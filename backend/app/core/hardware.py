"""
Single source of truth for CUDA/CPU device selection.

Every AI-facing service (Demucs, RVC) asks `resolve_device()` for the device
string instead of calling `torch.cuda.is_available()` itself. That keeps
detection logic, the "auto" override in Settings, and graceful fallback to
CPU all in one place.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.logging import get_logger

logger = get_logger(__name__)

VALID_MODES = ("auto", "cuda", "cpu")


@dataclass(frozen=True)
class HardwareInfo:
    cuda_available: bool
    device_name: str | None  # e.g. "NVIDIA GeForce RTX 3060", or None on CPU
    cuda_version: str | None
    torch_version: str | None
    resolved_device: str  # "cuda" or "cpu" — what will actually be used


def _probe_cuda() -> tuple[bool, str | None, str | None, str | None]:
    """
    Best-effort CUDA probe. Never raises: if torch is missing or the CUDA
    driver/runtime is broken, we log it and fall back to CPU rather than
    crashing the app at startup.
    """
    try:
        import torch  # local import: torch is heavy, only needed here

        torch_version = torch.__version__
        if torch.cuda.is_available():
            try:
                name = torch.cuda.get_device_name(0)
            except Exception:  # driver present but query failed
                name = "Unknown CUDA device"
            return True, name, torch.version.cuda, torch_version
        return False, None, None, torch_version
    except Exception as exc:  # torch not installed, or import failed entirely
        logger.warning("CUDA probe failed, defaulting to CPU: %s", exc)
        return False, None, None, None


def get_hardware_info(requested_mode: str = "auto") -> HardwareInfo:
    """
    requested_mode: "auto" | "cuda" | "cpu" (from Settings).
    If "cuda" is requested but unavailable, we log a warning and fall back
    to CPU rather than failing the whole pipeline.
    """
    if requested_mode not in VALID_MODES:
        raise ValueError(f"Invalid device mode '{requested_mode}', expected one of {VALID_MODES}")

    cuda_available, device_name, cuda_version, torch_version = _probe_cuda()

    if requested_mode == "cpu":
        resolved = "cpu"
    elif requested_mode == "cuda":
        if not cuda_available:
            logger.warning("CUDA was requested but is not available — falling back to CPU.")
        resolved = "cuda" if cuda_available else "cpu"
    else:  # auto
        resolved = "cuda" if cuda_available else "cpu"

    return HardwareInfo(
        cuda_available=cuda_available,
        device_name=device_name,
        cuda_version=cuda_version,
        torch_version=torch_version,
        resolved_device=resolved,
    )
