#!/usr/bin/env bash
# Installs whisper.cpp (Metal-accelerated on Apple Silicon), the large-v3-turbo model (~1.6 GB) for the
# transcript and the base model (~148 MB) that identifies the spoken language of each line (worker/voices.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v whisper-cli >/dev/null; then
  brew install whisper-cpp
fi

fetch() {
  if [ ! -f "models/$1" ]; then
    mkdir -p models
    curl -L --fail -o "models/$1.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$1"
    mv "models/$1.part" "models/$1"
  fi
}
fetch ggml-large-v3-turbo.bin
fetch ggml-base.bin
echo "whisper ready: $(command -v whisper-cli) + models/ggml-large-v3-turbo.bin + models/ggml-base.bin"
