import { resolveMotionAssetUrl } from "../../api/motion";

export type WaveformPeaks = { min: number; max: number }[];

const decodeCache = new Map<string, Promise<WaveformPeaks>>();

// Create a single AudioContext for decoding (creating too many throws an error)
let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioCtx;
}

/**
 * Fetches an audio asset, decodes it, and downsamples channel 0 to `columns` min/max pairs.
 * Responses are cached by URL and column count to avoid re-decoding.
 */
export function getAudioPeaks(sourceUrl: string, columns: number): Promise<WaveformPeaks> {
  const url = resolveMotionAssetUrl(sourceUrl);
  if (!url) return Promise.reject(new Error("Empty URL"));

  const cacheKey = `${url}:${columns}`;
  if (decodeCache.has(cacheKey)) {
    return decodeCache.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      
      const audioCtx = getAudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const channelData = audioBuffer.getChannelData(0);
      const peaks: WaveformPeaks = [];
      
      const step = Math.max(1, Math.floor(channelData.length / columns));
      
      for (let i = 0; i < columns; i++) {
        let min = 1.0;
        let max = -1.0;
        const start = i * step;
        const end = Math.min(start + step, channelData.length);
        
        for (let j = start; j < end; j++) {
          const val = channelData[j];
          if (val < min) min = val;
          if (val > max) max = val;
        }
        
        // If step was small/empty, prevent uninitialized min/max
        if (min > max) {
          min = 0;
          max = 0;
        }
        
        peaks.push({ min, max });
      }
      
      return peaks;
    } catch (e) {
      decodeCache.delete(cacheKey);
      throw e;
    }
  })();
  
  decodeCache.set(cacheKey, promise);
  return promise;
}
