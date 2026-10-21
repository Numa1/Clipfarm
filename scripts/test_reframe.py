"""Unit tests for the pure parts of scripts/reframe.py. Run: pnpm test:py"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(__file__))
import reframe as rf  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REFRAME = os.path.join(HERE, "reframe.py")


def det(x, y, w, h, mouth=None):
    return rf.Det(x, y, w, h, score=0.9, mouth=mouth)


def test_clip_box_intersects_with_frame():
    assert rf.clip_box(-20, 10, 100, 50, 1000, 500) == (0.0, 0.02, 0.08, 0.1)
    x, y, w, h = rf.clip_box(950, 480, 100, 100, 1000, 500)
    assert x + w <= 1 and y + h <= 1 and math.isclose(w, 0.05)
    assert rf.clip_box(1200, 10, 50, 50, 1000, 500) is None


def test_scene_score_matches_ffmpeg_formula():
    assert rf.scene_score(40, 2) == 0.38  # min(40, |40-2|) / 100
    assert rf.scene_score(40, 40) == 0  # steady motion is not a cut
    assert rf.scene_score(500, 0) == 1


def test_pick_cuts_keeps_one_cut_per_window():
    frames = [(1.0, 0.1), (2.0, 0.5), (2.1, 0.6), (2.5, 0.4), (4.0, 0.29), (5.0, 0.31)]
    assert rf.pick_cuts(frames) == [2.0, 2.5, 5.0]


def test_segment_never_straddles_a_cut_and_absorbs_flicker():
    times = [i * 0.2 for i in range(30)]  # 6 s, cut at 3.0 s (index 15)
    scene_of = [0 if t < 3.0 - 1e-6 else 1 for t in times]
    labels = [("split", 0)] * 15 + [("crop", 1)] * 15
    labels[5] = ("fit", -1)  # 0.2 s detector flicker inside the first scene
    runs = rf.segment(times, labels, scene_of, 6.0, lambda lab: rf.HOLD)
    assert [(r[0], r[2]) for r in runs] == [(0, ("split", 0)), (15, ("crop", 1))]


def test_segment_keeps_a_short_scene_and_merges_equal_neighbours():
    times = [i * 0.2 for i in range(20)]
    # Scenes: [0, 1.6) [1.6, 2.0) [2.0, 4.0) — the middle one is a 0.4 s flash.
    scene_of = [0 if t < 1.6 - 1e-6 else 1 if t < 2.0 - 1e-6 else 2 for t in times]
    labels = [("split", 0) if s != 1 else ("fit", -1) for s in scene_of]
    runs = rf.segment(times, labels, scene_of, 4.0, lambda lab: rf.HOLD)
    assert [r[2][0] for r in runs] == ["split", "fit", "split"]  # a whole scene is never absorbed
    labels = [("split", 0)] * 20
    assert len(rf.segment(times, labels, scene_of, 4.0, lambda lab: rf.HOLD)) == 1  # merged across cuts


def test_pan_keyframes_hold_then_pan():
    pts = [(0.0, 0.5), (1.0, 0.52), (2.0, 0.49), (3.0, 0.8), (4.0, 0.81)]
    kfs = rf.pan_keyframes(pts, dead_zone=0.1, lo=0.2, hi=0.75)
    assert [round(k["x"], 2) for k in kfs] == [0.5, 0.5, 0.75]  # clamped to hi
    assert kfs[1]["t"] == 2.4 and kfs[2]["t"] == 3.0


def test_remove_attached_drops_a_print_but_keeps_a_person():
    face = rf.Track()
    shirt = rf.Track()
    neighbour = rf.Track()
    for i in range(10):
        wobble = 0.01 * math.sin(i)
        face.dets[i] = det(0.10 + wobble, 0.60, 0.07, 0.16)
        shirt.dets[i] = det(0.07 + wobble, 0.78, 0.07, 0.14)  # rigidly below the face
        neighbour.dets[i] = det(0.14 + 0.03 * math.cos(i * 1.7), 0.80 + 0.02 * math.sin(i * 2.3), 0.07, 0.14)
        face.activity[i] = shirt.activity[i] = 0.4
        neighbour.activity[i] = 0.4
    kept = rf.remove_attached([face, shirt, neighbour])
    assert face in kept and neighbour in kept and shirt not in kept


def test_remove_attached_keeps_a_talking_person_below():
    top, below = rf.Track(), rf.Track()
    for i in range(10):
        top.dets[i] = det(0.40, 0.20, 0.10, 0.20)
        below.dets[i] = det(0.40, 0.45, 0.10, 0.20)
        top.activity[i], below.activity[i] = 0.1, 0.6  # only the lower one talks
    assert len(rf.remove_attached([top, below])) == 2


def test_overlay_box_from_cut_differences():
    rng = np.random.default_rng(0)
    pairs = []
    for _ in range(3):
        a = rng.integers(0, 255, (180, 320)).astype(np.uint8)
        b = rng.integers(0, 255, (180, 320)).astype(np.uint8)
        cam = rng.integers(0, 255, (60, 80)).astype(np.uint8)
        a[110:170, 10:90] = cam  # webcam rectangle: same pixels on both sides of the cut
        b[110:170, 10:90] = cam
        pairs.append((a, b))
    box = rf.overlay_box((40 / 320, 125 / 180, 20 / 320, 25 / 180), pairs)
    assert box is not None
    assert abs(box["x"] - 10 / 320) < 0.01 and abs(box["x"] + box["w"] - 90 / 320) < 0.01
    assert abs(box["y"] - 110 / 180) < 0.02 and abs(box["y"] + box["h"] - 170 / 180) < 0.02
    assert rf.overlay_box((0.1, 0.7, 0.05, 0.1), pairs[:1]) is None  # one cut is not enough evidence


def test_two_shot_fits_only_when_both_are_inside_a_9_16_window():
    aspect = 16 / 9
    assert math.isclose(rf.crop_window_w(aspect), 0.316, abs_tol=1e-3)
    assert rf.fits_two_shot(det(0.40, 0.3, 0.08, 0.2), det(0.55, 0.3, 0.08, 0.2), aspect)
    assert not rf.fits_two_shot(det(0.10, 0.3, 0.08, 0.2), det(0.75, 0.3, 0.08, 0.2), aspect)


@pytest.fixture(scope="module")
def panning_video():
    """A synthetic clip: a white square sweeping left-to-right over a black background (like the
    ball/action moving across a football clip, with no face anywhere)."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    tmp = tempfile.mkdtemp(prefix="clipfarm-reframe-follow-test-")
    video = os.path.join(tmp, "pan.mp4")
    duration, w, h, travel = 4.0, 320, 240, 280
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "lavfi", "-i", f"color=c=black:s={w}x{h}:d={duration}:r=10",
         "-f", "lavfi", "-i", f"color=c=white:s=40x40:d={duration}:r=10",
         "-filter_complex", f"[0][1]overlay=x='{travel}*t/{duration}':y=100",
         "-pix_fmt", "yuv420p", video],
        check=True,
    )
    yield video, duration, w, travel
    shutil.rmtree(tmp, ignore_errors=True)


