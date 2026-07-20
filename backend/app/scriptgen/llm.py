"""
Local LLM runtime for the Script Studio and AI Chat.

Two selectable models:
  - qwen    Qwen2.5-3B-Instruct (~6 GB) — fits a free Colab T4 comfortably.
  - gpt-oss openai/gpt-oss-20b (~13 GB MXFP4) — needs a bigger GPU (L4/A100);
            on a T4 it may offload to CPU and run slowly.

Cloud-GPU gated by design: these would take minutes per sentence on a laptop
CPU, so the models only load where CUDA is available (or AVC_ENABLE_LLM=1
forces it). On an unsupported machine the API reports unavailable with a
clear reason instead of degrading the whole app.
"""

from __future__ import annotations

import os
import threading

from app.core.errors import AppError
from app.core.logging import get_logger

logger = get_logger(__name__)

MODELS: dict[str, dict[str, str]] = {
    "qwen": {
        "id": os.environ.get("AVC_LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct"),
        "label": "Qwen2.5 3B (recommended)",
        "download": "~6 GB — fits a free T4",
    },
    "gpt-oss": {
        "id": "openai/gpt-oss-20b",
        "label": "GPT-OSS 20B (bigger, slower)",
        "download": "~13 GB — best on L4/A100; slow on a T4",
    },
}
DEFAULT_MODEL = "qwen"

# Kept for backward compatibility (status endpoint, logs).
MODEL_ID = MODELS[DEFAULT_MODEL]["id"]

_lock = threading.Lock()
_active_key = DEFAULT_MODEL
_bundle = None  # (tokenizer, model) for _active_key


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


def active_model() -> str:
    return _active_key


def set_model(key: str) -> None:
    """Select which model generate()/chat() use. Frees the old model's VRAM
    so a T4 isn't holding two LLMs at once. The new one loads (and downloads
    on first use) lazily at the next generation call."""
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


def _get_bundle():
    global _bundle
    with _lock:
        if _bundle is None:
            ok, reason = availability()
            if not ok:
                raise AppError(reason)
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            model_id = MODELS[_active_key]["id"]
            logger.info(
                "Loading %s (first use downloads %s)...",
                model_id,
                MODELS[_active_key]["download"],
            )
            tokenizer = AutoTokenizer.from_pretrained(model_id)
            model = AutoModelForCausalLM.from_pretrained(
                model_id,
                dtype="auto" if _active_key == "gpt-oss" else (
                    torch.float16 if torch.cuda.is_available() else torch.float32
                ),
                device_map="auto" if torch.cuda.is_available() else None,
            )
            model.eval()
            _bundle = (tokenizer, model)
        return _bundle


def _extract_final(text: str) -> str:
    """GPT-OSS emits harmony channels (analysis reasoning, then a final
    channel). Return only the final answer; pass other models' output through."""
    marker = "final<|message|>"
    if marker in text:
        text = text.rsplit(marker, 1)[1]
    for token in ("<|return|>", "<|end|>", "<|channel|>"):
        text = text.split(token)[0]
    return text.strip()


def _run(messages: list[dict], max_new_tokens: int) -> str:
    import torch

    tokenizer, model = _get_bundle()
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    # Serialized: one generation at a time — queueing beats the VRAM cost
    # of concurrency on a single GPU.
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
    return _extract_final(text)


def generate(system: str, user: str, max_new_tokens: int = 1024) -> str:
    """One chat completion (system + single user turn)."""
    return _run(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_new_tokens,
    )


def chat(messages: list[dict], max_new_tokens: int = 1024) -> str:
    """Multi-turn chat completion. messages: [{role, content}, ...]."""
    return _run(messages, max_new_tokens)
