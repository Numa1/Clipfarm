# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless>=4.9,<5", "numpy>=1.26"]
# ///
"""
9:16 reframing: detect the main face on sampled frames of [start, end] and print
smoothed crop keyframes as JSON: [{"t": source_sec, "x": 0..1, "y": 0..1, "zoom": 1}].

V1 uses OpenCV's bundled Haar cascade (no model download). Swap for a stronger
detector (YuNet / MediaPipe) + active-speaker detection later.

Usage: uv run scripts/reframe.py VIDEO START END [--fps 2]
"""
import argparse
import json
import sys

import cv2
import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("--fps", type=float, default=2.0)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"cannot open {args.video}")
    w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    samples: list[tuple[float, float | None, float | None]] = []
    t = args.start
    step = 1.0 / args.fps
    while t <= args.end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(int(h / 12), int(h / 12)))
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])  # largest face = main speaker (V1)
            samples.append((t, (x + fw / 2) / w, (y + fh / 2) / h))
        else:
            samples.append((t, None, None))
        t += step

    # Fill gaps with the last known position (or center).
    xs, ys, last = [], [], (0.5, 0.45)
    for _, x, y in samples:
        if x is not None:
            last = (x, y)
        xs.append(last[0])
        ys.append(last[1])

    # Median filter to kill detection jitter, then keep only meaningful moves (camera "holds").
    def median(a: list[float], k: int = 5) -> list[float]:
        arr = np.array(a)
        pad = np.pad(arr, k // 2, mode="edge")
        return [float(np.median(pad[i : i + k])) for i in range(len(arr))]

    xs, ys = median(xs), median(ys)
    keyframes: list[dict] = []
    for (ts, _, _), x, y in zip(samples, xs, ys):
        if not keyframes or abs(x - keyframes[-1]["x"]) > 0.06:
            if keyframes:
                # Hold previous framing until just before the move → smooth pan of `step` seconds.
                keyframes.append({**keyframes[-1], "t": round(max(keyframes[-1]["t"], ts - step), 3)})
            keyframes.append({"t": round(ts, 3), "x": round(x, 4), "y": round(min(max(y, 0.3), 0.6), 4), "zoom": 1})
    json.dump(keyframes, sys.stdout)


if __name__ == "__main__":
    main()
