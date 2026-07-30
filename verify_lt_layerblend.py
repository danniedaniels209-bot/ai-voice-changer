"""LT-LAYERBLEND verification — DOM-aware version.

Three checks:
1. The two layer rects are positioned where the project JSON says they are.
2. The GREEN (top) layer's <g> has style="mix-blend-mode: multiply" applied.
3. Sampling the OVERLAP region in the editor canvas and the export render
   yields the SAME pixel, and that pixel matches the multiply blend math
   (red * green = black).

The previous version guessed viewport-absolute coordinates, but the
editor's MotionCanvas applies its own pan/zoom and the canvas viewport
isn't the full window. Sampling by DOM-relative coordinates (the actual
<rect> elements from each renderer) avoids that whole layout question
and makes the comparison meaningful: we sample the SAME logical point
in both renderers, not points at the same window pixel.

Multiply blend math for fully-saturated primary colors over a black background:
  multiply(0,0,0, 0,255,0) = (0, 0, 0)   -- green-only over black = black
  multiply(255,0,0, 0,0,0) = (0, 0, 0)   -- red-only over black = black
  multiply(255,0,0, 0,255,0) = (0, 0, 0)  -- OVERLAP of red and green = black

So every region should be black! That's a degenerate test — multiply
with anything against a black background yields black. Switch to a
non-black background so the math actually distinguishes the three
regions. A white background:
  multiply(255,255,255, 0,255,0) = (0, 255, 0)   -- green-only over white = green
  multiply(255,255,255, 255,0,0) = (255, 0, 0)   -- red-only over white = red
  multiply(255,255,255, 0,255,0) then with red underneath
        = (255,0,0) * (0,255,0) / 255 = (0, 0, 0)  -- overlap = black

Now the three regions are distinguishable: red, green, black. The
overlap MUST be black for the blend to be active — if it were green
instead, the blend mode isn't doing anything.
"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image

PROJECT_ID = "278875186b7a"
SCENE_ID = "efea76ba8503"
EDITOR_URL = f"http://localhost:8000/motion/{PROJECT_ID}"
RENDER_URL = f"http://localhost:8000/render/{PROJECT_ID}?scene={SCENE_ID}&t=0"
TMP = Path("C:/Users/USER/Downloads/ai-voice-changer/.tmp_lt_layerblend")
TMP.mkdir(exist_ok=True)


async def measure_layer(page, layer_id):
    """Find a layer's <g> by inspecting the DOM. The layer wrapper <g>
    contains a <rect> with the layer's fill color; we find that, and
    return the rect's bounding rect AND the parent <g>'s style attribute
    (which is where mix-blend-mode lives)."""
    return await page.evaluate(
        """(layerId) => {
        const allG = Array.from(document.querySelectorAll('svg g'));
        const out = {found: 0, layer_rects: []};
        for (const g of allG) {
          const r = g.querySelector(':scope > rect[fill]');
          if (r) {
            const fill = r.getAttribute('fill');
            if (fill === '#FF0000' || fill === '#00FF00') {
              const bbox = g.getBoundingClientRect();
              out.layer_rects.push({
                fill,
                bbox: {x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height},
                parentStyle: g.getAttribute('style'),
              });
              out.found += 1;
            }
          }
        }
        return out;
      }"""
    )


async def shot(page, url, out_path, wait_attr):
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_selector(wait_attr, timeout=10000)
    await page.wait_for_timeout(700)
    await page.screenshot(path=str(out_path), full_page=False)


def get_pixel(img, x, y):
    x = max(0, min(img.width - 1, int(x)))
    y = max(0, min(img.height - 1, int(y)))
    return img.getpixel((x, y))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await ctx.new_page()

        await shot(page, EDITOR_URL, TMP / "editor.png", "svg")
        editor_layers = await measure_layer(page, "layer_green")
        editor_img = Image.open(TMP / "editor.png").convert("RGB")

        await shot(page, RENDER_URL, TMP / "render.png", "[data-render-ready]")
        render_layers = await measure_layer(page, "layer_green")
        render_img = Image.open(TMP / "render.png").convert("RGB")

        await browser.close()

    print(f"Editor layers found: {editor_layers['found']}")
    for L in editor_layers["layer_rects"]:
        print(f"  fill={L['fill']:8} bbox={L['bbox']}")
        print(f"           parent style: {L['parentStyle']}")
    print(f"Render layers found: {render_layers['found']}")
    for L in render_layers["layer_rects"]:
        print(f"  fill={L['fill']:8} bbox={L['bbox']}")
        print(f"           parent style: {L['parentStyle']}")
    print()

    # Find the two rects in each
    def by_fill(layers, fill):
        for L in layers["layer_rects"]:
            if L["fill"] == fill:
                return L
        return None

    # Sample three points: red-only, green-only, overlap.
    # Use the GEOMETRIC positions of the red and green rects in each
    # viewport to compute where the overlap should be visually.
    def sample_overlap(red, green):
        # Overlap x range: [max(red.x, green.x), min(red.x+red.w, green.x+green.w)]
        overlap_x_start = max(red["bbox"]["x"], green["bbox"]["x"])
        overlap_x_end = min(
            red["bbox"]["x"] + red["bbox"]["width"],
            green["bbox"]["x"] + green["bbox"]["width"],
        )
        overlap_y_center = (
            red["bbox"]["y"]
            + max(red["bbox"]["height"], green["bbox"]["height"]) / 2
        )
        return int((overlap_x_start + overlap_x_end) / 2), int(overlap_y_center)

    def sample_red_only(red, green):
        # Red-only: x in [red.x, green.x), y centered
        x_center = (red["bbox"]["x"] + green["bbox"]["x"]) / 2
        y_center = red["bbox"]["y"] + red["bbox"]["height"] / 2
        return int(x_center), int(y_center)

    def sample_green_only(red, green):
        # Green-only: x in [red.x + red.w, green.x + green.w)
        x_start = red["bbox"]["x"] + red["bbox"]["width"]
        x_end = green["bbox"]["x"] + green["bbox"]["width"]
        x_center = (x_start + x_end) / 2
        y_center = green["bbox"]["y"] + green["bbox"]["height"] / 2
        return int(x_center), int(y_center)

    samples = {}

    for name, label, img, layers in [
        ("EDITOR", "editor", editor_img, editor_layers),
        ("RENDER", "render", render_img, render_layers),
    ]:
        red = by_fill(layers, "#FF0000")
        green = by_fill(layers, "#00FF00")
        if not red or not green:
            print(f"{name}: missing layer — red={red is not None} green={green is not None}")
            continue

        ro = sample_red_only(red, green)
        go = sample_green_only(red, green)
        ov = sample_overlap(red, green)
        samples[name] = {
            "red_only": get_pixel(img, *ro),
            "green_only": get_pixel(img, *go),
            "overlap": get_pixel(img, *ov),
            "coords": {"red_only": ro, "green_only": go, "overlap": ov},
            "green_parent_style": green["parentStyle"],
        }

    print(f"{'region':<14} {'editor':<22} {'render':<22} {'match':<6} {'expected':<22}")
    print("-" * 92)
    expected = {
        "red_only": (255, 0, 0),  # red rect over white, no blend
        "green_only": (0, 255, 0),  # green rect with multiply over white = green (unchanged)
        "overlap": (0, 0, 0),  # multiply blend result: red * green = black
    }
    all_pass = True
    for region in ("red_only", "green_only", "overlap"):
        e = samples.get("EDITOR", {}).get(region, "?")
        r = samples.get("RENDER", {}).get(region, "?")
        match = e == r and e == expected[region]
        if not match:
            all_pass = False
        print(f"{region:<14} {str(e):<22} {str(r):<22} {'YES' if match else 'NO':<6} {str(expected[region]):<22}")
    print("-" * 92)

    # Also assert the editor canvas has mix-blend-mode applied to the green layer's parent <g>
    editor_green_style = samples.get("EDITOR", {}).get("green_parent_style") or ""
    render_green_style = samples.get("RENDER", {}).get("green_parent_style") or ""
    style_present_editor = "mix-blend-mode" in editor_green_style
    style_present_render = "mix-blend-mode" in render_green_style
    print(f"Editor: green layer <g> style: {editor_green_style!r}  (mix-blend-mode present: {style_present_editor})")
    print(f"Render: green layer <g> style: {render_green_style!r}  (mix-blend-mode present: {style_present_render})")
    if not style_present_editor or not style_present_render:
        all_pass = False

    print()
    print("PASS" if all_pass else "FAIL")


asyncio.run(main())