# Swingweight

Measures a tennis racket's swingweight in the browser using the compound-pendulum
method. The racket hangs from a pivot and swings freely; a camera under the butt
cap tracks the swing, the app fits the period, and combines it with the racket's
mass, balance point and pivot distance.

No build step, no dependencies, everything runs client-side.

## Run

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. Camera access requires `localhost` or HTTPS — to use a
phone as the camera, serve the folder from any static HTTPS host.

## Measure

1. Hang the racket so it swings perpendicular to the string bed (toward/away from
   the support), and keep swings small (a few degrees).
2. Measure, in cm from the butt end: the **balance point** and the **pivot** (the
   line where the frame rests on the support). Weigh the racket in grams.
3. **Live camera**: lay the phone face-up under the butt cap, press *Start camera*,
   let it swing. It beeps/vibrates when the period locks (≈10 swings).
   **Video file**: record the same shot, choose the file (or *Load sample*), press
   *Analyze*. Keep the tab visible while it plays through.
4. Enter mass, balance and pivot. Swingweight is reported about the axis 10 cm
   from the butt, in kg·cm².

The first and last moments (release and catch) are detected and ignored
automatically. Drag on the video to restrict tracking to a region if something
else dark moves in the frame.

Accuracy note: when hung from the head, swingweight changes ≈7–8 units per cm of
pivot error and ≈20 units per cm of balance error — measure those carefully.

## Physics

L = g·T² / 4π², d = |pivot − balance|, I_cm = m·d·(L − d),
SW = I_cm + m·(balance − 10)².

## Tests

```bash
npm test
```

`tests/regression.test.js` checks the full pipeline on `assets/IMG_7825.MOV`;
generate its fixture first with `scripts/make-fixture.sh` (needs ffmpeg).
