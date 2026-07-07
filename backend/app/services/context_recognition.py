"""
Context-Aware Technical Recognition — a modular post-transcription layer
that protects technical terminology (AI models, products, companies,
frameworks, APIs, people, projects) from being treated as ordinary English.

Design (deliberately NOT a dictionary):
- Whisper reports a per-word confidence. An unfamiliar technical term the
  model wasn't sure about gets a LOW probability even when the letters it
  emitted are right.
- We compute a "technical context" score for each sentence from surrounding
  indicator words ("model", "API", "framework"...) and trigger phrases
  ("released by", "built with", "powered by"...). The indicators describe
  the CONTEXT, not the terms themselves — new products/models that don't
  exist yet still get recognized because the sentences around them look
  technical.
- In technical context, low-confidence words are PRESERVED verbatim
  (never substituted — we have no alternative source, and replacing an
  uncertain technical term with a common word is exactly the failure mode
  this layer exists to prevent) and, when the position suggests a name
  (right after a trigger phrase, or shaped like an identifier), their
  capitalization is normalized to proper-noun form.
- Timestamps are never touched: only the `text` of segments is adjusted,
  so subtitle synchronization and downstream timing are unchanged.

The layer is independent of the transcription engine: it consumes plain
SpeechSegments (with optional word confidences) and returns the same shape,
so a future engine or a smarter recognizer can drop in behind the same
interface.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.logging import get_logger
from app.services.transcribe_service import SpeechSegment

logger = get_logger(__name__)

# Context INDICATORS — words that make the surrounding sentence "technical".
# These describe domains, not terms: they let us recognize technology names
# that did not exist when this file was written.
_CONTEXT_INDICATORS = {
    "model", "models", "ai", "framework", "frameworks", "library", "libraries",
    "api", "apis", "sdk", "python", "javascript", "typescript", "code", "coding",
    "github", "repository", "repo", "gpu", "cpu", "llm", "llms", "neural",
    "machine", "learning", "training", "trained", "dataset", "open-source",
    "opensource", "software", "app", "application", "startup", "tech",
    "version", "release", "released", "beta", "server", "cloud", "database",
    "algorithm", "chip", "hardware", "browser", "plugin", "package",
    # ML/dev vocabulary — still domain describers, not product names
    "inference", "token", "tokens", "prompt", "prompts", "deploy", "deployed",
    "deployment", "endpoint", "backend", "frontend", "runtime", "compiler",
    "kernel", "benchmark", "benchmarks", "weights", "parameters", "checkpoint",
    "transformer", "embedding", "embeddings", "quantized", "quantization",
    "fine-tune", "finetune", "finetuned", "fine-tuned", "agent", "agents",
    "chatbot", "terminal", "docker", "install", "integration", "latency",
    "context", "multimodal", "reasoning", "hallucination", "hallucinations",
}

# A video whose transcript crosses these thresholds is treated as a
# TECHNICAL VIDEO: from then on, EVERY sentence gets conservative handling,
# even ones without local indicators — in a tech video, an unfamiliar word
# anywhere is more likely a product name than a transcription slip.
_DOC_TECHNICAL_SEGMENT_RATIO = 0.30
_DOC_TECHNICAL_MIN_HITS = 8

# Trigger phrases — the word(s) right after these are very likely a
# product/company/person name regardless of overall context.
_TRIGGER_PHRASES = (
    "released by", "built with", "powered by", "made by", "developed by",
    "created by", "using", "supports", "integrates with", "called",
    "named", "from", "built on", "runs on", "based on",
)

# Words in technical context with Whisper confidence below this are treated
# as "uncertain technical terms" and protected.
_LOW_CONFIDENCE = 0.55

# Sentences need this many indicator hits (or one trigger phrase) to count
# as technical context.
_MIN_INDICATOR_HITS = 2

_WORD_RE = re.compile(r"[A-Za-z0-9][\w.+\-]*")


@dataclass
class RecognitionDecision:
    word: str
    action: str  # "preserved" | "capitalized"
    reason: str


def _english_rarity_ok() -> bool:
    try:
        import wordfreq  # noqa: F401

        return True
    except ImportError:
        return False


def _is_rare_in_english(word: str) -> bool:
    """
    Statistical term detection — NO vocabulary list: `wordfreq` scores a
    word's frequency in general English. Product/model/company names
    (present and FUTURE ones) score near zero ("qwen"=0.0, "groq"=0.0,
    "anthropic"=1.9) while ordinary words score high ("beach"=4.9). A rare
    word in a technical context is treated as terminology to preserve.
    """
    w = word.strip(".,!?()").lower()
    if len(w) < 3 or not any(c.isalpha() for c in w):
        return False
    try:
        from wordfreq import zipf_frequency

        return zipf_frequency(w, "en") < 3.5
    except ImportError:
        return False


def _looks_like_identifier(word: str) -> bool:
    """CamelCase, mixed alphanumerics, dots or dashes: PyTorch, GPT4, k8s, node.js"""
    w = word.strip(".,!?")
    if any(c.isdigit() for c in w) and any(c.isalpha() for c in w):
        return True
    if re.search(r"[a-z][A-Z]", w):  # internal capital
        return True
    if "." in w or "-" in w:
        return True
    return False


def _indicator_hits(text: str) -> int:
    return sum(1 for w in _WORD_RE.findall(text.lower()) if w in _CONTEXT_INDICATORS)


def _technical_score(text: str) -> tuple[bool, bool]:
    """Returns (is_technical_context, has_trigger_phrase)."""
    lower = text.lower()
    hits = _indicator_hits(text)
    has_trigger = any(p in lower for p in _TRIGGER_PHRASES)
    return hits >= _MIN_INDICATOR_HITS or has_trigger, has_trigger


def is_technical_document(segments: list[SpeechSegment]) -> bool:
    """
    Document-level detection: is this VIDEO about technology?

    Primary path — zero-shot SEMANTIC classification (domain_classifier):
    the whole transcript is compared in embedding space against natural-
    language descriptions of "technology content" vs "everyday
    conversation". No keyword list is involved, so it generalizes to
    vocabulary that didn't exist when this code was written.

    Fallback path — if the embedding model isn't available (offline first
    run), the keyword-clue heuristic below keeps the feature working in a
    degraded mode rather than silently off.
    """
    if not segments:
        return False

    transcript = " ".join(s.text for s in segments)
    try:
        # Watchdog: this is an OPTIONAL enhancement — it must never be able
        # to stall a conversion. The classifier runs in a worker thread with
        # a hard deadline; on timeout (e.g. a wedged network socket after a
        # sleep/wake cycle) we fall back to keywords and move on.
        import concurrent.futures

        from app.services import domain_classifier

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(domain_classifier.technical_score, transcript)
            score = future.result(timeout=60)
        verdict = score > 0.02
        logger.info(
            "Domain classifier (semantic): %s (score %+.3f)",
            "technical" if verdict else "conversational",
            score,
        )
        return verdict
    except concurrent.futures.TimeoutError:
        logger.warning("Domain classifier timed out after 60s - using keyword fallback.")
    except Exception as exc:
        logger.warning("Domain classifier unavailable (%s) - using keyword fallback.", exc)

    technical_segments = sum(1 for s in segments if _technical_score(s.text)[0])
    total_hits = sum(_indicator_hits(s.text) for s in segments)
    return (
        technical_segments / len(segments) >= _DOC_TECHNICAL_SEGMENT_RATIO
        or total_hits >= _DOC_TECHNICAL_MIN_HITS
    )


def _follows_trigger(text_before: str) -> bool:
    lower = text_before.lower().rstrip()
    return any(lower.endswith(p) for p in _TRIGGER_PHRASES)


def refine_segments(segments: list[SpeechSegment]) -> tuple[list[SpeechSegment], list[RecognitionDecision]]:
    """
    Applies context-aware recognition to transcribed segments. Only segment
    TEXT may change (capitalization of detected names); start/end times and
    word timings are returned untouched. Returns (segments, decisions) so
    the pipeline can log what was recognized.
    """
    decisions: list[RecognitionDecision] = []
    refined: list[SpeechSegment] = []

    doc_technical = is_technical_document(segments)
    if doc_technical:
        logger.info(
            "Technical video detected — conservative transcription handling "
            "applies to the entire recording."
        )

    for seg in segments:
        technical, _ = _technical_score(seg.text)
        # In a technical VIDEO, every sentence is handled conservatively —
        # product names don't only appear in indicator-heavy sentences.
        if not (technical or doc_technical) or not seg.words:
            refined.append(seg)
            continue

        new_words: list[str] = []
        rebuilt = ""
        for w in seg.words:
            word = w.word
            uncertain = w.probability < _LOW_CONFIDENCE
            is_name_shaped = _looks_like_identifier(word)
            rare = _is_rare_in_english(word)
            after_trigger = _follows_trigger(rebuilt)

            if uncertain or is_name_shaped or rare:
                out = word
                # Proper-noun capitalization when position/shape says "name".
                if (after_trigger or is_name_shaped or rare) and out and out[0].isalpha() and out[0].islower():
                    # Don't capitalize obvious common words after triggers
                    # like "using the ..." — only uncertain/rare/identifier words.
                    if uncertain or is_name_shaped or rare:
                        out = out[0].upper() + out[1:]
                        decisions.append(
                            RecognitionDecision(
                                word=word,
                                action="capitalized",
                                reason=(
                                    "name position" if after_trigger
                                    else "identifier shape" if is_name_shaped
                                    else "rare in general English"
                                ),
                            )
                        )
                if (uncertain or rare) and out == word:
                    decisions.append(
                        RecognitionDecision(
                            word=word,
                            action="preserved",
                            reason=(
                                f"rare in general English"
                                if rare and not uncertain
                                else f"low confidence ({w.probability:.2f}) in technical context"
                            ),
                        )
                    )
                new_words.append(out)
            else:
                new_words.append(word)
            rebuilt = (rebuilt + " " + word).strip()

        new_text = " ".join(new_words).strip()
        # Timestamps and word timings are intentionally copied unchanged.
        refined.append(
            SpeechSegment(start=seg.start, end=seg.end, text=new_text or seg.text, words=seg.words)
        )

    if decisions:
        summary = ", ".join(f"{d.word} ({d.action})" for d in decisions[:8])
        logger.info("Context recognition: %d decision(s): %s", len(decisions), summary)
    return refined, decisions
