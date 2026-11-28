"""The analysis pipeline: imagery in, reviewable proposals out.

The pipeline is pure orchestration over three providers, which is what makes it testable
without any model weights: hand it a detector that returns boxes and a segmenter that returns
masks, and the geometry, provenance and refusal behaviour are all exercised for real.

Two rules are enforced here rather than left to the caller:

* nothing is proposed from a model that did not run — the result is ``UNAVAILABLE`` with the
  precise reason, and the application shows that instead of an empty overlay;
* segmentation produces image-space polygons only. Converting to metres needs verified
  georeferencing, which lives in the application (``src/domain/geo.ts``), not here.
"""

from __future__ import annotations

import json
import os
from typing import Any

from .geometry import GeometryError, Mask, proposals_from_mask
from .providers import Detection, ProviderUnavailable, Providers, candidate_from_detection
from .schema import AnalysisResult, AnalyseRequest, Candidate, FeatureProposal, ModelProvenance

DETECTION_PROMPT = (
    "building, house, roof, garage, shed, workshop, carport, extension"
    if not os.environ.get("SSP_AI_DETECTION_PROMPT")
    else os.environ["SSP_AI_DETECTION_PROMPT"]
)

FEATURE_PROMPT = "ridge, hip, valley, eave, barge, flashing, chimney, skylight, roof vent, pipe"

FEATURE_KINDS = {
    "chimney": "penetration",
    "skylight": "penetration",
    "roof vent": "penetration",
    "pipe": "penetration",
}

ROOF_FORM_QUESTION = (
    "You are looking at an aerial image of a roof. Answer with JSON only, no prose: "
    '{"roof_form": "gable|hip|skillion|complex|unknown", "storeys": 1, '
    '"obscured_areas": ["..."], "notes": "one short sentence"}. '
    "Do not estimate any dimension and do not guess a scale."
)


def image_size(image_bytes: bytes) -> tuple[int, int]:
    """Read the pixel size without decoding the whole image."""

    from .geometry import GeometryError as _GeometryError

    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as error:  # pragma: no cover - Pillow is a service dependency
        raise _GeometryError("Pillow is required to read an image") from error

    import io

    with Image.open(io.BytesIO(image_bytes)) as image:
        return image.size


def analyse(
    request: AnalyseRequest,
    providers: Providers,
    image_bytes: bytes,
    *,
    max_candidates: int = 12,
) -> AnalysisResult:
    request.validate()

    availability = providers.availability()
    detector_ready = availability["detector"]["available"]
    segmenter_ready = availability["segmenter"]["available"]

    if not detector_ready:
        return AnalysisResult(
            status="UNAVAILABLE",
            job_id=request.job_id,
            unavailable_reason=availability["detector"]["reason"],
            warnings=["no detection model is running, so no candidate roofs can be proposed"],
            image=_image_payload(request),
        )

    provenance: list[ModelProvenance] = [providers.detector.provenance()]
    warnings: list[str] = []

    try:
        detections: list[Detection] = providers.detector.detect(image_bytes, DETECTION_PROMPT)
    except ProviderUnavailable as error:
        return AnalysisResult(
            status="UNAVAILABLE",
            job_id=request.job_id,
            unavailable_reason=str(error),
            image=_image_payload(request),
        )

    detections = [item for item in detections if item.box[2] > 1 and item.box[3] > 1][:max_candidates]
    if not detections:
        return AnalysisResult(
            status="PARTIAL",
            job_id=request.job_id,
            provenance=provenance,
            warnings=["the detector found no building or roof in this image"],
            image=_image_payload(request),
        )

    candidates: list[Candidate] = []
    for index, detection in enumerate(detections):
        candidate = candidate_from_detection(detection, index)
        if segmenter_ready:
            try:
                segmented: tuple[Mask, float] = providers.segmenter.segment(image_bytes, detection.box)
            except ProviderUnavailable as error:
                warnings.append(f"candidate {candidate.id}: segmentation unavailable ({error})")
            else:
                mask, score = segmented
                if mask.is_empty():
                    warnings.append(f"candidate {candidate.id}: segmentation returned an empty mask")
                else:
                    outlines = proposals_from_mask(mask)
                    if outlines:
                        best = outlines[0]
                        candidate.outline = best["points"]
                        candidate.area_px = best["area_px"]
                        if not best["is_simple"]:
                            candidate.uncertain = True
                            warnings.append(f"candidate {candidate.id}: outline crosses itself")
                    if score < 0.5:
                        candidate.uncertain = True
        else:
            warnings.append("no segmentation model is running: candidates have boxes but no outlines")
        candidates.append(candidate)

    if segmenter_ready:
        provenance.append(providers.segmenter.provenance())

    features: list[FeatureProposal] = []
    if "features" in request.stages and detector_ready:
        try:
            feature_detections = providers.detector.detect(image_bytes, FEATURE_PROMPT)
        except ProviderUnavailable as error:
            warnings.append(f"feature detection unavailable ({error})")
        else:
            parent = candidates[0].id
            for index, detection in enumerate(feature_detections):
                kind = FEATURE_KINDS.get(detection.label.lower(), detection.label.lower())
                if kind not in (
                    "ridge",
                    "hip",
                    "valley",
                    "eave",
                    "barge",
                    "apron",
                    "box_gutter",
                    "flashing",
                    "penetration",
                    "obstruction",
                ):
                    kind = "obstruction"
                x, y, width, height = detection.box
                features.append(
                    FeatureProposal(
                        id=f"f{index + 1}",
                        kind=kind,  # type: ignore[arg-type]
                        points=[[round(x + width / 2, 2), round(y + height / 2, 2)]],
                        confidence=round(detection.score, 4),
                        candidate_id=parent,
                    )
                )

    planes: list[dict[str, Any]] = []
    if "classify" in request.stages:
        form = _roof_form(providers, image_bytes, warnings)
        if form is not None:
            provenance.append(providers.vision.provenance())
            planes.append({"proposal": "roof_form", **form})

    status = "PROPOSED" if candidates else "PARTIAL"
    result = AnalysisResult(
        status=status,
        job_id=request.job_id,
        candidates=candidates,
        features=features,
        planes=planes,
        provenance=provenance,
        warnings=warnings,
        image=_image_payload(request),
    )
    result.validate()
    return result


