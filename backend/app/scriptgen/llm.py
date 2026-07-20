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

# Default fits a free T4 alongside the other models; override with
# AVC_LLM_MODEL (e.g. Qwen/Qwen2.5-7B-Instruct on a bigger GPU).
MODEL_ID = os.environ.get("AVC_LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct")

_lock = threading.Lock()
_bundle = None  # (tokenizer, model)


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

            logger.info("Loading %s (first use downloads ~6 GB)...", MODEL_ID)
            tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
            wanted_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
            device_map = "auto" if torch.cuda.is_available() else None
            try:
                # transformers >= 4.56 renamed torch_dtype -> dtype; older
                # versions (what Colab's pinned deps install) only know
                # torch_dtype and pass unknown kwargs into the model
                # constructor, which raises TypeError.
                model = AutoModelForCausalLM.from_pretrained(
                    MODEL_ID, torch_dtype=wanted_dtype, device_map=device_map
                )
            except TypeError:
                model = AutoModelForCausalLM.from_pretrained(
                    MODEL_ID, dtype=wanted_dtype, device_map=device_map
                )
            model.eval()
            _bundle = (tokenizer, model)
        return _bundle


def _run(messages: list[dict], max_new_tokens: int) -> str:
    import torch

    tokenizer, model = _get_bundle()
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
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
    return text.strip()


def generate(system: str, user: str, max_new_tokens: int = 1024) -> str:
    """One chat completion (system + single user turn)."""
    return _run(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_new_tokens,
    )


def chat(messages: list[dict], max_new_tokens: int = 1024) -> str:
    """Multi-turn chat completion. messages: [{role, content}, ...]."""
    return _run(messages, max_new_tokens)
