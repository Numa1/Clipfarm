"""Tests for scripts/probe.py. Run: uv run --quiet --with pytest --with 'opencv-python-headless>=4.9,<5'
--with 'numpy>=1.26' pytest -q scripts/test_probe.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(__file__))
import probe as pb  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "probe.py")


def test_green_share_on_pure_green_and_pure_red():
    green = np.zeros((20, 20, 3), dtype=np.uint8)
    green[:, :, 1] = 180  # pure green in BGR
    assert pb.green_share(green) > 0.95

    red = np.zeros((20, 20, 3), dtype=np.uint8)
    red[:, :, 2] = 200  # pure red in BGR
    assert pb.green_share(red) == 0.0


def test_pick_keyframe_times_regularly_spaced():
    times = pb.pick_keyframe_times(0.0, 8.0, 4)
    assert times == [1.0, 3.0, 5.0, 7.0]
    assert pb.pick_keyframe_times(2.0, 2.0, 4) == [2.0, 2.0, 2.0, 2.0]


def test_encode_jpeg_b64_roundtrips_to_a_decodable_image():
    import base64

    import cv2

    img = np.full((10, 10, 3), 128, dtype=np.uint8)
    b64 = pb.encode_jpeg_b64(img)
    decoded = cv2.imdecode(np.frombuffer(base64.b64decode(b64), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == img.shape


def test_has_face_is_false_on_a_blank_frame():
    import cv2

    gray = np.zeros((200, 200), dtype=np.uint8)
    detector = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))
    assert pb.has_face(gray, detector) is False


@pytest.fixture(scope="module")
def generated_video():
    """A short synthetic clip: a plain color changing every second (scene cuts), no faces, no green."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    tmp = tempfile.mkdtemp(prefix="clipfarm-probe-test-")
    video = os.path.join(tmp, "test.mp4")
    # 4 one-second segments of flat, sharply different colors concatenated: 4 scene cuts.
    filter_complex = (
        "color=c=red:s=320x240:d=1[a];"
        "color=c=blue:s=320x240:d=1[b];"
        "color=c=white:s=320x240:d=1[c];"
        "color=c=black:s=320x240:d=1[d];"
        "[a][b][c][d]concat=n=4:v=1:a=0[outv]"
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-filter_complex", filter_complex, "-map", "[outv]",
         "-r", "30", "-pix_fmt", "yuv420p", video],
        check=True,
    )
    yield video
    shutil.rmtree(tmp, ignore_errors=True)


def test_probe_on_generated_video_detects_cuts_and_no_face_no_green(generated_video):
    out = subprocess.run(
        [sys.executable, PROBE, generated_video], check=True, capture_output=True, text=True,
    ).stdout
    result = json.loads(out)
    assert set(result) == {"sceneCutRate", "sceneCuts", "hasFace", "faceScore", "greenShare", "keyframes"}
    assert result["sceneCuts"] >= 2  # at least some of the 3 hard color cuts are picked up
    assert result["hasFace"] is False
    assert result["faceScore"] == 0.0
    assert result["greenShare"] < 0.05  # no grass-colored pixels in red/blue/white/black
    assert len(result["keyframes"]) == 4
    for kf in result["keyframes"]:
        assert 0.0 <= kf["t"] <= 4.0
        assert len(kf["jpeg_b64"]) > 0


def test_probe_respects_a_time_range(generated_video):
    out = subprocess.run(
        [sys.executable, PROBE, generated_video, "0", "1", "--keyframes", "2"],
        check=True, capture_output=True, text=True,
    ).stdout
    result = json.loads(out)
    assert len(result["keyframes"]) == 2
    assert all(kf["t"] <= 1.1 for kf in result["keyframes"])


def test_probe_out_dir_saves_jpeg_files(generated_video):
    out_dir = tempfile.mkdtemp(prefix="clipfarm-probe-kf-")
    try:
        out = subprocess.run(
            [sys.executable, PROBE, generated_video, "--keyframes", "2", "--out-dir", out_dir],
            check=True, capture_output=True, text=True,
        ).stdout
        result = json.loads(out)
        for kf in result["keyframes"]:
            assert "jpeg_b64" not in kf
            assert os.path.isfile(kf["path"])
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)
