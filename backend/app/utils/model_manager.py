"""
Scans, imports, and deletes RVC voice models under models/.

Two on-disk layouts are supported, since both are common in the wild:
  1. Folder-per-model:  models/<name>/<anything>.pth (+ optional *.index)
  2. Flat pair:         models/<name>.pth (+ optional models/<name>.index)

All models are exposed through one RVCModelInfo shape regardless of layout.
"""

from __future__ import annotations

import re
import shutil

from fastapi import UploadFile

from app.core.config import Paths, get_settings
from app.core.errors import DuplicateModelError, InvalidModelFileError, ModelNotFoundError
from app.core.logging import get_logger
from app.schemas.model_info import RVCModelInfo

logger = get_logger(__name__)

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_\-. ]+$")


def _validate_name(name: str) -> None:
    """Reject anything that could escape the models/ directory."""
    if not name or not _SAFE_NAME_RE.match(name) or ".." in name:
        raise InvalidModelFileError(
            f"Invalid model name: '{name}'. Use letters, numbers, spaces, '-', '_', '.' only.",
            details={"field": "name"},
        )


def _probe_sample_rate(pth_path) -> int | None:
    """
    Best-effort read of the sample rate embedded in an RVC checkpoint.
    Never raises: torch may not be installed yet, or the checkpoint may use
    a layout we don't recognize — either way we degrade to `None` rather
    than fail model listing.

    weights_only=True is a security boundary, not an optimization: .pth files
    are pickles, and unpickling an untrusted one with weights_only=False can
    execute arbitrary code just by listing the models directory.
    """
    try:
        import torch

        checkpoint = torch.load(pth_path, map_location="cpu", weights_only=True)
        if isinstance(checkpoint, dict):
            sr = checkpoint.get("sr")
            if sr:
                return int(sr)
            config = checkpoint.get("config")
            if isinstance(config, list) and len(config) > 2:
                return int(config[2])
    except Exception as exc:
        logger.debug("Could not probe sample rate for %s: %s", pth_path, exc)
    return None


def _info_from_pth(name: str, pth_path, index_path) -> RVCModelInfo:
    return RVCModelInfo(
        name=name,
        pth_path=str(pth_path),
        index_path=str(index_path) if index_path else None,
        has_index=index_path is not None,
        size_mb=round(pth_path.stat().st_size / (1024 * 1024), 2),
        sample_rate=_probe_sample_rate(pth_path),
    )


def list_models() -> list[RVCModelInfo]:
    Paths.models.mkdir(parents=True, exist_ok=True)
    results: list[RVCModelInfo] = []
    seen_names: set[str] = set()

    # Layout 1: folder-per-model
    for entry in sorted(Paths.models.iterdir()):
        if not entry.is_dir():
            continue
        pth_files = sorted(entry.glob("*.pth"))
        if not pth_files:
            continue
        index_files = sorted(entry.glob("*.index"))
        results.append(_info_from_pth(entry.name, pth_files[0], index_files[0] if index_files else None))
        seen_names.add(entry.name)

    # Layout 2: flat pair directly in models/
    for pth_path in sorted(Paths.models.glob("*.pth")):
        name = pth_path.stem
        if name in seen_names:
            continue
        index_path = Paths.models / f"{name}.index"
        results.append(_info_from_pth(name, pth_path, index_path if index_path.exists() else None))
        seen_names.add(name)

    return results


def get_model(name: str) -> RVCModelInfo:
    _validate_name(name)
    for model in list_models():
        if model.name == name:
            return model
    raise ModelNotFoundError(f"No voice model named '{name}' found in {Paths.models}")


def _write_limited(upload: UploadFile, dest) -> None:
    """Stream an uploaded file to disk in chunks, enforcing the size cap."""
    max_bytes = get_settings().max_model_size_mb * 1024 * 1024
    written = 0
    with dest.open("wb") as f:
        while chunk := upload.file.read(1024 * 1024):
            written += len(chunk)
            if written > max_bytes:
                raise InvalidModelFileError(
                    f"Model file exceeds the {get_settings().max_model_size_mb} MB limit."
                )
            f.write(chunk)


async def import_model(name: str, pth_file: UploadFile, index_file: UploadFile | None) -> RVCModelInfo:
    _validate_name(name)

    if not pth_file.filename or not pth_file.filename.lower().endswith(".pth"):
        raise InvalidModelFileError("Model weights file must be a .pth file.")
    if index_file is not None and index_file.filename and not index_file.filename.lower().endswith(".index"):
        raise InvalidModelFileError("Index file must be a .index file.")

    target_dir = Paths.models / name
    flat_pth = Paths.models / f"{name}.pth"
    if target_dir.exists() or flat_pth.exists():
        raise DuplicateModelError(f"A model named '{name}' already exists.")

    target_dir.mkdir(parents=True)
    try:
        _write_limited(pth_file, target_dir / f"{name}.pth")

        if index_file is not None and index_file.filename:
            _write_limited(index_file, target_dir / f"{name}.index")
    except Exception:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise

    logger.info("Imported voice model '%s' into %s", name, target_dir)
    return get_model(name)


def delete_model(name: str) -> None:
    _validate_name(name)
    target_dir = Paths.models / name
    flat_pth = Paths.models / f"{name}.pth"
    flat_index = Paths.models / f"{name}.index"

    if target_dir.is_dir():
        shutil.rmtree(target_dir)
        logger.info("Deleted voice model folder '%s'", name)
        return

    if flat_pth.exists():
        flat_pth.unlink()
        if flat_index.exists():
            flat_index.unlink()
        logger.info("Deleted voice model files for '%s'", name)
        return

    raise ModelNotFoundError(f"No voice model named '{name}' found in {Paths.models}")
