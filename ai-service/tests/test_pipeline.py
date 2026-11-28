"""Pipeline behaviour: refusal, proposals, provenance and feature mapping.

The doubles below stand in for the models at the documented provider seam. Everything else
— availability handling, outline generation, schema validation, feature mapping — is the real
code path.
"""

from __future__ import annotations

import unittest

from ssp_ai.geometry import Mask
from ssp_ai.pipeline import analyse
from ssp_ai.providers import Detection, ProviderUnavailable, Providers, candidate_from_detection
from ssp_ai.schema import AnalyseRequest, ImageInfo, ModelProvenance, SchemaError, result_from_dict


class FakeDetector:
    def __init__(self, detections: list[Detection] | None = None, ready: bool = True, reason: str = "ready") -> None:
        self.detections = detections or []
        self.ready = ready
        self.reason = reason
        self.calls: list[str] = []

    def provenance(self) -> ModelProvenance:
        return ModelProvenance(kind="detector", name="GroundingDINO", version="test-double")

    def available(self) -> tuple[bool, str]:
        return self.ready, self.reason

    def detect(self, image_bytes: bytes, prompt: str) -> list[Detection]:
        self.calls.append(prompt)
        if not self.ready:
            raise ProviderUnavailable(self.reason)
        return [item for item in self.detections if item.label in prompt or "roof" in prompt]


class FakeSegmenter:
    def __init__(self, mask: Mask | None = None, ready: bool = True, reason: str = "ready") -> None:
        self.mask = mask
        self.ready = ready
        self.reason = reason

    def provenance(self) -> ModelProvenance:
        return ModelProvenance(kind="segmenter", name="SAM 2.1", version="test-double")

    def available(self) -> tuple[bool, str]:
        return self.ready, self.reason

    def segment(self, image_bytes: bytes, box: tuple[float, float, float, float]) -> tuple[Mask, float]:
        if not self.ready:
            raise ProviderUnavailable(self.reason)
        assert self.mask is not None
        return self.mask, 0.92


class FakeVision:
    def __init__(self, reply: str | None = None, ready: bool = True) -> None:
        self.reply = reply
        self.ready = ready

    def provenance(self) -> ModelProvenance:
        return ModelProvenance(kind="vision", name="Qwen3-VL-8B-Instruct", version="test-double", quantisation="Q4_K_M")

    def available(self) -> tuple[bool, str]:
        return (True, "ready") if self.ready else (False, "llama.cpp server is not reachable")

    def describe(self, image_bytes: bytes, question: str) -> str:
        assert self.reply is not None
        return self.reply


def square_mask(size: int = 40, width: int = 120, height: int = 120) -> Mask:
    rows = []
    for y in range(height):
        row = bytearray(width)
        if 10 <= y < 10 + size:
            for x in range(10, 10 + size):
                row[x] = 1
        rows.append(bytes(row))
    return Mask(width=width, height=height, rows=tuple(rows))


def request(stages=("detect", "segment")) -> AnalyseRequest:
    return AnalyseRequest(
        image=ImageInfo(width_px=120, height_px=120, source="aerial-test.png", ground_sample_mm_per_px=150.0),
        job_id="job-1",
        stages=stages,
    )


