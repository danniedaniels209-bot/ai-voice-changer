import type { ConversionMode, PipelineStage } from "../types/api";

const STAGE_LABELS: Record<PipelineStage, string> = {
  uploaded: "Uploaded",
  extracting_audio: "Extracting audio",
  separating_speech: "Separating speech from background",
  transcribing: "Transcribing speech",
  synthesizing: "Synthesizing AI narration",
  converting_voice: "Converting voice",
  mixing_audio: "Mixing audio",
  muxing_video: "Exporting final video",
  done: "Done",
};

const RVC_STAGE_ORDER: PipelineStage[] = [
  "extracting_audio",
  "separating_speech",
  "converting_voice",
  "mixing_audio",
  "muxing_video",
  "done",
];

const TTS_STAGE_ORDER: PipelineStage[] = [
  "extracting_audio",
  "separating_speech",
  "transcribing",
  "synthesizing",
  "mixing_audio",
  "muxing_video",
  "done",
];

const SCRIPT_STAGE_ORDER: PipelineStage[] = [
  "extracting_audio",
  "synthesizing",
  "mixing_audio",
  "muxing_video",
  "done",
];

interface StageIndicatorProps {
  stage: PipelineStage;
  mode?: ConversionMode | null;
  skippedSeparation?: boolean;
}

export function StageIndicator({ stage, mode, skippedSeparation }: StageIndicatorProps) {
  const order =
    mode === "script" ? SCRIPT_STAGE_ORDER : mode === "tts" ? TTS_STAGE_ORDER : RVC_STAGE_ORDER;
  const stages = skippedSeparation
    ? order.filter((s) => s !== "separating_speech" && s !== "mixing_audio")
    : order;
  const currentIndex = stages.indexOf(stage);

  return (
    <ol className="space-y-2">
      {stages.map((s, i) => {
        const isDone = currentIndex > i;
        const isCurrent = currentIndex === i;
        return (
          <li key={s} className="flex items-center gap-3 text-sm">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                isDone
                  ? "bg-success text-white"
                  : isCurrent
                    ? "bg-accent text-white"
                    : "bg-surface border border-border text-text-muted"
              }`}
            >
              {isDone ? "✓" : i + 1}
            </span>
            <span className={isCurrent ? "text-text font-medium" : "text-text-muted"}>
              {STAGE_LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
