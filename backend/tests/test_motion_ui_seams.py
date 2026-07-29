"""
The editor's SEAMS: interactions that cross two features.

Every serious bug in Motion Studio has lived here rather than inside any one
feature. A representative list, all of which shipped green unit tests:

  - video played in the editor and exported a frozen first frame
  - audio mixed correctly and silently truncated the video
  - connectors drew on the canvas and vanished from the export
  - a gradient previewed 90 degrees from how it rendered
  - blur rendered on the canvas and not in the export
  - clicking a keyframe stored the selection and showed nothing, because the
    panel that displays it only renders once a LAYER is selected

Not one of those is visible to a unit test, because each half was correct.
They only appear when you drive the real UI and check that doing A then B
produces what B promised.

These tests are Playwright over the real built frontend, so they are slow —
marked `slow` and excluded by `pytest -m "not slow"`. That cost is the point:
this is the only layer that would have caught the six bugs above.

Requires the app to be reachable at AVC_TEST_BASE_URL (default
http://127.0.0.1:8000) with a current `frontend/dist`. Skips cleanly if it
isn't running, so it never fails for the wrong reason.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.request
import uuid

import pytest

from app.motion_studio import storage
from app.motion_studio.models import (
    Keyframe,
    MotionLayer,
    RectLayerProps,
    Transform,
)

BASE_URL = os.environ.get("AVC_TEST_BASE_URL", "http://127.0.0.1:8000")


def _app_running() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/motion/projects", timeout=4):
            return True
    except (urllib.error.URLError, OSError):
        return False


def _playwright_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            pw.chromium.launch().close()
        return True
    except Exception:
        return False


pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not _app_running(), reason=f"app not reachable at {BASE_URL}"),
    pytest.mark.skipif(not _playwright_available(), reason="Playwright browser missing"),
]


@pytest.fixture
def page():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        pg = browser.new_page(viewport={"width": 1500, "height": 900})
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.console_errors = errors  # type: ignore[attr-defined]
        yield pg
        browser.close()


@pytest.fixture
def animated_project():
    """One layer with two keyframes carrying distinguishable easings."""
    project = storage.create_project("ui seam test")
    scene = project.scenes[0]
    scene.duration_ms = 4000
    scene.layers.append(
        MotionLayer(
            id=uuid.uuid4().hex[:12], name="Box", type="rect",
            transform=Transform(x=100, y=300, width=300, height=200),
            rect=RectLayerProps(fill="#4F46E5"),
            keyframes=[
                Keyframe(id="a", time_ms=0, property="x", value=0, easing="linear"),
                Keyframe(id="b", time_ms=1000, property="x", value=300, easing="spring"),
            ],
        )
    )
    storage.save_project(project)
    yield project
    storage.delete_project(project.id)


def _open_editor(page, project_id: str):
    page.goto(f"{BASE_URL}/motion/{project_id}")
    page.wait_for_selector('button[title*="Play"], button[title*="Nothing to play"]', timeout=20000)
    page.wait_for_timeout(900)


def _inspector_easing(page):
    return page.evaluate(
        """() => {
        const el = [...document.querySelectorAll('span')]
          .find(x => x.textContent.trim() === 'Keyframe easing');
        return el ? el.parentElement.querySelector('select').value : null;
      }"""
    )


def test_clicking_a_keyframe_shows_its_easing_without_selecting_the_layer_first(
    page, animated_project
):
    """Regression: the click registered and nothing appeared.

    The easing panel lives in the Inspector, which only renders once a layer
    is selected. Selecting a keyframe therefore has to select its layer too,
    or the user clicks and sees no change with no hint why.
    """
    _open_editor(page, animated_project.id)
    page.locator('[title*="@ 1.00s"]').first.click()
    page.wait_for_timeout(600)
    assert _inspector_easing(page) == "spring", (
        "clicking a keyframe on an unselected layer showed no easing panel"
    )


def test_changing_easing_persists_to_that_keyframe_only(page, animated_project):
    _open_editor(page, animated_project.id)
    page.locator('[title*="@ 1.00s"]').first.click()
    page.wait_for_timeout(500)
    page.evaluate(
        """() => {
        const el = [...document.querySelectorAll('span')]
          .find(x => x.textContent.trim() === 'Keyframe easing');
        const sel = el.parentElement.querySelector('select');
        sel.value = 'bounce';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }"""
    )
    page.wait_for_timeout(2500)  # autosave debounce

    reloaded = storage.load_project(animated_project.id)
    easings = {k.id: k.easing for k in reloaded.scenes[0].layers[0].keyframes}
    assert easings == {"a": "linear", "b": "bounce"}, (
        f"easing edit hit the wrong keyframe(s): {easings}"
    )


def test_empty_scene_offers_no_transport(page):
    """An empty scene must not offer to play itself.

    Otherwise the playhead sweeps a blank canvas and the app appears to be
    playing content that doesn't exist.
    """
    project = storage.create_project("ui seam empty")
    try:
        _open_editor(page, project.id)
        state = page.evaluate(
            """() => {
            const btns = [...document.querySelectorAll('button')];
            const play = btns.find(b => /play|nothing to play/i.test(b.getAttribute('title') || ''));
            return {
              disabled: play ? play.disabled : null,
              hint: /Add a layer to start building/.test(document.body.innerText),
            };
          }"""
        )
        assert state["disabled"] is True, "transport is live on an empty scene"
        assert state["hint"], "no explanation of why the timeline is inactive"
    finally:
        storage.delete_project(project.id)


def test_transport_becomes_live_once_the_scene_has_a_layer(page, animated_project):
    """The mirror of the test above — gating must not strand a real project."""
    _open_editor(page, animated_project.id)
    disabled = page.evaluate(
        """() => {
        const b = [...document.querySelectorAll('button')]
          .find(x => /play|nothing to play/i.test(x.getAttribute('title') || ''));
        return b ? b.disabled : null;
      }"""
    )
    assert disabled is False, "transport stayed disabled on a scene that has content"


def test_editor_loads_without_console_errors(page, animated_project):
    """A clean console is a weak signal, but a dirty one is always worth knowing."""
    _open_editor(page, animated_project.id)
    page.wait_for_timeout(700)
    errors = [e for e in page.console_errors if "favicon" not in e.lower()]
    assert not errors, f"console errors on editor load: {errors[:3]}"
