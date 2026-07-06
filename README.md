# CreateStory

CreateStory is a local operations tool for crawling novels, generating TTS audio, syncing Google Drive story folders, and managing the CreateStory production workflow from one React frontend.

## Layout

```text
CreateStory/
  CreateStory_FE/              React frontend
  Services/                    Docker Compose stack
    AutoAudio/                 Auto-audio orchestration service
    BedReadDriveSync/          Google Drive sync service
    BedReadVoices/             Kokoro TTS service
    FastAPIServer/             API gateway
    NovelCrawler/              Novel crawler service
```

## Kokoro Model Files

The Kokoro TTS model files are large and must not be committed to this repository. Keep them in a separate folder or repository next to this monorepo:

```text
D:\Developer\Nova\CreateStory\
D:\Developer\Nova\CreateStoryModels\
  kokoro-v1.0.onnx
  voices-v1.0.bin
```

Docker Compose mounts that external folder into `BedReadVoices` at runtime:

```text
CreateStoryModels -> /app/api/models
```

If your model folder is somewhere else, set `KOKORO_MODELS_DIR` before starting the stack. From `Services/`, the default is:

```powershell
$env:KOKORO_MODELS_DIR="../../CreateStoryModels"
```

For non-Docker local runs of `BedReadVoices`, copy or link the two files into:

```text
Services\BedReadVoices\api\models\
  kokoro-v1.0.onnx
  voices-v1.0.bin
```

That local `api\models` location is ignored by Git.

## Run

Frontend development:

```powershell
cd CreateStory_FE
npm install
npm run dev
```

Local service stack:

```powershell
cd Services
.\update_services.bat
```
