"""Chunked upload endpoints: reassembly, ordering, validation."""

import io

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def _send_chunk(client, upload_id: str, index: int, data: bytes):
    return client.post(
        "/upload/chunk",
        data={"upload_id": upload_id, "index": str(index)},
        files={"chunk": ("clip.mp4", io.BytesIO(data), "video/mp4")},
    )


def test_out_of_order_chunk_rejected(client):
    upload_id = "aabbccdd-0000-0000-0000-000000000001"
    assert _send_chunk(client, upload_id, 0, b"x" * 10).status_code == 200
    resp = _send_chunk(client, upload_id, 2, b"y" * 10)
    assert resp.status_code == 400
    assert "out of order" in resp.json()["error"]["message"]


def test_bad_upload_id_rejected(client):
    resp = _send_chunk(client, "../../etc/passwd", 0, b"x")
    assert resp.status_code == 400


def test_finalize_missing_data_rejected(client):
    resp = client.post(
        "/upload/finalize",
        json={"upload_id": "aabbccdd-0000-0000-0000-00000000dead",
              "filename": "clip.mp4", "total_chunks": 2},
    )
    assert resp.status_code == 400
    assert "No uploaded data" in resp.json()["error"]["message"]


def test_finalize_wrong_chunk_count_rejected(client):
    upload_id = "aabbccdd-0000-0000-0000-000000000002"
    assert _send_chunk(client, upload_id, 0, b"x" * 10).status_code == 200
    resp = client.post(
        "/upload/finalize",
        json={"upload_id": upload_id, "filename": "clip.mp4", "total_chunks": 3},
    )
    assert resp.status_code == 400
    assert "incomplete" in resp.json()["error"]["message"]


def test_chunks_reassemble_in_order(client, monkeypatch, tmp_path):
    """Two chunks arrive sequentially and finalize sees the concatenated file."""
    from app.api.routes import upload as upload_module

    upload_id = "aabbccdd-0000-0000-0000-000000000003"
    assert _send_chunk(client, upload_id, 0, b"AAAA").status_code == 200
    assert _send_chunk(client, upload_id, 1, b"BBBB").status_code == 200

    part = upload_module._part_path(upload_id)
    assert part.read_bytes() == b"AAAABBBB"

    # finalize with a bad extension cleans up and rejects (we don't need a
    # real playable video to prove reassembly worked)
    resp = client.post(
        "/upload/finalize",
        json={"upload_id": upload_id, "filename": "clip.exe", "total_chunks": 2},
    )
    assert resp.status_code == 400
    assert "Unsupported video format" in resp.json()["error"]["message"]
    assert not part.exists()
