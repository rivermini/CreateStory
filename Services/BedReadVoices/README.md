# BedReadVoices

**BedReadVoices** is the Text-to-Speech (TTS) microservice for the CreateStory suite. It provides GPU-accelerated speech synthesis using the **Kokoro ONNX** TTS engine, supports 45+ voices across 6 languages, and offers batch audio generation for entire stories. It runs on port 8001 and is called by FastAPIServer.

Built with FastAPI + Kokoro ONNX on Python 3.10+.

---

## Features

| Category | Details |
|---|---|
| **GPU-accelerated TTS** | Kokoro ONNX via onnxruntime-gpu (CUDA) with CPU fallback |
| **45+ voices** | Across 6 languages: US/UK English, French, Italian, Japanese, Mandarin |
| **Voice blending** | Mix two voices with custom weight ratios (e.g. `af_sarah,am_adam:60:40`) |
| **Speed control** | Adjustable from 0.5x to 2.0x |
| **Output formats** | WAV and MP3 |
| **Batch generation** | Generate audio for all chapters of a story in one request |
| **Job queue** | FIFO processing with configurable concurrency |
| **Voice preview** | Quick preview with a standard sentence per voice |
| **Story library** | Browse/search stories from external BedRead API |
| **Job persistence** | Job state persisted to disk — survives server restarts |

---

## Architecture

```
FastAPIServer (port 8000)
    │
    └── HTTP/SSE ──► BedReadVoices (port 8001, this service)
                          │
                          ├── Kokoro ONNX (GPU/CPU) ──► WAV/MP3 audio
                          │     ├── Kokoro model (kokoro-v1.0.onnx)
                          │     └── Voices manifest (voices-v1.0.bin)
                          │
                          ├── External BedRead API ──► story/chapter discovery
                          │     (via SERVICE_URLS_FastAPIServer / drive_sync_config.json)
                          │
                          └── FastAPI ──► REST API
                              └── Filesystem ──► output/tts/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI 0.110+ |
| ASGI server | Uvicorn |
| TTS engine | kokoro-onnx 0.4.7+ |
| ONNX runtime | onnxruntime-gpu (CUDA) with CPU fallback |
| Audio I/O | soundfile, numpy |
| HTTP client | httpx |
| Data validation | Pydantic 2.0+ |

---

## Prerequisites

- **Python 3.10+**
- **GPU with CUDA** (optional — CPU fallback works but is slower; auto-detected)
- **Kokoro model files** (download separately — see below)

### Download Kokoro Model Files

The two model files — `kokoro-v1.0.onnx` (~310 MB) and `voices-v1.0.bin` (~25 MB) — are too
large to commit, so they are **not** in git. They are hosted as assets on the CreateStory GitHub
Release tagged **`models-v1.0`**.

**Easiest (works whether the repo is public or private):**

```powershell
# from Services/BedReadVoices
powershell scripts/download-models.ps1
```

**Manual — while the repo is public** (asset URLs are open, no auth needed):

```bash
mkdir -p api/models
curl -L https://github.com/hatrumtruong27/CreateStory/releases/download/models-v1.0/kokoro-v1.0.onnx -o api/models/kokoro-v1.0.onnx
curl -L https://github.com/hatrumtruong27/CreateStory/releases/download/models-v1.0/voices-v1.0.bin  -o api/models/voices-v1.0.bin
```

**Manual — after the repo goes private** (the URLs above return **404** without auth; use the GitHub CLI, which handles the token + redirect for you):

```bash
gh auth login            # once per machine
gh release download models-v1.0 --repo hatrumtruong27/CreateStory \
  --pattern "kokoro-v1.0.onnx" --pattern "voices-v1.0.bin" --dir api/models
```

> **Docker:** compose mounts the models read-only from `${KOKORO_MODELS_DIR:-../../CreateStoryModels}`
> (default `D:\Developer\Nova\CreateStoryModels`), so populate that folder instead of `api/models`:
> `powershell scripts/download-models.ps1 -OutDir D:\Developer\Nova\CreateStoryModels`.

---

## Quick Start

```powershell
cd D:\Developer\Nova\CreateStoryMicroService\BedReadVoices
pip install -r requirements.txt
python main.py
```

The server starts on **http://localhost:8001**. API docs are at **http://localhost:8001/docs** (Swagger UI).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KOKORO_MODEL_PATH` | `api/models/kokoro-v1.0.onnx` | Path to Kokoro ONNX model file |
| `KOKORO_VOICES_PATH` | `api/models/voices-v1.0.bin` | Path to voices manifest |
| `ONNX_PROVIDER` | *(auto-detect)* | `CUDAExecutionProvider` or `CPUExecutionProvider` |
| `KOKORO_CONCURRENCY` | Auto (`1` on CUDA, up to `4` on CPU) | Max concurrent TTS worker threads |
| `KOKORO_CHUNK_SIZE` | `1400` | Target text characters per TTS chunk; larger values reduce overhead |
| `KOKORO_SAVE_CHUNKS` | `false` | Write intermediate `chunk_*.wav` files for debugging |
| `SERVICE_URLS_FastAPIServer` | `http://localhost:8000` | FastAPIServer URL (for runtime config fetch) |
| `SERVICE_URLS_BedReadVoices` | `http://localhost:8001` | Self-reference |

