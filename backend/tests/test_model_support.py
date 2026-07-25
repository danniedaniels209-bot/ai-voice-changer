"""Model architecture support: unusable models are caught before download."""

import pytest

from app.core.errors import AppError
from app.scriptgen import llm


def test_every_registry_model_declares_its_architecture():
    for key, info in llm.MODELS.items():
        assert info.get("arch"), f"{key} has no 'arch' — support can't be checked"


def test_supported_architectures_pass_on_this_install():
    """Whatever transformers is installed, the check must agree with it."""
    from transformers.models.auto.configuration_auto import CONFIG_MAPPING_NAMES

    for key, info in llm.MODELS.items():
        ok, why = llm.architecture_supported(key)
        assert ok == (info["arch"] in CONFIG_MAPPING_NAMES)
        if not ok:
            assert "newer transformers" in why


def test_unsupported_architecture_is_reported_not_crashed(monkeypatch):
    monkeypatch.setitem(llm.MODELS, "fake", {
        "id": "acme/futuremodel", "label": "Future 9B",
        "download": "~5 GB", "quant4": True, "arch": "definitely_not_a_real_arch",
    })
    ok, why = llm.architecture_supported("fake")
    assert ok is False
    assert "fresh cloud session" in why


def test_selecting_an_unsupported_model_fails_fast(monkeypatch):
    """The error must arrive on selection — not after a multi-GB download."""
    monkeypatch.setitem(llm.MODELS, "fake", {
        "id": "acme/futuremodel", "label": "Future 9B",
        "download": "~5 GB", "quant4": True, "arch": "definitely_not_a_real_arch",
    })
    with pytest.raises(AppError, match="Future 9B can't run here"):
        llm.set_model("fake")
    # ...and the active model is unchanged, so the app keeps working.
    assert llm.active_model() != "fake"


def test_status_marks_each_model_supported_or_not():
    from app.api.routes.scriptgen import _model_list

    models = _model_list()
    assert models and all("supported" in m and "reason" in m for m in models)
    assert {m["key"] for m in models} == set(llm.MODELS)
