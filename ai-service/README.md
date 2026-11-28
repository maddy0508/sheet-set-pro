# Sheet Set Pro AI service

Local inference only: Qwen3-VL-8B-Instruct (llama.cpp), GroundingDINO (detection) and SAM 2.1
(segmentation). No hosted or paid inference, no API keys. Model weights live outside this
repository, on the machine that runs the service.

## What runs where

| Piece | Where | Why |
|---|---|---|
| `ssp_ai/geometry.py` | any Python | mask → polygon, simplification, validity. Standard library only. |
| `ssp_ai/pipeline.py` | any Python | orchestration; refusals, provenance, feature mapping. |
| `ssp_ai/api.py` | FastAPI host | `/health`, `/v1/analyse`. |
| `ssp_ai/providers.py` | GPU/CPU host with the models | llama.cpp client, GroundingDINO, SAM 2.1 adapters. |

The application treats the service as optional: it probes `/health` and shows "AI analysis
unavailable" when a model is missing. Manual tracing and measurement never depend on it.

## Install

```bash
python3 -m pip install -r ai-service/requirements.txt
# model extras, only where the models will run:
python3 -m pip install torch --index-url https://download.pytorch.org/whl/cpu   # or cu12x
python3 -m pip install git+https://github.com/IDEA-Research/GroundingDINO.git
python3 -m pip install git+https://github.com/facebookresearch/sam2.git
```

## Weights

Download them once, outside Git:

```
$SSP_AI_WEIGHTS_DIR/
  groundingdino_swint_ogc.pth          # ~700 MB
  sam2.1_hiera_large.pt                # ~860 MB
  qwen3-vl-8b-instruct-q4_k_m.gguf     # ~5 GB
```

Environment:

```
SSP_AI_WEIGHTS_DIR=/srv/ssp-ai/weights
SSP_AI_DINO_CONFIG=/srv/ssp-ai/GroundingDINO/groundingdino/config/GroundingDINO_SwinT_OGC.py
SSP_AI_LLAMA_URL=http://127.0.0.1:8081
```

## Run

```bash
llama-server -m $SSP_AI_WEIGHTS_DIR/qwen3-vl-8b-instruct-q4_k_m.gguf \
  --mmproj $SSP_AI_WEIGHTS_DIR/qwen3-vl-8b-mmproj-f16.gguf --port 8081
uvicorn ssp_ai.api:app --host 127.0.0.1 --port 8090 --app-dir ai-service
```

`GET /health` lists each provider's availability, version and the reason it is unavailable.

## Performance, honestly

The development container has 4 vCPU, 15 GiB of RAM and **no GPU**, and it cannot hold the
weights plus the model runtime within its free disk. Qwen3-VL-8B at Q4 on 4 CPU cores runs at
roughly a few tokens per second: usable for a single roof-form question, not for interactive
iteration. GroundingDINO and SAM 2.1 on the same CPU take tens of seconds per image.

Neither model has been run in this environment. The adapters, the health reporting, the
refusal behaviour, the mask→outline geometry and the pipeline are implemented and tested; a
GPU host (or a modern desktop CPU) is required before any accuracy or speed claim is made.

## Tests

```bash
python3 -m unittest discover -s ai-service/tests -t ai-service
```

Twenty tests, standard library only: mask geometry, outlines, islands, simplification,
self-intersection, contract rejection, pipeline refusal when a model is missing, candidate
generation, feature mapping and provenance.