---

## Project Structure

```
BedReadVoices/
├── main.py                           # Uvicorn entry point (port 8001)
├── .env                              # Model paths, concurrency, service URLs
├── api/
│   ├── main.py                       # FastAPI app, CORS, router inclusion
│   ├── routes/
│   │   ├── tts.py                   # TTS endpoints (speak, voices, jobs, preview)
│   │   └── bedread.py                # BedRead endpoints (stories, batch generation)
│   ├── services/
│   │   ├── tts_service.py            # Kokoro ONNX wrapper, job queue
│   │   └── bedread_service.py        # External API proxy + batch coordination
│   ├── models/
│   │   └── voices.py                 # Voice/language Pydantic schemas
│   └── data/                         # TTS job state persistence
│       └── jobs.json
├── output/
│   ├── tts/                         # Generated audio files
│   └── bedread/                     # Batch generation output
└── vendor/                          # Bundled FFmpeg (used by auto-audio orchestrator)
    └── ffmpeg.exe
```

---

## Available Voices

Voices are organized by language. Use `GET /api/tts/voices` to list all available voices and their previews.

### English (US)

`af_heart`, `af_sarah`, `af_nicole`, `af_sky`, `af_bella`, `af_samantha`, `af_nicole`, `af_jessie`, `af_angie`, `af_grace`, `af_dora`, `af_kal_speech`, `af_nova`, `af_ariel`, `af_emma`, `af_lily`, `am_adam`, `am_eric`, `am_michael`, `am_alan`, `amAlbert`, `am_math`, `bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis`

### English (UK)

`lf_nicky`, `hf_privileged`, `lm_nicky`

### French

`ff_siwis`, `ff_玉米`, `ff_bella`, `ff_estra`, `ff_radio`, `ff_steve`

### Italian

`if_nicola`, `if_valentina`

### Japanese

`jf_aoife`, `jf_emi`, `jf_hikari`

### Mandarin

`zf_xiaobei`, `zf_xiaoni`, `zf_xiaoyun`, `pf_donna`, `pf_sarah`, `pf_xiaotong`

### Voice Blending

Mix two voices by comma-separating with a colon ratio:

```
POST /api/tts/speak
{
  "text": "Hello world",
  "voice": "af_sarah,am_adam:60:40",
  "lang": "en"
}
```

---

## API Reference

### TTS

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tts/voices` | List all available voices grouped by language |
| `GET` | `/api/tts/languages` | List supported languages |
| `POST` | `/api/tts/speak` | Enqueue a TTS job. Returns `{ job_id }` |
| `GET` | `/api/tts/jobs` | List all TTS jobs |
| `GET` | `/api/tts/jobs/{job_id}` | Get job status and progress |
| `DELETE` | `/api/tts/jobs/{job_id}` | Cancel a queued or processing job |
| `GET` | `/api/tts/jobs/{job_id}/audio` | Stream or download the completed audio |
| `POST` | `/api/tts/preview` | Generate a quick voice preview |

### BedRead

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/bedread/stories` | List stories from external library (cached 5 min) |
| `GET` | `/api/bedread/stories/search` | Search stories with filters |
| `GET` | `/api/bedread/stories/{story_id}/chapters` | Get chapter list for a story |
| `POST` | `/api/bedread/generate` | Start batch TTS generation for all chapters |
| `GET` | `/api/bedread/jobs` | List all batch jobs |
| `GET` | `/api/bedread/jobs/{batch_id}` | Get batch job status |
| `DELETE` | `/api/bedread/jobs/{batch_id}` | Cancel a batch job |
| `GET` | `/api/bedread/jobs/{batch_id}/download` | Download a single chapter audio |
| `GET` | `/api/bedread/jobs/{batch_id}/zip` | Download all chapters as a ZIP |

---

## Troubleshooting

**TTS model files not found.** Run `scripts/download-models.ps1`, or download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the [CreateStory `models-v1.0` release](https://github.com/hatrumtruong27/CreateStory/releases/tag/models-v1.0) into `api/models/`. Set `KOKORO_MODEL_PATH` and `KOKORO_VOICES_PATH` in `.env` if using non-default paths.

**CUDA not available.** Leave `ONNX_PROVIDER` empty to auto-detect. Falls back to CPU if CUDA is not installed.

**Slow audio generation.** Leave `KOKORO_CONCURRENCY` unset for auto-tuning, or set it manually in `.env`. CPU machines usually benefit from `2` to `4`; CUDA usually works best at `1`, with `2` worth testing if VRAM is comfortable. Increase `KOKORO_CHUNK_SIZE` for fewer inference calls, or lower it if a story hits phoneme/context errors.

**External API errors in batch generation.** The service fetches external API credentials from FastAPIServer's `drive_sync_config.json` at runtime. Ensure FastAPIServer is running and the config file exists.

---

## Related Projects

- [CreateStory_FE](https://github.com/hatrumtruong27/createstory-fe) — React frontend
- [FastAPIServer](https://github.com/hatrumtruong27/createstory-be) — API gateway that proxies to this service
