#!/usr/bin/env bash
# Installs whisper.cpp (Metal-accelerated on Apple Silicon) and the large-v3-turbo model (~1.6 GB).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v whisper-cli >/dev/null; then
  brew install whisper-cpp
fi

MODEL=models/ggml-large-v3-turbo.bin
if [ ! -f "$MODEL" ]; then
  mkdir -p models
  curl -L --fail -o "$MODEL.part" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
  mv "$MODEL.part" "$MODEL"
fi
echo "whisper ready: $(command -v whisper-cli) + $MODEL"
