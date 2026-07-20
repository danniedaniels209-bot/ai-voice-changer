"""
Orchestrates the pipeline stages after upload: Demucs separation -> RVC
voice conversion -> mixing -> final video mux. Runs on a background thread
(started by POST /convert) so the HTTP request returns immediately; progress
is tracked through job_manager and polled/streamed via /jobs/{id} and the
WebSocket in api/ws.py.

Upload + audio extraction (the first pipeline stage) already happened in
POST /upload — see api/routes/upload.py — so this only covers stages 2-7.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import Paths
from app.core.errors import AppError, JobInterruptedError, ModelNotFoundError
from app.core.hardware import get_hardware_info
from app.core.logging import get_logger
from app.schemas.job import JobStatus, PipelineStage
from app.schemas.rvc import VoiceConversionParams
from app.services import demucs_service, ffmpeg_service, mixer_service, prosody_service, rvc_service
from app.utils import job_manager, model_manager
from app.utils.settings_store import (
    get_effective_device_mode,
    get_effective_export_dir,
    load_settings,
)

logger = get_logger(__name__)

# Rough progress bands per stage. Not time-accurate (Demucs/RVC runtime
# varies a lot by device and video length) but gives the UI a sense of
# where in the pipeline a job currently is.
_PROGRESS_STAGE_START = {
    PipelineStage.SEPARATING_SPEECH: 10.0,
    PipelineStage.TRANSCRIBING: 50.0,
    PipelineStage.SYNTHESIZING: 65.0,
    PipelineStage.CONVERTING_VOICE: 50.0,
    PipelineStage.MIXING_AUDIO: 80.0,
    PipelineStage.MUXING_VIDEO: 90.0,
    PipelineStage.DONE: 100.0,
}


def _check_cancelled(job_id: str) -> None:
    if job_manager.is_cancel_requested(job_id):
        raise JobInterruptedError("Job was cancelled by the user.")


def _advance(job_id: str, stage: PipelineStage, message: str) -> None:
    _check_cancelled(job_id)
    job_manager.update_job(
        job_id, stage=stage, progress_percent=_PROGRESS_STAGE_START[stage]
    )
    job_manager.append_log(job_id, message)


def run_pipeline(
    job_id: str,
    model_name: str | None,
    params: VoiceConversionParams,
    skip_separation: bool = False,
    mode: str = "rvc",
    tts_voice: str = "en-US-GuyNeural",
    voice_style: str = "standard",
    script: str | None = None,
    chain=None,
    narration_engine: str = "edge",
    exaggeration: float = 0.5,
    continuity=None,
    precision: bool = False,
    dub_language: str | None = None,
    compress_output: bool = False,
) -> None:
    """Entry point for the worker pool task submitted by POST /convert."""
    try:
        job = job_manager.get_job(job_id)
        if not job.video_path:
            raise AppError(
                "Job has no uploaded video — upload must complete first.",
                details={"job_id": job_id},
            )
        if mode != "script" and not job.audio_path:
            raise AppError(
                "This video has no audio track, so there is no speech to convert. "
                "Use 'Narrate my script' mode instead.",
                details={"job_id": job_id},
            )

        model = model_manager.get_model(model_name) if mode == "rvc" else None
        job_manager.update_job(
            job_id,
            status=JobStatus.PROCESSING,
            mode=mode,
            model_name=model_name if mode == "rvc" else tts_voice,
        )

        app_settings = load_settings()
        job_dir = Paths.job_temp_dir(job_id)
        video_path = Path(job.video_path)
        audio_path = Path(job.audio_path) if job.audio_path else None

        device_mode = get_effective_device_mode()
        device = get_hardware_info(device_mode).resolved_device

        if mode == "script":
            # Script narration keeps the ENTIRE original audio (music, ambience)
            # as the background bed — nothing is removed, so no separation.
            job_manager.append_log(job_id, "Script narration: keeping the original audio as background.")
            voice_path, background_path = audio_path, audio_path
        elif skip_separation:
            job_manager.append_log(job_id, "Skipping speech/background separation (no music to preserve).")
            voice_path, background_path = audio_path, None
        else:
            _advance(job_id, PipelineStage.SEPARATING_SPEECH, "Separating speech from background music...")

            def _separation_progress(percent: float) -> None:
                # Map Demucs' own 0-100% into this stage's 10-50% band.
                job_manager.update_job(job_id, progress_percent=10.0 + percent * 0.4)

            voice_path, background_path = demucs_service.separate_speech(
                audio_path,
                job_dir / "separated",
                device=device,
                progress_callback=_separation_progress,
            )
            job_manager.append_log(job_id, "Speech separation complete.")

        preserve_prosody = voice_style == "preserve_prosody"
        if preserve_prosody and not prosody_service.engine_supports_prosody(mode):
            job_manager.append_log(
                job_id,
                f"Preserve Speaking Style is not available in this mode: "
                f"{prosody_service.unsupported_reason(mode)} Continuing with standard conversion.",
            )
            preserve_prosody = False

        converted_voice_path = job_dir / "converted_voice.wav"
        subtitle_cues: list = []
        plan_segments: list = []
        if mode == "script":
            subtitle_cues, plan_segments = _run_script_stages(
                job_id, job, converted_voice_path, job_dir, tts_voice, script,
                narration_engine, exaggeration, device, continuity,
            )
        elif mode == "tts":
            subtitle_cues, plan_segments = _run_tts_stages(
                job_id, job, voice_path, converted_voice_path, job_dir, tts_voice, device,
                narration_engine, exaggeration, continuity, precision, dub_language,
            )
        elif mode == "openvoice":
            from app.services import expressive_service

            _advance(
                job_id,
                PipelineStage.CONVERTING_VOICE,
                f"Converting voice expressively toward '{tts_voice}' (delivery preserved)...",
            )
            expressive_service.convert_expressive(
                voice_path, converted_voice_path, tts_voice, device
            )
            import soundfile as _sf

            mixer_service.conform_duration(
                converted_voice_path, _sf.info(str(voice_path)).duration
            )
            job_manager.append_log(job_id, "Expressive voice conversion complete (timeline verified).")
        else:
            assert model is not None
            _advance(job_id, PipelineStage.CONVERTING_VOICE, f"Converting voice using model '{model_name}'...")

            if preserve_prosody:
                params = prosody_service.adapt_rvc_params(params)
                job_manager.append_log(
                    job_id,
                    "Preserve Speaking Style: keeping the source loudness dynamics "
                    "(rms_mix_rate=0), consonant articulation (protect=0.5), and "
                    "pitch contour (rmvpe).",
                )

            if params.auto_pitch:
                from app.services import pitch_service

                semitones = pitch_service.suggest_transpose(voice_path, params.auto_pitch_target)
                params = params.model_copy(update={"pitch_semitones": semitones})
                job_manager.append_log(
                    job_id,
                    f"Auto-pitch: transposing {semitones:+d} semitones toward a "
                    f"{params.auto_pitch_target} speaking range.",
                )

            index_path = Path(model.index_path) if model.index_path else None
            rvc_service.convert_voice(
                voice_path,
                converted_voice_path,
                Path(model.pth_path),
                index_path,
                params,
                device=device,
            )
            import soundfile as _sf

            mixer_service.conform_duration(
                converted_voice_path, _sf.info(str(voice_path)).duration
            )
            job_manager.append_log(job_id, "Voice conversion complete (timeline verified).")

            if preserve_prosody:
                _check_cancelled(job_id)
                prosody_weight = 1.0
                if continuity is not None and continuity.enabled:
                    prosody_weight = continuity.prosody_preservation / 100.0
                prosody_service.transfer_loudness(
                    voice_path, converted_voice_path, converted_voice_path, weight=prosody_weight
                )
                job_manager.append_log(
                    job_id, "Restored the original speaker's loudness envelope (word emphasis/dynamics)."
                )

        if chain is not None:
            _check_cancelled(job_id)
            converted_voice_path = _run_chain_stage(
                job_id, converted_voice_path, job_dir, chain, params, device
            )

        # Continuity: final smoothing pass over the voice track softens any
        # residual loudness step-changes between converted regions. TTS/script
        # tracks were already assembled with crossfades + rolling memory, so
        # this mainly benefits rvc/openvoice/chained outputs.
        if continuity is not None and continuity.enabled and continuity.naturalness > 0:
            from app.services import continuity_service

            continuity_service.smooth_voice_track(
                converted_voice_path, converted_voice_path, continuity.naturalness
            )
            job_manager.append_log(
                job_id, f"Continuity: smoothed voice track (naturalness={continuity.naturalness})."
            )

        # Segment editor: persist the synthesis recipe so a completed job's
        # narration can be edited and re-exported without redoing separation
        # or transcription. Toggleable (Settings) in case a user prefers the
        # old always-clean-up behavior.
        recipe_saved = False
        if (
            app_settings.segment_editor
            and mode in ("tts", "script")
            and plan_segments
        ):
            import json as _json

            recipe = {
                "mode": mode,
                "engine": narration_engine,
                "voice": tts_voice,
                "exaggeration": exaggeration,
                "stability": (continuity.voice_stability / 100.0)
                if (continuity is not None and continuity.enabled) else None,
                "naturalness": continuity.naturalness
                if (continuity is not None and continuity.enabled) else 0,
                "strict_fit": bool(precision),
                "compress": bool(compress_output),
                "total_duration": job.video_metadata.duration_seconds
                if job.video_metadata else None,
                "background": str(background_path) if background_path else None,
                "segments": [
                    {"id": i, "start": s.start, "end": s.end, "text": s.text, "seed": 0}
                    for i, s in enumerate(sorted(plan_segments, key=lambda x: x.start))
                ],
            }
            (job_dir / "edit_recipe.json").write_text(
                _json.dumps(recipe, indent=2), encoding="utf-8"
            )
            recipe_saved = True

        finalize_export(
            job_id, job, video_path, converted_voice_path, background_path,
            subtitle_cues, app_settings, job_dir, compress=compress_output,
        )

        if app_settings.delete_temp_on_success:
            if recipe_saved:
                job_manager.append_log(
                    job_id,
                    "Keeping editing data (segment editor is on) — temp files "
                    "will be cleaned by the normal retention sweep instead.",
                )
            else:
                _cleanup_temp(job_id, job_dir)

    except JobInterruptedError as exc:
        job_manager.update_job(job_id, status=JobStatus.CANCELLED)
        job_manager.append_log(job_id, f"Job cancelled: {exc.message}")
        _cleanup_intermediates(job_id)
    except AppError as exc:
        job_manager.mark_failed(job_id, exc.code, exc.message)
        job_manager.append_log(job_id, f"Failed: {exc.message}")
        _cleanup_intermediates(job_id)
    except Exception as exc:  # last-resort: never let the background thread die silently
        logger.exception("Unexpected error in pipeline for job %s", job_id)
        job_manager.mark_failed(job_id, "internal_error", str(exc))
        job_manager.append_log(job_id, f"Failed with an unexpected error: {exc}")
        _cleanup_intermediates(job_id)


def _run_tts_stages(
    job_id: str,
    job,
    voice_path: Path,
    converted_voice_path: Path,
    job_dir: Path,
    tts_voice: str,
    device: str,
    narration_engine: str = "edge",
    exaggeration: float = 0.5,
    continuity=None,
    precision: bool = False,
    dub_language: str | None = None,
) -> tuple[list, list]:
    """
    TTS mode: transcribe the (separated) speech locally with Whisper, then
    re-synthesize each segment with a neural narrator voice, placed back at
    the original timestamps so narration stays in sync with the video.
    Returns (placements-for-subtitles, plan-segments-for-the-editor-recipe).
    """
    from app.services import transcribe_service, tts_service

    _advance(job_id, PipelineStage.TRANSCRIBING, "Transcribing speech...")

    def _transcribe_progress(percent: float) -> None:
        # Map into this stage's 50-65% band.
        job_manager.update_job(job_id, progress_percent=50.0 + percent * 0.15)

    segments = transcribe_service.transcribe(
        voice_path, device=device, progress_callback=_transcribe_progress
    )
    job_manager.append_log(job_id, f"Transcription complete ({len(segments)} segments).")

    if load_settings().context_recognition:
        from app.services import context_recognition

        segments, decisions = context_recognition.refine_segments(segments)
        if decisions:
            job_manager.append_log(
                job_id,
                f"Context recognition: protected/normalized {len(decisions)} "
                "technical term(s) (timestamps unchanged).",
            )

    if dub_language:
        # Translation dubbing: translate AFTER context recognition (so tech
        # terms are already protected) and BEFORE precision splitting/merging
        # (translated text has no word timestamps, so precision falls back
        # to segment-level anchoring, which is still exact per segment).
        from app.services import translation_service

        job_manager.append_log(
            job_id,
            "Translating transcript into "
            + translation_service.LANGUAGES.get(dub_language, dub_language) + "...",
        )
        segments = translation_service.translate_segments(segments, dub_language)
        job_manager.append_log(job_id, "Translation complete.")

    if precision:
        # Precision word placement: split into word-anchored phrases and
        # SKIP merging — exact placement and big merged chunks are opposed
        # goals, and the user explicitly chose placement.
        from app.services import alignment_service

        segments = alignment_service.split_to_phrases(segments)
        job_manager.append_log(
            job_id,
            f"Precision word placement: speech anchored as {len(segments)} "
            "phrase(s) at their exact original timings (adaptive merging disabled).",
        )
    elif continuity is not None and continuity.enabled and continuity.adaptive_segmentation:
        from app.services import continuity_service

        raw_count = len(segments)
        # Chatterbox truncates/skips words on long inputs (~1000-step sampler
        # limit), so its chunks are capped harder than the cloud engine's.
        if narration_engine == "chatterbox":
            segments = continuity_service.merge_segments(
                segments, continuity.context_window, max_chunk_override_s=12.0, max_chars=280
            )
        else:
            segments = continuity_service.merge_segments(segments, continuity.context_window)
        job_manager.append_log(
            job_id,
            f"Continuity: merged {raw_count} segments into {len(segments)} "
            "sentence-sized chunks (prosody develops within each chunk).",
        )

    _advance(job_id, PipelineStage.SYNTHESIZING, f"Synthesizing narration with '{tts_voice}'...")

    def _synth_progress(percent: float) -> None:
        _check_cancelled(job_id)  # segment loop is a natural cancellation point
        # Map into this stage's 65-80% band.
        job_manager.update_job(job_id, progress_percent=65.0 + percent * 0.15)

    if job.video_metadata and job.video_metadata.duration_seconds:
        total_duration = job.video_metadata.duration_seconds
    else:
        import soundfile as sf

        total_duration = sf.info(str(voice_path)).duration

    _, placements = tts_service.synthesize_timeline(
        segments,
        voice=tts_voice,
        total_duration=total_duration,
        work_dir=job_dir / "tts_segments",
        output_path=converted_voice_path,
        progress_callback=_synth_progress,
        engine=narration_engine,
        exaggeration=exaggeration,
        device=device,
        continuity=continuity,
        strict_fit=precision,
    )
    job_manager.append_log(job_id, "Narration synthesis complete.")
    return placements, segments


def _run_chain_stage(
    job_id: str,
    voice_track: Path,
    job_dir: Path,
    chain,
    params: VoiceConversionParams,
    device: str,
) -> Path:
    """
    Merge modes: apply a second conversion to the voice track the primary
    mode produced. Both chainable engines (RVC, OpenVoice) are time-aligned,
    so segment timing — and therefore subtitles — is unaffected.
    """
    chained_path = job_dir / "chained_voice.wav"

    if chain.mode == "rvc":
        chain_model = model_manager.get_model(chain.model_name)
        job_manager.append_log(
            job_id, f"Merge modes: converting the result with RVC model '{chain.model_name}'..."
        )
        index_path = Path(chain_model.index_path) if chain_model.index_path else None
        rvc_service.convert_voice(
            voice_track,
            chained_path,
            Path(chain_model.pth_path),
            index_path,
            params,
            device=device,
        )
    else:  # openvoice
        from app.services import expressive_service

        job_manager.append_log(
            job_id,
            f"Merge modes: converting the result expressively toward '{chain.tts_voice}'...",
        )
        expressive_service.convert_expressive(voice_track, chained_path, chain.tts_voice, device)

    import soundfile as _sf

    mixer_service.conform_duration(chained_path, _sf.info(str(voice_track)).duration)
    job_manager.append_log(job_id, "Merge modes: second conversion complete (timeline verified).")
    return chained_path


def _run_script_stages(
    job_id: str,
    job,
    converted_voice_path: Path,
    job_dir: Path,
    tts_voice: str,
    script: str | None,
    narration_engine: str = "edge",
    exaggeration: float = 0.5,
    device: str = "cpu",
    continuity=None,
) -> tuple[list, list]:
    """
    Script mode: no transcription — the user wrote the narration. Sentences
    are spread across the video proportionally to their length and
    synthesized with the chosen voice. Returns placed segments (for
    subtitles).
    """
    from app.services import tts_service

    if not script or not script.strip():
        raise AppError("Script narration mode requires a script.", details={"field": "script"})

    if job.video_metadata and job.video_metadata.duration_seconds:
        total_duration = job.video_metadata.duration_seconds
    else:
        raise AppError("Could not determine the video duration for narration timing.")

    segments = tts_service.split_script_into_segments(script, total_duration)
    job_manager.append_log(job_id, f"Script split into {len(segments)} narration segment(s).")

    if continuity is not None and continuity.enabled and continuity.adaptive_segmentation:
        from app.services import continuity_service

        if narration_engine == "chatterbox":
            segments = continuity_service.merge_segments(
                segments, continuity.context_window, max_chunk_override_s=12.0, max_chars=280
            )
        else:
            segments = continuity_service.merge_segments(segments, continuity.context_window)
        job_manager.append_log(
            job_id, f"Continuity: script merged into {len(segments)} chunk(s)."
        )

    _advance(job_id, PipelineStage.SYNTHESIZING, f"Synthesizing narration with '{tts_voice}'...")

    def _synth_progress(percent: float) -> None:
        _check_cancelled(job_id)
        # Map into the synthesizing stage's 65-80% band.
        job_manager.update_job(job_id, progress_percent=65.0 + percent * 0.15)

    _, placements = tts_service.synthesize_timeline(
        segments,
        voice=tts_voice,
        total_duration=total_duration,
        work_dir=job_dir / "tts_segments",
        output_path=converted_voice_path,
        progress_callback=_synth_progress,
        engine=narration_engine,
        exaggeration=exaggeration,
        device=device,
        continuity=continuity,
    )
    job_manager.append_log(job_id, "Narration synthesis complete.")
    return placements, segments


def finalize_export(
    job_id: str,
    job,
    video_path: Path,
    converted_voice_path: Path,
    background_path: Path | None,
    subtitle_cues: list,
    app_settings,
    job_dir: Path,
    compress: bool = False,
) -> Path:
    """
    Mix + subtitle + mux + verify + publish + job completion — shared by the
    first conversion and every segment-editor re-export, so both paths keep
    identical safety guarantees (safe atomic export, verification, vertical
    variant, subtitles).
    """
    if background_path is None:
        merged_audio_path = converted_voice_path
    else:
        _advance(job_id, PipelineStage.MIXING_AUDIO, "Mixing converted voice with background audio...")
        merged_audio_path = job_dir / "merged_audio.wav"
        mixer_service.mix_audio(
            converted_voice_path,
            background_path,
            merged_audio_path,
            duck_background=app_settings.music_ducking,
        )
        if app_settings.music_ducking:
            job_manager.append_log(job_id, "Background audio ducked under the voice.")
        job_manager.append_log(job_id, "Audio mixing complete.")

    _advance(job_id, PipelineStage.MUXING_VIDEO, "Exporting final video...")
    quality_presets = _export_quality_presets()
    preset = quality_presets.get(app_settings.export_quality, quality_presets["high"])

    # Compress mode re-encodes the video at CRF 26 (or the preset's CRF if
    # it's already smaller-file than that) instead of stream-copying the
    # source — phone/CapCut exports often carry 8-16 Mbps the content
    # doesn't need. Opt-in per job; off = bit-exact video.
    video_crf = preset["video_crf"]
    if compress:
        video_crf = str(max(int(video_crf), 26))
        job_manager.append_log(
            job_id, "Compressing file size: re-encoding video (CRF "
            f"{video_crf}) — expect a much smaller export."
        )

    export_dir = get_effective_export_dir()
    # Name the export after the user's original file, not the internal
    # temp name (which is always "input.<ext>").
    source_name = Path(job.original_filename).stem if job.original_filename else video_path.stem
    from app.utils import safe_export

    output_path = safe_export.resolve_output_path(
        export_dir, f"{source_name}_converted", app_settings.rename_duplicates
    )

    # Subtitles are needed before mux only when burning captions; the
    # final .srt is written next to the export after it is published.
    burn_path: Path | None = None
    if subtitle_cues and app_settings.generate_subtitles and app_settings.burn_captions:
        from app.utils import subtitles

        cue_objs = [subtitles.SubtitleCue(c.start, c.end, c.text) for c in subtitle_cues]
        if app_settings.animated_captions:
            burn_path = job_dir / "captions.ass"
            subtitles.write_word_pop_ass(cue_objs, burn_path)
            job_manager.append_log(job_id, "Burning animated word-by-word captions (re-encodes video)...")
        else:
            burn_path = job_dir / "captions.srt"
            subtitles.write_srt(cue_objs, burn_path)
            job_manager.append_log(job_id, "Burning captions into the video (re-encodes video)...")
    if app_settings.loudness_normalization:
        job_manager.append_log(job_id, "Normalizing loudness to -14 LUFS (YouTube standard).")

    # Safe export: render into the job's OWN temp dir, verify, then move
    # into exports/ atomically — a failure can never corrupt exports/.
    tmp_export = job_dir / "export_main.tmp.mp4"
    ffmpeg_service.mux_audio_into_video(
        video_path,
        merged_audio_path,
        tmp_export,
        video_crf=video_crf,
        audio_bitrate=preset["audio_bitrate"],
        normalize_loudness=app_settings.loudness_normalization,
        burn_subtitles_path=burn_path,
        force_reencode=compress,
    )
    if app_settings.verify_exports:
        safe_export.verify_export(tmp_export)
        job_manager.append_log(job_id, "Export verified (openable, audio present, valid duration).")
    output_path = safe_export.publish(
        tmp_export, output_path, rename_on_lock=app_settings.rename_duplicates
    )

    # Subtitles: cues exist only for tts/script modes (RVC keeps the
    # original words, so there's nothing newly transcribed to caption).
    subtitle_path: Path | None = None
    if subtitle_cues and app_settings.generate_subtitles:
        from app.utils import subtitles

        subtitle_path = output_path.with_suffix(".srt")
        subtitles.write_srt(
            [subtitles.SubtitleCue(c.start, c.end, c.text) for c in subtitle_cues],
            subtitle_path,
        )
        job_manager.append_log(job_id, f"Subtitles saved to {subtitle_path.name}")

    extra_outputs: list[str] = []
    if app_settings.vertical_export:
        _check_cancelled(job_id)
        job_manager.append_log(job_id, "Exporting vertical (9:16) variant for Shorts...")
        tmp_vertical = job_dir / "export_vertical.tmp.mp4"
        ffmpeg_service.export_vertical_variant(
            output_path, tmp_vertical, video_crf=video_crf
        )
        if app_settings.verify_exports:
            safe_export.verify_export(tmp_vertical)
        vertical_path = safe_export.publish(
            tmp_vertical,
            output_path.with_name(f"{output_path.stem}_vertical.mp4"),
            rename_on_lock=app_settings.rename_duplicates,
        )
        extra_outputs.append(str(vertical_path))
        job_manager.append_log(job_id, f"Vertical variant saved to {vertical_path.name}")

    job_manager.update_job(
        job_id,
        status=JobStatus.COMPLETED,
        stage=PipelineStage.DONE,
        progress_percent=100.0,
        output_path=str(output_path),
        subtitle_path=str(subtitle_path) if subtitle_path else None,
        extra_outputs=extra_outputs,
    )
    job_manager.append_log(job_id, f"Done. Exported to {output_path}")
    return output_path


def run_reexport(job_id: str, edited_segments: list[dict]) -> None:
    """
    Segment-editor re-export: re-synthesizes the narration from the saved
    recipe with the user's edits (text changes, new-take seeds), then reuses
    finalize_export. Untouched segments come straight from the content-hash
    cache, so a one-sentence fix re-renders one sentence.
    """
    import json as _json

    from app.services import tts_service
    from app.services.transcribe_service import SpeechSegment
    from app.utils.settings_store import load_settings

    try:
        job = job_manager.get_job(job_id)
        job_dir = Paths.job_temp_dir(job_id)
        recipe_path = job_dir / "edit_recipe.json"
        if not recipe_path.exists():
            raise AppError(
                "This job has no editing data (segment editor was off, or the "
                "temp files were cleaned). Re-run the conversion to edit it."
            )
        recipe = _json.loads(recipe_path.read_text(encoding="utf-8"))
        if not job.video_path or not Path(job.video_path).exists():
            raise AppError("The job's source video is no longer on disk — re-upload to edit.")

        app_settings = load_settings()
        device_mode = get_effective_device_mode()
        device = get_hardware_info(device_mode).resolved_device

        edits = {e["id"]: e for e in edited_segments}
        segments: list[SpeechSegment] = []
        seeds: dict[int, int] = {}
        for i, s in enumerate(sorted(recipe["segments"], key=lambda x: x["start"])):
            edit = edits.get(s["id"], {})
            text = (edit.get("text") or s["text"]).strip()
            if not text:
                continue  # user emptied it = drop this line entirely
            segments.append(SpeechSegment(start=s["start"], end=s["end"], text=text))
            seeds[len(segments) - 1] = int(edit.get("seed", s.get("seed", 0)))
        if not segments:
            raise AppError("All segments were emptied — nothing left to narrate.")

        _advance(job_id, PipelineStage.SYNTHESIZING, "Re-synthesizing edited narration...")

        def _progress(percent: float) -> None:
            _check_cancelled(job_id)
            job_manager.update_job(job_id, progress_percent=65.0 + percent * 0.15)

        converted_voice_path = job_dir / "converted_voice.wav"

        class _Continuity:
            enabled = recipe.get("stability") is not None
            voice_stability = int((recipe.get("stability") or 0.7) * 100)
            naturalness = int(recipe.get("naturalness") or 0)
            rolling_memory = True
            context_window = 0.5

        _, placements = tts_service.synthesize_timeline(
            segments,
            voice=recipe["voice"],
            total_duration=recipe["total_duration"] or (segments[-1].end + 1.0),
            work_dir=job_dir / "tts_segments",
            output_path=converted_voice_path,
            progress_callback=_progress,
            engine=recipe.get("engine", "edge"),
            exaggeration=recipe.get("exaggeration", 0.5),
            device=device,
            continuity=_Continuity() if _Continuity.enabled else None,
            strict_fit=bool(recipe.get("strict_fit")),
            seeds=seeds,
        )
        job_manager.append_log(job_id, "Edited narration re-synthesized.")

        # Persist the edits so the next editing round starts from them.
        recipe["segments"] = [
            {"id": i, "start": s.start, "end": s.end, "text": s.text,
             "seed": seeds.get(i, 0)}
            for i, s in enumerate(segments)
        ]
        recipe_path.write_text(_json.dumps(recipe, indent=2), encoding="utf-8")

        background = Path(recipe["background"]) if recipe.get("background") else None
        if background is not None and not background.exists():
            job_manager.append_log(
                job_id,
                "Background audio is no longer on disk — exporting narration only.",
            )
            background = None

        finalize_export(
            job_id, job, Path(job.video_path), converted_voice_path, background,
            placements, app_settings, job_dir, compress=bool(recipe.get("compress")),
        )

    except JobInterruptedError as exc:
        job_manager.update_job(job_id, status=JobStatus.CANCELLED)
        job_manager.append_log(job_id, f"Re-export cancelled: {exc.message}")
    except AppError as exc:
        job_manager.mark_failed(job_id, exc.code, exc.message)
        job_manager.append_log(job_id, f"Re-export failed: {exc.message}")
    except Exception as exc:  # never let the background thread die silently
        logger.exception("Unexpected error in re-export for job %s", job_id)
        job_manager.mark_failed(job_id, "internal_error", str(exc))
        job_manager.append_log(job_id, f"Re-export failed unexpectedly: {exc}")


def _export_quality_presets() -> dict[str, dict[str, str]]:
    from app.schemas.settings import EXPORT_QUALITY_PRESETS

    return EXPORT_QUALITY_PRESETS


def _cleanup_intermediates(job_id: str) -> None:
    """
    After a failed/cancelled run, delete the heavy intermediate files
    (separated stems, converted voice, merged audio) but KEEP the uploaded
    video, extracted audio, and job.json — so the user can retry the
    conversion without re-uploading, and the failure stays diagnosable.
    """
    import shutil

    job_dir = Paths.job_temp_dir(job_id)
    keep = {"job.json"}
    try:
        job = job_manager.get_job(job_id)
        for p in (job.video_path, job.audio_path):
            if p:
                keep.add(Path(p).name)
    except Exception:
        pass

    for entry in job_dir.iterdir():
        if entry.name in keep:
            continue
        try:
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
        except OSError as exc:
            logger.warning("Could not clean up %s for job %s: %s", entry, job_id, exc)


def _cleanup_temp(job_id: str, job_dir: Path) -> None:
    """
    Deletes intermediate files (extracted audio, separated stems, converted
    voice) now that the final export exists in exports/, keeping only
    job.json for history. Never deletes the exported output itself — that
    lives in exports/, outside job_dir.
    """
    import shutil

    for entry in job_dir.iterdir():
        if entry.name == "job.json":
            continue
        try:
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
        except OSError as exc:
            logger.warning("Could not clean up %s for job %s: %s", entry, job_id, exc)
