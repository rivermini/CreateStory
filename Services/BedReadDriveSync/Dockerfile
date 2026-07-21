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

COPY --from=watermark-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=watermark-runtime /watermark_runtime/node_modules ./watermark_runtime/node_modules

COPY . .

RUN adduser --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD python -c "import httpx; httpx.get('http://localhost:8003/').raise_for_status()"

USER appuser

EXPOSE 8003

CMD ["python", "main.py"]
