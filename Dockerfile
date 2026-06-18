FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

RUN adduser --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app && \
    mkdir -p /app/output && \
    chown -R appuser:appuser /app/output

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD python -c "import httpx; httpx.get('http://localhost:8004/').raise_for_status()"

USER appuser
ENTRYPOINT ["/docker-entrypoint.sh"]

EXPOSE 8004

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
