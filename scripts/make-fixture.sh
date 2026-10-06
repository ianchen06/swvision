#!/usr/bin/env bash
# Extracts 108x192 grayscale frames + timestamps from the sample video for
# tests/regression.test.js. Requires ffmpeg/ffprobe.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=${1:-assets/IMG_7825.MOV}
OUT=tests/fixtures
mkdir -p "$OUT"
ffmpeg -v error -y -i "$SRC" -fps_mode passthrough -vf "scale=108:192,format=gray" -f rawvideo "$OUT/img7825_gray.bin"
ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 "$SRC" | cut -d, -f1 > "$OUT/img7825_pts.txt"
echo "frames: $(wc -l < "$OUT/img7825_pts.txt")  bytes: $(wc -c < "$OUT/img7825_gray.bin")"
