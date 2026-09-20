export function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

// Capture the displayed blend only when a new shape is selected.
// The regular frame loop never writes particle buffers.
export function captureBlend(source, target, progress) {
  const t = smoothstep(progress);
  for (let i = 0; i < source.length; i++) {
    source[i] += (target[i] - source[i]) * t;
  }
  return source;
}

export function damping(rate, seconds) {
  return 1 - Math.exp(-rate * Math.max(0, seconds));
}

export function nearestAngle(current, target) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}