def _roof_form(providers: Providers, image_bytes: bytes, warnings: list[str]) -> dict[str, Any] | None:
    """Ask the vision model for structure only. Dimensions are never requested or trusted."""

    ready, reason = providers.vision.available()  # type: ignore[attr-defined]
    if not ready:
        warnings.append(f"roof-form interpretation unavailable ({reason})")
        return None
    try:
        answer = providers.vision.describe(image_bytes, ROOF_FORM_QUESTION)
    except ProviderUnavailable as error:
        warnings.append(f"roof-form interpretation unavailable ({error})")
        return None

    text = answer.strip()
    if "```" in text:
        text = text.split("```")[1].removeprefix("json").strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        warnings.append("the vision model did not answer in the agreed JSON shape; its reply was discarded")
        return None
    if not isinstance(parsed, dict) or "roof_form" not in parsed:
        warnings.append("the vision model replied without a roof form; its reply was discarded")
        return None
    return {
        "roof_form": str(parsed.get("roof_form", "unknown")),
        "storeys": parsed.get("storeys"),
        "obscured_areas": [str(item) for item in parsed.get("obscured_areas", [])][:10],
        "notes": str(parsed.get("notes", ""))[:280],
    }


def _image_payload(request: AnalyseRequest) -> dict[str, Any]:
    image = request.image
    return {
        "width_px": image.width_px,
        "height_px": image.height_px,
        "source": image.source,
        "captured_at": image.captured_at,
        "ground_sample_mm_per_px": image.ground_sample_mm_per_px,
        "crs_epsg": image.crs_epsg,
        "orthorectified": image.orthorectified,
        "attribution": image.attribution,
    }


def validate_image_bytes(data: bytes, max_bytes: int = 25 * 1024 * 1024) -> tuple[int, int]:
    """Reject a payload that is not an image, too large, or empty before any model loads."""

    if not data:
        raise GeometryError("the uploaded image is empty")
    if len(data) > max_bytes:
        raise GeometryError(f"the uploaded image is larger than {max_bytes // (1024 * 1024)} MB")
    try:
        width, height = image_size(data)
    except Exception as error:  # Pillow raises a variety of errors for a bad file
        raise GeometryError(f"the uploaded file is not a readable image: {error}") from error
    if width < 64 or height < 64:
        raise GeometryError("the uploaded image is too small to analyse")
    if width * height > 40_000_000:
        raise GeometryError("the uploaded image has too many pixels to analyse")
    return width, height
