"""
Local LLM runtime for the Script Studio: Qwen2.5-3B-Instruct.

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

MODEL_ID = "Qwen/Qwen2.5-3B-Instruct"

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
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_ID,
                dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map="auto" if torch.cuda.is_available() else None,
            )
            model.eval()
            _bundle = (tokenizer, model)
        return _bundle


def generate(system: str, user: str, max_new_tokens: int = 1024) -> str:
    """One chat completion. Serialized: a 3B model on a T4 is fast enough
    that queueing beats the VRAM cost of concurrency."""
    import torch

    tokenizer, model = _get_bundle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

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
