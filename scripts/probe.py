# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless>=4.9,<5", "numpy>=1.26"]
# ///
"""
Cheap visual/audio signals for the niche classifier (no Claude call). Prints one JSON object on
stdout:
  {"sceneCutRate", "sceneCuts", "hasFace", "faceScore", "greenShare", "keyframes"}
  - sceneCutRate: scene cuts per second over [start, end] (reuses reframe.py's scene_score /
    pick_cuts: same ffmpeg-like metric, not reimplemented here).
  - hasFace / faceScore: a face (Haar cascade — a lighter, standalone detector than reframe.py's
    YuNet/SFace pipeline; no model files to install) is seen in faceScore (0..1) of sampled frames;
    hasFace is true above a small threshold, to ignore one-off false positives.
  - greenShare: mean fraction of pixels in a grass-like HSV hue/saturation/value band, a simple
    outdoor-sport signal ("pelouse").
  - keyframes: `--keyframes` (default 4) frames regularly spaced across the range. By default each
    is a base64 JPEG inline in the JSON, so the caller (a Node job) gets one self-contained value
    with no file to clean up; pass --out-dir to save them as JPEG files on disk instead (handy to
    eyeball while developing) with their path in place of jpeg_b64.

Usage: uv run scripts/probe.py VIDEO [START] [END] [--fps 5] [--keyframes 4] [--out-dir DIR]
START/END default to the whole file.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reframe as rf  # noqa: E402  (scene_score / pick_cuts, reused as-is)

SAMPLE_FPS = 5.0
GREEN_LO = np.array([35, 40, 40])  # HSV band for grass / turf greens
GREEN_HI = np.array([85, 255, 255])
FACE_SCORE_THRESHOLD = 0.2  # seen in at least a fifth of sampled frames: not a stray false positive
N_KEYFRAMES = 4


def green_share(frame_bgr: np.ndarray) -> float:
    """Fraction of pixels inside the grass-like HSV band (simple threshold, no ML)."""
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, GREEN_LO, GREEN_HI)
    return float(np.count_nonzero(mask)) / mask.size


def has_face(gray: np.ndarray, detector: cv2.CascadeClassifier) -> bool:
    faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
    return len(faces) > 0


def encode_jpeg_b64(frame_bgr: np.ndarray, quality: int = 80) -> str:
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def pick_keyframe_times(start: float, end: float, n: int) -> list[float]:
    """n times regularly spaced across [start, end] (one per 1/n-th slice, centered)."""
    n = max(1, n)
    span = max(0.0, end - start)
    return [start + (i + 0.5) / n * span for i in range(n)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("start", type=float, nargs="?", default=0.0)
    ap.add_argument("end", type=float, nargs="?", help="defaults to the end of the file")
    ap.add_argument("--fps", type=float, default=SAMPLE_FPS, help="sampling rate for face/green detection")
    ap.add_argument("--keyframes", type=int, default=N_KEYFRAMES)
    ap.add_argument("--out-dir", help="save key frames as JPEG files here instead of inlining base64")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"cannot open {args.video}")
    fps_src = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps_src if fps_src > 0 else 0.0
    end = args.end if args.end is not None else duration
    start = max(0.0, args.start)

    face_detector = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))

    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    period = 1.0 / args.fps
    next_sample = start
    frames: list[tuple[float, float]] = []  # (t, scene score), one per decoded frame
    green_vals: list[float] = []
    face_hits: list[float] = []
    prev_small: np.ndarray | None = None
    prev_mafd = 0.0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t > end:
            break
        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 90), interpolation=cv2.INTER_AREA)
        if prev_small is not None:
            mafd = float(np.mean(cv2.absdiff(small, prev_small)))
            frames.append((t, rf.scene_score(mafd, prev_mafd)))
            prev_mafd = mafd
        prev_small = small
        if t < start - 1e-3 or t < next_sample - 1e-3:
            continue
        next_sample = t + period
        green_vals.append(green_share(frame))
        face_hits.append(1.0 if has_face(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), face_detector) else 0.0)

    cuts = rf.pick_cuts(frames) if frames else []
    span = max(period, end - start)
    face_score = float(np.mean(face_hits)) if face_hits else 0.0

    keyframes = []
    for kt in pick_keyframe_times(start, end, args.keyframes):
        cap.set(cv2.CAP_PROP_POS_MSEC, kt * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        actual_t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if args.out_dir:
            os.makedirs(args.out_dir, exist_ok=True)
            out_path = os.path.join(args.out_dir, f"{actual_t:08.2f}.jpg")
            cv2.imwrite(out_path, frame)
            keyframes.append({"t": round(actual_t, 3), "path": out_path})
        else:
            keyframes.append({"t": round(actual_t, 3), "jpeg_b64": encode_jpeg_b64(frame)})

    result = {
        "sceneCutRate": round(len(cuts) / span, 4),
        "sceneCuts": len(cuts),
        "hasFace": face_score >= FACE_SCORE_THRESHOLD,
        "faceScore": round(face_score, 4),
        "greenShare": round(float(np.mean(green_vals)) if green_vals else 0.0, 4),
        "keyframes": keyframes,
    }
    json.dump(result, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()
