# /// script
# requires-python = ">=3.10"
# dependencies = ["opencv-python-headless>=4.9,<5", "numpy>=1.26"]
# ///
"""
9:16 reframing for a [start, end] range of a 16:9 video. Prints JSON shots (source time):
  {"t", "layout": "crop", "keyframes": [{t,x,y,zoom}]}  - real camera: frame the active speaker
  {"t", "layout": "split", "cam": rect, "content": rect, "ratio"} - stream facecam on top, content below
  {"t", "layout": "fit"}                                - no reliable face: whole frame on blurred bg

Faces come from YuNet. Only "anchor" faces count: tracks that stay on screen for a large share
of the clip at a stable position (the streamer / podcast guests). Transient faces (game cutscenes,
B-roll) are ignored. Speech intervals ([[start, end], ...] JSON on stdin, optional) pick the
active speaker when several anchors are visible.

Usage: uv run scripts/reframe.py VIDEO START END [--model PATH] [--fps 5] [--debug DIR] < speech.json
"""
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
MIN_SHOT = 1.5  # seconds
CUT_SNAP = 0.5  # snap shot boundaries to a scene cut this close
DEAD_ZONE = 0.1  # crop moves only when the face leaves ±10% of the frame width around the framing


@dataclass
class Det:
    x: float  # box, normalized
    y: float
    w: float
    h: float
    score: float
    mouth: tuple[float, float, float, float]  # mouth-corner bbox, normalized
    aligned: np.ndarray | None = None  # 112×112 aligned crop for identity (SFace)

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@dataclass
class Track:
    dets: dict[int, Det] = field(default_factory=dict)  # sample index → detection
    motion: dict[int, float] = field(default_factory=dict)  # sample index → mouth motion energy
    last: int = -1

    def median_box(self, idx: list[int] | None = None) -> tuple[float, float, float, float]:
        ds = [self.dets[i] for i in (idx if idx is not None else self.dets) if i in self.dets]
        return tuple(float(np.median([getattr(d, k) for d in ds])) for k in ("x", "y", "w", "h"))  # type: ignore

    def embedding(self, rec) -> np.ndarray | None:
        best = sorted((d for d in self.dets.values() if d.aligned is not None), key=lambda d: -d.score)[:5]
        if not best:
            return None
        e = np.mean([rec.feature(d.aligned).flatten() for d in best], axis=0)
        return e / (np.linalg.norm(e) + 1e-9)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("--models", default=os.path.join(os.path.dirname(__file__), "..", "models"))
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--debug")
    args = ap.parse_args()

    speech: list[tuple[float, float]] = []
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            speech = [(float(a), float(b)) for a, b in json.loads(raw)]

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"cannot open {args.video}")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    vfps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    for name in ("face_detection_yunet_2023mar.onnx", "face_recognition_sface_2021dec.onnx"):
        if not os.path.isfile(os.path.join(args.models, name)):
            sys.exit(f"model {name} not found in {os.path.abspath(args.models)}. Run: pnpm setup:models")
    detector = cv2.FaceDetectorYN.create(
        os.path.join(args.models, "face_detection_yunet_2023mar.onnx"), "", (W, H),
        score_threshold=0.75, nms_threshold=0.3, top_k=20,
    )
    recognizer = cv2.FaceRecognizerSF.create(os.path.join(args.models, "face_recognition_sface_2021dec.onnx"), "")

    # ---- 1. Sequential sampling (one seek, then grab/skip: much faster than seeking per sample).
    step = max(1, round(vfps / args.fps))
    cap.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000)
    times: list[float] = []
    dets: list[list[Det]] = []
    hists: list[np.ndarray] = []
    grays: list[np.ndarray] = []
    debug_frames: dict[int, np.ndarray] = {}
    n = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t > args.end:
            break
        if t < args.start - 1e-3 or n % step:
            n += 1
            continue
        n += 1
        ok, frame = cap.retrieve()
        if not ok:
            break
        i = len(times)
        times.append(t)
        _, faces = detector.detect(frame)
        ds = []
        for f in faces if faces is not None else []:
            x, y, w, h = f[:4]
            mx = [f[10], f[12]]  # mouth corners (right, left)
            my = [f[11], f[13]]
            mw = abs(mx[1] - mx[0]) or w * 0.4
            mbox = (min(mx) / W - mw * 0.25 / W, min(my) / H - mw * 0.35 / H, mw * 1.5 / W, mw * 0.8 / H)
            aligned = recognizer.alignCrop(frame, f) if w >= 32 else None
            ds.append(Det(max(0, x / W), max(0, y / H), w / W, h / H, float(f[14]), mbox, aligned))
        dets.append(ds)
        hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        hists.append(cv2.normalize(hist, hist).flatten())
        grays.append(cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY))
        if args.debug and i % max(1, round(args.fps)) == 0:
            debug_frames[i] = frame.copy()
    if not times:
        json.dump([{"t": round(args.start, 3), "layout": "fit"}], sys.stdout)
        return
    N = len(times)
    dt = 1.0 / args.fps
    span = max(dt, times[-1] - times[0] + dt)

    # ---- 2. Scene cuts: big jump in the color histogram between consecutive samples.
    cuts = [i for i in range(1, N) if cv2.compareHist(hists[i - 1], hists[i], cv2.HISTCMP_CORREL) < 0.6]

    # Drop faces printed on someone's clothes: smaller and right below a bigger face (on the torso).
    # Checked against neighbouring samples too, since the big face is not detected on every frame.
    # A print is about the wearer's face size; a game close-up above a facecam is ~3× bigger.
    def on_torso(d: Det, o: Det) -> bool:
        return (0.4 * o.h <= d.h < o.h / 1.2 and o.y + o.h * 0.8 < d.cy < o.y + o.h * 3
                and abs(d.cx - o.cx) < o.w * 1.2)

    r = round(0.4 * args.fps)
    dets = [
        [d for d in ds if not any(on_torso(d, o) for j in range(max(0, i - r), min(N, i + r + 1)) for o in dets[j])]
        for i, ds in enumerate(dets)
    ]

    # ---- 3. Tracks: greedy association on center distance (relative to face size) and size ratio,
    # tolerating gaps (blinks, head turns, missed detections). More forgiving than IoU when the
    # person leans or moves on their chair.
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
                size = max(p.w, d.w)
                ratio = d.h / p.h
                if not 0.65 < ratio < 1.55:
                    continue
                cost = math.hypot((d.cx - p.cx) * W, (d.cy - p.cy) * H) / (size * W)
                if cost < best_cost:
                    best, best_cost = k, cost
            if best is None:
                tracks.append(Track())
                best = len(tracks) - 1
            tr = tracks[best]
            tr.dets[i] = d
            tr.last = i
            used.add(best)

    # Stitch fragments of the same face (long occlusion, detector dropout): no time overlap,
    # gap ≤ 10 s, same place and size.
    tracks.sort(key=lambda tr: min(tr.dets))
    stitched: list[Track] = []
    for tr in tracks:
        first = min(tr.dets)
        target = None
        for prev in stitched:
            if prev.last >= first or first - prev.last > round(10 * args.fps):
                continue
            p, d = prev.dets[prev.last], tr.dets[first]
            if 0.6 < d.h / p.h < 1.6 and math.hypot((d.cx - p.cx) * W, (d.cy - p.cy) * H) < 0.6 * max(p.w, d.w) * W:
                target = prev
                break
        if target:
            target.dets.update(tr.dets)
            target.last = max(target.dets)
        else:
            stitched.append(tr)
    tracks = stitched

    # Mouth motion: pixel change in the mouth box between consecutive samples, normalized by size.
    for tr in tracks:
        for i, d in tr.dets.items():
            if i == 0 or (i - 1) not in tr.dets:
                continue
            g0, g1 = grays[i - 1], grays[i]
            gh, gw = g1.shape
            x0, y0 = int(d.mouth[0] * gw), int(d.mouth[1] * gh)
            x1, y1 = int((d.mouth[0] + d.mouth[2]) * gw) + 1, int((d.mouth[1] + d.mouth[3]) * gh) + 1
            a, b = g0[max(0, y0):y1, max(0, x0):x1], g1[max(0, y0):y1, max(0, x0):x1]
            if a.size and a.shape == b.shape:
                tr.motion[i] = float(np.mean(cv2.absdiff(a, b)))

    # ---- 4. Anchors = the creator / guests, not faces inside the content (game cutscenes, B-roll):
    # a face that stays put while the content behind it cuts is an overlay or the real camera;
    # one that stays on screen for most of the clip is too. Both must be fairly static.
    def is_anchor(tr: Track) -> bool:
        idx = sorted(tr.dets)
        dur = len(idx) * dt
        cxs = [d.cx for d in tr.dets.values()]
        cys = [d.cy for d in tr.dets.values()]
        # A big close-up face moves more in frame units; scale the tolerance with its size.
        tol = max(0.1, 0.8 * float(np.median([d.w for d in tr.dets.values()])))
        if float(np.std(cxs)) > tol or float(np.std(cys)) > tol:
            return False
        survives_cut = any(idx[0] < c <= idx[-1] for c in cuts)
        return (dur >= 3.0 and survives_cut) or dur >= max(3.0, 0.35 * span)

    def is_facecam(tr: Track) -> bool:
        x, y, w, h = tr.median_box()
        cx = x + w / 2
        return h < 0.22 and (cx < 0.3 or cx > 0.7)  # small face near a side → webcam overlay

    anchors = [tr for tr in tracks if is_anchor(tr)]
    # With a facecam, the creator is the webcam person: a big face only counts when it is them
    # (the streamer switching to a full-screen cam), never a game/B-roll character.
    creators = [e for e in (tr.embedding(recognizer) for tr in anchors if is_facecam(tr)) if e is not None]
    if creators:
        def is_creator(tr: Track) -> bool:
            e = tr.embedding(recognizer)
            return e is not None and max(float(e @ c) for c in creators) >= 0.363  # SFace cosine threshold
        if args.debug:
            for tr in anchors:
                e = tr.embedding(recognizer)
                sim = max(float(e @ c) for c in creators) if e is not None else None
                print(f"anchor {times[min(tr.dets)]:.1f}-{times[tr.last]:.1f}s box={tuple(round(v, 2) for v in tr.median_box())} "
                      f"facecam={is_facecam(tr)} sim={sim}", file=sys.stderr)
        anchors = [tr for tr in anchors if is_facecam(tr) or is_creator(tr)]

    def speaking(i: int) -> bool:
        t = times[i]
        return any(a - 0.2 <= t <= b + 0.2 for a, b in speech) if speech else True

    # ---- 5. Per-sample layout candidate.
    labels: list[tuple[str, int]] = []  # (layout, anchor index or -1)
    def near(tr: Track, i: int, sec: float) -> bool:
        r = round(sec * args.fps)
        return any(j in tr.dets for j in range(max(0, i - r), min(N, i + r + 1)))

    for i in range(N):
        # Facecams flicker (head turns, hand in front): tolerate longer dropouts than real faces.
        cams = [k for k, tr in enumerate(anchors) if is_facecam(tr) and near(tr, i, 1.0)]
        # While the webcam overlay is up, any big face beside it is part of the content.
        real = [] if cams else [k for k, tr in enumerate(anchors) if not is_facecam(tr) and near(tr, i, 0.4)]
        if cams:
            labels.append(("split", max(cams, key=lambda k: len(anchors[k].dets))))
        elif real:
            if len(real) > 1 and speaking(i):
                # Active speaker: most mouth motion over ±1 s.
                win = range(max(0, i - round(args.fps)), min(N, i + round(args.fps) + 1))
                k = max(real, key=lambda k: sum(anchors[k].motion.get(j, 0.0) for j in win))
            else:
                k = max(real, key=lambda k: anchors[k].dets.get(i, anchors[k].dets[anchors[k].last]).w)
            labels.append(("crop", k))
        else:
            labels.append(("fit", -1))

    if args.debug:
        step_s = max(1, round(args.fps))
        print("labels/s: " + " ".join(f"{times[i]:.0f}:{labels[i][0][0]}{labels[i][1]}" for i in range(0, N, step_s)), file=sys.stderr)
        for k, tr in enumerate(anchors):
            print(f"A{k} {times[min(tr.dets)]:.1f}-{times[tr.last]:.1f}s n={len(tr.dets)} box={tuple(round(v, 2) for v in tr.median_box())} cam={is_facecam(tr)}", file=sys.stderr)

    # ---- 6. Segments: majority-smooth, snap boundaries to scene cuts, then merge runs shorter
    # than MIN_SHOT into their longer neighbour.
    win = max(1, round(0.5 * args.fps))
    smooth = []
    for i in range(N):
        votes: dict[tuple[str, int], int] = {}
        for j in range(max(0, i - win), min(N, i + win + 1)):
            votes[labels[j]] = votes.get(labels[j], 0) + 1
        smooth.append(max(votes, key=lambda v: (votes[v], v == labels[i])))
    runs: list[list] = []  # [start_idx, end_idx_exclusive, label]
    for i, lab in enumerate(smooth):
        if runs and runs[-1][2] == lab:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1, lab])
    snap = round(CUT_SNAP * args.fps)
    for r in range(1, len(runs)):
        b = runs[r][0]
        close = [c for c in cuts if abs(c - b) <= snap]
        if close:
            c = min(close, key=lambda c: abs(c - b))
            if runs[r - 1][0] < c < runs[r][1]:
                runs[r - 1][1] = c
                runs[r][0] = c
    # With a facecam, only switch to a big-face crop when the full-screen cam really lasts:
    # brief ones are usually a lookalike in the content while the webcam flickers.
    def min_len(lab: tuple[str, int]) -> int:
        return round((2.5 if creators and lab[0] == "crop" else MIN_SHOT) * args.fps)

    while len(runs) > 1:
        short = [r for r in range(len(runs)) if runs[r][1] - runs[r][0] < min_len(runs[r][2])]
        if not short:
            break
        r = min(short, key=lambda r: runs[r][1] - runs[r][0])
        neighbours = [n for n in (r - 1, r + 1) if 0 <= n < len(runs)]
        into = max(neighbours, key=lambda n: runs[n][1] - runs[n][0])
        runs[into][0] = min(runs[into][0], runs[r][0])
        runs[into][1] = max(runs[into][1], runs[r][1])
        del runs[r]
        merged = [runs[0]]
        for rr in runs[1:]:
            if rr[2] == merged[-1][2]:
                merged[-1][1] = rr[1]
            else:
                merged.append(rr)
        runs = merged

    # ---- 7. Shot geometry.
    src_aspect = W / H

    def clamp_rect(cx: float, cy: float, w: float, h: float) -> dict:
        w, h = min(w, 1.0), min(h, 1.0)
        x = min(max(cx - w / 2, 0.0), 1.0 - w)
        y = min(max(cy - h / 2, 0.0), 1.0 - h)
        return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)}

    def motion_center_x(a: int, b: int, avoid: dict | None) -> float:
        prof = np.zeros(grays[0].shape[1])
        for i in range(max(1, a), b):
            diff = cv2.absdiff(grays[i - 1], grays[i]).astype(np.float32)
            if avoid:
                gh, gw = diff.shape
                diff[int(avoid["y"] * gh):int((avoid["y"] + avoid["h"]) * gh) + 1,
                     int(avoid["x"] * gw):int((avoid["x"] + avoid["w"]) * gw) + 1] = 0
            prof += diff.sum(axis=0)
        if prof.sum() <= 0:
            return 0.5
        xs = (np.arange(len(prof)) + 0.5) / len(prof)
        return float(np.average(xs, weights=prof))

    def mean_luma(rect: dict, idx: list[int]) -> float:
        gh, gw = grays[0].shape
        y0, y1 = int(rect["y"] * gh), int((rect["y"] + rect["h"]) * gh) + 1
        x0, x1 = int(rect["x"] * gw), int((rect["x"] + rect["w"]) * gw) + 1
        return float(np.mean([grays[i][y0:y1, x0:x1].mean() for i in idx]))

    def crop_shot(k: int, idx: list[int], t0: float) -> dict:
        tr = anchors[k]
        pts = [(times[i], tr.dets[i]) for i in idx if i in tr.dets] or [(times[idx[0]], tr.dets[tr.last])]
        fh = float(np.median([d.h for _, d in pts]))
        # Zoom in when the face is small (keeps face ≈ 1/4 of frame height), capped.
        zoom = round(min(2.2, max(1.0, 0.25 / max(fh, 1e-3))), 3)
        fy = float(np.median([d.cy for _, d in pts]))
        y = round(min(max(fy + 0.12 / zoom, 0.0), 1.0), 4)  # face in the upper third
        fx = float(np.median([d.cx for _, d in pts[: max(1, len(pts) // 4)]]))
        kfs = [{"t": t0, "x": round(fx, 4), "y": y, "zoom": zoom}]
        for ts, d in pts:
            if abs(d.cx - fx) > DEAD_ZONE / zoom:
                fx = d.cx
                # Hold, then a short pan (0.6 s) to the new position.
                kfs.append({**kfs[-1], "t": round(max(kfs[-1]["t"], ts - 0.6), 3)})
                kfs.append({"t": round(ts, 3), "x": round(fx, 4), "y": y, "zoom": zoom})
        return {"t": t0, "layout": "crop", "keyframes": kfs}

    shots = []
    for a, b, (layout, k) in runs:
        t0 = round(args.start if not shots else times[a], 3)
        idx = list(range(a, b))
        if layout == "split":
            x, y, w, h = anchors[k].median_box(idx)
            cam_aspect = OUT_W / (OUT_H * SPLIT_RATIO)  # output slot aspect
            ch = min(1.0, h * 2.4)
            cw = ch * cam_aspect / src_aspect
            cam = clamp_rect(x + w / 2, y + h / 2 + h * 0.15, cw, ch)
            content_aspect = OUT_W / (OUT_H * (1 - SPLIT_RATIO))
            cth = 1.0
            ctw = cth * content_aspect / src_aspect
            mx = motion_center_x(a, b, cam)
            # Keep the content window off the facecam when the frame allows it.
            if cam["x"] + cam["w"] / 2 < 0.5:
                mx = max(mx, min(0.64, cam["x"] + cam["w"] + ctw / 2 - 0.02))
            else:
                mx = min(mx, max(0.36, cam["x"] - ctw / 2 + 0.02))
            content = clamp_rect(mx, 0.5, ctw, cth)
            if mean_luma(content, idx) < 18:
                # Black / empty content (transition, loading screen): just show the creator.
                shots.append(crop_shot(k, idx, t0))
            else:
                shots.append({"t": t0, "layout": "split", "cam": cam, "content": content, "ratio": SPLIT_RATIO})
        elif layout == "crop":
            shots.append(crop_shot(k, idx, t0))
        else:
            shots.append({"t": t0, "layout": "fit"})

    if args.debug:
        write_debug(args.debug, debug_frames, times, dets, anchors, shots, W, H)
    json.dump(shots, sys.stdout)


def write_debug(out_dir, frames, times, dets, anchors, shots, W, H) -> None:
    os.makedirs(out_dir, exist_ok=True)
    for i, frame in frames.items():
        t = times[i]
        shot = [s for s in shots if s["t"] <= t + 1e-6][-1] if shots else None
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
            cv2.putText(img, f"{t:.1f}s {shot['layout']}", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imwrite(os.path.join(out_dir, f"{t:08.2f}.jpg"), img)


if __name__ == "__main__":
    main()
