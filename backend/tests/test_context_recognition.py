import pytest

from app.services.context_recognition import refine_segments
from app.services.transcribe_service import SpeechSegment, WordInfo


@pytest.fixture(autouse=True)
def keyword_fallback_mode(monkeypatch):
    """
    Force the keyword fallback path so unit tests are deterministic and
    never download the embedding model. The semantic path has its own
    integration test below, which runs only when the model is cached.
    """
    from app.services import domain_classifier

    def _unavailable(*a, **k):
        raise domain_classifier.ClassifierUnavailable("mocked offline")

    monkeypatch.setattr(domain_classifier, "is_technical", _unavailable)
    monkeypatch.setattr(domain_classifier, "technical_score", _unavailable)


def _seg(text: str, words: list[tuple[str, float]], start=0.0, end=5.0) -> SpeechSegment:
    t = start
    infos = []
    for w, prob in words:
        infos.append(WordInfo(word=w, start=t, end=t + 0.3, probability=prob))
        t += 0.35
    return SpeechSegment(start=start, end=end, text=text, words=infos)


def test_capitalizes_name_after_trigger_in_technical_context():
    seg = _seg(
        "the model was released by anthropic this year",
        [("the", 0.99), ("model", 0.98), ("was", 0.99), ("released", 0.97),
         ("by", 0.99), ("anthropic", 0.40), ("this", 0.99), ("year", 0.99)],
    )
    refined, decisions = refine_segments([seg])
    assert "released by Anthropic" in refined[0].text
    assert any(d.action == "capitalized" for d in decisions)


def test_preserves_uncertain_word_without_altering_it():
    seg = _seg(
        "this framework uses the kubeflow library on the GPU",
        [("this", 0.99), ("framework", 0.98), ("uses", 0.99), ("the", 0.99),
         ("kubeflow", 0.30), ("library", 0.97), ("on", 0.99), ("the", 0.99), ("GPU", 0.9)],
    )
    refined, decisions = refine_segments([seg])
    assert "kubeflow" in refined[0].text.lower()  # never substituted
    assert any(d.action == "preserved" for d in decisions)


def test_identifier_shapes_get_proper_casing():
    seg = _seg(
        "we wrote the code in pyTorch using the API",
        [("we", 0.99), ("wrote", 0.99), ("the", 0.99), ("code", 0.98),
         ("in", 0.99), ("pyTorch", 0.85), ("using", 0.99), ("the", 0.99), ("API", 0.95)],
    )
    refined, _ = refine_segments([seg])
    assert "PyTorch" in refined[0].text


def test_non_technical_sentences_are_untouched():
    seg = _seg(
        "we went to the beach and had a lovely dinner",
        [("we", 0.99), ("went", 0.99), ("to", 0.99), ("the", 0.99), ("beach", 0.4),
         ("and", 0.99), ("had", 0.99), ("a", 0.99), ("lovely", 0.5), ("dinner", 0.99)],
    )
    refined, decisions = refine_segments([seg])
    assert refined[0].text == seg.text
    assert decisions == []


def test_timestamps_never_change():
    seg = _seg(
        "the model was released by mistral",
        [("the", 0.99), ("model", 0.99), ("was", 0.99), ("released", 0.99),
         ("by", 0.99), ("mistral", 0.35)],
        start=12.5, end=17.5,
    )
    refined, _ = refine_segments([seg])
    assert refined[0].start == 12.5 and refined[0].end == 17.5
    assert refined[0].words == seg.words


def test_segments_without_word_data_pass_through():
    seg = SpeechSegment(start=0.0, end=3.0, text="an AI model called something")
    refined, decisions = refine_segments([seg])
    assert refined[0].text == seg.text
    assert decisions == []