def test_follow_mode_tracks_horizontal_motion_without_face_detection(panning_video):
    video, duration, w, travel = panning_video
    out = subprocess.run(
        ["uv", "run", "--quiet", REFRAME, video, "0", str(duration), "--mode", "follow", "--fps", "5"],
        check=True, capture_output=True, text=True,
    ).stdout
    shots = json.loads(out)
    assert len(shots) == 1 and shots[0]["layout"] == "crop"
    kfs = shots[0]["keyframes"]
    assert len(kfs) >= 2  # the sweep is tracked, not held static

    # The box center moves from 20/320 to (20+travel)/320, linearly in t. The produced x should
    # follow the same trend: strongly (positively) correlated with the expected position.
    expected_x = lambda t: (20 + travel * t / duration) / w  # noqa: E731
    produced = np.interp([k["t"] for k in kfs], [k["t"] for k in kfs], [k["x"] for k in kfs])
    expected = np.array([expected_x(t) for t in [k["t"] for k in kfs]])
    corr = np.corrcoef(produced, expected)[0, 1]
    assert corr > 0.9
    assert kfs[-1]["x"] > kfs[0]["x"]  # net motion is to the right, matching the sweep


def test_sanitize_clamps_into_schema_ranges_and_rejects_nan():
    shots = rf.sanitize([
        {"t": -0.1, "layout": "crop", "keyframes": [{"t": 0, "x": 1.07, "y": -0.2, "zoom": 0.5}]},
        {"t": 2, "layout": "split", "cam": {"x": 0.9, "y": 0.6, "w": 0.3, "h": 0.5}, "content": {"x": 0.2, "y": 0, "w": 0.5, "h": 1},
         "ratio": 0.9, "pan": []},
    ])
    kf = shots[0]["keyframes"][0]
    assert shots[0]["t"] == 0 and kf["x"] == 1 and kf["y"] == 0 and kf["zoom"] == 1
    cam = shots[1]["cam"]
    assert cam["x"] + cam["w"] <= 1 and cam["y"] + cam["h"] <= 1 + 1e-9
    assert shots[1]["ratio"] == 0.7 and "pan" not in shots[1]
    json.dumps(shots, allow_nan=False)