class PipelineTests(unittest.TestCase):
    def test_detector_unavailable_is_reported_not_faked(self) -> None:
        providers = Providers(
            detector=FakeDetector(ready=False, reason="GroundingDINO weights not found at /weights/x.pth"),
            segmenter=FakeSegmenter(mask=square_mask()),
            vision=FakeVision(),
        )
        result = analyse(request(), providers, b"jpeg-bytes")
        self.assertEqual(result.status, "UNAVAILABLE")
        self.assertIn("weights not found", result.unavailable_reason or "")
        self.assertEqual(result.candidates, [])
        self.assertEqual(result.image["ground_sample_mm_per_px"], 150.0)

    def test_no_detections_is_partial_not_an_invented_candidate(self) -> None:
        providers = Providers(FakeDetector(detections=[]), FakeSegmenter(mask=square_mask()), FakeVision())
        result = analyse(request(), providers, b"jpeg-bytes")
        self.assertEqual(result.status, "PARTIAL")
        self.assertEqual(result.candidates, [])
        self.assertTrue(result.warnings)

    def test_two_buildings_become_two_selectable_candidates(self) -> None:
        detections = [
            Detection(label="house", score=0.93, box=(10, 10, 40, 40)),
            Detection(label="shed", score=0.71, box=(60, 60, 20, 20)),
        ]
        providers = Providers(FakeDetector(detections), FakeSegmenter(mask=square_mask()), FakeVision())
        result = analyse(request(), providers, b"jpeg-bytes")
        self.assertEqual(result.status, "PROPOSED")
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual([candidate.id for candidate in result.candidates], ["c1", "c2"])
        for candidate in result.candidates:
            self.assertIsNotNone(candidate.outline)
            self.assertGreater(candidate.area_px or 0, 100)
        self.assertEqual({model.name for model in result.provenance}, {"GroundingDINO", "SAM 2.1"})
        result.to_dict()

    def test_segmenter_unavailable_still_lists_boxes_with_a_warning(self) -> None:
        detections = [Detection(label="roof", score=0.8, box=(5, 5, 30, 30))]
        providers = Providers(FakeDetector(detections), FakeSegmenter(ready=False, reason="SAM 2.1 weights missing"), FakeVision())
        result = analyse(request(), providers, b"jpeg-bytes")
        self.assertEqual(result.status, "PROPOSED")
        self.assertIsNone(result.candidates[0].outline)
        self.assertTrue(any("segmentation" in warning for warning in result.warnings))

    def test_penetrations_are_proposed_as_features_with_a_parent_candidate(self) -> None:
        detections = [
            Detection(label="house", score=0.9, box=(0, 0, 60, 60)),
            Detection(label="chimney", score=0.6, box=(20, 20, 5, 5)),
            Detection(label="skylight", score=0.5, box=(30, 30, 4, 4)),
        ]
        providers = Providers(FakeDetector(detections), FakeSegmenter(mask=square_mask()), FakeVision())
        result = analyse(request(stages=("detect", "segment", "features")), providers, b"jpeg-bytes")
        kinds = {feature.kind for feature in result.features}
        self.assertIn("penetration", kinds)
        for feature in result.features:
            self.assertIn(feature.candidate_id, {candidate.id for candidate in result.candidates})

    def test_roof_form_reply_must_be_json_or_it_is_discarded(self) -> None:
        detections = [Detection(label="house", score=0.9, box=(0, 0, 60, 60))]
        providers = Providers(
            FakeDetector(detections),
            FakeSegmenter(mask=square_mask()),
            FakeVision(reply='{"roof_form": "hip", "storeys": 1, "obscured_areas": ["tree"], "notes": "clear"}'),
        )
        result = analyse(request(stages=("detect", "classify")), providers, b"jpeg-bytes")
        self.assertEqual(result.planes[0]["roof_form"], "hip")

        providers.vision = FakeVision(reply="It looks like a hip roof, about 200 square metres.")
        result = analyse(request(stages=("detect", "classify")), providers, b"jpeg-bytes")
        self.assertEqual(result.planes, [])
        self.assertTrue(any("discarded" in warning for warning in result.warnings))


class ContractTests(unittest.TestCase):
    def test_request_rejects_unknown_stage(self) -> None:
        with self.assertRaises(SchemaError):
            request(stages=("detect", "hallucinate")).validate()

    def test_request_rejects_box_outside_image(self) -> None:
        with self.assertRaises(SchemaError):
            AnalyseRequest(
                image=ImageInfo(width_px=100, height_px=100, source="x.png"),
                job_id="job",
                candidate_boxes=[[90, 90, 40, 40]],
            ).validate()

    def test_result_rejects_feature_without_known_candidate(self) -> None:
        payload = {
            "status": "PROPOSED",
            "job_id": "job",
            "candidates": [
                {"id": "c1", "kind": "roof", "score": 0.9, "box": [0, 0, 10, 10], "label": "roof", "parent_id": None, "area_px": None, "outline": None, "uncertain": False}
            ],
            "features": [{"kind": "ridge", "points": [[1, 1]], "confidence": 0.5, "candidate_id": "c9", "id": "f1"}],
        }
        with self.assertRaises(SchemaError):
            result_from_dict(payload)

    def test_result_rejects_proposed_without_candidates(self) -> None:
        with self.assertRaises(SchemaError):
            result_from_dict({"status": "PROPOSED", "job_id": "job", "candidates": []})

    def test_candidate_from_detection_keeps_provenance_fields(self) -> None:
        candidate = candidate_from_detection(Detection(label="detached garage", score=0.43219, box=(1, 2, 3, 4)), 0)
        self.assertEqual(candidate.id, "c1")
        self.assertEqual(candidate.kind, "building")
        self.assertEqual(candidate.score, 0.4322)


if __name__ == "__main__":
    unittest.main()
