from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

F0Method = Literal["rmvpe", "harvest", "crepe", "pm"]


class VoiceConversionParams(BaseModel):
    """
    User-facing voice conversion controls (Models/Home page sliders), mapped
    onto RVC's actual inference parameters:
      - pitch_semitones  -> f0up_key   ("Pitch adjustment")
      - index_rate       -> index_rate ("Index ratio": how much the FAISS
                             feature index pulls timbre toward the target
                             voice model)
      - protect           -> protect    ("Voice similarity": how much of the
                             ORIGINAL voice's consonants/breathiness is
                             preserved rather than replaced — lower values
                             sound more like the target model, higher values
                             preserve more of the source voice's character)
      - sample_rate       -> resample_sr ("Sample rate selection"; 0 = use
                             the model's native output rate, no resampling)
    """

    pitch_semitones: int = Field(default=0, ge=-24, le=24)
    auto_pitch: bool = Field(
        default=False,
        description=(
            "Measure the speaker's pitch and transpose automatically toward "
            "auto_pitch_target's typical speaking range (e.g. female->male "
            "lands around -12). Overrides pitch_semitones when enabled."
        ),
    )
    auto_pitch_target: Literal["male", "female"] = Field(default="male")
    index_rate: float = Field(default=0.5, ge=0.0, le=1.0)
    protect: float = Field(default=0.33, ge=0.0, le=0.5)
    sample_rate: int = Field(default=0, description="0 = native model output rate")
    filter_radius: int = Field(default=3, ge=0, le=7)
    rms_mix_rate: float = Field(default=1.0, ge=0.0, le=1.0)
    f0_method: F0Method = Field(default="rmvpe")
