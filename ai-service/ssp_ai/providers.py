"""Model adapters for the local AI stack.

Every adapter is lazy: nothing heavy is imported until a request actually needs it, and an
adapter reports itself unavailable with a precise reason rather than silently returning an
empty result. That keeps one rule true everywhere in the application — a model that is not
running must look like a model that is not running.

The stack is fixed by the project: Qwen3-VL-8B-Instruct through llama.cpp, GroundingDINO for
open-vocabulary detection, SAM 2.1 for segmentation. No hosted or paid inference is used.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from .schema import Candidate, ModelProvenance

DEFAULT_VISION_MODEL = "Qwen3-VL-8B-Instruct"
DEFAULT_VISION_QUANTISATION = "Q4_K_M"
DEFAULT_DETECTOR_WEIGHTS = "groundingdino_swint_ogc.pth"
DEFAULT_SEGMENTER_WEIGHTS = "sam2.1_hiera_large.pt"
DEFAULT_SEGMENTER_CONFIG = "configs/sam2.1/sam2.1_hiera_l.yaml"


class ProviderUnavailable(RuntimeError):
    """Raised when a model cannot run here; the message says exactly why."""


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    box: tuple[float, float, float, float]


class Detector(Protocol):
    def provenance(self) -> ModelProvenance: ...

    def detect(self, image_bytes: bytes, prompt: str) -> list[Detection]: ...


class Segmenter(Protocol):
    def provenance(self) -> ModelProvenance: ...

    def segment(self, image_bytes: bytes, box: tuple[float, float, float, float]) -> Any: ...


class Vision(Protocol):
    def provenance(self) -> ModelProvenance: ...

    def describe(self, image_bytes: bytes, question: str) -> str: ...


def weights_dir() -> str:
    return os.environ.get("SSP_AI_WEIGHTS_DIR", os.path.join(os.path.dirname(__file__), "..", "weights"))


def _weight_path(name: str) -> str:
    return os.path.abspath(os.path.join(weights_dir(), name))


class GroundingDinoDetector:
    """Open-vocabulary detector. Proposes boxes; it never decides which roof is the job's."""

    def __init__(self, weights: str | None = None, config: str | None = None) -> None:
        self.weights = _weight_path(weights or os.environ.get("SSP_AI_DINO_WEIGHTS", DEFAULT_DETECTOR_WEIGHTS))
        self.config = config or os.environ.get("SSP_AI_DINO_CONFIG", "")
        self._model: Any = None

    def provenance(self) -> ModelProvenance:
        return ModelProvenance(
            kind="detector",
            name="GroundingDINO",
            version=os.environ.get("SSP_AI_DINO_VERSION", "swint-ogc"),
            runtime="torch (in-process)",
        )

    def available(self) -> tuple[bool, str]:
        if not os.path.exists(self.weights):
            return False, f"GroundingDINO weights not found at {self.weights}"
        try:
            import torch  # noqa: F401
            import groundingdino  # noqa: F401
        except ImportError as error:
            return False, f"GroundingDINO dependencies are not installed: {error}"
        if not self.config:
            return False, "SSP_AI_DINO_CONFIG must point at a GroundingDINO model config"
        return True, "ready"

    def detect(self, image_bytes: bytes, prompt: str) -> list[Detection]:
        ready, reason = self.available()
        if not ready:
            raise ProviderUnavailable(reason)

        import io

        import torch
        from PIL import Image
        from groundingdino.util.inference import Model

        if self._model is None:
            self._model = Model(model_config_path=self.config, model_checkpoint_path=self.weights)

        with Image.open(io.BytesIO(image_bytes)) as image:
            rgb = image.convert("RGB")

        detections = self._model.predict_with_classes(
            image=_to_array(rgb),
            classes=[label.strip() for label in prompt.split(",") if label.strip()],
            box_threshold=float(os.environ.get("SSP_AI_BOX_THRESHOLD", "0.25")),
            text_threshold=float(os.environ.get("SSP_AI_TEXT_THRESHOLD", "0.25")),
        )
        names = list(detections.data.get("class_name", [])) if hasattr(detections, "data") else []
        results = []
        for index, (xyxy, confidence) in enumerate(zip(detections.xyxy, detections.confidence)):
            x1, y1, x2, y2 = (float(value) for value in xyxy)
            label = str(names[index]) if index < len(names) else "structure"
            results.append(
                Detection(label=label, score=float(confidence), box=(x1, y1, max(0.0, x2 - x1), max(0.0, y2 - y1)))
            )
        order = sorted(range(len(results)), key=lambda index: results[index].score, reverse=True)
        return [results[index] for index in order]


def _to_array(image: Any) -> Any:
    import numpy as np

    return np.array(image)


