"""TTS service — GPU-only, multi-worker FIFO queue using kokoro-onnx."""

from __future__ import annotations

import logging
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock, Thread
from typing import Optional

logger = logging.getLogger(__name__)


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


SAMPLE_RATE = 24000

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
            "status": self.status,
            "voice": self.voice,
            "lang": self.lang,
            "speed": self.speed,
            "format": self.format,
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
    CONCURRENCY: int = int(os.environ.get("KOKORO_CONCURRENCY", "1"))

    def __init__(self) -> None:
        self._jobs: dict[str, TTSJob] = {}
        self._queue: list[str] = []
        self._lock = Lock()
        self._workers: list[Thread] = []
        self._workers_running = True
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._output_base = self._project_root / "output" / "tts"
        self._output_base.mkdir(parents=True, exist_ok=True)
        self._model_path: Optional[Path] = None
        self._voices_path: Optional[Path] = None

        for i in range(self.CONCURRENCY):
            t = Thread(target=self._worker_loop, args=(i,), daemon=True)
            t.start()
            self._workers.append(t)

        logger.info("TTSService started with %d workers, provider=%s.", self.CONCURRENCY, _detect_execution_provider())

    def _resolve_paths(self) -> tuple[Path, Path]:
        if self._model_path is None:
            raw_model = os.environ.get("KOKORO_MODEL_PATH", "models/kokoro-v1.0.onnx")
            self._model_path = (self._project_root / raw_model).resolve()
        if self._voices_path is None:
            raw_voices = os.environ.get("KOKORO_VOICES_PATH", "models/voices-v1.0.bin")
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
                    "Kokoro model files not found. "
                    "Download them and set KOKORO_MODEL_PATH / KOKORO_VOICES_PATH in .env:\n"
                    "  wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx\n"
                    "  wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin"
                )

            from kokoro_onnx import Kokoro
            provider = _detect_execution_provider()
            os.environ["ONNX_PROVIDER"] = provider
            kokoro = Kokoro(str(model_path), str(voices_path))
            setattr(self, attr, kokoro)
            logger.info("Kokoro model loaded for worker %d on %s.", worker_id, provider)

        return kokoro

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

    def start_job(
        self,
        text: str,
        voice: str = "af_sarah",
        lang: str = "en-us",
        speed: float = 1.0,
        format: str = "wav",
    ) -> str:
        if not text or not text.strip():
            raise ValueError("Text cannot be empty.")

        job_id = str(uuid.uuid4())[:8]
        output_dir = self._output_base / job_id
        output_dir.mkdir(parents=True, exist_ok=True)

        clean = self.clean_text(text)

        job = TTSJob(
            job_id=job_id,
            status="queued",
            text=clean,
            voice=voice,
            lang=lang,
            speed=min(max(speed, 0.5), 2.0),
            format=format,
            output_dir=str(output_dir),
        )

        with self._lock:
            self._jobs[job_id] = job
            self._queue.append(job_id)

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
            items = []
            for job_id, job in self._jobs.items():
                try:
                    items.append(job.to_dict(queue_position=self._get_queue_position(job_id)))
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
            if job_id in self._queue:
                self._queue.remove(job_id)
        logger.info("TTS job %s cancelled.", job_id)
        return True

    def get_output_path(self, job_id: str) -> Optional[Path]:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return None
        try:
            path = Path(job.output_dir) / job.output_filename
            if path.exists():
                return path
            return None
        except Exception:
            return None

    def get_queue_size(self) -> int:
        with self._lock:
            return sum(1 for jid in self._queue if self._jobs.get(jid, TTSJob()).status == "queued")

    def get_concurrency(self) -> int:
        return self.CONCURRENCY

    def _worker_loop(self, worker_id: int) -> None:
        import numpy as np
        import time

        logger.info("Worker %d started, waiting for jobs...", worker_id)

        while self._workers_running:
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

            job.status = "processing"
            job.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            logger.info("Worker %d picked TTS job %s.", worker_id, job_id)

            try:
                kokoro = self._get_kokoro_for_worker(worker_id)
                voice_val = self._validate_voice(job.voice, kokoro)

                chunks = self.chunk_text(job.text, initial_chunk_size=1000)
                job.chunks_total = len(chunks)
                job.chunks_done = 0

                logger.info(
                    "Worker %d job %s: %d chunks, voice=%s, lang=%s, speed=%.1f, fmt=%s",
                    worker_id, job_id, len(chunks), job.voice, job.lang, job.speed, job.format,
                )

                all_samples: list[np.ndarray] = []
                sample_rate = SAMPLE_RATE

                for i, chunk in enumerate(chunks):
                    with self._lock:
                        j = self._jobs.get(job_id)
                        if j and j.status == "cancelled":
                            logger.info("Worker %d job %s cancelled mid-processing.", worker_id, job_id)
                            break

                    chunk_file = Path(job.output_dir) / f"chunk_{i + 1:03d}.{job.format}"

                    try:
                        samples, sr = kokoro.create(
                            chunk,
                            voice=voice_val,
                            speed=job.speed,
                            lang=job.lang,
                        )
                    except Exception as exc:
                        error_msg = str(exc)
                        if "index 510 is out of bounds" in error_msg or "phoneme" in error_msg.lower():
                            logger.warning("Worker %d chunk %d phoneme error, splitting.", worker_id, i + 1)
                            samples_list: list[np.ndarray] = []
                            sr = SAMPLE_RATE
                            sub_chunks = self.chunk_text(chunk, initial_chunk_size=int(len(chunk) * 0.6))
                            for sub_chunk in sub_chunks:
                                try:
                                    sub_s, sub_sr = kokoro.create(
                                        sub_chunk,
                                        voice=voice_val,
                                        speed=job.speed,
                                        lang=job.lang,
                                    )
                                    samples_list.append(sub_s)
                                    sr = sub_sr
                                except Exception:
                                    continue
                            if samples_list:
                                samples = np.concatenate(samples_list)
                            else:
                                raise
                        else:
                            raise

                    import soundfile as sf
                    sf.write(str(chunk_file), samples, sr)
                    all_samples.append(samples)

                    with self._lock:
                        j = self._jobs.get(job_id)
                        if j:
                            j.chunks_done = i + 1
                            j.progress_pct = int((i + 1) * 100 / len(chunks))

                    with self._lock:
                        j = self._jobs.get(job_id)
                        if j and j.status == "cancelled":
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

                logger.info("Worker %d job %s completed: %s", worker_id, job_id, merged_path)

            except Exception as exc:
                logger.exception("Worker %d job %s failed: %s", worker_id, job_id, exc)
                with self._lock:
                    j = self._jobs.get(job_id)
                    if j:
                        j.status = "failed"
                        j.error = repr(exc)
                        j.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")


_tts_service: Optional[TTSService] = None


def get_tts_service() -> TTSService:
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
