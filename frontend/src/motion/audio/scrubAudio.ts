/**
 * Audible timeline scrubbing (LT-AUDIOSCRUB).
 *
 * Dragging the playhead already moves video frames but is silent, so there's
 * no way to find a beat, a word, or a cut by ear — which is how people
 * actually locate things in audio. This plays a short grain of the track at
 * the playhead as you scrub, the way every NLE does.
 *
 * Three problems have to be solved together, and each one's naive answer
 * breaks the others:
 *
 * 1. STACKING. A scrub fires many times a second. Starting a source per event
 *    layers dozens of overlapping copies into a loud mush. Fixed by keeping
 *    exactly ONE live source and stopping it before starting the next.
 *
 * 2. MACHINE-GUNNING. Stopping and restarting on every event still retriggers
 *    ~60x/sec, which sounds like a buzz rather than the audio. Fixed by a
 *    minimum interval between grains — a new grain only starts once the
 *    previous has had time to be heard.
 *
 * 3. CLICKS. Starting or stopping a buffer at an arbitrary sample cuts the
 *    waveform mid-cycle, and a discontinuity is an audible click on every
 *    single grain. Fixed with a short gain ramp in and out, so each grain
 *    fades rather than snaps.
 */

import { resolveMotionAssetUrl } from "../../api/motion";
import { getSharedAudioContext } from "./waveform";

/** How much audio each scrub grain plays. Long enough to be recognisable as
 *  speech/music, short enough that it doesn't lag behind a fast drag. */
const GRAIN_MS = 120;

/** Minimum gap between grain starts. Below roughly this, retriggering is
 *  heard as a buzz instead of as the underlying audio. Deliberately shorter
 *  than GRAIN_MS so consecutive grains overlap slightly and sound continuous
 *  rather than stuttering. */
const MIN_INTERVAL_MS = 70;

/** Fade applied at both ends of every grain. Without it, each grain starts
 *  and ends on an arbitrary sample and the waveform discontinuity clicks. */
const FADE_S = 0.006;

/** Decoded buffers, keyed by resolved URL. Separate from waveform.ts's peaks
 *  cache: that stores downsampled min/max pairs for drawing, which can't be
 *  played back. Same decode cost is shared via the same AudioContext. */
const bufferCache = new Map<string, Promise<AudioBuffer>>();

let activeSource: AudioBufferSourceNode | null = null;
let lastGrainAt = 0;

function loadBuffer(sourceUrl: string): Promise<AudioBuffer> {
  const url = resolveMotionAssetUrl(sourceUrl);
  if (!url) return Promise.reject(new Error("Empty URL"));
  const cached = bufferCache.get(url);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return getSharedAudioContext().decodeAudioData(await response.arrayBuffer());
  })();
  // Don't cache a rejected fetch — a transient failure would otherwise make
  // this track permanently silent for the rest of the session.
  promise.catch(() => bufferCache.delete(url));
  bufferCache.set(url, promise);
  return promise;
}

/** Stop whatever grain is currently sounding. Safe to call when nothing is. */
export function stopScrubAudio(): void {
  if (!activeSource) return;
  try {
    activeSource.stop();
  } catch {
    // Already stopped/ended — stop() throws if the node has finished.
  }
  activeSource = null;
}

/**
 * Play a short grain of `sourceUrl` starting at `offsetSec` within the track.
 *
 * Returns immediately; decoding happens off the calling path. Rate-limited
 * internally, so callers can fire this on every playhead change without
 * throttling themselves.
 *
 * `nowMs` is injectable purely so tests can drive the rate limiter
 * deterministically instead of sleeping.
 */
export function scrubAudioAt(
  sourceUrl: string,
  offsetSec: number,
  nowMs: number = performance.now(),
): void {
  if (!sourceUrl || offsetSec < 0) return;
  if (nowMs - lastGrainAt < MIN_INTERVAL_MS) return;
  lastGrainAt = nowMs;

  void loadBuffer(sourceUrl)
    .then((buffer) => {
      // A seek past the end of the track isn't an error — there's just
      // nothing there to play.
      if (offsetSec >= buffer.duration) return;
      const ctx = getSharedAudioContext();
      // Autoplay policy suspends the context until a user gesture; a scrub IS
      // one, but the context may still be suspended from page load.
      if (ctx.state === "suspended") void ctx.resume();

      stopScrubAudio();

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      const grainS = Math.min(GRAIN_MS / 1000, buffer.duration - offsetSec);

      // Ramp in and out so the grain fades rather than snapping. Clamped so a
      // grain shorter than two fades still has a sane envelope.
      const fade = Math.min(FADE_S, grainS / 2);
      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + fade);
      gain.gain.setValueAtTime(1, t0 + grainS - fade);
      gain.gain.linearRampToValueAtTime(0, t0 + grainS);

      src.connect(gain).connect(ctx.destination);
      src.start(t0, offsetSec, grainS);
      activeSource = src;
      src.onended = () => {
        if (activeSource === src) activeSource = null;
      };
    })
    .catch(() => {
      // A track that can't be fetched or decoded shouldn't break scrubbing —
      // it just scrubs silently, same as a project with no audio at all.
    });
}

/** Test seam: reset the rate limiter and drop any live grain. */
export function resetScrubAudioForTest(): void {
  stopScrubAudio();
  lastGrainAt = 0;
}
