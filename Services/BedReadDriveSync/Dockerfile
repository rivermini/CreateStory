FROM node:22-slim AS watermark-runtime

WORKDIR /watermark_runtime
COPY watermark_runtime/package.json watermark_runtime/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Bake the checksum-pinned OpenCV LaMa model into the image. Runtime download
# remains as a recovery path for local development, but production starts warm.
RUN mkdir -p /app/api/data/models && \
    python -c "import hashlib,urllib.request; p='/app/api/data/models/inpainting_lama_2025jan.onnx'; urllib.request.urlretrieve('https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx',p); actual=hashlib.sha256(open(p,'rb').read()).hexdigest(); expected='7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2'; assert actual==expected,(actual,expected)"

COPY --from=watermark-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=watermark-runtime /watermark_runtime/node_modules ./watermark_runtime/node_modules

COPY . .

RUN adduser --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD python -c "import httpx; httpx.get('http://localhost:8003/').raise_for_status()"

USER appuser

EXPOSE 8003

CMD ["python", "main.py"]
