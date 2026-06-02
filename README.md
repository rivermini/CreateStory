# AutoAudio

Auto-audio orchestration microservice for the CreateStory system.

Discovers stories with missing audio and auto-generates TTS chapters via the BedReadVoices microservice, then uploads compressed audio back to the main backend.

## Architecture

```
AutoAudio Service (port 8004)
  ├── core/service.py          — Session orchestration
  ├── core/orchestrator/       — Batch polling, story pipeline, session persistence
  ├── core/services/           — External API client, BedReadVoices client, upload manager, story discovery
  └── api/routes/              — FastAPI endpoints

Downstream:
  BedReadVoices (port 8001)  — TTS generation (Kokoro ONNX)
  BedReadDriveSync (port 8003) — Google Drive sync
  Main Backend API           — Story data & audio storage
```

## Configuration

Copy `.env.example` to `.env` and configure:

- `SERVICE_URLS.BedReadVoices` — BedReadVoices API URL
- `SERVICE_URLS.BedReadDriveSync` — BedReadDriveSync API URL
- `DRIVE_SYNC_CONFIG_PATH` — path to `drive_sync_config.json` (shared with FastAPIServer)
- `USER_SETTINGS_PATH` — path to `user_settings.json` (shared with FastAPIServer)

## Running

```bash
# Install dependencies
pip install -r requirements.txt

# Run
uvicorn main:app --host 0.0.0.0 --port 8004 --reload
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auto-audio/start` | Start a new auto-audio session |
| GET | `/api/auto-audio/status` | Get current session status |
| POST | `/api/auto-audio/stop` | Stop the running session |
| GET | `/api/auto-audio/history` | List all past sessions |
| GET | `/api/auto-audio/history/{id}` | Get full session detail |
| DELETE | `/api/auto-audio/history/{id}` | Delete a session |
