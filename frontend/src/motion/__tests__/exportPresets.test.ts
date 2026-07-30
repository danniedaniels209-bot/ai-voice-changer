/**
 * LT-EXPORTPRESETS. localStorage-backed, so each test clears the key first
 * — otherwise state would leak between tests in this file (and this repo
 * has no jsdom/happy-dom dependency — every other test file here is pure
 * logic, no DOM — so `localStorage` doesn't exist under plain Node at all;
 * this is a minimal in-memory stand-in, scoped to this file only, not a
 * change to shared test config).
 */
import { describe, it, expect, beforeEach } from "vitest";

if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

import {
  BUILTIN_PRESETS,
  getCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
} from "../export/exportPresets";

const VALUES = { resolutionPresetId: "1080p", fps: 30, format: "mp4", qualityId: "high", transparent: false };

beforeEach(() => {
  localStorage.clear();
});

describe("BUILTIN_PRESETS", () => {
  it("covers a resolution-only combo and a format-changing combo", () => {
    // At least one built-in must actually change FORMAT, not just
    // resolution/fps — otherwise the "preset" system is really just a
    // resolution picker with extra steps.
    const formats = new Set(BUILTIN_PRESETS.map((p) => p.format));
    expect(formats.size).toBeGreaterThan(1);
  });

  it("every built-in has a unique id and name", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    const names = BUILTIN_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("custom presets", () => {
  it("starts empty", () => {
    expect(getCustomPresets()).toEqual([]);
  });

  it("saves and lists a custom preset with the given values", () => {
    const saved = saveCustomPreset("My Preset", VALUES);
    expect(saved).not.toBeNull();
    const list = getCustomPresets();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "My Preset", ...VALUES });
  });

  it("gives each saved preset a distinct id, even with the same name twice", () => {
    saveCustomPreset("Dup", VALUES);
    saveCustomPreset("Dup", VALUES);
    const list = getCustomPresets();
    expect(list).toHaveLength(2);
    expect(list[0].id).not.toBe(list[1].id);
  });

  it("refuses to save an empty/whitespace-only name", () => {
    expect(saveCustomPreset("", VALUES)).toBeNull();
    expect(saveCustomPreset("   ", VALUES)).toBeNull();
    expect(getCustomPresets()).toEqual([]);
  });

  it("trims a name with surrounding whitespace", () => {
    saveCustomPreset("  Padded  ", VALUES);
    expect(getCustomPresets()[0].name).toBe("Padded");
  });

  it("deletes exactly the targeted preset, leaving the others", () => {
    const a = saveCustomPreset("A", VALUES)!;
    const b = saveCustomPreset("B", VALUES)!;
    deleteCustomPreset(a.id);
    const list = getCustomPresets();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.id);
  });

  it("persists across a fresh read (survives what a page reload would do)", () => {
    saveCustomPreset("Persisted", VALUES);
    // getCustomPresets() has no in-memory cache -- every call re-reads
    // localStorage, so calling it again IS the "reload" simulation.
    expect(getCustomPresets()).toHaveLength(1);
  });

  it("degrades to empty rather than throwing on corrupt localStorage data", () => {
    localStorage.setItem("motion_export_presets", "{not json");
    expect(getCustomPresets()).toEqual([]);
    localStorage.setItem("motion_export_presets", JSON.stringify({ not: "an array" }));
    expect(getCustomPresets()).toEqual([]);
  });
});
