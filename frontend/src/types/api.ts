// Mirrors backend/app/schemas/*.py — keep in sync when those change.

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type PipelineStage =
  | "uploaded"
  | "extracting_audio"
  | "separating_speech"
  | "transcribing"
  | "synthesizing"
  | "converting_voice"
  | "mixing_audio"
  | "muxing_video"
  | "done";

export type ConversionMode = "rvc" | "tts" | "script" | "openvoice";
export type VoiceStyle = "standard" | "preserve_prosody";

export interface VideoMetadata {
  duration_seconds: number;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  has_audio: boolean;
  audio_codec: string | null;
  audio_sample_rate: number | null;
}

export interface LogEntry {
  timestamp: string;
  message: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  stage: PipelineStage;
  progress_percent: number;
  created_at: string;
  updated_at: string;
  original_filename: string | null;
  video_path: string | null;
  video_metadata: VideoMetadata | null;
  audio_path: string | null;
  model_name: string | null;
  mode: ConversionMode | null;
  request_summary: Record<string, string>;
  output_path: string | null;
  subtitle_path: string | null;
  extra_outputs: string[];
  error_code: string | null;
  error_message: string | null;
  cancel_requested: boolean;
  log: LogEntry[];
}

export interface RVCModelInfo {
  name: string;
  pth_path: string;
  index_path: string | null;
  has_index: boolean;
  size_mb: number;
  sample_rate: number | null;
}

export type DeviceMode = "auto" | "cuda" | "cpu";
export type ExportQuality = "low" | "medium" | "high" | "lossless";

export interface AppSettings {
  device_mode: DeviceMode;
  ffmpeg_path: string | null;
  temp_dir: string | null;
  export_dir: string | null;
  export_quality: ExportQuality;
  delete_temp_on_success: boolean;
  generate_subtitles: boolean;
  burn_captions: boolean;
  vertical_export: boolean;
  music_ducking: boolean;
  loudness_normalization: boolean;
  context_recognition: boolean;
  segment_editor: boolean;
  animated_captions: boolean;
  custom_voices: boolean;
  rename_duplicates: boolean;
  verify_exports: boolean;
  default_narration_engine: NarrationEngine;
}

export type AppSettingsUpdate = Partial<AppSettings>;

export interface HardwareStatus {
  cuda_available: boolean;
  device_name: string | null;
  cuda_version: string | null;
  torch_version: string | null;
  resolved_device: string;
}

export interface HealthResponse {
  status: string;
  app_name: string;
  ffmpeg_found: boolean;
  ffmpeg_path: string | null;
  hardware: HardwareStatus;
  paths: Record<string, string>;
}

export type F0Method = "rmvpe" | "harvest" | "crepe" | "pm";

export interface VoiceConversionParams {
  pitch_semitones: number;
  auto_pitch: boolean;
  auto_pitch_target: "male" | "female";
  index_rate: number;
  protect: number;
  sample_rate: number;
  filter_radius: number;
  rms_mix_rate: number;
  f0_method: F0Method;
}

export const DEFAULT_VOICE_PARAMS: VoiceConversionParams = {
  pitch_semitones: 0,
  auto_pitch: false,
  auto_pitch_target: "male",
  index_rate: 0.5,
  protect: 0.33,
  sample_rate: 0,
  filter_radius: 3,
  rms_mix_rate: 1.0,
  f0_method: "rmvpe",
};

export interface ContinuitySettings {
  enabled: boolean;
  context_window: number; // 0-1
  voice_stability: number; // 0-100
  prosody_preservation: number; // 0-100
  naturalness: number; // 0-100
  adaptive_segmentation: boolean;
  rolling_memory: boolean;
}

export const DEFAULT_CONTINUITY: ContinuitySettings = {
  enabled: false,
  context_window: 0.5,
  voice_stability: 70,
  prosody_preservation: 70,
  naturalness: 70,
  adaptive_segmentation: true,
  rolling_memory: true,
};

export interface ChainStage {
  mode: "rvc" | "openvoice";
  model_name: string | null;
  tts_voice: string;
}

export type NarrationEngine = "edge" | "chatterbox";

export interface ConvertRequest {
  mode: ConversionMode;
  model_name: string | null;
  tts_voice: string;
  script: string | null;
  chain: ChainStage | null;
  continuity: ContinuitySettings;
  precision_alignment: boolean;
  narration_engine: NarrationEngine;
  exaggeration: number;
  voice_style: VoiceStyle;
  params: VoiceConversionParams;
  skip_separation: boolean;
}

export interface CustomVoiceInfo {
  id: string; // "custom:<name>"
  name: string;
  size_mb: number;
}

export interface VoiceInfo {
  id: string;
  label: string;
  gender: "male" | "female";
  accent: string;
  is_default: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export interface JobSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  seed: number;
}

export interface JobSegmentsResponse {
  editable: boolean;
  reason: string;
  engine?: string;
  voice?: string;
  segments: JobSegment[];
}
