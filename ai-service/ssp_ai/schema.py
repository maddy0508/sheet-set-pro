"""The contract between the application and the local AI service.

Everything that crosses the boundary is validated here, in both directions: a malformed
request is refused before any model runs, and a model result that does not match the schema
is rejected rather than passed to the application as geometry.

The application never trusts a confidence score as an accuracy claim, and never treats a
proposal as a measurement, so the schema keeps those ideas apart: a proposal carries
``source`` and ``provenance``; only an operator approval turns it into roof geometry.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

ANALYSIS_STAGES = ("detect", "segment", "outline", "features", "classify")

CandidateKind = Literal["building", "roof", "roof_section", "roof_plane"]
FeatureKind = Literal[
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
]


class SchemaError(ValueError):
    """A payload that does not match the agreed contract."""


@dataclass(frozen=True)
class ImageInfo:
    """What the service knows about the image it was given. No scale is inferred."""

    width_px: int
    height_px: int
    source: str
    captured_at: str | None = None
    ground_sample_mm_per_px: float | None = None
    crs_epsg: int | None = None
    orthorectified: bool | None = None
    attribution: str | None = None

    def validate(self) -> None:
        if self.width_px <= 0 or self.height_px <= 0:
            raise SchemaError("image dimensions must be positive")
        if self.ground_sample_mm_per_px is not None and self.ground_sample_mm_per_px <= 0:
            raise SchemaError("ground sample distance must be positive")
        if not self.source:
            raise SchemaError("image source is required for provenance")


@dataclass(frozen=True)
class ModelProvenance:
    """Recorded with every analysis so a result can be reproduced and audited."""

    kind: str
    name: str
    version: str
    quantisation: str | None = None
    runtime: str | None = None

    def validate(self) -> None:
        for label, value in (("kind", self.kind), ("name", self.name), ("version", self.version)):
            if not value:
                raise SchemaError(f"model {label} is required")


@dataclass
class AnalyseRequest:
    image: ImageInfo
    job_id: str
    stages: tuple[str, ...] = ("detect",)
    prompt: str | None = None
    candidate_boxes: list[list[float]] = field(default_factory=list)

    def validate(self) -> None:
        if not self.job_id:
            raise SchemaError("job_id is required")
        self.image.validate()
        if not self.stages:
            raise SchemaError("at least one stage is required")
        unknown = [stage for stage in self.stages if stage not in ANALYSIS_STAGES]
        if unknown:
            raise SchemaError(f"unknown stages: {', '.join(unknown)}")
        for box in self.candidate_boxes:
            if len(box) != 4 or any(value < 0 for value in box):
                raise SchemaError("candidate boxes are [x, y, width, height] with non-negative values")
            if box[0] + box[2] > self.image.width_px or box[1] + box[3] > self.image.height_px:
                raise SchemaError("candidate box falls outside the image")


@dataclass
class Candidate:
    """A building or roof the operator may choose. The service proposes; it does not decide."""

    id: str
    kind: CandidateKind
    score: float
    box: list[float]
    label: str
    parent_id: str | None = None
    area_px: float | None = None
    outline: list[list[float]] | None = None
    uncertain: bool = False

    def validate(self) -> None:
        if not self.id:
            raise SchemaError("candidate id is required")
        if self.kind not in ("building", "roof", "roof_section", "roof_plane"):
            raise SchemaError(f"unknown candidate kind: {self.kind}")
        if not 0.0 <= self.score <= 1.0:
            raise SchemaError("candidate score must be between 0 and 1")
        if len(self.box) != 4 or self.box[2] <= 0 or self.box[3] <= 0:
            raise SchemaError("candidate box must be [x, y, width, height] with positive size")
        if self.outline is not None and len(self.outline) < 3:
            raise SchemaError("a candidate outline needs at least three points")


@dataclass
class FeatureProposal:
    kind: FeatureKind
    points: list[list[float]]
    confidence: float
    candidate_id: str
    id: str | None = None

    def validate(self) -> None:
        if self.kind not in (
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
            raise SchemaError(f"unknown feature kind: {self.kind}")
        if len(self.points) < 1:
            raise SchemaError("a feature needs at least one point")
        if not 0.0 <= self.confidence <= 1.0:
            raise SchemaError("feature confidence must be between 0 and 1")
        if not self.candidate_id:
            raise SchemaError("a feature must belong to a candidate")


@dataclass
class AnalysisResult:
    status: Literal["PROPOSED", "UNAVAILABLE", "PARTIAL"]
    job_id: str
    candidates: list[Candidate] = field(default_factory=list)
    features: list[FeatureProposal] = field(default_factory=list)
    planes: list[dict[str, Any]] = field(default_factory=list)
    provenance: list[ModelProvenance] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    unavailable_reason: str | None = None
    image: dict[str, Any] | None = None

    def validate(self) -> None:
        if self.status not in ("PROPOSED", "UNAVAILABLE", "PARTIAL"):
            raise SchemaError(f"unknown result status: {self.status}")
        if self.status == "PROPOSED" and not self.candidates:
            raise SchemaError("a proposed result needs at least one candidate")
        if self.status == "UNAVAILABLE" and not self.unavailable_reason:
            raise SchemaError("an unavailable result must say why")
        seen: set[str] = set()
        for candidate in self.candidates:
            candidate.validate()
            if candidate.id in seen:
                raise SchemaError(f"duplicate candidate id: {candidate.id}")
            seen.add(candidate.id)
        for feature in self.features:
            feature.validate()
            if feature.candidate_id not in seen:
                raise SchemaError(f"feature refers to unknown candidate: {feature.candidate_id}")
        for model in self.provenance:
            model.validate()

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


def result_from_dict(payload: dict[str, Any]) -> AnalysisResult:
    """Read a result, rejecting anything the application would have to guess at."""

    try:
        result = AnalysisResult(
            status=payload["status"],
            job_id=payload["job_id"],
            candidates=[Candidate(**item) for item in payload.get("candidates", [])],
            features=[FeatureProposal(**item) for item in payload.get("features", [])],
            planes=list(payload.get("planes", [])),
            provenance=[ModelProvenance(**item) for item in payload.get("provenance", [])],
            warnings=list(payload.get("warnings", [])),
            unavailable_reason=payload.get("unavailable_reason"),
            image=payload.get("image"),
        )
    except (KeyError, TypeError) as error:
        raise SchemaError(f"malformed analysis result: {error}") from error
    result.validate()
    return result
