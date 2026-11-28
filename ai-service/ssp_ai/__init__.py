"""Local AI service for roof detection, selection support and outlines.

The models live outside the repository; this package holds the contract, the orchestration
and the geometry that turns a segmentation mask into an editable outline.
"""

from .geometry import GeometryError, Mask, proposals_from_mask  # noqa: F401
from .schema import AnalysisResult, AnalyseRequest, ImageInfo, SchemaError  # noqa: F401

__all__ = [
    "AnalysisResult",
    "AnalyseRequest",
    "GeometryError",
    "ImageInfo",
    "Mask",
    "SchemaError",
    "proposals_from_mask",
]
