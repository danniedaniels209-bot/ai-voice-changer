"""
GET /models, GET /models/{name}, POST /models/import, DELETE /models/{name}
Backs the Models page: list/import/delete/preview local RVC voice models.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile

from app.schemas.model_info import RVCModelInfo
from app.utils import model_manager

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=list[RVCModelInfo])
def list_models_endpoint() -> list[RVCModelInfo]:
    return model_manager.list_models()


@router.get("/{name}", response_model=RVCModelInfo)
def get_model_endpoint(name: str) -> RVCModelInfo:
    return model_manager.get_model(name)


@router.post("/import", response_model=RVCModelInfo)
async def import_model_endpoint(
    name: str = Form(...),
    pth_file: UploadFile = File(...),
    index_file: UploadFile | None = File(None),
) -> RVCModelInfo:
    return await model_manager.import_model(name, pth_file, index_file)


@router.delete("/{name}")
def delete_model_endpoint(name: str) -> dict[str, str]:
    model_manager.delete_model(name)
    return {"status": "deleted", "name": name}