class Sam2Segmenter:
    """SAM 2.1 prompted by a box; returns a boolean mask for that region only."""

    def __init__(self, weights: str | None = None, config: str | None = None) -> None:
        self.weights = _weight_path(weights or os.environ.get("SSP_AI_SAM2_WEIGHTS", DEFAULT_SEGMENTER_WEIGHTS))
        self.config = config or os.environ.get("SSP_AI_SAM2_CONFIG", DEFAULT_SEGMENTER_CONFIG)
        self._predictor: Any = None

    def provenance(self) -> ModelProvenance:
        return ModelProvenance(
            kind="segmenter", name="SAM 2.1", version="2.1-hiera-large", runtime="torch (in-process)"
        )

    def available(self) -> tuple[bool, str]:
        if not os.path.exists(self.weights):
            return False, f"SAM 2.1 weights not found at {self.weights}"
        try:
            import torch  # noqa: F401
            import sam2  # noqa: F401
        except ImportError as error:
            return False, f"SAM 2.1 dependencies are not installed: {error}"
        return True, "ready"

    def segment(self, image_bytes: bytes, box: tuple[float, float, float, float]) -> Any:
        ready, reason = self.available()
        if not ready:
            raise ProviderUnavailable(reason)

        import io

        import numpy as np
        from PIL import Image
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        if self._predictor is None:
            self._predictor = SAM2ImagePredictor(build_sam2(self.config, self.weights))

        with Image.open(io.BytesIO(image_bytes)) as image:
            rgb = image.convert("RGB")
            array = np.array(rgb)

        self._predictor.set_image(array)
        x, y, width, height = box
        masks, scores, _ = self._predictor.predict(
            box=np.array([x, y, x + width, y + height]), multimask_output=False
        )
        mask = masks[0] if masks.ndim == 3 else masks
        from .geometry import Mask

        rows = tuple(bytes(1 if value else 0 for value in row) for row in mask.astype(bool))
        return Mask(width=len(rows[0]) if rows else 0, height=len(rows), rows=rows), float(np.max(scores))


class LlamaQwenVision:
    """Qwen3-VL through a local llama.cpp server (OpenAI-compatible /v1/chat/completions)."""

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or os.environ.get("SSP_AI_LLAMA_URL", "http://127.0.0.1:8081")).rstrip("/")
        self.model = model or os.environ.get("SSP_AI_VISION_MODEL", DEFAULT_VISION_MODEL)

    def provenance(self) -> ModelProvenance:
        return ModelProvenance(
            kind="vision",
            name=self.model,
            version=os.environ.get("SSP_AI_VISION_VERSION", "8B-Instruct"),
            quantisation=os.environ.get("SSP_AI_VISION_QUANTISATION", DEFAULT_VISION_QUANTISATION),
            runtime=f"llama.cpp server at {self.base_url}",
        )

    def available(self) -> tuple[bool, str]:
        try:
            with urllib.request.urlopen(f"{self.base_url}/health", timeout=2) as response:
                if response.status == 200:
                    return True, "ready"
                return False, f"llama.cpp server answered {response.status}"
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return False, f"llama.cpp server is not reachable at {self.base_url}: {error}"

    def describe(self, image_bytes: bytes, question: str) -> str:
        ready, reason = self.available()
        if not ready:
            raise ProviderUnavailable(reason)

        payload = {
            "model": self.model,
            "temperature": 0,
            "max_tokens": 700,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode()},
                        },
                    ],
                }
            ],
        }
        request = urllib.request.Request(
            f"{self.base_url}/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=float(os.environ.get("SSP_AI_VISION_TIMEOUT", "120"))) as response:
            body = json.loads(response.read().decode())
        try:
            return str(body["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as error:
            raise ProviderUnavailable(f"llama.cpp returned an unexpected body: {error}") from error


@dataclass
class Providers:
    detector: Detector
    segmenter: Segmenter
    vision: Vision

    def availability(self) -> dict[str, dict[str, Any]]:
        report: dict[str, dict[str, Any]] = {}
        for name, provider in (("detector", self.detector), ("segmenter", self.segmenter), ("vision", self.vision)):
            check = getattr(provider, "available", None)
            ready, reason = check() if check else (True, "ready")
            report[name] = {"available": ready, "reason": reason, "provenance": provider.provenance().__dict__}
        return report


def default_providers() -> Providers:
    return Providers(detector=GroundingDinoDetector(), segmenter=Sam2Segmenter(), vision=LlamaQwenVision())


def candidate_from_detection(detection: Detection, index: int) -> Candidate:
    x, y, width, height = detection.box
    kind = "roof" if "roof" in detection.label.lower() else "building"
    return Candidate(
        id=f"c{index + 1}",
        kind=kind,
        score=round(detection.score, 4),
        box=[round(value, 2) for value in detection.box],
        label=detection.label,
        area_px=None,
    )
