"""Cloud upload TTL sweeper: deletes idle job folders, never active ones."""

import os
import time

from app.utils import cleanup


def _make_job_dir(base, name: str, age_minutes: float):
    d = base / name
    d.mkdir(parents=True)
    f = d / "input.mp4"
    f.write_bytes(b"video")
    old = time.time() - age_minutes * 60
    os.utime(f, (old, old))
    os.utime(d, (old, old))
    return d


def test_old_idle_folder_deleted(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "temp", tmp_path)
    old_dir = _make_job_dir(tmp_path, "job-old", age_minutes=120)
    fresh_dir = _make_job_dir(tmp_path, "job-fresh", age_minutes=10)

    removed = cleanup.prune_expired_uploads(ttl_minutes=90)
    assert removed == 1
    assert not old_dir.exists()
    assert fresh_dir.exists()


def test_processing_job_never_deleted(tmp_path, monkeypatch):
    from app.core.config import Paths
    from app.schemas.job import JobStatus
    from app.utils import job_manager

    monkeypatch.setattr(Paths, "temp", tmp_path)
    old_dir = _make_job_dir(tmp_path, "job-busy", age_minutes=300)

    class FakeJob:
        status = JobStatus.PROCESSING

    monkeypatch.setattr(job_manager, "get_job", lambda job_id: FakeJob())
    removed = cleanup.prune_expired_uploads(ttl_minutes=90)
    assert removed == 0
    assert old_dir.exists()


def test_stale_chunk_parts_deleted(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "temp", tmp_path)
    chunk_dir = tmp_path / "chunked_uploads"
    chunk_dir.mkdir()
    stale = chunk_dir / "abc.part"
    stale.write_bytes(b"x")
    old = time.time() - 7200
    os.utime(stale, (old, old))
    fresh = chunk_dir / "def.part"
    fresh.write_bytes(b"y")

    cleanup.prune_expired_uploads(ttl_minutes=90)
    assert not stale.exists()
    assert fresh.exists()


def test_old_exports_deleted_fresh_kept(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "exports", tmp_path)
    old_file = tmp_path / "video_converted.mp4"
    old_file.write_bytes(b"v")
    stamp = time.time() - 3 * 3600
    os.utime(old_file, (stamp, stamp))
    fresh_file = tmp_path / "new_converted.mp4"
    fresh_file.write_bytes(b"v")

    removed = cleanup.prune_expired_exports(ttl_minutes=120)
    assert removed == 1
    assert not old_file.exists()
    assert fresh_file.exists()


def test_strip_thinking_never_returns_empty():
    from app.scriptgen import llm

    assert llm._strip_thinking("<think>reason</think>Answer.") == "Answer."
    # Whole reply inside an unclosed think block -> content kept, not dropped
    assert llm._strip_thinking("<think>only reasoning, no close tag") == (
        "only reasoning, no close tag"
    )
    assert llm._strip_thinking("Before<think>dangling") == "Before"


def test_coder_workspace_files_expire_after_ttl(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "temp", tmp_path)
    ws = tmp_path / "coder_workspace" / "app"
    ws.mkdir(parents=True)
    old = ws / "stale.py"
    old.write_text("x", encoding="utf-8")
    stamp = time.time() - 6 * 3600  # 6 h ago, past the 5 h window
    os.utime(old, (stamp, stamp))
    fresh = ws / "active.py"
    fresh.write_text("y", encoding="utf-8")

    removed = cleanup.prune_expired_coder_files(ttl_minutes=300)
    assert removed == 1
    assert not old.exists()
    assert fresh.exists()  # still being worked on


def test_coder_prune_is_safe_when_workspace_missing(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "temp", tmp_path)
    assert cleanup.prune_expired_coder_files() == 0


def test_sweeper_only_starts_on_cloud(monkeypatch):
    import threading

    started = []
    monkeypatch.setattr(
        threading, "Thread",
        lambda **kw: started.append(kw) or type("T", (), {"start": lambda self: None})(),
    )
    monkeypatch.delenv("AVC_AUTH_TOKEN", raising=False)
    cleanup.start_upload_sweeper()
    assert started == []

    monkeypatch.setenv("AVC_AUTH_TOKEN", "tok")
    cleanup.start_upload_sweeper()
    assert len(started) == 1
