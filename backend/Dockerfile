# Multi-stage build: builder stage compiles the wheels (which can need
# transient compiler toolchains for things like httpx-native or pillow's
# JPEG/PNG decoders), runtime stage ships only the installed packages
# plus the app. Final image is ~150 MB instead of ~400 MB.

FROM python:3.11-slim AS builder

WORKDIR /build

# Only what's needed to BUILD wheels — gcc/musl-dev for any C extension
# in the dep tree (pydantic-core's Rust build is satisfied via a wheel,
# so no Rust toolchain needed here in practice).
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# `--user` puts everything under /root/.local which we copy to /home/app
# in the runtime stage. Keeps the runtime image free of pip + build tools.
RUN pip install --no-cache-dir --user -r requirements.txt


# ── runtime stage ──────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# `ngrok` is added here to support local dev tunneling (tunnel.py).
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && curl -L https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz -o ngrok.tgz \
    && tar -xvzf ngrok.tgz -C /usr/local/bin \
    && rm ngrok.tgz \
    && chmod +x /usr/local/bin/ngrok \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. The /home/app/content directory is created here
# and chown'd so the runtime user can write uploads and the bundled-
# ffmpeg cache (imageio_ffmpeg writes its binary under the user's home
# the first time it's invoked).
RUN useradd --create-home --shell /bin/bash app
USER app
WORKDIR /home/app

# Copy the user-site packages from the builder stage. The `--from`
# pattern keeps the runtime image free of pip / build-essential / etc.
COPY --from=builder --chown=app:app /root/.local /home/app/.local
ENV PATH=/home/app/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# App code — NOT content/. Content is a runtime volume in production;
# baking the dev content dir into the image previously leaked
# oauth_tokens.json into shipped images (see plans/hosting.md).
COPY --chown=app:app app /home/app/app

# Create the content dir so first boot doesn't need a write to root.
# The actual production data comes from a Docker named volume mounted
# here (caption-content); when nothing is mounted, the empty dir is the
# right default.
RUN mkdir -p /home/app/content
ENV CONTENT_DIR=/home/app/content

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

# `--proxy-headers` lets uvicorn trust X-Forwarded-* from Caddy (and
# ngrok) so request.base_url, the client IP, and the OAuth redirect
# logic see the public scheme/host instead of the loopback the container
# actually listens on.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
