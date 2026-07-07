"""TTS service — GPU-only, multi-worker FIFO queue using kokoro-onnx."""

from __future__ import annotations

import logging
import os
import re
import uuid
import gc
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Optional

from api.db import init_db
from api.repositories.audio_repository import GeneratedAudioRepository

logger = logging.getLogger(__name__)
MIN_KOKORO_CONCURRENCY = 1
MAX_KOKORO_CONCURRENCY = 2


def _detect_execution_provider() -> str:
    env_override = os.environ.get("ONNX_PROVIDER", "").strip()
    if env_override:
        return env_override

    try:
        import onnxruntime as ort
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            return "CUDAExecutionProvider"
    except ImportError:
        pass

    return "CPUExecutionProvider"


def _env_int(name: str, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        value = default
    else:
        try:
            value = int(raw)
        except ValueError:
            logger.warning("Invalid %s=%r; using %d.", name, raw, default)
            value = default

    value = max(minimum, value)
    if maximum is not None:
        value = min(value, maximum)
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "y", "on"}


def _default_concurrency(ignore_env: bool = False) -> int:
    if not ignore_env and os.environ.get("KOKORO_CONCURRENCY", "").strip():
        return _env_int(
            "KOKORO_CONCURRENCY",
            1,
            minimum=MIN_KOKORO_CONCURRENCY,
            maximum=MAX_KOKORO_CONCURRENCY,
        )

    provider = _detect_execution_provider()
    if provider == "CPUExecutionProvider":
        cpu_count = os.cpu_count() or 2
        return max(MIN_KOKORO_CONCURRENCY, min(MAX_KOKORO_CONCURRENCY, cpu_count // 2))

    return MIN_KOKORO_CONCURRENCY


SAMPLE_RATE = 24000
MAX_QUEUED_JOBS_PER_USER = int(os.getenv("MAX_QUEUED_JOBS_PER_USER", "20"))
MAX_QUEUED_JOBS_GLOBAL = int(os.getenv("MAX_QUEUED_JOBS_GLOBAL", "100"))
JOB_CLEANUP_RETENTION_DAYS = _env_int("TTS_JOB_CLEANUP_RETENTION_DAYS", 30, minimum=1)
JOB_CLEANUP_INTERVAL_SECONDS = _env_int("TTS_JOB_CLEANUP_INTERVAL_SECONDS", 6 * 60 * 60, minimum=60)
TEXTLESS_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}


class TTSCapacityError(RuntimeError):
    """Raised when the TTS queue has reached an admission limit."""

VOICE_LANG_MAP: dict[str, str] = {
    "en-us": "English (US)",
    "en-gb": "English (UK)",
    "fr-fr": "French",
    "it": "Italian",
    "ja": "Japanese",
    "cmn": "Mandarin Chinese",
}

VOICE_METADATA: dict[str, tuple[str, str]] = {
    "af_alloy": ("en-us", "Alloy (US Female)"),
    "af_aoede": ("en-us", "Aoede (US Female)"),
    "af_bella": ("en-us", "Bella (US Female)"),
    "af_heart": ("en-us", "Heart (US Female)"),
    "af_jessica": ("en-us", "Jessica (US Female)"),
    "af_kore": ("en-us", "Kore (US Female)"),
    "af_nicole": ("en-us", "Nicole (US Female)"),
    "af_nova": ("en-us", "Nova (US Female)"),
    "af_river": ("en-us", "River (US Female)"),
    "af_sarah": ("en-us", "Sarah (US Female)"),
    "af_sky": ("en-us", "Sky (US Female)"),
    "am_adam": ("en-us", "Adam (US Male)"),
    "am_echo": ("en-us", "Echo (US Male)"),
    "am_eric": ("en-us", "Eric (US Male)"),
    "am_fenrir": ("en-us", "Fenrir (US Male)"),
    "am_liam": ("en-us", "Liam (US Male)"),
    "am_michael": ("en-us", "Michael (US Male)"),
    "am_onyx": ("en-us", "Onyx (US Male)"),
    "am_puck": ("en-us", "Puck (US Male)"),
    "bf_alice": ("en-gb", "Alice (UK Female)"),
    "bf_emma": ("en-gb", "Emma (UK Female)"),
    "bf_isabella": ("en-gb", "Isabella (UK Female)"),
    "bm_daniel": ("en-gb", "Daniel (UK Male)"),
    "bm_fable": ("en-gb", "Fable (UK Male)"),
    "bm_george": ("en-gb", "George (UK Male)"),
    "bm_lewis": ("en-gb", "Lewis (UK Male)"),
    "ff_siwis": ("fr-fr", "Siwis (French)"),
    "if_sara": ("it", "Sara (Italian Female)"),
    "im_nicola": ("it", "Nicola (Italian Male)"),
    "jf_alpha": ("ja", "Alpha (Japanese Female)"),
    "jf_gongitsune": ("ja", "Gongitsune (Japanese Female)"),
    "jf_nezumi": ("ja", "Nezumi (Japanese Female)"),
    "jf_tebukuro": ("ja", "Tebukuro (Japanese Female)"),
    "jm_kumo": ("ja", "Kumo (Japanese Male)"),
    "zf_xiaobei": ("cmn", "Xiaobei (Mandarin Female)"),
    "zf_xiaoni": ("cmn", "Xiaoni (Mandarin Female)"),
    "zf_xiaoxiao": ("cmn", "Xiaoxiao (Mandarin Female)"),
    "zf_xiaoyi": ("cmn", "Xiaoyi (Mandarin Female)"),
    "zm_yunjian": ("cmn", "Yunjian (Mandarin Male)"),
    "zm_yunxi": ("cmn", "Yunxi (Mandarin Male)"),
    "zm_yunxia": ("cmn", "Yunxia (Mandarin Female)"),
    "zm_yunyang": ("cmn", "Yang (Mandarin Male)"),
}


@dataclass
class TTSJob:
    job_id: str = ""
    created_by_user_id: str | None = None
    status: str = "idle"
    text: str = ""
    voice: str = "af_sarah"
    lang: str = "en-us"
    speed: float = 1.0
    format: str = "wav"
    output_dir: str = ""
    chunks_total: int = 0
    chunks_done: int = 0
    progress_pct: int = 0
    error: str = ""
    output_filename: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

    def to_dict(self, queue_position: int = 0) -> dict:
        return {
            "job_id": self.job_id,
            "created_by_user_id": self.created_by_user_id,
            "status": self.status,
            "voice": self.voice,
            "lang": self.lang,
            "speed": self.speed,
            "format": self.format,
            "output_dir": self.output_dir,
            "chunks_total": self.chunks_total,
            "chunks_done": self.chunks_done,
            "progress_pct": self.progress_pct,
            "error": self.error,
            "output_filename": self.output_filename,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "queue_position": queue_position,
        }


class TTSService:
    CONCURRENCY: int = _default_concurrency()
    CHUNK_SIZE: int = _env_int("KOKORO_CHUNK_SIZE", 1400, minimum=600, maximum=2400)
    SAVE_CHUNKS: bool = _env_bool("KOKORO_SAVE_CHUNKS", False)
    RETRY_MIN_CHUNK_SIZE: int = 180
    RETRY_MAX_DEPTH: int = 4

    def __init__(self) -> None:
        self._jobs: dict[str, TTSJob] = {}
        self._queue: list[str] = []
        self._lock = Lock()
        self._workers: list[Thread] = []
        self._workers_running = True
        self._cleanup_stop = Event()
        self._cleanup_thread: Thread | None = None
        self._target_workers = self.CONCURRENCY
        self._busy_workers: set[int] = set()
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._output_base = self._project_root / "output" / "tts"
        self._output_base.mkdir(parents=True, exist_ok=True)
        init_db()
        self._job_repo = GeneratedAudioRepository()
        self._job_repo.import_existing_output_dir(self._output_base)
        self._load_persisted_jobs()
        self._model_path: Optional[Path] = None
        self._voices_path: Optional[Path] = None

        for i in range(self.CONCURRENCY):
            t = Thread(target=self._worker_loop, args=(i,), daemon=True)
            t.start()
            self._workers.append(t)

        self._cleanup_thread = Thread(target=self._cleanup_old_jobs_loop, daemon=True)
        self._cleanup_thread.start()

        logger.info(
            "TTSService started with %d workers, provider=%s, chunk_size=%d, save_chunks=%s.",
            self.CONCURRENCY,
            _detect_execution_provider(),
            self.CHUNK_SIZE,
            self.SAVE_CHUNKS,
        )

    def _load_persisted_jobs(self) -> None:
        try:
            interrupted_jobs: list[TTSJob] = []
            for entry in self._job_repo.load_jobs():
                job_id = entry.get("job_id", "")
                if not job_id:
                    continue
                status = entry.get("status", "queued")
                if status in ("queued", "processing"):
                    status = "interrupted"
                    was_interrupted = True
                else:
                    was_interrupted = False
                job = TTSJob(
                    job_id=job_id,
                    created_by_user_id=entry.get("created_by_user_id"),
                    status=status,
                    text="" if status in TEXTLESS_TERMINAL_STATUSES else entry.get("text", ""),
                    voice=entry.get("voice", "af_sarah"),
                    lang=entry.get("lang", "en-us"),
                    speed=entry.get("speed", 1.0),
                    format=entry.get("format", "wav"),
                    output_dir=entry.get("output_dir", ""),
                    chunks_total=entry.get("chunks_total", 0),
                    chunks_done=entry.get("chunks_done", 0),
                    progress_pct=entry.get("progress_pct", 0),
                    error=entry.get("error", ""),
                    output_filename=entry.get("output_filename", ""),
                    started_at=entry.get("started_at"),
                    finished_at=entry.get("finished_at"),
                )
                self._jobs[job_id] = job
                if was_interrupted:
                    interrupted_jobs.append(job)
            for job in interrupted_jobs:
                self._persist_job(job)
            logger.info("Loaded %d generated audio job(s) from PostgreSQL.", len(self._jobs))
        except Exception as exc:
            logger.warning("Failed to load generated audio jobs from PostgreSQL: %s", exc)

    def _cleanup_old_jobs_loop(self) -> None:
        while not self._cleanup_stop.is_set():
            self._cleanup_old_jobs_once()
            if self._cleanup_stop.wait(JOB_CLEANUP_INTERVAL_SECONDS):
                break

    def _cleanup_old_jobs_once(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=JOB_CLEANUP_RETENTION_DAYS)
        try:
            removed_jobs, removed_files, removed_ids = self._job_repo.cleanup_old_jobs(cutoff, self._output_base)
        except Exception as exc:
            logger.warning("Failed to clean up old TTS jobs: %s", exc)
            return
        if not removed_ids:
            return
        with self._lock:
            for job_id in removed_ids:
                job = self._jobs.get(job_id)
                if job and job.status in {"completed", "failed"}:
                    self._jobs.pop(job_id, None)
        logger.info(
            "Cleaned up %d old TTS job record(s) and %d audio path(s).",
            removed_jobs,
            removed_files,
        )

    def _persist_job(self, job: TTSJob, queue_position: int = 0) -> None:
        try:
            data = job.to_dict(queue_position=queue_position)
            output_path = ""
            if job.output_dir and job.output_filename:
                output_path = str(Path(job.output_dir) / job.output_filename)
            data["output_path"] = output_path
            data["text"] = "" if job.status in TEXTLESS_TERMINAL_STATUSES else job.text
            self._job_repo.save_job(data)
        except Exception as exc:
            logger.warning("Failed to persist TTS job %s: %s", job.job_id, exc)

    def _resolve_paths(self) -> tuple[Path, Path]:
        if self._model_path is None:
            raw_model = os.environ.get("KOKORO_MODEL_PATH", "api/models/kokoro-v1.0.onnx")
            self._model_path = (self._project_root / raw_model).resolve()
        if self._voices_path is None:
            raw_voices = os.environ.get("KOKORO_VOICES_PATH", "api/models/voices-v1.0.bin")
            self._voices_path = (self._project_root / raw_voices).resolve()
        return self._model_path, self._voices_path

    def _get_kokoro_for_worker(self, worker_id: int):
        attr = f"_kokoro_{worker_id}"
        kokoro = getattr(self, attr, None)
        if kokoro is None:
            model_path, voices_path = self._resolve_paths()

            missing = []
            if not model_path.exists():
                missing.append(str(model_path))
            if not voices_path.exists():
                missing.append(str(voices_path))
            if missing:
                raise FileNotFoundError(
                    "Kokoro model files not found. Fetch them from the CreateStory release "
                    "(or set KOKORO_MODEL_PATH / KOKORO_VOICES_PATH in .env):\n"
                    "  powershell scripts/download-models.ps1\n"
                    "  # manual, from the CreateStory GitHub release:\n"
                    "  #   https://github.com/hatrumtruong27/CreateStory/releases/download/models-v1.0/kokoro-v1.0.onnx -> api/models/\n"
                    "  #   https://github.com/hatrumtruong27/CreateStory/releases/download/models-v1.0/voices-v1.0.bin  -> api/models/"
                )

            from kokoro_onnx import Kokoro
            provider = _detect_execution_provider()
            os.environ["ONNX_PROVIDER"] = provider
            kokoro = Kokoro(str(model_path), str(voices_path))
            setattr(self, attr, kokoro)
            logger.info("Kokoro model loaded for worker %d on %s.", worker_id, provider)

        return kokoro

    def _unload_kokoro_for_worker(self, worker_id: int) -> None:
        attr = f"_kokoro_{worker_id}"
        if hasattr(self, attr):
            try:
                delattr(self, attr)
            except Exception:
                logger.debug("Failed to unload Kokoro for worker %d.", worker_id, exc_info=True)

    @staticmethod
    def clean_text(text: str) -> str:
        text = re.sub(r'<[^>]+>', ' ', text)
        text = text.replace('\n', ' ').replace('\r', '')
        text = re.sub(r'\\[nprts]', ' ', text)
        text = re.sub(r'\\+', ' ', text)
        text = re.sub(r' {2,}', ' ', text)
        return text.strip()

    @staticmethod
    def chunk_text(text: str, initial_chunk_size: int = 1000) -> list[str]:
        sentences = text.replace("\n", " ").split(".")
        chunks: list[str] = []
        current_chunk: list[str] = []
        current_size = 0

        for sentence in sentences:
            if not sentence.strip():
                continue

            sentence = sentence.strip() + "."
            sentence_size = len(sentence)

            if sentence_size > initial_chunk_size:
                words = sentence.split()
                current_piece: list[str] = []
                current_piece_size = 0

                for word in words:
                    word_size = len(word) + 1
                    if current_piece_size + word_size > initial_chunk_size:
                        if current_piece:
                            chunks.append(" ".join(current_piece).strip() + ".")
                        current_piece = [word]
                        current_piece_size = word_size
                    else:
                        current_piece.append(word)
                        current_piece_size += word_size

                if current_piece:
                    chunks.append(" ".join(current_piece).strip() + ".")
                continue

            if current_size + sentence_size > initial_chunk_size and current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_size = 0

            current_chunk.append(sentence)
            current_size += sentence_size

        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks

    def get_voices(self) -> list[dict]:
        return [
            {"id": vid, "label": label, "lang": lang_code}
            for vid, (lang_code, label) in VOICE_METADATA.items()
        ]

    def get_languages(self) -> list[dict]:
        return [
            {"code": code, "label": label}
            for code, label in VOICE_LANG_MAP.items()
        ]

    def _validate_voice(self, voice: str, kokoro) -> str | object:
        import numpy as np

        supported = set(kokoro.get_voices())

        if "," in voice:
            parts = voice.split(",")
            voices = []
            weights = []

            for part in parts:
                if ":" in part:
                    v, w = part.strip().split(":")
                    voices.append(v.strip())
                    weights.append(float(w.strip()))
                else:
                    voices.append(part.strip())
                    weights.append(50.0)

            if len(voices) != 2:
                raise ValueError("Voice blending requires exactly two voices.")

            for v in voices:
                if v not in supported:
                    raise ValueError(f"Unsupported voice: {v}")

            total = sum(weights)
            if total != 100:
                weights = [w * (100 / total) for w in weights]

            style1 = kokoro.get_voice_style(voices[0])
            style2 = kokoro.get_voice_style(voices[1])
            blend = np.add(style1 * (weights[0] / 100), style2 * (weights[1] / 100))
            return blend

        if voice not in supported:
            raise ValueError(f"Unsupported voice: {voice}")
        return voice

    @staticmethod
    def _should_split_tts_error(error_msg: str) -> bool:
        msg = error_msg.lower()
        return (
            "index 510 is out of bounds" in msg
            or "phoneme" in msg
            or "number of lines in input and output" in msg
        )

    def _create_with_split_retry(
        self,
        kokoro,
        text: str,
        voice_val,
        speed: float,
        lang: str,
        worker_id: int,
        chunk_index: int,
        depth: int = 0,
    ) -> tuple["np.ndarray", int]:
        import numpy as np

        try:
            samples, sr = kokoro.create(
                text,
                voice=voice_val,
                speed=speed,
                lang=lang,
            )
            return samples, sr
        except Exception as exc:
            error_msg = str(exc)
            if (
                depth >= self.RETRY_MAX_DEPTH
                or len(text) <= self.RETRY_MIN_CHUNK_SIZE
                or not self._should_split_tts_error(error_msg)
            ):
                raise

            next_size = max(self.RETRY_MIN_CHUNK_SIZE, int(len(text) * 0.5))
            sub_chunks = self.chunk_text(text, initial_chunk_size=next_size)
            if len(sub_chunks) <= 1:
                words = text.split()
                if len(words) <= 1:
                    raise
                midpoint = max(1, len(words) // 2)
                sub_chunks = [
                    " ".join(words[:midpoint]).strip(),
                    " ".join(words[midpoint:]).strip(),
                ]

            logger.warning(
                "Worker %d chunk %d TTS line/phoneme error, splitting into %d sub-chunks (depth=%d).",
                worker_id,
                chunk_index + 1,
                len(sub_chunks),
                depth + 1,
            )

            sample_parts: list[np.ndarray] = []
            sample_rate = SAMPLE_RATE
            for sub_chunk in sub_chunks:
                sub_chunk = sub_chunk.strip()
                if not sub_chunk:
                    continue
                sub_samples, sub_sr = self._create_with_split_retry(
                    kokoro,
                    sub_chunk,
                    voice_val,
                    speed,
                    lang,
                    worker_id,
                    chunk_index,
                    depth + 1,
                )
                sample_parts.append(sub_samples)
                sample_rate = sub_sr

            if not sample_parts:
                raise
            return np.concatenate(sample_parts), sample_rate

    def start_job(
        self,
        text: str,
        voice: str = "af_sarah",
        lang: str = "en-us",
        speed: float = 1.0,
        format: str = "wav",
        created_by_user_id: str | None = None,
    ) -> str:
        if not text or not text.strip():
            raise ValueError("Text cannot be empty.")

        job_id = str(uuid.uuid4())[:8]
        output_dir = self._output_base / job_id

        clean = self.clean_text(text)

        job = TTSJob(
            job_id=job_id,
            created_by_user_id=created_by_user_id,
            status="queued",
            text=clean,
            voice=voice,
            lang=lang,
            speed=min(max(speed, 0.5), 2.0),
            format=format,
            output_dir=str(output_dir),
        )

        with self._lock:
            active_jobs = [
                existing
                for existing in self._jobs.values()
                if existing.status in {"queued", "processing"}
            ]
            owner_jobs = [
                existing
                for existing in active_jobs
                if existing.created_by_user_id == created_by_user_id
            ]
            if len(active_jobs) >= MAX_QUEUED_JOBS_GLOBAL:
                raise TTSCapacityError("Global TTS queue capacity reached.")
            if created_by_user_id and len(owner_jobs) >= MAX_QUEUED_JOBS_PER_USER:
                raise TTSCapacityError("Per-user TTS queue capacity reached.")
            output_dir.mkdir(parents=True, exist_ok=True)
            self._jobs[job_id] = job
            self._queue.append(job_id)
            queue_position = len(self._queue)

        self._persist_job(job, queue_position=queue_position)
        logger.info("TTS job %s queued.", job_id)
        return job_id

    def get_job(self, job_id: str) -> Optional[dict]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            queue_pos = 0
            try:
                queue_pos = self._queue.index(job_id) + 1
            except ValueError:
                pass
            return job.to_dict(queue_position=queue_pos)

    def _get_queue_position(self, job_id: str) -> int:
        with self._lock:
            try:
                return self._queue.index(job_id) + 1
            except ValueError:
                return 0

    def list_jobs(self) -> list[dict]:
        with self._lock:
            queue_positions = {job_id: i + 1 for i, job_id in enumerate(self._queue)}
            items = []
            for job_id, job in self._jobs.items():
                try:
                    items.append(job.to_dict(queue_position=queue_positions.get(job_id, 0)))
                except Exception:
                    pass
            return items

    def cancel_job(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            if job.status in ("completed", "failed", "cancelled"):
                return False
            job.status = "cancelled"
            job.text = ""
            job.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if job_id in self._queue:
                self._queue.remove(job_id)
            persist_job = job
        self._persist_job(persist_job)
        logger.info("TTS job %s cancelled.", job_id)
        self.release_idle_models()
        return True

    def get_output_path(self, job_id: str) -> Optional[Path]:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return None
        try:
            if not job.output_filename:
                return None
            path = Path(job.output_dir) / job.output_filename
            if path.exists():
                return path
            return None
        except Exception:
            return None

    def get_output_dir(self, job_id: str) -> Optional[Path]:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None or not job.output_dir:
            return None
        try:
            path = Path(job.output_dir)
            if path.exists() and path.is_dir():
                return path
            return None
        except Exception:
            return None

    def get_queue_size(self) -> int:
        with self._lock:
            return sum(1 for jid in self._queue if self._jobs.get(jid, TTSJob()).status == "queued")

    def get_active_job_count(self) -> int:
        """Jobs currently counted against the global admission cap."""
        with self._lock:
            return sum(
                1 for j in self._jobs.values()
                if j.status in {"queued", "processing"}
            )

    def get_admission_headroom(self) -> int:
        """Free global TTS queue slots right now (>= 0), shared across all producers."""
        return max(0, MAX_QUEUED_JOBS_GLOBAL - self.get_active_job_count())

    def get_concurrency(self) -> int:
        return self.CONCURRENCY

    def set_concurrency(self, concurrency: int) -> None:
        """Update the number of workers at runtime. Call before or after __init__."""
        concurrency = max(MIN_KOKORO_CONCURRENCY, min(concurrency, MAX_KOKORO_CONCURRENCY))
        if concurrency == self.CONCURRENCY:
            return

        with self._lock:
            # Drop dead thread references so subsequent scale-ups don't reuse
            # their worker IDs (the new thread's id is len(self._workers)).
            self._workers = [t for t in self._workers if t.is_alive()]

            old = self.CONCURRENCY
            self.CONCURRENCY = concurrency
            self._target_workers = concurrency

            if concurrency > old:
                for i in range(len(self._workers), concurrency):
                    t = Thread(target=self._worker_loop, args=(i,), daemon=True)
                    t.start()
                    self._workers.append(t)
                logger.info("Scaled TTSService workers from %d to %d.", old, concurrency)
            else:
                # Actively stop excess workers and clean up their references immediately.
                # Workers exit via the _target_workers check in _worker_loop; joining them
                # here ensures the thread objects are dropped from _workers without waiting
                # for the next set_concurrency() call.
                excess = len(self._workers) - concurrency
                for i in range(len(self._workers) - 1, len(self._workers) - excess - 1, -1):
                    self._workers[i].join(timeout=2.0)
                self._workers = [t for t in self._workers if t.is_alive()]
                logger.info("Scaled TTSService workers down from %d to %d.", old, concurrency)

    def set_auto_concurrency(self) -> None:
        self.set_concurrency(_default_concurrency(ignore_env=True))

    def release_idle_models(self, force: bool = False) -> bool:
        """Release cached Kokoro/ONNX sessions when no TTS job is currently running."""
        with self._lock:
            busy = bool(self._busy_workers)
            queued_or_processing = any(
                job.status in ("queued", "processing")
                for job in self._jobs.values()
            )
        if busy or (queued_or_processing and not force):
            return False

        released = False
        for worker_id in range(len(self._workers)):
            attr = f"_kokoro_{worker_id}"
            if hasattr(self, attr):
                self._unload_kokoro_for_worker(worker_id)
                released = True

        if released:
            gc.collect()
            logger.info("Released idle Kokoro model sessions.")
        return released

    def reset_runtime_state(self) -> None:
        """Clear in-memory job state after the gateway development cleanup."""
        with self._lock:
            for job in self._jobs.values():
                if job.status in ("queued", "processing"):
                    job.status = "cancelled"
                    job.text = ""
                    job.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self._jobs.clear()
            self._queue.clear()
        self.release_idle_models(force=True)

    def _worker_loop(self, worker_id: int) -> None:
        import numpy as np
        import time

        logger.info("Worker %d started, waiting for jobs...", worker_id)

        while self._workers_running:
            if worker_id >= self._target_workers:
                self._unload_kokoro_for_worker(worker_id)
                gc.collect()
                logger.info("Worker %d stopped after concurrency downscale.", worker_id)
                return

            job_id: Optional[str] = None
            with self._lock:
                while self._queue and self._queue[0] in self._jobs:
                    jid = self._queue[0]
                    if self._jobs[jid].status == "cancelled":
                        self._queue.pop(0)
                    else:
                        job_id = jid
                        self._queue.pop(0)
                        break

            if job_id is None:
                time.sleep(0.5)
                continue

            with self._lock:
                job = self._jobs.get(job_id)
            if job is None:
                continue

            with self._lock:
                self._busy_workers.add(worker_id)
                job.status = "processing"
                job.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                persist_job = job

            self._persist_job(persist_job)

            logger.info("Worker %d picked TTS job %s.", worker_id, job_id)

            all_samples: list[np.ndarray] = []
            chunks: list[str] = []
            samples_list: list[np.ndarray] = []
            kokoro = None
            voice_val = None
            samples = None
            merged = None
            sub_s = None

            try:
                kokoro = self._get_kokoro_for_worker(worker_id)
                voice_val = self._validate_voice(job.voice, kokoro)

                chunks = self.chunk_text(job.text, initial_chunk_size=self.CHUNK_SIZE)
                job.chunks_total = len(chunks)
                job.chunks_done = 0

                logger.info(
                    "Worker %d job %s: %d chunks, voice=%s, lang=%s, speed=%.1f, fmt=%s, chunk_size=%d",
                    worker_id, job_id, len(chunks), job.voice, job.lang, job.speed, job.format, self.CHUNK_SIZE,
                )

                sample_rate = SAMPLE_RATE

                for i, chunk in enumerate(chunks):
                    with self._lock:
                        j = self._jobs.get(job_id)
                        if j and j.status == "cancelled":
                            logger.info("Worker %d job %s cancelled mid-processing.", worker_id, job_id)
                            break

                    samples, sr = self._create_with_split_retry(
                        kokoro,
                        chunk,
                        voice_val,
                        job.speed,
                        job.lang,
                        worker_id,
                        i,
                    )

                    sample_rate = sr
                    if self.SAVE_CHUNKS:
                        import soundfile as sf
                        chunk_file = Path(job.output_dir) / f"chunk_{i + 1:03d}.{job.format}"
                        sf.write(str(chunk_file), samples, sr)

                    all_samples.append(samples)

                    with self._lock:
                        j = self._jobs.get(job_id)
                        if j:
                            j.chunks_done = i + 1
                            j.progress_pct = int((i + 1) * 100 / len(chunks))
                            persist_job = j
                        else:
                            persist_job = None

                    if persist_job:
                        self._persist_job(persist_job)

                    with self._lock:
                        j = self._jobs.get(job_id)
                        if j and j.status == "cancelled":
                            continue

                with self._lock:
                    j = self._jobs.get(job_id)
                    persist_job = None
                    if j and j.status == "cancelled":
                        j.text = ""
                        j.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        persist_job = j
                        logger.info("Worker %d job %s finished cancellation cleanup.", worker_id, job_id)
                if persist_job:
                    self._persist_job(persist_job)
                    continue

                if not all_samples:
                    raise ValueError("No audio chunks were generated.")

                merged = np.concatenate(all_samples)
                safe_name = f"tts_{job_id}.{job.format}"
                merged_path = Path(job.output_dir) / safe_name

                import soundfile as sf
                sf.write(str(merged_path), merged, sample_rate)

                job.status = "completed"
                job.output_filename = safe_name
                job.progress_pct = 100
                job.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                # Audio is written; drop the source chapter text so completed jobs
                # don't retain it in memory or the DB (L5 — memory + privacy).
                job.text = ""
                self._persist_job(job)

                logger.info("Worker %d job %s completed: %s", worker_id, job_id, merged_path)

            except Exception as exc:
                logger.exception("Worker %d job %s failed: %s", worker_id, job_id, exc)
                with self._lock:
                    j = self._jobs.get(job_id)
                    if j:
                        j.status = "failed"
                        j.text = ""
                        j.error = repr(exc)
                        j.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        persist_job = j
                    else:
                        persist_job = None
                if persist_job:
                    self._persist_job(persist_job)
            finally:
                all_samples.clear()
                chunks.clear()
                samples_list.clear()
                kokoro = None
                voice_val = None
                samples = None
                merged = None
                sub_s = None
                with self._lock:
                    self._busy_workers.discard(worker_id)
                gc.collect()
                self.release_idle_models()


_tts_service: Optional[TTSService] = None


def get_tts_service() -> TTSService:
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
