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
        "label": "Qwen2.5 3B (fast, default)",
        "download": "~6 GB",
        "quant4": False,
    },
    "qwen3-8b": {
        "id": "Qwen/Qwen3-8B",
        "label": "Qwen3 8B (smartest, 4-bit)",
        "download": "~5.5 GB in 4-bit",
        "quant4": True,  # fp16 would need ~16 GB — 4-bit fits a T4
    },
    "hermes3": {
        "id": "NousResearch/Hermes-3-Llama-3.2-3B",
        "label": "Hermes 3 (Llama 3.2 3B)",
        "download": "~6 GB",
        "quant4": False,
    },
}
DEFAULT_MODEL = "qwen"

# Kept for backward compatibility (status endpoint, logs).
MODEL_ID = MODELS[DEFAULT_MODEL]["id"]

_lock = threading.Lock()
_active_key = DEFAULT_MODEL
_bundle = None  # (tokenizer, model) for _active_key


def active_model() -> str:
    return _active_key


def set_model(key: str) -> None:
    """Select the model generate()/chat() use. Frees the old model's VRAM so
    a T4 never holds two LLMs; the new one loads lazily on next use."""
    global _active_key, _bundle
    if key not in MODELS:
        raise AppError(f"Unknown model '{key}'. Available: {', '.join(MODELS)}")
    with _lock:
        if key == _active_key:
            return
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
            tokenizer = AutoTokenizer.from_pretrained(model_id)
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


def _run(messages: list[dict], max_new_tokens: int) -> str:
    import torch

    tokenizer, model = _get_bundle()
    try:
        # Qwen3 supports disabling its thinking mode at the template level.
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
    except TypeError:
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    # Serialized: a 3B model on a T4 is fast enough that queueing beats the
    # VRAM cost of concurrency.
    with _lock, torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id,
        )
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
