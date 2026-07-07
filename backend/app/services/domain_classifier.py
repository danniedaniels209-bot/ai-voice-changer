"""
Zero-shot domain detection — decides whether a transcript is about
technology WITHOUT any keyword list.

How: a small sentence-embedding model (MiniLM, ~90 MB, runs on CPU in
milliseconds) embeds the transcript and a pair of natural-language anchor
descriptions; cosine similarity tells us which description the transcript
is semantically closer to. Because the comparison happens in meaning-space,
it generalizes to vocabulary that never appears in this file — a sentence
about "distilling the checkpoint onto the new accelerator" classifies as
technical even though none of those words is listed anywhere.

If the model isn't available (first run offline), callers fall back to the
keyword heuristic in context_recognition — degraded, never broken.
"""

from __future__ import annotations

import threading

from app.core.logging import get_logger

logger = get_logger(__name__)

_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"

# Anchor descriptions of the two domains. These are PROSE, not keyword
# lists: the classifier measures semantic similarity to whole descriptions,
# so specific product names never need to appear here.
_TECH_ANCHOR = (
    "A video about artificial intelligence, machine learning models, "
    "software development, programming, computer hardware, APIs, "
    "developer tools, and technology products."
)
_CASUAL_ANCHOR = (
    "An everyday conversation about ordinary life: family, food, travel, "
    "shopping, feelings, relationships, and daily activities."
)

_lock = threading.Lock()
_bundle = None  # (tokenizer, model, anchor_embeddings)


class ClassifierUnavailable(Exception):
    """The embedding model can't be loaded (e.g. offline first run)."""


def _mean_pool(last_hidden, attention_mask):
    import torch

    mask = attention_mask.unsqueeze(-1).float()
    summed = (last_hidden * mask).sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1e-9)
    return summed / counts


def _embed(texts: list[str]):
    import torch

    tokenizer, model, _ = _get_bundle()
    with torch.no_grad():
        batch = tokenizer(texts, padding=True, truncation=True, max_length=256, return_tensors="pt")
        out = model(**batch)
        emb = _mean_pool(out.last_hidden_state, batch["attention_mask"])
        return torch.nn.functional.normalize(emb, dim=1)


def _get_bundle():
    global _bundle
    with _lock:
        if _bundle is None:
            try:
                import torch
                from transformers import AutoModel, AutoTokenizer

                logger.info("Loading domain classifier (%s)...", _MODEL_ID)
                try:
                    # Cache-first: NEVER touch the network when the model is
                    # already on disk — a hung update-check here once froze a
                    # whole conversion for hours.
                    tokenizer = AutoTokenizer.from_pretrained(_MODEL_ID, local_files_only=True)
                    model = AutoModel.from_pretrained(_MODEL_ID, local_files_only=True)
                except Exception:
                    logger.info("Domain classifier not cached — downloading (~90 MB)...")
                    tokenizer = AutoTokenizer.from_pretrained(_MODEL_ID)
                    model = AutoModel.from_pretrained(_MODEL_ID)
                model.eval()
                _bundle = (tokenizer, model, None)
                # Pre-compute anchors once.
                anchors = _embed([_TECH_ANCHOR, _CASUAL_ANCHOR])
                _bundle = (tokenizer, model, anchors)
            except Exception as exc:
                _bundle = None
                raise ClassifierUnavailable(str(exc)) from exc
        return _bundle


def technical_score(text: str) -> float:
    """
    Semantic technicality of `text` in [-1, 1]: positive = closer to the
    technology anchor, negative = closer to everyday conversation.
    Raises ClassifierUnavailable if the model can't be loaded.
    """
    if not text.strip():
        return 0.0
    _, _, anchors = _get_bundle()
    emb = _embed([text[:4000]])
    sim_tech = float((emb @ anchors[0].unsqueeze(1)).item())
    sim_casual = float((emb @ anchors[1].unsqueeze(1)).item())
    return sim_tech - sim_casual


def is_technical(text: str, margin: float = 0.02) -> bool:
    """True when the text is semantically closer to technology than to
    everyday conversation by at least `margin`."""
    return technical_score(text) > margin
