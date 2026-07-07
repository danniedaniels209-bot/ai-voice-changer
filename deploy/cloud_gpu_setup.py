"""
Cloud GPU session bootstrap — works on BOTH Google Colab and Kaggle.

Paste into one notebook cell and run:

    !git clone https://github.com/YOUR_USERNAME/ai-voice-changer.git
    %cd ai-voice-changer
    !python deploy/cloud_gpu_setup.py

It installs dependencies (keeping the platform's CUDA torch), downloads a
tunnel client, starts the backend with a fresh access token, and prints the
URL + token to paste into the app's Settings -> Cloud GPU backend.

The session lasts as long as the notebook does (Colab: keep the tab open;
Kaggle: up to 12h with GPU quota). Models (~6 GB) download on first use per
session at datacenter speed.
"""

from __future__ import annotations

import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def run(cmd: list[str], **kw) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kw)


def detect_platform() -> str:
    if os.environ.get("COLAB_RELEASE_TAG") or Path("/content").exists():
        return "colab"
    if os.environ.get("KAGGLE_KERNEL_RUN_TYPE") or Path("/kaggle").exists():
        return "kaggle"
    return "generic"


def main() -> None:
    platform = detect_platform()
    print(f"=== AI Voice Changer cloud bootstrap ({platform}) ===")

    # 1. Verify GPU — refuse to continue without one: a CPU cloud session is
    # as slow as the laptop it was meant to replace.
    try:
        import torch

        has_gpu = torch.cuda.is_available()
        print(f"torch {torch.__version__}, CUDA: {has_gpu}"
              + (f" ({torch.cuda.get_device_name(0)})" if has_gpu else ""))
    except ImportError:
        has_gpu = False

    if not has_gpu:
        print("\n" + "!" * 62)
        print("  NO GPU IN THIS SESSION — stopping before wasting your time.")
        print("  Fix (Colab):  Runtime -> Change runtime type -> T4 GPU -> Save")
        print("  Fix (Kaggle): Settings panel -> Accelerator -> GPU T4 x2")
        print("  The session restarts when you change it — then re-run this cell.")
        print("!" * 62)
        raise SystemExit(1)

    # 2. Dependencies — WITHOUT touching the platform's CUDA torch.
    run([sys.executable, "-m", "pip", "install", "-q", "--no-deps", "rvc-python", "chatterbox-tts"])
    run([sys.executable, "-m", "pip", "install", "-q", "-r", str(BACKEND / "requirements-cloud.txt")])
    run([sys.executable, "-m", "pip", "install", "-q",
         "resemble-perth", "s3tokenizer", "conformer", "diffusers", "wordfreq"])

    # 3. Tunnel client (cloudflared — no account needed)
    tunnel_bin = Path("/tmp/cloudflared")
    if not tunnel_bin.exists():
        print("Downloading cloudflared...")
        urllib.request.urlretrieve(
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            tunnel_bin,
        )
        tunnel_bin.chmod(0o755)

    # 4. Access token — a new one per session, required by the backend.
    token = secrets.token_urlsafe(16)
    env = os.environ.copy()
    env["AVC_AUTH_TOKEN"] = token
    env["AVC_HOST"] = "127.0.0.1"
    env["HF_HUB_DISABLE_XET"] = "1"

    # 5. Start the backend
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(BACKEND),
        env=env,
    )
    time.sleep(8)
    if server.poll() is not None:
        raise SystemExit("Backend failed to start — scroll up for the error.")

    # 6. Start the tunnel and capture its public URL
    tunnel = subprocess.Popen(
        [str(tunnel_bin), "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    url = None
    deadline = time.time() + 60
    for line in tunnel.stdout:  # type: ignore[union-attr]
        m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
        if m:
            url = m.group(0)
            break
        if time.time() > deadline:
            break

    if not url:
        raise SystemExit("Tunnel did not produce a URL — re-run this cell.")

    print("\n" + "=" * 62)
    print("  READY — paste these into Settings -> Cloud GPU backend:")
    print(f"  Backend URL:  {url}")
    print(f"  Access token: {token}")
    print(f"\n  Or open directly: {url}/?token={token}")
    print("=" * 62)
    print("\nKeep this notebook running while you convert. Models (~6 GB)")
    print("download automatically on the first conversion of the session.")

    # Keep the cell alive, echoing tunnel output quietly.
    def _drain():
        for _ in tunnel.stdout:  # type: ignore[union-attr]
            pass

    threading.Thread(target=_drain, daemon=True).start()
    server.wait()


if __name__ == "__main__":
    main()
