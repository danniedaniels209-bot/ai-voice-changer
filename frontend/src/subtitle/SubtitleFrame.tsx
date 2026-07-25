/**
 * Pure renderer: given a point in time, a cue list, and a style, draws
 * exactly what would be on screen — no video element involved. This is
 * what SubtitleOverlay (video-driven live preview) and any style-picker
 * demo (driven by its own small looping clock) both render through, so a
 * style preview always matches the real playback exactly.
 */

import type { CSSProperties } from "react";
import { effectiveWords, findActiveCue, findActiveWordIndex } from "./timing";
import type { SubtitleCue, SubtitleStyle } from "../types/subtitle";
import "./animations.css";

interface SubtitleFrameProps {
  currentTime: number;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  /** Scale factor from the style's 1920x1080 reference canvas to whatever
   * size this is actually being drawn at (playerWidth / 1920). */
  scale?: number;
}

function px(n: number): string {
  return `${n}px`;
}

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${opacity})`;
}

export function SubtitleFrame({ currentTime, cues, style, scale = 1 }: SubtitleFrameProps) {
  const cue = findActiveCue(cues, currentTime);
  if (!cue) return null;
  const activeWordIndex = findActiveWordIndex(cue, currentTime);

  const { text: t, stroke, shadow, background, position, animation, word_mode } = style;

  const strokeShadow = stroke.width > 0
    ? [
        `0 0 ${px(stroke.width * scale)} ${stroke.color}`,
        `${px(stroke.width * scale)} 0 0 ${stroke.color}`,
        `${px(-stroke.width * scale)} 0 0 ${stroke.color}`,
        `0 ${px(stroke.width * scale)} 0 ${stroke.color}`,
        `0 ${px(-stroke.width * scale)} 0 ${stroke.color}`,
      ]
    : [];
  const dropShadow = shadow.opacity > 0
    ? [`${px(shadow.offset_x * scale)} ${px(shadow.offset_y * scale)} ${px(shadow.blur * scale)} ${hexToRgba(shadow.color, shadow.opacity)}`]
    : [];
  const textShadow = [...strokeShadow, ...dropShadow].join(", ") || undefined;

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: 10,
    ...(position.anchor === "top" ? { top: px(position.margin * scale) } : {}),
    ...(position.anchor === "bottom" ? { bottom: px(position.margin * scale) } : {}),
    ...(position.anchor === "center" ? { top: "50%", transform: "translateY(-50%)" } : {}),
  };

  const textStyle: CSSProperties = {
    fontFamily: t.font_family,
    fontWeight: t.font_weight,
    fontStyle: t.italic ? "italic" : "normal",
    textDecoration: t.underline ? "underline" : "none",
    letterSpacing: px(t.letter_spacing * scale),
    fontSize: px(t.font_size * scale),
    color: t.color,
    opacity: t.opacity,
    textShadow,
    padding: background.shape === "box" ? `${px(background.padding_y * scale)} ${px(background.padding_x * scale)}` : undefined,
    background: background.shape === "box" ? hexToRgba(background.color, background.opacity) : undefined,
    borderRadius: background.shape === "box" ? px(background.corner_radius * scale) : undefined,
    whiteSpace: "pre-wrap",
    textAlign: "center",
    maxWidth: "90%",
  };

  function renderContent(cue: SubtitleCue) {
    if (word_mode === "word") {
      const words = effectiveWords(cue);
      const idx = Math.max(activeWordIndex, 0);
      const w = words[idx] ?? words[0];
      if (!w) return null;
      return (
        <span
          key={`${cue.id}-${idx}`}
          className={animation.type === "pop" ? "subfx-pop" : undefined}
          style={{ animationDuration: `${animation.duration_ms}ms` }}
        >
          {w.text}
        </span>
      );
    }

    if (word_mode === "karaoke") {
      const words = effectiveWords(cue);
      const active = t.active_color || t.color;
      return words.map((w, i) => {
        const progress = currentTime < w.start ? 0 : currentTime > w.end ? 1
          : (currentTime - w.start) / Math.max(w.end - w.start, 0.001);
        return (
          <span key={i} style={{ marginRight: "0.3em", position: "relative", display: "inline-block" }}>
            <span>{w.text}</span>
            <span
              style={{
                position: "absolute", left: 0, top: 0, overflow: "hidden",
                width: `${progress * 100}%`, color: active, whiteSpace: "nowrap",
              }}
              aria-hidden
            >
              {w.text}
            </span>
          </span>
        );
      });
    }

    if (word_mode === "highlight") {
      const words = effectiveWords(cue);
      return words.map((w, i) => (
        <span key={i} style={{ marginRight: "0.3em", color: i === activeWordIndex ? (t.active_color || t.color) : t.color }}>
          {w.text}
        </span>
      ));
    }

    // word_mode === "line"
    if (animation.type === "typewriter") {
      const duration = Math.max(cue.end - cue.start, 0.05);
      const frac = Math.min(Math.max((currentTime - cue.start) / duration, 0), 1);
      return cue.text.slice(0, Math.round(cue.text.length * frac));
    }
    return (
      <span
        key={cue.id}
        className={animation.type === "fade" ? "subfx-fade" : undefined}
        style={{ animationDuration: `${animation.duration_ms}ms` }}
      >
        {cue.text}
      </span>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={textStyle}>{renderContent(cue)}</div>
    </div>
  );
}
