FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

ARG CHROMIUM_MIN_VERSION=150.0.7871.100
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    gosu \
    xauth \
    xvfb && \
    installed_chromium="$(dpkg-query -W -f='${Version}' chromium)" && \
    dpkg --compare-versions "$installed_chromium" ge "$CHROMIUM_MIN_VERSION" && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# ChromeDriver can be version-matched yet unusable (Debian's
# 150.0.7871.46 release crashed with SIGTRAP in Docker). Exercise a real
# WebDriver session at build time so a broken browser cannot reach production.
RUN python scripts/chromium_smoke.py

RUN adduser --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD python -c "import httpx; httpx.get('http://localhost:8002/').raise_for_status()"

EXPOSE 8002

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["python", "main.py"]
