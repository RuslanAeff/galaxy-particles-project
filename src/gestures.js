export const GESTURE_SHAPES = Object.freeze({
  thumb: 'galaxy',
  fist: 'torus',
  peace: 'dna',
  point: 'vortex',
  rock: 'blackhole',
  ok: 'atom',
  open: 'nebula',
});

export const GESTURE_LABELS = Object.freeze({
  thumb: 'Başparmak',
  fist: 'Yumruk',
  peace: 'Zafer işareti',
  point: 'İşaret parmağı',
  rock: 'Rock işareti',
  ok: 'Tamam işareti',
  open: 'Açık el',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const difference = (a, b) => [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
const length = (v) => Math.hypot(...v);
const distance = (a, b) => length(difference(a, b));

function alignment(a, b) {
  const denominator = length(a) * length(b);
  if (denominator < 1e-12) return -1;
  return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / denominator;
}

export function validLandmarks(points) {
  if (!Array.isArray(points) || points.length !== 21) return false;
  for (let index = 0; index < 21; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || (point.z !== undefined && !Number.isFinite(point.z))) return false;
  }
  return true;
}

function fingerState(points, base) {
  const [mcp, pip, dip, tip] = points.slice(base, base + 4);
  const straightness = alignment(difference(pip, mcp), difference(tip, pip));
  const distalStraightness = alignment(difference(dip, pip), difference(tip, dip));
  const tipReach = distance(tip, points[0]);
  const jointReach = distance(pip, points[0]);
  const extended = straightness > 0.72 && distalStraightness > 0.5
    && tipReach > jointReach * 1.08
    && distance(tip, mcp) > distance(pip, mcp) * 1.55;
  const curled = !extended && (straightness < 0.45 || tipReach < jointReach * 1.04);
  return { extended, curled };
}

/** Geometry is relative to the palm, so hand size, handedness and rotation do not select a different gesture. */
export function classifyGesture(landmarks, worldLandmarks) {
  if (!validLandmarks(landmarks)) return null;
  const points = validLandmarks(worldLandmarks) ? worldLandmarks : landmarks;
  const palmSize = (distance(points[0], points[9]) + distance(points[5], points[17])) / 2;
  if (palmSize < 1e-5) return null;

  const [index, middle, ring, pinky] = [5, 9, 13, 17].map((base) => fingerState(points, base));
  const pinched = distance(points[4], points[8]) < palmSize * 0.24;

  // Test the fingertip circle before the other poses; an OK sign can have a nearly straight index finger.
  if (pinched && middle.extended && ring.extended && pinky.extended) return 'ok';
  if (index.extended && middle.extended && ring.extended && pinky.extended) return 'open';
  if (index.extended && middle.extended && ring.curled && pinky.curled) return 'peace';
  if (index.extended && middle.curled && ring.curled && pinky.extended) return 'rock';
  if (index.extended && middle.curled && ring.curled && pinky.curled) return 'point';

  if (index.curled && middle.curled && ring.curled && pinky.curled) {
    const thumbStraight = alignment(difference(points[3], points[2]), difference(points[4], points[3])) > 0.65;
    const thumbExtended = thumbStraight
      && distance(points[4], points[2]) > palmSize * 0.4
      && distance(points[4], points[5]) > palmSize * 0.58
      && distance(points[4], points[17]) > distance(points[2], points[17]) * 1.08;
    return thumbExtended ? 'thumb' : 'fist';
  }
  return null;
}

/** Normalize camera motion for the mirrored preview and the renderer's upward-positive Y axis. */
export function getHandPose(points, aspect = 1) {
  if (!validLandmarks(points)) return null;
  const palm = [0, 5, 9, 13, 17];
  const centerX = palm.reduce((sum, index) => sum + points[index].x, 0) / palm.length;
  const centerY = palm.reduce((sum, index) => sum + points[index].y, 0) / palm.length;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const dx = (points[9].x - points[0].x) * safeAspect;
  const dy = points[9].y - points[0].y;
  const palmLength = Math.hypot(dx, dy);
  if (palmLength < 1e-5 || !Number.isFinite(palmLength)
      || !Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
  return {
    x: clamp(1 - centerX * 2, -1, 1),
    y: clamp(1 - centerY * 2, -1, 1),
    roll: Math.atan2(dx, -dy),
    scale: clamp(0.65 + palmLength * 1.8, 0.8, 1.2),
  };
}

/** Require elapsed time, rather than a frame count, so slow cameras behave consistently. */
export class GestureStabilizer {
  constructor({ holdMs = 240, releaseMs = 180 } = {}) {
    this.holdMs = holdMs;
    this.releaseMs = releaseMs;
    this.reset();
  }

  reset() {
    this.stable = null;
    this.candidate = null;
    this.since = 0;
    this.lastTime = -Infinity;
  }

  update(gesture, now) {
    if (!Number.isFinite(now)) {
      this.reset();
      return null;
    }
    if (now < this.lastTime) this.reset();
    this.lastTime = now;
    const next = typeof gesture === 'string' && Object.hasOwn(GESTURE_SHAPES, gesture) ? gesture : null;
    if (next !== this.candidate) {
      this.candidate = next;
      this.since = now;
    }
    const delay = next === null ? this.releaseMs : this.holdMs;
    if (now - this.since >= delay) this.stable = next;
    return this.stable;
  }
}
