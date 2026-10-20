# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless>=4.9,<5", "numpy>=1.26"]
# ///
"""
9:16 reframing of a [start, end] range of a video. Prints JSON shots keyed on source time:
  {"t", "layout": "crop", "keyframes": [{t, x, y, zoom}]}          real camera: the speaker, or a two-shot
  {"t", "layout": "split", "cam", "content", "ratio", "pan"?}        stream: facecam on top, content below
  {"t", "layout": "fit"}                                             no creator on screen: whole frame on blur

Pipeline:
 1. Every frame is decoded to find scene cuts frame-accurately (ffmpeg-like scene score). Every
    1/fps s, and on the first frame after each cut, faces are detected (YuNet) with an identity
    embedding (SFace) and a landmark-aligned mouth patch (speech activity).
 2. Faces are linked into tracks by position, size and identity. Faces printed on clothes (rigidly
    attached below a face, mouth never moving) are dropped.
 3. Anchors are the creator / guests: faces that persist across content cuts, or for most of the clip.
    A small anchor with content moving or cutting around it is a webcam overlay (facecam).
 4. Per sample: facecam → split; real faces → crop on the active speaker, or a two-shot when both fit;
    otherwise fit.
 5. Layout changes live inside scenes and must persist (hysteresis); scene cuts are exact cut points.

Speech intervals ([[start, end], ...] JSON on stdin, optional) gate the active-speaker choice.

Usage: uv run scripts/reframe.py VIDEO START END [--src-height PX] [--models DIR] [--fps 5] [--debug DIR] < speech.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field

import cv2
import numpy as np

OUT_W, OUT_H = 1080, 1920
SPLIT_RATIO = 0.4
MIN_SPLIT_RATIO = 0.28
MAX_UPSCALE = 3.5  # facecam: max source→output magnification before shrinking its slot
CUT_SCORE = 0.3  # ffmpeg "scene" score (real cuts/transitions measured at 0.4-0.65)
MIN_CUT_GAP = 0.3  # s: flashes / double cuts collapse into one
HOLD = 1.5  # s: a layout change inside a scene must last this long
HOLD_SPEAKER = 2.0  # s: same for switching between speakers
FACECAM_MAX_H = 0.25
MIN_ANCHOR_H = 0.07  # smaller faces (crowds, background) can't be framed and never are the creator
SPEAKER_MIN_REL = 0.5  # people considered for a speaker / two-shot: at least half the biggest face
SAME_PERSON = 0.2  # SFace cosine below this → different people (same person is usually ≥ 0.4)
STITCH_SIM = 0.3
CREATOR_SIM = 0.363  # SFace recommended threshold
YUNET = "face_detection_yunet_2023mar.onnx"
SFACE = "face_recognition_sface_2021dec.onnx"


# ---------------------------------------------------------------------------------------------
# Data


@dataclass
class Det:
    x: float  # box, normalized, clipped to the frame
    y: float
    w: float
    h: float
    score: float
    mouth: np.ndarray | None = None  # normalized, landmark-aligned mouth patch
    feat: np.ndarray | None = None  # unit SFace embedding

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@dataclass
class Track:
    dets: dict[int, Det] = field(default_factory=dict)  # sample index → detection
    activity: dict[int, float] = field(default_factory=dict)  # sample index → mouth change

    @property
    def first(self) -> int:
        return min(self.dets)

    @property
    def last(self) -> int:
        return max(self.dets)

    def box(self, idx: list[int] | None = None) -> tuple[float, float, float, float]:
        """Median box over `idx` (falls back to the whole track when it has no detection there)."""
        ds = [self.dets[i] for i in idx if i in self.dets] if idx is not None else []
        ds = ds or list(self.dets.values())
        return tuple(float(np.median([getattr(d, k) for d in ds])) for k in ("x", "y", "w", "h"))  # type: ignore

    def embedding(self) -> np.ndarray | None:
        fs = [d.feat for d in sorted(self.dets.values(), key=lambda d: -d.score) if d.feat is not None][:8]
        if not fs:
            return None
        e = np.mean(fs, axis=0)
        return e / (np.linalg.norm(e) + 1e-9)


# ---------------------------------------------------------------------------------------------
# Pure helpers (unit-tested in scripts/test_reframe.py)


def clip_box(x: float, y: float, w: float, h: float, W: int, H: int) -> tuple[float, float, float, float] | None:
    """Intersect a pixel box with the frame and normalize it; None when (almost) nothing is left."""
    x0, y0 = max(0.0, x), max(0.0, y)
    x1, y1 = min(float(W), x + w), min(float(H), y + h)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H


def scene_score(mafd: float, prev_mafd: float) -> float:
    """ffmpeg's `select=scene` metric from the mean absolute frame difference (0..255 scale)."""
    return min(1.0, min(mafd, abs(mafd - prev_mafd)) / 100.0)


