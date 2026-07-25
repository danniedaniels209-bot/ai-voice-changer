"""
Local LLM runtime for the Script Studio and AI Chat: Qwen2.5-3B-Instruct.

Cloud-GPU gated by design: ~6 GB of fp16 weights generate comfortably on a
free Colab T4 but would take minutes per sentence on a laptop CPU — so the
model only loads where CUDA is available (or AVC_ENABLE_LLM=1 forces it).
On an unsupported machine the API reports unavailable with a clear reason
instead of degrading the whole app.
"""

from __future__ import annotations

import os
import threading

from app.core.errors import AppError
from app.core.logging import get_logger

logger = get_logger(__name__)

MODELS: dict[str, dict] = {
    "qwen": {
        "id": os.environ.get("AVC_LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct"),
        "label": "Qwen2.5 3B (fastest)",
        "download": "~6 GB",
        "quant4": False,
        "arch": "qwen2",
    },
    "qwen7b": {
        "id": "Qwen/Qwen2.5-7B-Instruct",
        "label": "Qwen2.5 7B (best all-round, 4-bit)",
        "download": "~5 GB in 4-bit",
        "quant4": True,
        "arch": "qwen2",
    },
    "qwen3-8b": {
        "id": "Qwen/Qwen3-8B",
        "label": "Qwen3 8B (smartest, 4-bit)",
        "download": "~5.5 GB in 4-bit",
        "quant4": True,  # fp16 would need ~16 GB — 4-bit fits a T4
        "arch": "qwen3",  # needs transformers >= 4.51
    },
    "hermes8b": {
        "id": "NousResearch/Hermes-3-Llama-3.1-8B",
        "label": "Hermes 3 8B (agentic, 4-bit)",
        "download": "~5.5 GB in 4-bit",
        "quant4": True,
        "arch": "llama",
    },
    "xlam-7b": {
        "id": "Salesforce/xLAM-7b-r",
        "label": "xLAM 7B (tool specialist, 4-bit)",
        "download": "~5 GB in 4-bit",
        "quant4": True,  # 7B fp16 (~14 GB) leaves no room for the pipeline models
        "arch": "mistral",
    },
}


def architecture_supported(key: str) -> tuple[bool, str]:
    """
    Can the installed transformers actually load this model? Checked against
    the library's own architecture registry, so a model whose type is unknown
    (e.g. qwen3 on transformers < 4.51) is reported BEFORE the user waits for
    a multi-GB download that would then fail.
    """
    arch = MODELS.get(key, {}).get("arch")
    if not arch:
        return True, ""
    try:
        from transformers.models.auto.configuration_auto import CONFIG_MAPPING_NAMES

        if arch in CONFIG_MAPPING_NAMES:
            return True, ""
        import transformers as _tf

        return False, (
            f"Needs a newer transformers than this session has "
            f"({_tf.__version__}) — start a fresh cloud session to use it."
        )
    except Exception:  # noqa: BLE001 — never block on an introspection failure
        return True, ""
# All models are ungated (no Hugging Face login needed) and download freely.
DEFAULT_MODEL = "qwen"

# Kept for backward compatibility (status endpoint, logs).
MODEL_ID = MODELS[DEFAULT_MODEL]["id"]

_lock = threading.Lock()
_active_key = DEFAULT_MODEL
_bundle = None  # (tokenizer, model) for _active_key

# Per-thread progress callback. A model switch means the FIRST reply after
# it has to download+load multi-GB weights, which can take minutes — without
# this, that time is indistinguishable from a hang. Each background chat/
# coder task sets this on its own worker thread before generating.
_status_local = threading.local()


def set_status_hook(callback) -> None:
    """Register callback(message: str) on the CURRENT thread, called with
    human-readable progress while a model loads. Call with None to clear."""
    _status_local.callback = callback


def _notify(message: str) -> None:
    callback = getattr(_status_local, "callback", None)
    if callback:
        try:
            callback(message)
        except Exception:  # noqa: BLE001 — a UI hiccup must never block generation
            pass


def active_model() -> str:
    return _active_key


def _delete_model_cache(model_id: str) -> None:
    """Delete a model's downloaded weights from the Hugging Face cache.
    Cloud sessions have a small disk, so keeping only the selected model on
    disk lets the picker offer many models without ever filling up."""
    try:
        from huggingface_hub import scan_cache_dir

        cache = scan_cache_dir()
        revisions = [
            rev.commit_hash
            for repo in cache.repos
            if repo.repo_id == model_id
            for rev in repo.revisions
        ]
        if revisions:
            cache.delete_revisions(*revisions).execute()
            logger.info("Freed disk: removed cached weights for %s", model_id)
    except Exception as exc:  # noqa: BLE001 — best-effort housekeeping
        logger.warning("Could not delete cache for %s: %s", model_id, exc)


