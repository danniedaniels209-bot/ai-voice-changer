import sys
from pathlib import Path

import pytest

# Make `app` importable when running pytest from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Paths  # noqa: E402
from app.utils import job_manager  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_dirs(tmp_path, monkeypatch):
    """Point temp/models at a throwaway dir and reset the job registry."""
    monkeypatch.setattr(Paths, "temp", tmp_path / "temp")
    monkeypatch.setattr(Paths, "models", tmp_path / "models")
    job_manager._jobs.clear()
    yield
    job_manager._jobs.clear()
