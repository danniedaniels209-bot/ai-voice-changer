"""
Makes the `rvc-python` package (pip-installed with --no-deps — see
backend/requirements.txt) work WITHOUT fairseq.

Why this exists: `rvc-python` vendors the real RVC-Project synthesizer
network and inference pipeline (lib/infer_pack/models.py, modules/vc/
pipeline.py) — code whose exact layer shapes must match public RVC .pth
checkpoints, so we use it as-is rather than reimplementing it. But its only
use of `fairseq` is to load the HuBERT content-encoder checkpoint via
`fairseq.checkpoint_utils.load_model_ensemble_and_task(...)`
(modules/vc/utils.py::load_hubert), and `fairseq==0.12.2` does not reliably
build on Windows + Python 3.11 (it needs a full C++ build toolchain and has
known dependency-resolution failures there).

The content encoder RVC models were actually trained against is not
Facebook's HuBERT — it's ContentVec, which has an official fairseq-free
HuggingFace `transformers` port (`lengyue233/content-vec-best`) whose output
is verified numerically identical (see that repo's own conversion sanity
check). So instead of installing fairseq, this module:

  1. Stubs `fairseq` in sys.modules just enough that rvc_python's top-level
     `from fairseq import checkpoint_utils` import doesn't crash (the stub
     function itself is never actually called).
  2. Replaces `rvc_python.modules.vc.modules.load_hubert` with a loader
     backed by the transformers-based ContentVec model, wrapped in an
     adapter exposing the exact `extract_features(source, padding_mask,
     output_layer)` / `final_proj` interface rvc_python's pipeline expects.
  3. Replaces `rvc_python.infer.download_rvc_models` with a version that
     skips downloading the (now unused) hubert_base.pt.

apply() must run before anything imports `rvc_python.infer` / `rvc_python.
modules.vc.modules`, and is idempotent.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import requests
import torch
from torch import nn
from transformers import HubertConfig, HubertModel

from app.core.logging import get_logger

logger = get_logger(__name__)

_APPLIED = False

CONTENT_VEC_MODEL_ID = "lengyue233/content-vec-best"

# Same source rvc-python itself downloads hubert_base.pt/rmvpe.pt from; we
# only need rmvpe.pt (the torch pitch-estimation weights used on cpu/cuda).
# rmvpe.onnx is only used by rvc_python's DirectML ("privateuseone") backend,
# which this project doesn't target, so it's skipped to save ~360MB.
_RMVPE_BASE_URL = "https://huggingface.co/Daswer123/RVC_Base/resolve/main"
_RMVPE_FILES = ("rmvpe.pt",)


class HubertModelWithFinalProj(HubertModel):
    """
    Matches lengyue233/content-vec-best's checkpoint layout: a standard HF
    HubertModel plus the final projection layer fairseq's HuBERT/ContentVec
    checkpoints carry (used for v1/256-dim RVC models).
    """

    def __init__(self, config: HubertConfig):
        super().__init__(config)
        self.final_proj = nn.Linear(config.hidden_size, config.classifier_proj_size)


class _FairseqCompatibleHubert:
    """
    Adapter giving a HuggingFace HubertModelWithFinalProj the same call
    surface as fairseq's HuBERT model object, since rvc_python's pipeline
    (modules/vc/pipeline.py::vc) was written against fairseq's API:
    `model.extract_features(source=..., padding_mask=..., output_layer=N)`
    returning a tuple whose [0] is the hidden-state tensor, plus a
    `model.final_proj` submodule for v1 models.
    """

    def __init__(self, hf_model: HubertModelWithFinalProj):
        self._model = hf_model

    def extract_features(self, source: torch.Tensor, padding_mask: torch.Tensor | None = None, output_layer: int = 9):
        attention_mask = None
        if padding_mask is not None:
            attention_mask = (~padding_mask).long()
        outputs = self._model(source, attention_mask=attention_mask, output_hidden_states=True)
        # HF's hidden_states[0] is the embedding output, hidden_states[N] is
        # the output after N encoder layers — same indexing fairseq's
        # `output_layer` uses.
        hidden = outputs.hidden_states[output_layer]
        return (hidden, None)

    @property
    def final_proj(self):
        return self._model.final_proj

    def to(self, device):
        self._model.to(device)
        return self

    def half(self):
        self._model.half()
        return self

    def float(self):
        self._model.float()
        return self

    def eval(self):
        self._model.eval()
        return self


_content_encoder_cache: _FairseqCompatibleHubert | None = None


# The repo's default revision only ships a legacy pickle (.bin) checkpoint.
# Recent `transformers` refuses to load those through `from_pretrained()`
# unless torch>=2.6 (CVE-2025-32434 mitigation) — but this project pins
# torch==2.5.1 (needed to avoid a *different* incompatibility: newer
# torchaudio requires `torchcodec`, which needs a matching native FFmpeg
# build not reliably available on Windows). Rather than fetch a second,
# differently-formatted copy of the same ~378MB model from a PR revision,
# this downloads the ordinary .bin file via huggingface_hub directly (same
# cache, resumable, dedup'd against any partial/previous download) and
# loads it with our own trusted `torch.load()` call — bypassing
# `transformers`' guarded loading path entirely rather than the file format.
def _load_content_encoder(config, lib_dir: str) -> _FairseqCompatibleHubert:
    """
    Drop-in replacement for rvc_python.modules.vc.utils.load_hubert. Same
    signature so it can be assigned directly over the original.
    """
    global _content_encoder_cache
    if _content_encoder_cache is None:
        logger.info("Loading fairseq-free content encoder (%s)...", CONTENT_VEC_MODEL_ID)
        from huggingface_hub import hf_hub_download

        config_path = hf_hub_download(CONTENT_VEC_MODEL_ID, "config.json")
        weights_path = hf_hub_download(CONTENT_VEC_MODEL_ID, "pytorch_model.bin")

        hf_config = HubertConfig.from_pretrained(Path(config_path).parent)
        hf_model = HubertModelWithFinalProj(hf_config)
        state_dict = torch.load(weights_path, map_location="cpu", weights_only=True)
        hf_model.load_state_dict(state_dict, strict=True)
        hf_model.eval()

        _content_encoder_cache = _FairseqCompatibleHubert(hf_model)

    encoder = _content_encoder_cache
    encoder.to(config.device)
    if config.is_half:
        encoder.half()
    else:
        encoder.float()
    return encoder.eval()


def _download_required_assets(lib_dir: str) -> None:
    """Replacement for rvc_python.download_model.download_rvc_models that
    skips the unused hubert_base.pt (we use the transformers-based encoder
    above instead) and only fetches the RMVPE pitch-estimation weights."""
    folder = Path(lib_dir) / "base_model"
    folder.mkdir(parents=True, exist_ok=True)

    for filename in _RMVPE_FILES:
        dest = folder / filename
        if dest.exists():
            continue
        url = f"{_RMVPE_BASE_URL}/{filename}"
        logger.info("Downloading RVC asset %s...", filename)
        with requests.get(url, stream=True, timeout=60) as response:
            response.raise_for_status()
            tmp_dest = dest.with_suffix(dest.suffix + ".part")
            with tmp_dest.open("wb") as f:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
            tmp_dest.replace(dest)
        logger.info("Downloaded %s", filename)


def _install_fairseq_stub() -> None:
    if "fairseq" in sys.modules:
        return
    try:
        import fairseq  # noqa: F401 — real fairseq is installed, nothing to stub

        return
    except ImportError:
        pass

    def _should_never_run(*_args, **_kwargs):
        raise RuntimeError(
            "fairseq is stubbed out in this project (see app/rvc_lib/patch.py) "
            "and this function should never actually be called."
        )

    checkpoint_utils_stub = types.ModuleType("fairseq.checkpoint_utils")
    checkpoint_utils_stub.load_model_ensemble_and_task = _should_never_run

    utils_stub = types.ModuleType("fairseq.utils")
    utils_stub.index_put = _should_never_run

    fairseq_stub = types.ModuleType("fairseq")
    fairseq_stub.checkpoint_utils = checkpoint_utils_stub
    fairseq_stub.utils = utils_stub

    sys.modules["fairseq"] = fairseq_stub
    sys.modules["fairseq.checkpoint_utils"] = checkpoint_utils_stub
    sys.modules["fairseq.utils"] = utils_stub
    logger.debug("Installed fairseq stub (real fairseq not found).")


def apply() -> None:
    """Idempotent. Must run before importing rvc_python.infer."""
    global _APPLIED
    if _APPLIED:
        return

    _install_fairseq_stub()

    import rvc_python.infer as rvc_infer_module
    import rvc_python.modules.vc.modules as rvc_vc_module

    rvc_vc_module.load_hubert = _load_content_encoder
    rvc_infer_module.download_rvc_models = _download_required_assets

    _APPLIED = True
    logger.info("Applied fairseq-free patches to rvc_python.")