def set_model(key: str) -> None:
    """Select the model generate()/chat() use. Frees the old model's VRAM so
    a T4 never holds two LLMs; the new one loads lazily on next use. On cloud
    sessions the old model's downloaded weights are also deleted from disk so
    only one model is ever stored — the picker can offer many without filling
    the session disk."""
    global _active_key, _bundle
    if key not in MODELS:
        raise AppError(f"Unknown model '{key}'. Available: {', '.join(MODELS)}")
    ok, why = architecture_supported(key)
    if not ok:
        # Fail here, not after a multi-GB download.
        raise AppError(f"{MODELS[key]['label']} can't run here. {why}")
    with _lock:
        if key == _active_key:
            return
        old_id = MODELS[_active_key]["id"]
        _active_key = key
        if _bundle is not None:
            _bundle = None
            try:
                import gc

                import torch

                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
        logger.info("LLM switched to %s (%s)", key, MODELS[key]["id"])
        # Cloud only (small ephemeral disk); local machines keep downloads so
        # switching back doesn't re-download over a home connection.
        if os.environ.get("AVC_AUTH_TOKEN") and old_id != MODELS[key]["id"]:
            _delete_model_cache(old_id)


def availability() -> tuple[bool, str]:
    if os.environ.get("AVC_ENABLE_LLM") == "1":
        return True, "enabled by AVC_ENABLE_LLM"
    try:
        import torch

        if torch.cuda.is_available():
            return True, f"GPU: {torch.cuda.get_device_name(0)}"
    except ImportError:
        pass
    return False, (
        "Script generation needs a GPU — start a cloud session "
        "(deploy/DEPLOY.md) and use the Studio there."
    )


def _free_pipeline_gpu_memory() -> None:
    """
    Whisper, Chatterbox and OpenVoice each cache a model in GPU memory for
    the life of the process and never release it on their own — on a T4's
    single shared ~15 GB, that competes directly with the chat LLM and is
    the most common cause of a CUDA out-of-memory error after converting a
    few videos and then opening chat. Best-effort: a missing/broken service
    must never block loading the LLM.
    """
    for module_name, func_name in (
        ("app.services.chatterbox_service", "release_model"),
        ("app.services.transcribe_service", "release_models"),
        ("app.services.expressive_service", "release_converter"),
    ):
        try:
            import importlib

            module = importlib.import_module(module_name)
            getattr(module, func_name)()
        except Exception as exc:  # noqa: BLE001 — best-effort reclaim only
            logger.debug("Could not free %s: %s", module_name, exc)


def _get_bundle():
    global _bundle
    with _lock:
        if _bundle is None:
            ok, reason = availability()
            if not ok:
                raise AppError(reason)
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            info = MODELS[_active_key]
            model_id = info["id"]
            logger.info(
                "Loading %s (first use downloads %s)...", model_id, info["download"]
            )
            if torch.cuda.is_available():
                _free_pipeline_gpu_memory()
            _notify(
                f"loading {info['label']} — downloads {info['download']} on "
                "first use this session, can take a few minutes"
            )
            tokenizer = AutoTokenizer.from_pretrained(model_id)
            _notify(f"loading {info['label']} — weights")
            wanted_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
            device_map = "auto" if torch.cuda.is_available() else None

            kwargs: dict = {"device_map": device_map}
            if info["quant4"] and torch.cuda.is_available():
                try:
                    from transformers import BitsAndBytesConfig

                    kwargs["quantization_config"] = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_compute_dtype=torch.float16,
                        bnb_4bit_quant_type="nf4",
                    )
                except ImportError:
                    logger.warning(
                        "bitsandbytes unavailable — loading %s at fp16 (needs a big GPU)",
                        model_id,
                    )
            try:
                # transformers >= 4.56 renamed torch_dtype -> dtype; older
                # versions (what Colab's pinned deps install) only know
                # torch_dtype and pass unknown kwargs into the model
                # constructor, which raises TypeError.
                model = AutoModelForCausalLM.from_pretrained(
                    model_id, torch_dtype=wanted_dtype, **kwargs
                )
            except TypeError:
                model = AutoModelForCausalLM.from_pretrained(
                    model_id, dtype=wanted_dtype, **kwargs
                )
            except ValueError as exc:
                # A newer architecture (e.g. Qwen3) on an older transformers.
                # Say so plainly instead of leaking a traceback to the UI.
                if "does not recognize this architecture" in str(exc) or "model type" in str(exc):
                    import transformers as _tf

                    raise AppError(
                        f"This session's transformers ({_tf.__version__}) is too old for "
                        f"{model_id}. Start a fresh cloud session to pick up the newer "
                        "version, or choose another model (Qwen2.5 3B works everywhere)."
                    ) from exc
                raise
            model.eval()
            _bundle = (tokenizer, model)
        return _bundle


