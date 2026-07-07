import pytest

from app.core.errors import InvalidVideoError
from app.utils import safe_export


def test_resolve_output_path_renames_duplicates(tmp_path):
    (tmp_path / "video_converted.mp4").write_bytes(b"x")
    (tmp_path / "video_converted (1).mp4").write_bytes(b"x")
    result = safe_export.resolve_output_path(tmp_path, "video_converted", rename_duplicates=True)
    assert result.name == "video_converted (2).mp4"


def test_resolve_output_path_overwrite_mode(tmp_path):
    (tmp_path / "video_converted.mp4").write_bytes(b"x")
    result = safe_export.resolve_output_path(tmp_path, "video_converted", rename_duplicates=False)
    assert result.name == "video_converted.mp4"


def test_publish_moves_atomically(tmp_path):
    tmp = tmp_path / "work" / "export.tmp.mp4"
    tmp.parent.mkdir()
    tmp.write_bytes(b"video-bytes")
    final = tmp_path / "exports" / "video.mp4"

    result = safe_export.publish(tmp, final)
    assert result == final
    assert final.read_bytes() == b"video-bytes"
    assert not tmp.exists()  # moved, not copied


def test_publish_falls_back_to_variant_when_destination_locked(tmp_path, monkeypatch):
    tmp = tmp_path / "export.tmp.mp4"
    tmp.write_bytes(b"new")
    final = tmp_path / "video.mp4"
    final.write_bytes(b"locked-by-player")

    import os

    real_replace = os.replace

    def replace_with_lock(src, dst):
        if str(dst) == str(final):
            raise PermissionError("file is in use")
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", replace_with_lock)
    result = safe_export.publish(tmp, final, rename_on_lock=True)
    assert result.name == "video (1).mp4"
    assert result.read_bytes() == b"new"
    assert final.read_bytes() == b"locked-by-player"  # original untouched


def test_publish_raises_clear_error_when_lock_and_no_rename(tmp_path, monkeypatch):
    from app.core.errors import AppError

    tmp = tmp_path / "export.tmp.mp4"
    tmp.write_bytes(b"new")
    final = tmp_path / "video.mp4"
    final.write_bytes(b"locked")

    import os

    monkeypatch.setattr(
        os, "replace", lambda src, dst: (_ for _ in ()).throw(PermissionError("in use"))
    )
    with pytest.raises(AppError, match="open in another"):
        safe_export.publish(tmp, final, rename_on_lock=False)


def test_verify_export_rejects_empty_file(tmp_path):
    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"")
    with pytest.raises(InvalidVideoError, match="missing or empty"):
        safe_export.verify_export(bad)


def test_verify_export_rejects_garbage_file(tmp_path):
    bad = tmp_path / "garbage.mp4"
    bad.write_bytes(b"this is not a video at all" * 100)
    with pytest.raises(Exception):  # probe fails -> InvalidVideoError from ffprobe
        safe_export.verify_export(bad)
