#!/usr/bin/env bash
# Downloads the models used by scripts/reframe.py: YuNet face detector (~230 KB)
# and SFace face recognizer (~37 MB, tells the creator apart from faces in the content).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

fetch() {
  if [ ! -f "models/$1" ]; then
    curl -L --fail -o "models/$1.part" "https://github.com/opencv/opencv_zoo/raw/main/models/$2/$1"
    mv "models/$1.part" "models/$1"
  fi
}
fetch face_detection_yunet_2023mar.onnx face_detection_yunet
fetch face_recognition_sface_2021dec.onnx face_recognition_sface
echo "models ready: $(ls models/*.onnx | tr '\n' ' ')"
