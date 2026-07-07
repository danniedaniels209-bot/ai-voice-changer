from app.narration import script_analyzer
from app.narration.planner import Controls, plan
from app.narration.pronunciation import to_speakable

SCRIPT = """# Getting Started

This is EXTREMELY important. Have you installed PyTorch yet?

- First point
- Second point

> A wise person once said something.

```
print("hello")
```

Never skip this step! The model costs $49.99 and uses 16GB of memory.
"""


def test_analyzer_detects_structure():
    segs = script_analyzer.analyze(SCRIPT)
    kinds = [s.kind for s in segs]
    assert "heading" in kinds
    assert "list_item" in kinds
    assert "quote" in kinds
    assert "code" in kinds
    assert kinds.count("list_item") == 2


def test_analyzer_classifies_sentence_types():
    segs = script_analyzer.analyze(SCRIPT)
    by_text = {s.text: s for s in segs}
    assert by_text["Have you installed PyTorch yet?"].sentence_type == "question"
    assert by_text["Never skip this step!"].sentence_type in ("exclamation", "command")


def test_analyzer_separates_emphasis_from_tech():
    segs = script_analyzer.analyze(SCRIPT)
    imp = next(s for s in segs if "EXTREMELY" in s.text)
    assert "EXTREMELY" in imp.emphasis_words  # common English caps = shouting
    q = next(s for s in segs if "PyTorch" in s.text)
    assert "PyTorch" in q.tech_terms  # identifier shape = tech term


def test_pronunciation_rules():
    assert to_speakable("$49.99") == "49 dollars and 99 cents"
    assert to_speakable("50%") == "50 percent"
    assert to_speakable("16GB") == "16 gigabytes"
    assert "point 1 4" in to_speakable("pi is 3.14")
    # hyphen split + vowel-less acronym spelling: spoken as "gee pee tee five"
    assert to_speakable("GPT-5") == "G P T 5"
    assert "S D K" in to_speakable("the SDK works")  # no vowels -> spelled
    assert "CUDA" in to_speakable("uses CUDA")  # has vowels -> spoken as word
    assert "example dot com" in to_speakable("visit https://example.com/docs")
    assert to_speakable("2026 was great") == "2026 was great"  # years untouched


def test_planner_directs_by_type_and_mode():
    segs = script_analyzer.analyze(SCRIPT)
    planned = plan(segs, "youtube", Controls(), "en-US-GuyNeural", code_policy="skip")

    question = next(p for p in planned if p.text.endswith("yet?"))
    statement = next(p for p in planned if p.kind == "heading")
    assert question.pitch_hz > statement.pitch_hz  # questions lift

    code = next(p for p in planned if p.kind == "code")
    assert code.skipped  # skip policy honored

    heading = next(p for p in planned if p.kind == "heading")
    sentence = next(p for p in planned if p.kind == "sentence")
    assert heading.pause_after > sentence.pause_after  # headings breathe


def test_planner_quote_voice_and_code_summarize():
    segs = script_analyzer.analyze(SCRIPT)
    planned = plan(
        segs, "professional", Controls(), "en-US-GuyNeural",
        quote_voice="en-GB-RyanNeural", code_policy="summarize",
    )
    quote = next(p for p in planned if p.kind == "quote")
    assert quote.voice == "en-GB-RyanNeural"
    code = next(p for p in planned if p.kind == "code")
    assert not code.skipped and "code block" in code.speak_text
