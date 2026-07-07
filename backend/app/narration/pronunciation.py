"""
Pronunciation Engine — rewrites text into its natural SPOKEN form before it
reaches any TTS engine. Rule-based (no dictionary of products): each rule
targets a PATTERN (currency, units, versions, URLs, acronym shapes), so it
generalizes to values and names that don't exist yet.
"""

from __future__ import annotations

import re

_UNITS = {
    "TB": "terabytes", "GB": "gigabytes", "MB": "megabytes", "KB": "kilobytes",
    "GHz": "gigahertz", "MHz": "megahertz", "Hz": "hertz",
    "ms": "milliseconds", "fps": "frames per second",
}

_VOWELS = set("AEIOUY")


def _spell_out(acronym: str) -> str:
    return " ".join(acronym)


def _speak_digits(digits: str) -> str:
    return " ".join(digits)


def _currency(m: re.Match) -> str:
    whole, cents = m.group(1), m.group(2)
    out = f"{whole} dollars"
    if cents and int(cents) > 0:
        out += f" and {int(cents)} cents"
    return out


def _decimal(m: re.Match) -> str:
    # 3.14 -> "3 point 1 4" (digits after the point are spoken separately)
    return f"{m.group(1)} point {_speak_digits(m.group(2))}"


def _url(m: re.Match) -> str:
    host = m.group("host")
    return host.replace("www.", "").replace(".", " dot ")


def to_speakable(text: str) -> str:
    """Applies all pronunciation rules. Order matters: composite patterns
    (URLs, currency) before the generic ones (decimals, acronyms)."""
    out = text

    # URLs and emails
    out = re.sub(r"https?://(?:www\.)?(?P<host>[\w.-]+)(?:/\S*)?", _url, out)
    out = re.sub(
        r"\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b",
        lambda m: f"{m.group(1)} at {m.group(2).replace('.', ' dot ')}",
        out,
    )

    # Money, percentages, temperatures
    out = re.sub(r"\$(\d+)(?:\.(\d{2}))?", _currency, out)
    out = re.sub(r"(\d+(?:\.\d+)?)%", r"\1 percent", out)

    # Times: 12:30 PM -> "12 30 PM"
    out = re.sub(r"\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b",
                 lambda m: f"{m.group(1)} {m.group(2)}" + (f" {m.group(3)}" if m.group(3) else ""),
                 out)

    # Storage/frequency units: 16GB -> "16 gigabytes"
    def _unit(m: re.Match) -> str:
        return f"{m.group(1)} {_UNITS[m.group(2)]}"

    out = re.sub(r"\b(\d+(?:\.\d+)?)\s?(" + "|".join(_UNITS) + r")\b", _unit, out)

    # Name-with-number products: GPT-5 -> "GPT 5", IPv6 -> "IP v 6"
    out = re.sub(r"\b([A-Za-z]{2,})-(\d+(?:\.\d+)?)\b", r"\1 \2", out)
    out = re.sub(r"\b([A-Z]{2,})v(\d+)\b", r"\1 v \2", out)

    # Versions & decimals: "version 3.7" / 3.14 -> spoken point form.
    # Years (4-digit integers) are left alone — TTS reads them naturally.
    out = re.sub(r"\b(\d+)\.(\d+)\b", _decimal, out)

    # Acronym spelling: ALL-CAPS with no vowels can't be pronounced as a
    # word (SDK, HTTP, GPU) -> spell the letters. Vowel-bearing caps (CUDA,
    # ONNX, NASA) are usually spoken as words -> left alone.
    def _acronym(m: re.Match) -> str:
        word = m.group(0)
        if not set(word) & _VOWELS:
            return _spell_out(word)
        return word

    out = re.sub(r"\b[A-Z]{2,6}\b", _acronym, out)

    return re.sub(r"\s{2,}", " ", out).strip()