def accept_cut(t: float, score: float, cuts: list[float], threshold: float = CUT_SCORE, min_gap: float = MIN_CUT_GAP) -> bool:
    """Is frame `t` (with this scene score) the first frame of a new scene? One cut per `min_gap`."""
    return score >= threshold and (not cuts or t - cuts[-1] >= min_gap)


def pick_cuts(frames: list[tuple[float, float]], threshold: float = CUT_SCORE, min_gap: float = MIN_CUT_GAP) -> list[float]:
    """[(t, score)] → cut times (first frame of each new scene)."""
    cuts: list[float] = []
    for t, s in frames:
        if accept_cut(t, s, cuts, threshold, min_gap):
            cuts.append(t)
    return cuts


def cosine(a: np.ndarray | None, b: np.ndarray | None) -> float | None:
    if a is None or b is None:
        return None
    return float(a @ b)


def clamp_rect(cx: float, cy: float, w: float, h: float) -> dict:
    w, h = min(max(w, 1e-3), 1.0), min(max(h, 1e-3), 1.0)
    x = min(max(cx - w / 2, 0.0), 1.0 - w)
    y = min(max(cy - h / 2, 0.0), 1.0 - h)
    return {"x": x, "y": y, "w": w, "h": h}


def intersect(a: dict, b: dict) -> dict | None:
    x0, y0 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x1, y1 = min(a["x"] + a["w"], b["x"] + b["w"]), min(a["y"] + a["h"], b["y"] + b["h"])
    if x1 - x0 <= 0.01 or y1 - y0 <= 0.01:
        return None
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


def crop_window_w(aspect: float, zoom: float = 1.0) -> float:
    """Width (normalized on the source) of a 9:16 crop window filling the output height."""
    return min(1.0, (OUT_W / OUT_H) / aspect / zoom)


def fits_two_shot(a: Det, b: Det, aspect: float) -> bool:
    left, right = min(a.x, b.x), max(a.x + a.w, b.x + b.w)
    return right - left <= 0.9 * crop_window_w(aspect)


def segment(times: list[float], labels: list, scene_of: list[int], end: float, hold) -> list[list]:
    """
    Turn per-sample labels into runs [start_idx, end_idx_excl, label]. Runs never straddle a scene
    cut; inside a scene, runs shorter than hold(label) seconds are absorbed by their longer neighbour
    (hysteresis). Consecutive runs with the same label are merged, also across cuts.
    """
    n = len(times)
    t_at = lambda i: times[i] if i < n else end  # noqa: E731
    runs: list[list] = []
    for i, lab in enumerate(labels):
        if runs and runs[-1][2] == lab and scene_of[runs[-1][0]] == scene_of[i]:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1, lab])
    dur = lambda r: t_at(r[1]) - t_at(r[0])  # noqa: E731
    while True:
        best = None
        for k, r in enumerate(runs):
            nb = [m for m in (k - 1, k + 1) if 0 <= m < len(runs) and scene_of[runs[m][0]] == scene_of[r[0]]]
            if nb and dur(r) < hold(r[2]) and (best is None or dur(r) < dur(runs[best[0]])):
                best = (k, max(nb, key=lambda m: dur(runs[m])))
        if best is None:
            break
        k, into = best
        runs[into][0], runs[into][1] = min(runs[into][0], runs[k][0]), max(runs[into][1], runs[k][1])
        del runs[k]
        merged = [runs[0]]
        for r in runs[1:]:
            if r[2] == merged[-1][2] and scene_of[r[0]] == scene_of[merged[-1][0]]:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        runs = merged
    out = [runs[0]]
    for r in runs[1:]:
        if r[2] == out[-1][2]:
            out[-1][1] = r[1]
        else:
            out.append(r)
    return out


