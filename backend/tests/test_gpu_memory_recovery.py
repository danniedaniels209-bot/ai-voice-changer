"""
GPU memory recovery: pipeline models (Whisper/Chatterbox/OpenVoice) cache
themselves in VRAM for the life of the process and never release on their
own — on a T4's single shared ~15 GB that starves the chat LLM after a few
conversions. These prove the release hooks work and that generation
recovers from a real CUDA OOM instead of dying with a raw traceback.
"""

import types

import pytest


def test_chatterbox_release_clears_cache(monkeypatch):
    from app.services import chatterbox_service as cbs

    cbs._model = object()
    cbs._model_device = "cuda"
    cbs.release_model()
    assert cbs._model is None
    assert cbs._model_device is None


def test_chatterbox_release_is_a_noop_when_nothing_loaded():
    from app.services import chatterbox_service as cbs

    cbs._model = None
    cbs.release_model()  # must not raise
    assert cbs._model is None


def test_whisper_release_clears_all_cached_devices():
    from app.services import transcribe_service as ts

    ts._model_cache[("large-v3", "cuda")] = object()
    ts._model_cache[("large-v3", "cpu")] = object()
    ts.release_models()
    assert ts._model_cache == {}


def test_openvoice_release_clears_cache():
    from app.services import expressive_service as exs

    exs._converter = object()
    exs._converter_device = "cuda"
    exs.release_converter()
    assert exs._converter is None
    assert exs._converter_device is None


def test_free_pipeline_gpu_memory_calls_every_service(monkeypatch):
    from app.scriptgen import llm

    called = []
    monkeypatch.setattr("app.services.chatterbox_service.release_model", lambda: called.append("cb"))
    monkeypatch.setattr("app.services.transcribe_service.release_models", lambda: called.append("wh"))
    monkeypatch.setattr("app.services.expressive_service.release_converter", lambda: called.append("ov"))

    llm._free_pipeline_gpu_memory()
    assert set(called) == {"cb", "wh", "ov"}


def test_free_pipeline_gpu_memory_survives_a_broken_service(monkeypatch):
    """One service raising must not stop the others from being freed, and
    must never propagate — this runs on every model load."""
    from app.scriptgen import llm

    called = []

    def boom():
        raise RuntimeError("this service is broken")

    monkeypatch.setattr("app.services.chatterbox_service.release_model", boom)
    monkeypatch.setattr("app.services.transcribe_service.release_models", lambda: called.append("wh"))
    monkeypatch.setattr("app.services.expressive_service.release_converter", lambda: called.append("ov"))

    llm._free_pipeline_gpu_memory()  # must not raise
    assert set(called) == {"wh", "ov"}


def test_generation_recovers_from_oom_by_freeing_memory_and_retrying(monkeypatch):
    """First attempt OOMs (as in production, from other cached models eating
    VRAM); after freeing pipeline memory, the retry succeeds."""
    from app.core.errors import AppError
    from app.scriptgen import llm

    attempts = {"n": 0}

    class FakeOutput:
        def __getitem__(self, i):
            return [1, 2, 3]

    class FakeInputs(dict):
        def to(self, device):
            return self

    class FakeTokenizer:
        eos_token_id = 0
        pad_token_id = 0
        unk_token_id = None

        def apply_chat_template(self, *a, **kw):
            return "prompt"

        def __call__(self, *a, **kw):
            import torch as _t
            fake = FakeInputs()
            fake["input_ids"] = _t.tensor([[1]])
            return fake

        def convert_tokens_to_ids(self, tok):
            return -1

        def decode(self, *a, **kw):
            return "the answer"

    class FakeModel:
        device = "cuda"

        def generate(self, **kw):
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise torch_module.cuda.OutOfMemoryError("CUDA out of memory")
            return FakeOutput()

    import torch as torch_module

    monkeypatch.setattr(llm, "_get_bundle", lambda: (FakeTokenizer(), FakeModel()))
    monkeypatch.setattr(llm, "_free_pipeline_gpu_memory", lambda: None)

    reply = llm._run([{"role": "user", "content": "hi"}], max_new_tokens=10)
    assert attempts["n"] == 2  # failed once, recovered on retry
    assert reply == "the answer"


def test_generation_gives_a_clear_message_when_still_oom_after_retry(monkeypatch):
    """If freeing memory doesn't help, the user sees an actionable message,
    not a multi-hundred-line CUDA memory dump."""
    from app.core.errors import AppError
    from app.scriptgen import llm

    class FakeInputs(dict):
        def to(self, device):
            return self

    class FakeTokenizer:
        eos_token_id = 0
        pad_token_id = 0
        unk_token_id = None

        def apply_chat_template(self, *a, **kw):
            return "prompt"

        def __call__(self, *a, **kw):
            import torch as _t
            fake = FakeInputs()
            fake["input_ids"] = _t.tensor([[1]])
            return fake

        def convert_tokens_to_ids(self, tok):
            return -1

    import torch as torch_module

    class FakeModel:
        device = "cuda"

        def generate(self, **kw):
            raise torch_module.cuda.OutOfMemoryError("CUDA out of memory")

    monkeypatch.setattr(llm, "_get_bundle", lambda: (FakeTokenizer(), FakeModel()))
    monkeypatch.setattr(llm, "_free_pipeline_gpu_memory", lambda: None)

    with pytest.raises(AppError, match="ran out of memory"):
        llm._run([{"role": "user", "content": "hi"}], max_new_tokens=10)