def test_technical_video_protects_indicator_free_sentences():
    # A tech-heavy transcript makes the WHOLE video technical: the last
    # sentence has no indicator words of its own, but its uncertain word
    # ("groq") must still be preserved and name-cased.
    tech_context = [
        _seg("we trained the model on the GPU cluster",
             [("we", .99), ("trained", .98), ("the", .99), ("model", .98),
              ("on", .99), ("the", .99), ("GPU", .97), ("cluster", .9)]),
        _seg("the API uses tokens and prompts for inference",
             [("the", .99), ("API", .97), ("uses", .99), ("tokens", .95),
              ("and", .99), ("prompts", .94), ("for", .99), ("inference", .93)]),
        _seg("and then groq made it faster",
             [("and", .99), ("then", .99), ("groq", 0.35), ("made", .99),
              ("it", .99), ("faster", .98)]),
    ]
    refined, decisions = refine_segments(tech_context)
    assert "groq" in refined[2].text.lower()  # preserved verbatim
    assert any(d.word == "groq" for d in decisions)


def test_conversational_video_stays_untouched():
    from app.services.context_recognition import is_technical_document

    casual = [
        _seg("we went to the market this morning",
             [("we", .99), ("went", .99), ("to", .99), ("the", .99),
              ("market", .5), ("this", .99), ("morning", .99)]),
        _seg("then we cooked dinner together",
             [("then", .99), ("we", .99), ("cooked", .6), ("dinner", .99), ("together", .99)]),
    ]
    assert not is_technical_document(casual)
    refined, decisions = refine_segments(casual)
    assert [s.text for s in refined] == [s.text for s in casual]
    assert decisions == []


def test_rare_english_words_are_preserved_and_cased():
    # "qwen" has ~zero frequency in general English: even at HIGH Whisper
    # confidence it must be treated as terminology (preserved + name-cased),
    # with no keyword or dictionary entry for it anywhere.
    seg = _seg(
        "the model called qwen beat every benchmark",
        [("the", .99), ("model", .98), ("called", .99), ("qwen", .9),
         ("beat", .99), ("every", .99), ("benchmark", .95)],
    )
    refined, decisions = refine_segments([seg])
    assert "Qwen" in refined[0].text
    assert any(d.word == "qwen" for d in decisions)


def test_rarity_alone_triggers_preservation_without_trigger_phrase():
    # No trigger phrase before "mixtral" and HIGH confidence: rarity is the
    # only signal, and it must be enough in technical context.
    seg = _seg(
        "the model mixtral needs a bigger GPU for training",
        [("the", .99), ("model", .98), ("mixtral", .9), ("needs", .99),
         ("a", .99), ("bigger", .99), ("GPU", .97), ("for", .99), ("training", .96)],
    )
    refined, decisions = refine_segments([seg])
    assert "Mixtral" in refined[0].text
    assert any(d.word == "mixtral" and "rare" in d.reason for d in decisions)


def test_common_words_are_not_flagged_as_rare():
    seg = _seg(
        "the model runs code on the server every day",
        [("the", .99), ("model", .98), ("runs", .99), ("code", .97),
         ("on", .99), ("the", .99), ("server", .96), ("every", .99), ("day", .99)],
    )
    refined, decisions = refine_segments([seg])
    assert refined[0].text == seg.text
    assert decisions == []


def test_semantic_classifier_integration():
    """Real MiniLM classification — opt-in: slow on CPU-only machines."""
    import os

    if os.environ.get("AVC_RUN_SLOW_TESTS") != "1":
        pytest.skip("set AVC_RUN_SLOW_TESTS=1 to run the real-model test")

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    try:
        from app.services import domain_classifier as dc
        import importlib

        importlib.reload(dc)
        tech = dc.technical_score(
            "We fine-tuned the model overnight and deployed the checkpoint "
            "to the inference server with the new quantization kernel."
        )
        casual = dc.technical_score(
            "We went to the beach with the kids, had ice cream, and watched "
            "the sunset before driving home for dinner."
        )
    except Exception:
        pytest.skip("embedding model not cached yet")
    finally:
        os.environ.pop("HF_HUB_OFFLINE", None)
    assert tech > 0
    assert casual < 0
    assert tech > casual
