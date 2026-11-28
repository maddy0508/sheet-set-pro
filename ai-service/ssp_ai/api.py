"""FastAPI surface for the local AI service.

Run it on the business's own machine, next to the model files:

    SSP_AI_WEIGHTS_DIR=/srv/ssp-ai/weights \
    SSP_AI_LLAMA_URL=http://127.0.0.1:8081 \
    uvicorn ssp_ai.api:app --host 127.0.0.1 --port 8090

The application treats this service as optional. ``/health`` is what it probes, and it
answers truthfully when a model is missing so the interface can say "AI analysis is
unavailable" instead of showing an empty overlay.
"""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .geometry import GeometryError
from .pipeline import analyse, validate_image_bytes
from .providers import ProviderUnavailable, default_providers
from .schema import AnalyseRequest, ImageInfo, SchemaError

app = FastAPI(title="Sheet Set Pro AI service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, Any]:
    """Model availability, versions and the runtime each one needs."""

    providers = default_providers()
    report = providers.availability()
    ready = any(entry["available"] for entry in report.values())
    return {
        "status": "ready" if ready else "unavailable",
        "providers": report,
        "weights_dir": os.path.abspath(os.environ.get("SSP_AI_WEIGHTS_DIR", "weights")),
    }


@app.post("/v1/analyse")
async def analyse_route(
    image: UploadFile = File(...),
    job_id: str = Form(...),
    stages: str = Form("detect,segment"),
    prompt: str | None = Form(None),
) -> JSONResponse:
    """Detect candidate buildings and roofs, and segment each one into an editable outline.

    Answers ``503`` when no model is running: the application shows "AI analysis is
    unavailable" and the operator falls back to manual tracing.
    """

    data = await image.read()
    try:
        width, height = validate_image_bytes(data)
    except GeometryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    request = AnalyseRequest(
        image=ImageInfo(
            width_px=width,
            height_px=height,
            source=image.filename or "upload",
            captured_at=None,
            ground_sample_mm_per_px=None,
            crs_epsg=None,
        ),
        job_id=job_id,
        stages=tuple(part.strip() for part in stages.split(",") if part.strip()),
        prompt=prompt,
    )

    try:
        result = analyse(request, default_providers(), data)
    except (SchemaError, GeometryError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ProviderUnavailable as error:
        return JSONResponse(status_code=503, content={"detail": str(error)})

    payload = result.to_dict()
    if result.status == "UNAVAILABLE":
        return JSONResponse(status_code=503, content=payload)
    return JSONResponse(status_code=200, content=json.loads(json.dumps(payload)))
