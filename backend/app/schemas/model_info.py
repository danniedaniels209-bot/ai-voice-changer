from __future__ import annotations

from pydantic import BaseModel


class RVCModelInfo(BaseModel):
    name: str
    pth_path: str
    index_path: str | None
    has_index: bool
    size_mb: float
    sample_rate: int | None = None
