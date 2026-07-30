/**
 * LT-CAPTIONSTYLE: shown in the Inspector when the selected layer belongs to
 * a subtitle import (see subtitleGroup.ts for how membership is tagged).
 *
 * Two operations, both dispatched as ONE undo step via the existing batch
 * actions — no new styling system, no subtitle-specific model fields, no
 * per-caption manual repeats:
 *
 *  - "Apply to all N captions" copies the SELECTED layer's own style fields
 *    (already editable via the ordinary Inspector text/rect controls above
 *    this block) onto every OTHER SAME-TYPE sibling from the same import.
 *    Same-type only: a text layer's font/color has nothing to say about a
 *    band rect's fill, and copying across types would silently corrupt
 *    whichever one didn't match.
 *
 *  - "Move whole group" nudges every sibling's transform by a typed offset,
 *    via the existing ALIGN_LAYERS batch action. This is deliberately NOT
 *    live click-drag: MotionCanvas's own drag handler explicitly does not
 *    support moving a multi-selection today ("dragging a multi-selection
 *    isn't supported yet" — its own comment), and building that generically
 *    is a separate, canvas-wide feature, not a subtitle-styling one. An
 *    explicit offset + Apply is the honest scope for this task.
 */

import { useState } from "react";
import { Captions, Move } from "lucide-react";
import type { MotionLayer, TextLayerProps } from "../../types/motion";
import { siblingsOf } from "./subtitleGroup";

export interface CaptionGroupPanelProps {
  layer: MotionLayer;
  allLayers: MotionLayer[];
  onBatchUpdateLayers: (updates: { layerId: string; patch: Partial<MotionLayer> }[]) => void;
  onAlignLayers: (updates: { layerId: string; transform: MotionLayer["transform"] }[]) => void;
}

/** Style fields to copy for a text layer — everything that affects LOOK, not
 *  the caption's own words or its per-caption timing/position. Returns the
 *  style fields alone (no `text` key) plus `shadow`; the caller grafts the
 *  style onto each sibling's OWN `text.text` — see applyToSiblings. */
function textStyleFields(source: MotionLayer): Omit<TextLayerProps, "text"> {
  const s = source.text!;
  return {
    font_family: s.font_family,
    font_size: s.font_size,
    font_weight: s.font_weight,
    color: s.color,
    align: s.align,
    letter_spacing: s.letter_spacing,
    line_height: s.line_height,
    stroke_color: s.stroke_color,
    stroke_width: s.stroke_width,
  };
}

/** Style fields to copy for a band rect — fill/corner radius/opacity, NOT
 *  position or size (every caption's band is sized to its own text). */
function rectStylePatch(source: MotionLayer): Partial<MotionLayer> {
  const r = source.rect!;
  return {
    rect: {
      fill: r.fill,
      corner_radius: r.corner_radius,
      stroke_color: r.stroke_color,
      stroke_width: r.stroke_width,
    },
  };
}

export function CaptionGroupPanel({
  layer,
  allLayers,
  onBatchUpdateLayers,
  onAlignLayers,
}: CaptionGroupPanelProps) {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);

  if ((layer.type !== "text" && layer.type !== "rect") || (!layer.text && !layer.rect)) return null;
  const siblings = siblingsOf(layer, allLayers);
  if (siblings.length <= 1) return null;

  const sameType = siblings.filter((l) => l.id !== layer.id && l.type === layer.type);
  const kind = layer.type === "text" ? "caption text" : "caption background";

  function applyToSiblings() {
    const updates =
      layer.type === "text"
        ? (() => {
            const fields = textStyleFields(layer);
            const shadow = layer.shadow ?? null;
            // Graft the copied style onto each sibling's OWN text content —
            // the whole point is every caption keeps its own words.
            return sameType.map((sib) => ({
              layerId: sib.id,
              patch: { text: { ...fields, text: sib.text!.text }, shadow },
            }));
          })()
        : sameType.map((sib) => ({ layerId: sib.id, patch: rectStylePatch(layer) }));
    onBatchUpdateLayers(updates);
  }

  function moveGroup() {
    if (dx === 0 && dy === 0) return;
    const updates = siblings.map((sib) => ({
      layerId: sib.id,
      transform: { ...sib.transform, x: sib.transform.x + dx, y: sib.transform.y + dy },
    }));
    onAlignLayers(updates);
    setDx(0);
    setDy(0);
  }

  return (
    <div className="border border-accent/40 rounded-lg bg-accent-dim/40 p-2.5 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">
        <Captions size={12} />
        Subtitle import ({siblings.length} layers)
      </div>

      {sameType.length > 0 && (
        <button
          type="button"
          onClick={applyToSiblings}
          className="w-full px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90"
        >
          Apply this style to all {sameType.length + 1} {kind} layers
        </button>
      )}

      <div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-faint mb-1.5">
          <Move size={11} />
          Move whole group ({siblings.length} layers, px)
        </div>
        <div className="flex items-center gap-2">
          {/* "Nudge X/Y", not bare "X"/"Y" — the Transform section above
              already has generic X/Y fields for the single selected layer,
              and a same-named label here is genuinely ambiguous for anyone
              (a screen reader, a test, a future reader) locating a control
              by its label text rather than pixel position. */}
          <label className="flex items-center gap-1 text-xs text-text-muted">
            Nudge X
            <input
              type="number"
              value={dx}
              onChange={(e) => setDx(Number(e.target.value) || 0)}
              className="w-16 px-1.5 py-1 rounded bg-surface border border-border text-text text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-text-muted">
            Nudge Y
            <input
              type="number"
              value={dy}
              onChange={(e) => setDy(Number(e.target.value) || 0)}
              className="w-16 px-1.5 py-1 rounded bg-surface border border-border text-text text-xs"
            />
          </label>
          <button
            type="button"
            disabled={dx === 0 && dy === 0}
            onClick={moveGroup}
            className="px-3 py-1 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-30"
          >
            Move group
          </button>
        </div>
      </div>
    </div>
  );
}
