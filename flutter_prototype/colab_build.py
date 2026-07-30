#!/usr/bin/env python3
"""
Build and serve the Flutter Web UI prototype on Colab.

Run from the repo root:

    !python flutter_prototype/colab_build.py

It installs the Flutter SDK if missing, scaffolds a web project, drops in
lib/main.dart from this folder, builds for web, and serves the result through
a cloudflared tunnel so you can open it in your browser.

Deliberately uses `flutter create` to generate the project rather than
hand-writing pubspec.yaml / web/index.html / the platform scaffolding. Those
files are version-specific, and a hand-written one that drifts from the
installed SDK fails the build for reasons that look like our code's fault.
The prototype has no third-party dependencies, so the generated pubspec
needs no edits at all.

Nothing here touches the application. It builds into a scratch directory.
"""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SRC_MAIN = REPO / "flutter_prototype" / "lib" / "main.dart"
WORK = Path("/content/flutter_proto") if Path("/content").exists() else REPO / "temp" / "flutter_proto"
FLUTTER_DIR = Path("/opt/flutter") if Path("/content").exists() else REPO / "temp" / "flutter"
PORT = 8090


def run(cmd, **kw):
    print(f"\n$ {' '.join(str(c) for c in cmd)}", flush=True)
    return subprocess.run(cmd, check=True, **kw)


def flutter_bin() -> str:
    found = shutil.which("flutter")
    if found:
        return found
    candidate = FLUTTER_DIR / "bin" / "flutter"
    if candidate.exists():
        return str(candidate)
    return ""


def ensure_flutter() -> str:
    fb = flutter_bin()
    if fb:
        print(f"Flutter already present at {fb}")
        return fb

    print("Installing Flutter SDK (~1.5GB, a few minutes on first run)...")
    FLUTTER_DIR.parent.mkdir(parents=True, exist_ok=True)
    # --depth 1 on the stable branch: we need a working toolchain, not history.
    run(["git", "clone", "--depth", "1", "-b", "stable",
         "https://github.com/flutter/flutter.git", str(FLUTTER_DIR)])
    fb = str(FLUTTER_DIR / "bin" / "flutter")
    os.environ["PATH"] = f"{FLUTTER_DIR / 'bin'}:{os.environ.get('PATH', '')}"
    # Colab runs as root; without this the toolchain refuses to run.
    run([fb, "config", "--no-analytics"])
    run([fb, "precache", "--web"])
    return fb


def main() -> int:
    if not SRC_MAIN.exists():
        print(f"ERROR: {SRC_MAIN} not found. Run this from the repo.", file=sys.stderr)
        return 1

    fb = ensure_flutter()
    run([fb, "--version"])

    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.parent.mkdir(parents=True, exist_ok=True)

    run([fb, "create", "--platforms=web", "--project-name",
         "voiceover_prototype", str(WORK)])

    # Our UI replaces the generated counter app. No pubspec edit needed —
    # the prototype imports nothing beyond the Flutter SDK.
    shutil.copy(SRC_MAIN, WORK / "lib" / "main.dart")
    print(f"copied {SRC_MAIN.name} -> {WORK / 'lib' / 'main.dart'}")

    print("\nBuilding for web (first build is slow — subsequent ones are quicker)...")
    run([fb, "build", "web", "--release"], cwd=str(WORK))

    build_dir = WORK / "build" / "web"
    if not (build_dir / "index.html").exists():
        print("ERROR: build produced no index.html", file=sys.stderr)
        return 1
    print(f"\nBuild OK: {build_dir}")

    # Serve it.
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--directory", str(build_dir)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2)
    print(f"Serving on http://127.0.0.1:{PORT}")

    # Reuse cloudflared if the main deploy script already fetched it;
    # otherwise grab it. Same no-account tunnel the app itself uses.
    cf = shutil.which("cloudflared") or "/usr/local/bin/cloudflared"
    if not Path(cf).exists():
        print("\nFetching cloudflared...")
        run(["wget", "-q", "-O", "/usr/local/bin/cloudflared",
             "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"])
        run(["chmod", "+x", "/usr/local/bin/cloudflared"])
        cf = "/usr/local/bin/cloudflared"

    print("\n" + "=" * 66)
    print("Starting tunnel. Open the https://<something>.trycloudflare.com URL")
    print("printed below. Ctrl-C (or stop the cell) to shut it down.")
    print("=" * 66 + "\n")
    try:
        subprocess.run([cf, "tunnel", "--url", f"http://127.0.0.1:{PORT}"])
    except KeyboardInterrupt:
        pass
    finally:
        srv.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
