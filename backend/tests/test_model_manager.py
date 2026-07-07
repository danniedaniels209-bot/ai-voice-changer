import pytest

from app.core.errors import InvalidModelFileError, ModelNotFoundError
from app.utils import model_manager


@pytest.mark.parametrize(
    "bad_name",
    ["", "../escape", "..", "name/with/slash", "name\\with\\backslash", "semi;colon"],
)
def test_validate_name_rejects_traversal(bad_name):
    with pytest.raises(InvalidModelFileError):
        model_manager._validate_name(bad_name)


@pytest.mark.parametrize("good_name", ["MyVoice", "voice_2.1", "My Voice-v2"])
def test_validate_name_accepts_safe_names(good_name):
    model_manager._validate_name(good_name)  # must not raise


def test_list_models_empty(tmp_path):
    assert model_manager.list_models() == []


def test_get_missing_model_raises():
    with pytest.raises(ModelNotFoundError):
        model_manager.get_model("nope")


def test_list_models_finds_both_layouts():
    from app.core.config import Paths

    # Layout 1: folder-per-model
    folder = Paths.models / "folder_model"
    folder.mkdir(parents=True)
    (folder / "weights.pth").write_bytes(b"fake")

    # Layout 2: flat pair
    (Paths.models / "flat_model.pth").write_bytes(b"fake")
    (Paths.models / "flat_model.index").write_bytes(b"fake")

    models = {m.name: m for m in model_manager.list_models()}
    assert set(models) == {"folder_model", "flat_model"}
    assert not models["folder_model"].has_index
    assert models["flat_model"].has_index
    # Fake bytes aren't a valid checkpoint — sample rate probing must
    # degrade to None, never crash listing.
    assert models["folder_model"].sample_rate is None