def _strip_thinking(text: str) -> str:
    """Some models (Qwen3, sometimes Hermes) emit <think>…</think> reasoning
    before the answer — drop the reasoning but NEVER return an empty reply:
    if stripping would erase everything (e.g. the model spent its whole
    output inside an unclosed think block), fall back to the block's content
    so the user still gets an answer."""
    import re

    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    if "<think>" in cleaned:
        # Unclosed block: keep whatever came before it.
        cleaned = cleaned.split("<think>", 1)[0]
    cleaned = cleaned.strip()
    if cleaned:
        return cleaned
    # Everything was inside think tags — better to show the content than nothing.
    inner = re.sub(r"</?think>", "", text, flags=re.DOTALL).strip()
    return inner


def _render_prompt(tokenizer, messages: list[dict]) -> str:
    """Turn a message list into a prompt string, robust across model families.
    Tries the model's own chat template (Qwen3 also gets thinking disabled),
    and if a model ships without a usable template, falls back to a simple
    role-tagged prompt so generation can never hard-fail here."""
    try:
        return tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
    except TypeError:
        pass  # older/other models don't accept enable_thinking
    except Exception:
        return _manual_prompt(messages)
    try:
        return tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    except Exception:
        return _manual_prompt(messages)


def _manual_prompt(messages: list[dict]) -> str:
    parts = [f"{m['role'].capitalize()}: {m['content']}" for m in messages]
    parts.append("Assistant:")
    return "\n\n".join(parts)


def _run(messages: list[dict], max_new_tokens: int) -> str:
    import torch

    tokenizer, model = _get_bundle()
    prompt = _render_prompt(tokenizer, messages)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    # Different model families end their turn with different tokens (Qwen:
    # <|im_end|>, Llama 3 / Hermes: <|eot_id|>). If generate() only watches
    # the config's default eos, a mismatched model never stops — it fills the
    # whole token budget and the request times out with no reply. Stop on
    # every known end-of-turn token the tokenizer actually has.
    stop_ids: set[int] = set()
    if tokenizer.eos_token_id is not None:
        stop_ids.add(tokenizer.eos_token_id)
    for token in ("<|eot_id|>", "<|im_end|>", "<|end_of_text|>", "<|endoftext|>"):
        tid = tokenizer.convert_tokens_to_ids(token)
        if isinstance(tid, int) and tid >= 0 and tid != getattr(tokenizer, "unk_token_id", None):
            stop_ids.add(tid)

    def _generate():
        with _lock, torch.no_grad():
            return model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=True,
                temperature=0.7,
                top_p=0.9,
                eos_token_id=sorted(stop_ids) if stop_ids else None,
                pad_token_id=tokenizer.pad_token_id
                if tokenizer.pad_token_id is not None
                else tokenizer.eos_token_id,
            )

    # Serialized: a 3B model on a T4 is fast enough that queueing beats the
    # VRAM cost of concurrency.
    try:
        output = _generate()
    except torch.cuda.OutOfMemoryError:
        # Most common cause on a T4: a pipeline model (Whisper/Chatterbox/
        # OpenVoice) from an earlier conversion is still resident. Free it
        # and retry once before giving up with a clear, actionable message.
        logger.warning("CUDA OOM during generation — freeing pipeline models and retrying once")
        _notify("out of memory — freeing other models and retrying...")
        torch.cuda.empty_cache()
        _free_pipeline_gpu_memory()
        torch.cuda.empty_cache()
        try:
            output = _generate()
        except torch.cuda.OutOfMemoryError as exc:
            torch.cuda.empty_cache()
            raise AppError(
                f"The GPU ran out of memory generating with {MODELS[_active_key]['label']}. "
                "This session's T4 has ~15 GB shared between every model — try a smaller "
                "model (Qwen2.5 3B), or restart the cloud session to clear all GPU memory."
            ) from exc
    text = tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return _strip_thinking(text)


def generate(system: str, user: str, max_new_tokens: int = 1024) -> str:
    """One chat completion (system + single user turn)."""
    return _run(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_new_tokens,
    )


def chat(messages: list[dict], max_new_tokens: int = 1024) -> str:
    """Multi-turn chat completion. messages: [{role, content}, ...]."""
    return _run(messages, max_new_tokens)
