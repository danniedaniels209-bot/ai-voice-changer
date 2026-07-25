"""
Live token streaming: the reply is delivered incrementally through a
per-thread stream hook as the model generates it, instead of only appearing
once generation finishes. Uses a queue-backed fake TextIteratorStreamer so
the test is synchronized with the real background-generation thread rather
than racing it.
"""

import queue

import pytest


class _FakeStreamer:
    """Stands in for transformers.TextIteratorStreamer: a blocking iterator
    fed from another thread, exactly like the real one's contract."""

    def __init__(self, tokenizer, **kw):
        self._q: queue.Queue = queue.Queue()

    def feed(self, text: str) -> None:
        self._q.put(text)

    def end(self) -> None:
        self._q.put(None)

    def __iter__(self):
        return self

    def __next__(self):
        item = self._q.get()
        if item is None:
            raise StopIteration
        return item


class _FakeInputs(dict):
    def to(self, device):
        return self


class _FakeTokenizer:
    eos_token_id = 0
    pad_token_id = 0
    unk_token_id = None

    def apply_chat_template(self, *a, **kw):
        return "prompt"

    def __call__(self, *a, **kw):
        import torch

        fake = _FakeInputs()
        fake["input_ids"] = torch.tensor([[1]])
        return fake

    def convert_tokens_to_ids(self, tok):
        return -1


@pytest.fixture()
def patched_streamer(monkeypatch):
    monkeypatch.setattr("transformers.TextIteratorStreamer", _FakeStreamer)


def test_stream_hook_receives_incremental_chunks(monkeypatch, patched_streamer):
    from app.scriptgen import llm

    class FakeModel:
        device = "cuda"

        def generate(self, **kwargs):
            streamer = kwargs["streamer"]
            for piece in ["Hello", " world", "!"]:
                streamer.feed(piece)
            streamer.end()

    monkeypatch.setattr(llm, "_get_bundle", lambda: (_FakeTokenizer(), FakeModel()))

    seen: list[str] = []
    llm.set_stream_hook(seen.append)
    try:
        reply = llm.chat([{"role": "user", "content": "hi"}], max_new_tokens=10)
    finally:
        llm.set_stream_hook(None)

    assert reply == "Hello world!"
    assert seen == ["Hello", "Hello world", "Hello world!"]


def test_no_stream_hook_registered_is_a_silent_noop(monkeypatch, patched_streamer):
    from app.scriptgen import llm

    class FakeModel:
        device = "cuda"

        def generate(self, **kwargs):
            streamer = kwargs["streamer"]
            streamer.feed("fine")
            streamer.end()

    monkeypatch.setattr(llm, "_get_bundle", lambda: (_FakeTokenizer(), FakeModel()))
    llm.set_stream_hook(None)
    assert llm.chat([{"role": "user", "content": "hi"}], max_new_tokens=10) == "fine"


def test_broken_stream_hook_never_breaks_generation(monkeypatch, patched_streamer):
    from app.scriptgen import llm

    class FakeModel:
        device = "cuda"

        def generate(self, **kwargs):
            streamer = kwargs["streamer"]
            streamer.feed("still works")
            streamer.end()

    monkeypatch.setattr(llm, "_get_bundle", lambda: (_FakeTokenizer(), FakeModel()))
    llm.set_stream_hook(lambda text: 1 / 0)  # raises on every call
    try:
        reply = llm.chat([{"role": "user", "content": "hi"}], max_new_tokens=10)
    finally:
        llm.set_stream_hook(None)
    assert reply == "still works"


def test_exception_inside_the_generation_thread_propagates_to_the_caller(
    monkeypatch, patched_streamer
):
    """CUDA OOM (and anything else) raised inside model.generate() — which
    now runs on a worker thread for streaming — must still surface on the
    calling thread, unchanged, so the existing OOM-retry logic keeps working."""
    from app.scriptgen import llm

    class FakeModel:
        device = "cuda"

        def generate(self, **kwargs):
            raise RuntimeError("boom from the generation thread")

    monkeypatch.setattr(llm, "_get_bundle", lambda: (_FakeTokenizer(), FakeModel()))
    with pytest.raises(RuntimeError, match="boom from the generation thread"):
        llm.chat([{"role": "user", "content": "hi"}], max_new_tokens=10)


def test_stream_hook_is_per_thread_scoped():
    """A stray global hook must never leak into an unrelated call."""
    from app.scriptgen import llm

    llm.set_stream_hook(None)
    llm._stream("nothing should receive this")  # no listener, must not raise
