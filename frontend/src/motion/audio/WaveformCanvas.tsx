import { useState, useRef, useEffect } from "react";
import { getAudioPeaks, type WaveformPeaks } from "./waveform";

export function Waveform({ 
  sourceUrl, 
  width = 120, 
  height = 32, 
  className = "" 
}: { 
  sourceUrl: string | null; 
  width?: number; 
  height?: number; 
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"empty" | "loading" | "error" | "loaded">("empty");
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);

  useEffect(() => {
    if (!sourceUrl || width <= 0 || height <= 0) {
      setState("empty");
      setPeaks(null);
      return;
    }

    setState("loading");
    setPeaks(null);
    let active = true;

    const dpr = window.devicePixelRatio || 1;
    const columns = Math.floor(width * dpr);

    getAudioPeaks(sourceUrl, columns)
      .then((data) => {
        if (!active) return;
        setPeaks(data);
        setState("loaded");
      })
      .catch((e) => {
        console.error("Failed to decode waveform:", e);
        if (!active) return;
        setState("error");
        setPeaks(null);
      });

    return () => {
      active = false;
    };
  }, [sourceUrl, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (state === "empty") {
      return;
    }

    if (state === "loading") {
      ctx.fillStyle = "rgba(156, 163, 175, 0.4)";
      ctx.fillRect(0, height / 2 - 1, width, 2);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "rgba(156, 163, 175, 0.8)";
      ctx.fillText("Decoding...", 4, height / 2 - 4);
      return;
    }

    if (state === "error") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.4)";
      ctx.fillRect(0, height / 2 - 1, width, 2);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
      ctx.fillText("Decode Failed", 4, height / 2 - 4);
      return;
    }

    if (state === "loaded" && peaks) {
      ctx.fillStyle = "rgba(99, 102, 241, 0.8)";
      const barWidth = width / peaks.length;
      const centerY = height / 2;
      const amplitude = height / 2;

      for (let i = 0; i < peaks.length; i++) {
        const { min, max } = peaks[i];
        const barHeight = Math.max(1, (max - min) * amplitude);
        const y = centerY - (max * amplitude);
        ctx.fillRect(i * barWidth, y, barWidth, barHeight);
      }
    }
  }, [state, peaks, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className={className} title={state === "error" ? "Audio decoding failed" : undefined} />;
}
