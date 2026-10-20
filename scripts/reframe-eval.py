#!/usr/bin/env python3
"""
Regression check for scripts/reframe.py: compares every shot boundary with ffmpeg's own scene
cuts on the same range and reports the offset. Boundaries that are not on a cut are layout changes
inside a scene (e.g. a facecam turned off without a cut) and are listed separately.

Usage: python3 scripts/reframe-eval.py VIDEO START END [--src-height PX] [START END ...]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("reframe.py")


def ffmpeg_cuts(video: str, start: float, end: float, threshold: float) -> list[float]:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", str(start), "-i", video, "-t", str(end - start), "-an",
         "-vf", f"scale=160:-2,select='gt(scene,{threshold})',metadata=print", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    return [start + float(t) for t in re.findall(r"pts_time:([0-9.]+)", out)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("ranges", nargs="+", type=float)
    ap.add_argument("--src-height", type=int)
    ap.add_argument("--threshold", type=float, default=0.3)
    ap.add_argument("--fps", type=float, default=30.0, help="video frame rate, for the 1-frame tolerance")
    args = ap.parse_args()
    if len(args.ranges) % 2:
        sys.exit("ranges must be START END pairs")

    worst = 0.0
    for start, end in zip(args.ranges[::2], args.ranges[1::2]):
        cmd = ["uv", "run", "--quiet", str(SCRIPT), args.video, str(start), str(end)]
        if args.src_height:
            cmd += ["--src-height", str(args.src_height)]
        shots = json.loads(subprocess.run(cmd, input="[]", capture_output=True, text=True, check=True).stdout)
        cuts = ffmpeg_cuts(args.video, start, end, args.threshold)
        print(f"== {start}-{end}: {len(shots)} shots, ffmpeg cuts: {' '.join(f'{c:.2f}' for c in cuts) or '-'}")
        for prev, s in zip(shots, shots[1:]):
            near = min(cuts, key=lambda c: abs(c - s["t"]), default=None)
            off = s["t"] - near if near is not None else None
            on_cut = off is not None and abs(off) <= 1.5 / args.fps
            if on_cut:
                worst = max(worst, abs(off))
            tag = f"on cut ({off * 1000:+.0f} ms)" if on_cut else (
                f"inside a scene (nearest cut {off:+.2f} s)" if off is not None else "inside a scene")
            print(f"  {s['t']:9.3f}  {prev['layout']:>5} → {s['layout']:<5}  {tag}")
    print(f"worst on-cut offset: {worst * 1000:.0f} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