def pan_keyframes(points: list[tuple[float, float]], dead_zone: float, lo: float, hi: float, ramp: float = 0.6) -> list[dict]:
    """Camera-operator pans: hold the framing until the target leaves ±dead_zone, then pan over `ramp` s."""
    if not points:
        return []
    clampx = lambda v: min(max(v, lo), hi)  # noqa: E731
    k = max(1, len(points) // 4)
    cur = clampx(float(np.median([x for _, x in points[:k]])))
    kfs = [{"t": points[0][0], "x": cur}]
    for t, x in points:
        if abs(clampx(x) - cur) > dead_zone:
            cur = clampx(x)
            kfs.append({"t": max(kfs[-1]["t"], t - ramp), "x": kfs[-1]["x"]})
            kfs.append({"t": t, "x": cur})
    return kfs


def remove_attached(tracks: list[Track], log=None) -> list[Track]:
    """
    Drop detections of faces printed on clothes: rigidly attached below another face (same offset
    over time), not bigger than it, and whose mouth does not move compared to the real one.
    """
    for a in tracks:
        for b in tracks:
            if a is b:
                continue
            common = sorted(set(a.dets) & set(b.dets))
            if len(common) < 3:
                continue
            dx = np.array([(b.dets[s].cx - a.dets[s].cx) / a.dets[s].w for s in common])
            dy = np.array([(b.dets[s].cy - a.dets[s].cy) / a.dets[s].h for s in common])
            size = float(np.median([b.dets[s].h / a.dets[s].h for s in common]))
            if not (0.6 <= float(np.median(dy)) <= 2.5 and abs(float(np.median(dx))) <= 1.0 and size <= 1.1):
                continue
            act_a = [a.activity[s] for s in common if s in a.activity]
            act_b = [b.activity[s] for s in common if s in b.activity]
            mean_a = float(np.mean(act_a)) if act_a else None
            mean_b = float(np.mean(act_b)) if act_b else None
            if log:
                log(f"attached? n={len(common)} dy={np.median(dy):.2f}±{np.std(dy):.2f} dx={np.median(dx):.2f}±{np.std(dx):.2f} "
                    f"size={size:.2f} act_a={mean_a} act_b={mean_b}")
            if float(np.std(dx)) > 0.25 or float(np.std(dy)) > 0.25:
                continue  # not rigidly attached: two people moving independently
            # Mouth change on a print is mostly fabric/compression noise, about the real mouth's level;
            # a real person below talking would clearly exceed it.
            if mean_a is not None and mean_b is not None and mean_b > 1.5 * mean_a:
                continue
            for s in common:
                b.dets.pop(s, None)
                b.activity.pop(s, None)
    return [t for t in tracks if t.dets]


def sanitize(shots: list[dict]) -> list[dict]:
    """Clamp every coordinate into the schema's ranges (normalized 0..1, zoom 1..4)."""
    unit = lambda v: round(min(max(float(v), 0.0), 1.0), 4)  # noqa: E731

    def rect(r: dict) -> dict:
        w, h = unit(r["w"]) or 1e-3, unit(r["h"]) or 1e-3
        return {"x": round(min(unit(r["x"]), 1 - w), 4), "y": round(min(unit(r["y"]), 1 - h), 4), "w": w, "h": h}

    out = []
    for s in shots:
        s = {**s, "t": round(max(0.0, float(s["t"])), 3)}
        if s["layout"] == "crop":
            s["keyframes"] = [
                {"t": round(max(0.0, float(k["t"])), 3), "x": unit(k["x"]), "y": unit(k["y"]),
                 "zoom": round(min(max(float(k["zoom"]), 1.0), 4.0), 3)}
                for k in s["keyframes"]
            ]
        elif s["layout"] == "split":
            s["cam"], s["content"] = rect(s["cam"]), rect(s["content"])
            s["ratio"] = round(min(max(float(s["ratio"]), 0.2), 0.7), 3)
            if s.get("pan"):
                s["pan"] = [{"t": round(max(0.0, float(k["t"])), 3), "x": unit(k["x"])} for k in s["pan"]]
            else:
                s.pop("pan", None)
        out.append(s)
    return out


# ---------------------------------------------------------------------------------------------
# Image measurements


def mouth_patch(gray: np.ndarray, f: np.ndarray) -> np.ndarray | None:
    """Mouth region aligned on the two mouth-corner landmarks, z-normalized (lighting-invariant)."""
    rx, ry, lx, ly = (float(v) for v in f[10:14])
    d = math.hypot(lx - rx, ly - ry)
    if d < 6:
        return None
    cx, cy = (rx + lx) / 2, (ry + ly) / 2
    x0, x1, y0, y1 = int(cx - 0.8 * d), int(cx + 0.8 * d), int(cy - 0.5 * d), int(cy + 0.5 * d)
    H, W = gray.shape
    if x0 < 0 or y0 < 0 or x1 > W or y1 > H or x1 - x0 < 4 or y1 - y0 < 4:
        return None
    p = cv2.resize(gray[y0:y1, x0:x1], (24, 14), interpolation=cv2.INTER_AREA).astype(np.float32)
    return (p - p.mean()) / (p.std() + 1e-3)


def px_rect(r: dict | tuple, gw: int, gh: int) -> tuple[int, int, int, int]:
    x, y, w, h = (r["x"], r["y"], r["w"], r["h"]) if isinstance(r, dict) else r
    return int(x * gw), int(y * gh), max(int(x * gw) + 1, int((x + w) * gw)), max(int(y * gh) + 1, int((y + h) * gh))


def grow_still_rect(still: np.ndarray, seed: tuple[int, int, int, int], min_fill: float = 0.85) -> tuple[int, int, int, int]:
    """Grow a rectangle from `seed` (x0, y0, x1, y1) while the next row/column is mostly `still`."""
    gh, gw = still.shape
    x0, y0, x1, y1 = seed
    grew = True
    while grew:
        grew = False
        if x0 > 0 and still[y0:y1, x0 - 1].mean() >= min_fill:
            x0, grew = x0 - 1, True
        if x1 < gw and still[y0:y1, x1].mean() >= min_fill:
            x1, grew = x1 + 1, True
        if y0 > 0 and still[y0 - 1, x0:x1].mean() >= min_fill:
            y0, grew = y0 - 1, True
        if y1 < gh and still[y1, x0:x1].mean() >= min_fill:
            y1, grew = y1 + 1, True
    return x0, y0, x1, y1


def overlay_box(face: tuple, cut_pairs: list[tuple[np.ndarray, np.ndarray]]) -> dict | None:
    """
    Webcam overlay bounds around a facecam. At a content cut every content pixel changes while the
    webcam feed does not (frames 1/fps apart), so averaging the difference over the cuts the facecam
    straddles leaves the overlay "still": grow a rectangle from the face over that still area.
    None when there are too few cuts to tell.
    """
    if len(cut_pairs) < 2:
        return None
    gh, gw = cut_pairs[0][0].shape
    diff = np.mean([cv2.absdiff(a, b).astype(np.float32) for a, b in cut_pairs], axis=0)
    diff = cv2.blur(diff, (3, 3))
    still = diff < max(12.0, 0.35 * float(np.median(diff)))
    x0, y0, x1, y1 = grow_still_rect(still, px_rect(face, gw, gh), min_fill=0.75)
    return {"x": x0 / gw, "y": y0 / gh, "w": (x1 - x0) / gw, "h": (y1 - y0) / gh}


# ---------------------------------------------------------------------------------------------
# Main analysis


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("--src-height", type=int, help="height of the file used at render time (upscale guard)")
    ap.add_argument("--models", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models"))
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--debug")
    args = ap.parse_args()

    speech: list[tuple[float, float]] = []
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            speech = [(float(a), float(b)) for a, b in json.loads(raw)]

    for name in (YUNET, SFACE):
        if not os.path.isfile(os.path.join(args.models, name)):
            sys.exit(f"model {name} not found in {os.path.abspath(args.models)}. Run: pnpm setup:models")
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"cannot open {args.video}")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    aspect = W / H
    src_h = args.src_height or H
    detector = cv2.FaceDetectorYN.create(os.path.join(args.models, YUNET), "", (W, H), 0.75, 0.3, 20)
    recognizer = cv2.FaceRecognizerSF.create(os.path.join(args.models, SFACE), "")

    # ---- 1. Decode every frame: scene cuts; analysis samples every 1/fps s and on each cut.
    # Seek a bit early: some files land after the requested time.
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, args.start - 1.0) * 1000)
    period = 1.0 / args.fps
    times: list[float] = []
    dets: list[list[Det]] = []
    grays: list[np.ndarray] = []
    debug_frames: dict[int, np.ndarray] = {}
    cut_times: list[float] = []
    before_cut: dict[int, np.ndarray] = {}  # sample index of a cut → frame right before it (320×180)
    prev_small = prev_g = None
    prev_mafd = 0.0
    next_sample = args.start
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t > args.end:
            break
        g = cv2.cvtColor(cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        small = cv2.resize(g, (160, 90), interpolation=cv2.INTER_AREA)
        is_cut = False
        if prev_small is not None:
            mafd = float(np.mean(cv2.absdiff(small, prev_small)))
            score = scene_score(mafd, prev_mafd)
            prev_mafd = mafd
            if t > args.start and accept_cut(t, score, cut_times):
                cut_times.append(t)
                is_cut = True
                before_cut[len(times)] = prev_g
        prev_small, prev_g = small, g
        if t < args.start - 1e-3 or (t < next_sample - 1e-3 and not is_cut):
            continue
        next_sample = t + period
        i = len(times)
        times.append(t)
        gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, faces = detector.detect(frame)
        ds = []
        for f in faces if faces is not None else []:
            box = clip_box(float(f[0]), float(f[1]), float(f[2]), float(f[3]), W, H)
            if box is None:
                continue
            feat = None
            if f[2] >= 32 and f[3] >= 32:
                e = recognizer.feature(recognizer.alignCrop(frame, f)).flatten()
                feat = e / (np.linalg.norm(e) + 1e-9)
            ds.append(Det(*box, score=float(f[14]), mouth=mouth_patch(gray_full, f), feat=feat))
        dets.append(ds)
        grays.append(g)
        if args.debug and (i % max(1, round(args.fps)) == 0 or is_cut):
            debug_frames[i] = frame.copy()
    if not times:
        json.dump([{"t": round(args.start, 3), "layout": "fit"}], sys.stdout)
        return
    N = len(times)
    span = max(period, times[-1] - times[0] + period)
    scene_of = [sum(1 for c in cut_times if c <= t + 1e-6) for t in times]
    cut_samples = [i for i in range(1, N) if scene_of[i] != scene_of[i - 1]]

    # ---- 2. Tracks: position + size + identity; tolerate gaps (head turns, missed detections).
    tracks: list[Track] = []
    max_gap = round(3 * args.fps)
    for i, ds in enumerate(dets):
        used: set[int] = set()
        for d in sorted(ds, key=lambda d: -d.w * d.h):
            best, best_cost = None, 1.0
            for k, tr in enumerate(tracks):
                if k in used or i - tr.last > max_gap:
                    continue
                p = tr.dets[tr.last]
                if not 0.65 < d.h / p.h < 1.55:
                    continue
                sim = cosine(d.feat, tr.embedding())
                if sim is not None and sim < SAME_PERSON:
                    continue
                cost = math.hypot(d.cx - p.cx, (d.cy - p.cy) / aspect) / max(p.w, d.w)
                if cost < best_cost:
                    best, best_cost = k, cost
            if best is None:
                tracks.append(Track())
                best = len(tracks) - 1
            tracks[best].dets[i] = d
            used.add(best)

    # Stitch fragments of the same face: no time overlap, gap ≤ 10 s, same place, size and identity.
    tracks.sort(key=lambda tr: tr.first)
    stitched: list[Track] = []
    for tr in tracks:
        target = None
        for prev in stitched:
            if prev.last >= tr.first or tr.first - prev.last > round(10 * args.fps):
                continue
            p, d = prev.dets[prev.last], tr.dets[tr.first]
            sim = cosine(prev.embedding(), tr.embedding())
            if (0.6 < d.h / p.h < 1.6 and math.hypot(d.cx - p.cx, (d.cy - p.cy) / aspect) < 0.6 * max(p.w, d.w)
                    and (sim is None or sim >= STITCH_SIM)):
                target = prev
                break
        if target:
            target.dets.update(tr.dets)
        else:
            stitched.append(tr)
    tracks = stitched

    # Speech activity: change of the aligned mouth patch between close samples of the same scene.
    near_gap = max(1, round(0.5 * args.fps))
    for tr in tracks:
        keys = sorted(tr.dets)
        for a, b in zip(keys, keys[1:]):
            ma, mb = tr.dets[a].mouth, tr.dets[b].mouth
            if b - a <= near_gap and scene_of[a] == scene_of[b] and ma is not None and mb is not None:
                tr.activity[b] = float(np.mean(np.abs(mb - ma)))
    tracks = remove_attached(tracks, log=(lambda m: print(m, file=sys.stderr)) if args.debug else None)

    # ---- 3. Anchors and facecams.
    def survives_cut(tr: Track) -> bool:
        return any(tr.first < c <= tr.last for c in cut_samples)

    def is_anchor(tr: Track) -> bool:
        if tr.box()[3] < MIN_ANCHOR_H:
            return False
        ds = tr.dets.values()
        tol = max(0.1, 0.8 * float(np.median([d.w for d in ds])))
        if float(np.std([d.cx for d in ds])) > tol or float(np.std([d.cy for d in ds])) > tol:
            return False
        dur = len(tr.dets) * period
        return (dur >= 3.0 and survives_cut(tr)) or dur >= max(3.0, 0.35 * span)

    def cam_rect(face: tuple, ratio: float) -> dict:
        x, y, w, h = face
        ch = min(1.0, h * 2.4)
        cw = ch * (OUT_W / (OUT_H * ratio)) / aspect
        return clamp_rect(x + w / 2, y + h / 2 + h * 0.15, cw, ch)

    def cut_presence(tr: Track) -> tuple[int, int]:
        """(straddled, one-sided) cuts. Straddled: the face is seen right before AND right after, at
        the same place — the content cut under it while it stayed (overlay). One-sided: it appears
        or disappears exactly at the cut — it belongs to that shot (content, or a camera angle)."""
        n = one = 0
        for c in cut_samples:
            before = [tr.dets[j] for j in range(max(0, c - 4), c) if j in tr.dets and times[c] - times[j] <= 0.7]
            after = [tr.dets[j] for j in range(c, min(N, c + 4)) if j in tr.dets and times[j] - times[c] <= 0.7]
            if before and after:
                if math.hypot(before[-1].cx - after[0].cx, (before[-1].cy - after[0].cy) / aspect) < 0.5 * before[-1].w:
                    n += 1
            elif before or after:
                one += 1
        return n, one

    def straddled_cuts(tr: Track) -> int:
        return cut_presence(tr)[0]

    def straddled_pairs(tr: Track) -> list[tuple[np.ndarray, np.ndarray]]:
        """(frame right before, frame right after) each cut the face is seen on both sides of."""
        return [(before_cut[c], grays[c]) for c in cut_samples
                if c in before_cut and c in tr.dets and (c - 1) in tr.dets]

    def content_motion(tr: Track) -> float:
        """Mean frame change outside the webcam area (0..255): gameplay/screens move a lot, sets don't."""
        gh, gw = grays[0].shape
        x0, y0, x1, y1 = px_rect(cam_rect(tr.box(), SPLIT_RATIO), gw, gh)
        vals = []
        for i in sorted(tr.dets):
            if i == 0 or scene_of[i] != scene_of[i - 1]:
                continue
            diff = cv2.absdiff(grays[i - 1], grays[i]).astype(np.float32)
            diff[y0:y1, x0:x1] = np.nan
            vals.append(float(np.nanmean(diff)))
        return float(np.median(vals)) if vals else 0.0

    def is_facecam(tr: Track) -> tuple[bool, str]:
        x, y, w, h = tr.box()
        if h >= FACECAM_MAX_H:
            return False, "big"
        n, one = cut_presence(tr)
        if n:
            return True, f"straddles {n} cut(s), one-sided {one}"
        # No cut to tell: an overlay near a side over busy content (not a calm set).
        motion = content_motion(tr)
        cx = x + w / 2
        return (cx < 0.3 or cx > 0.7) and motion >= 6.0, f"content motion {motion:.1f}"

    anchors = [tr for tr in tracks if is_anchor(tr)]
    facecam_flags = []
    for tr in anchors:
        flag, why = is_facecam(tr)
        facecam_flags.append(flag)
        if args.debug:
            print(f"anchor {times[tr.first]:.1f}-{times[tr.last]:.1f}s n={len(tr.dets)} box={tuple(round(v, 2) for v in tr.box())} "
                  f"facecam={flag} ({why})", file=sys.stderr)
    # The main facecam (most present) defines the creator. Other overlay faces only count when they
    # are the creator too (cam moved / resized) and never at the same time as the main one: stream
    # alerts with a photo, or a lookalike inside the content, are rejected.
    cams = [k for k, f in enumerate(facecam_flags) if f]
    if cams:
        main_cam = max(cams, key=lambda k: (len(anchors[k].dets), straddled_cuts(anchors[k])))
        main_emb = anchors[main_cam].embedding()
        for k in cams:
            if k == main_cam:
                continue
            sim = cosine(anchors[k].embedding(), main_emb)
            overlaps = not set(anchors[k].dets).isdisjoint(anchors[main_cam].dets)
            if overlaps or (sim is not None and sim < CREATOR_SIM):
                facecam_flags[k] = False
                if args.debug:
                    print(f"  rejected facecam {times[anchors[k].first]:.1f}s: overlaps={overlaps} sim={sim}", file=sys.stderr)

    # With a facecam, the creator is the webcam person: a big face only counts when it is them
    # (switch to a full-screen cam), never a character inside the content. Such a face may live
    # inside a single scene (it never survives a cut), so look for it among all tracks.
    creators = [e for e, cam in zip((tr.embedding() for tr in anchors), facecam_flags) if cam and e is not None]
    if creators:
        for tr in tracks:
            e = tr.embedding()
            if (tr not in anchors and e is not None and len(tr.dets) * period >= HOLD and tr.box()[3] >= FACECAM_MAX_H
                    and max(float(e @ c) for c in creators) >= CREATOR_SIM):
                anchors.append(tr)
                facecam_flags.append(False)
        keep = []
        for tr, cam in zip(anchors, facecam_flags):
            e = tr.embedding()
            if cam or (e is not None and max(float(e @ c) for c in creators) >= CREATOR_SIM):
                keep.append((tr, cam))
        anchors, facecam_flags = [t for t, _ in keep], [c for _, c in keep]

    # ---- 4. Per-sample layout candidate.
    def present(tr: Track, i: int, sec: float) -> bool:
        return any(j in tr.dets and scene_of[j] == scene_of[i] and abs(times[j] - times[i]) <= sec
                   for j in range(max(0, i - round(sec * args.fps) - 1), min(N, i + round(sec * args.fps) + 2)))

    def speaking(i: int) -> bool:
        return not speech or any(a - 0.2 <= times[i] <= b + 0.2 for a, b in speech)

    def det_near(tr: Track, i: int) -> Det:
        return tr.dets.get(i) or tr.dets[min(tr.dets, key=lambda j: abs(j - i))]

    labels: list[tuple] = []
    for i in range(N):
        cams = [k for k, tr in enumerate(anchors) if facecam_flags[k] and present(tr, i, 0.6)]
        # While the webcam overlay is up, any big face beside it is part of the content.
        real = [] if cams else [k for k, tr in enumerate(anchors) if not facecam_flags[k] and present(tr, i, 0.4)]
        if real:
            biggest = max(det_near(anchors[k], i).h for k in real)
            real = [k for k in real if det_near(anchors[k], i).h >= SPEAKER_MIN_REL * biggest]
        if cams:
            labels.append(("split", max(cams, key=lambda k: len(anchors[k].dets))))
        elif len(real) >= 2:
            pair = None
            for a in range(len(real)):
                for b in range(a + 1, len(real)):
                    if fits_two_shot(det_near(anchors[real[a]], i), det_near(anchors[real[b]], i), aspect):
                        pair = (real[a], real[b])
            if pair:
                labels.append(("crop", pair))
            else:
                win = [j for j in range(max(0, i - round(args.fps)), min(N, i + round(args.fps) + 1))
                       if scene_of[j] == scene_of[i] and speaking(j)]
                act = {k: sum(anchors[k].activity.get(j, 0.0) for j in win) for k in real}
                k = max(real, key=lambda k: (act[k], det_near(anchors[k], i).w))
                labels.append(("crop", k))
        elif real:
            labels.append(("crop", real[0]))
        else:
            labels.append(("fit", -1))

    if args.debug:
        step_s = max(1, round(args.fps))
        print("cuts: " + " ".join(f"{c:.2f}" for c in cut_times), file=sys.stderr)
        print("labels/s: " + " ".join(f"{times[i]:.0f}:{labels[i][0][0]}{labels[i][1]}" for i in range(0, N, step_s)), file=sys.stderr)

    # ---- 5. Segments inside scenes, with hysteresis.
    multi_speaker = any(isinstance(lab[1], int) and lab[0] == "crop" for lab in labels) and len(
        {lab[1] for lab in labels if lab[0] == "crop"}) > 1
    runs = segment(times, labels, scene_of, args.end,
                   lambda lab: HOLD_SPEAKER if multi_speaker and lab[0] == "crop" else HOLD)

    # ---- 6. Shot geometry.
    def motion_x(a: int, b: int, avoid: dict | None) -> list[tuple[float, float]]:
        """Per-second horizontal center of the content motion (avoiding the facecam)."""
        gh, gw = grays[0].shape
        xs = (np.arange(gw) + 0.5) / gw
        out, acc, t0 = [], np.zeros(gw), None
        for i in range(a, b):
            if i == 0 or scene_of[i] != scene_of[i - 1]:
                continue
            diff = cv2.absdiff(grays[i - 1], grays[i]).astype(np.float32)
            if avoid:
                x0, y0, x1, y1 = px_rect(avoid, gw, gh)
                diff[y0:y1, x0:x1] = 0
            acc += diff.sum(axis=0)
            t0 = times[i] if t0 is None else t0
            if times[i] - t0 >= 1.0 or i == b - 1:
                if acc.sum() > 0:
                    out.append((t0, float(np.average(xs, weights=acc))))
                acc, t0 = np.zeros(gw), None
        return out

    def mean_luma(rect: dict, idx: list[int]) -> float:
        gh, gw = grays[0].shape
        x0, y0, x1, y1 = px_rect(rect, gw, gh)
        return float(np.mean([grays[i][y0:y1, x0:x1].mean() for i in idx]))

    def crop_shot(key, idx: list[int], t0: float) -> dict:
        if isinstance(key, tuple):  # two-shot: frame both people, static
            boxes = [anchors[k].box(idx) for k in key]
            left = min(b[0] for b in boxes)
            right = max(b[0] + b[2] for b in boxes)
            fy = float(np.mean([b[1] + b[3] / 2 for b in boxes]))
            y = min(max(fy + 0.12, 0.0), 1.0)
            return {"t": t0, "layout": "crop", "keyframes": [{"t": t0, "x": (left + right) / 2, "y": y, "zoom": 1.0}]}
        tr = anchors[key]
        pts = [(times[i], tr.dets[i]) for i in idx if i in tr.dets] or [(times[idx[0]], det_near(tr, idx[0]))]
        fh = float(np.median([d.h for _, d in pts]))
        # Zoom in when the face is small (face ≈ 1/4 of the frame height), capped; and never past
        # MAX_UPSCALE on the render file.
        # Output magnification is zoom·OUT_H/src_h.
        zoom = max(1.0, min(2.2, 0.25 / max(fh, 1e-3), MAX_UPSCALE * src_h / OUT_H))
        fy = float(np.median([d.cy for _, d in pts]))
        y = min(max(fy + 0.12 / zoom, 0.0), 1.0)  # face in the upper third
        win = crop_window_w(aspect, zoom)
        lo, hi = win / 2, 1 - win / 2
        kfs = pan_keyframes([(t, d.cx) for t, d in pts], 0.2 * win, lo, hi)
        kfs[0]["t"] = t0
        return {"t": t0, "layout": "crop", "keyframes": [{**k, "y": y, "zoom": zoom} for k in kfs]}

    shots = []
    for a, b, (layout, key) in runs:
        t0 = args.start if not shots else times[a]
        idx = list(range(a, b))
        if layout == "split":
            tr = anchors[key]
            face = tr.box(idx)
            # Use the whole facecam lifetime: the more content cuts, the clearer the overlay.
            box = overlay_box(face, straddled_pairs(tr))
            x, y, w, h = face
            # Big overlays (a whole room) are still framed around the face.
            box = box and intersect(box, clamp_rect(x + w / 2, y + h / 2 + 0.15 * h, 4.5 * w, 3.2 * h))
            if box and (box["w"] < 2.2 * w or box["h"] < 1.8 * h):
                # No margin around the face: a background-removed cam (the content shows through
                # around the person) — keep the framing around the face.
                box = None
            if args.debug:
                print(f"shot {times[a]:.2f}: face={tuple(round(v, 3) for v in face)} overlay={box and {k: round(v, 3) for k, v in box.items()}}", file=sys.stderr)
            if box:
                # Show the whole webcam frame: size the slot to its shape.
                cam = box
                ratio = min(0.5, max(MIN_SPLIT_RATIO, OUT_W / (OUT_H * (cam["w"] * aspect / cam["h"]))))
            else:
                ratio = SPLIT_RATIO
                cam = cam_rect(face, ratio)
            # Low-resolution source: shrink the facecam slot rather than blowing pixels up.
            if OUT_H * ratio / max(1.0, cam["h"] * src_h) > MAX_UPSCALE:
                ratio = max(MIN_SPLIT_RATIO, MAX_UPSCALE * cam["h"] * src_h / OUT_H)
                if not box:
                    cam = cam_rect(face, ratio)
            content_w = min(1.0, (OUT_W / (OUT_H * (1 - ratio))) / aspect)
            # Keep the content window off the facecam when the frame allows it.
            lo, hi = content_w / 2, 1 - content_w / 2
            if cam["x"] + cam["w"] / 2 < 0.5:
                lo = min(max(lo, cam["x"] + cam["w"] + content_w / 2), 0.64)
            else:
                hi = max(min(hi, cam["x"] - content_w / 2), 0.36)
            pan = pan_keyframes(motion_x(a, b, cam), 0.25 * content_w, lo, max(lo, hi), ramp=0.8)
            cx = pan[0]["x"] if pan else min(max(0.5, lo), max(lo, hi))
            content = clamp_rect(cx, 0.5, content_w, 1.0)
            if mean_luma(content, idx) < 18:
                shots.append(crop_shot(key, idx, t0))  # black / loading screen: just show the creator
                continue
            shot = {"t": t0, "layout": "split", "cam": cam, "content": content, "ratio": ratio}
            if len(pan) > 1:
                pan[0]["t"] = t0
                shot["pan"] = pan
            shots.append(shot)
        elif layout == "crop":
            shots.append(crop_shot(key, idx, t0))
        else:
            shots.append({"t": t0, "layout": "fit"})

    shots = sanitize(shots)
    if args.debug:
        write_debug(args.debug, debug_frames, times, dets, anchors, shots, W, H)
    json.dump(shots, sys.stdout, allow_nan=False)


def write_debug(out_dir, frames, times, dets, anchors, shots, W, H) -> None:
    os.makedirs(out_dir, exist_ok=True)
    for i, frame in frames.items():
        t = times[i]
        shot = [s for s in shots if s["t"] <= t + 2e-3][-1] if shots else None
        img = frame.copy()
        for d in dets[i]:
            cv2.rectangle(img, (int(d.x * W), int(d.y * H)), (int((d.x + d.w) * W), int((d.y + d.h) * H)), (0, 0, 255), 1)
        for k, tr in enumerate(anchors):
            if i in tr.dets:
                d = tr.dets[i]
                cv2.rectangle(img, (int(d.x * W), int(d.y * H)), (int((d.x + d.w) * W), int((d.y + d.h) * H)), (0, 255, 0), 2)
                cv2.putText(img, f"A{k}", (int(d.x * W), int(d.y * H) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        if shot:
            for key, color in (("cam", (255, 0, 255)), ("content", (255, 200, 0))):
                if key in shot:
                    r = shot[key]
                    cv2.rectangle(img, (int(r["x"] * W), int(r["y"] * H)), (int((r["x"] + r["w"]) * W), int((r["y"] + r["h"]) * H)), color, 2)
            cv2.putText(img, f"{t:.2f}s {shot['layout']}", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imwrite(os.path.join(out_dir, f"{t:08.2f}.jpg"), img)


if __name__ == "__main__":
    main()
