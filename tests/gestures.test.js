import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyGesture, GestureStabilizer, GESTURE_SHAPES, getHandPose } from '../src/gestures.js';
import { HandTracker } from '../src/hand-tracker.js';

// Synthetic anatomical poses let us check invariants independently of a camera or model download.
function hand(gesture) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  const fingers = {
    open: [true, true, true, true],
    fist: [false, false, false, false],
    thumb: [false, false, false, false],
    peace: [true, true, false, false],
    point: [true, false, false, false],
    rock: [true, false, false, true],
    ok: [false, true, true, true],
    unknown: [true, false, true, true],
  }[gesture];
  points[1] = { x: 0.42, y: 0.66, z: 0 };
  points[2] = { x: 0.34, y: 0.60, z: 0 };
  points[3] = gesture === 'thumb' ? { x: 0.28, y: 0.49, z: 0 } : { x: 0.42, y: 0.57, z: 0 };
  points[4] = gesture === 'thumb' ? { x: 0.22, y: 0.40, z: 0 } : { x: 0.51, y: 0.58, z: 0 };
  const bases = [[0.39, 0.50], [0.49, 0.47], [0.58, 0.49], [0.67, 0.53]];
  bases.forEach(([x, y], finger) => {
    const start = 5 + finger * 4;
    points[start] = { x, y, z: 0 };
    if (fingers[finger]) {
      points[start + 1] = { x, y: y - 0.10, z: 0 };
      points[start + 2] = { x, y: y - 0.17, z: 0 };
      points[start + 3] = { x, y: y - 0.23, z: 0 };
    } else {
      points[start + 1] = { x, y: y - 0.075, z: 0.008 };
      points[start + 2] = { x, y: y - 0.045, z: -0.045 };
      points[start + 3] = { x, y: y + 0.035, z: -0.075 };
    }
  });
  if (gesture === 'ok') points[4] = { ...points[8], x: points[8].x + 0.008 };
  return points;
}

function transform(points, angle, scale, mirror = 1) {
  return points.map(({ x, y, z }) => ({
    x: 0.3 + scale * (Math.cos(angle) * x - Math.sin(angle) * y) * mirror,
    y: -0.2 + scale * (Math.sin(angle) * x + Math.cos(angle) * y),
    z: z * scale,
  }));
}

test('all seven poses select their intended shapes at multiple rotations, sizes and handedness', () => {
  const expected = { thumb: 'galaxy', fist: 'torus', peace: 'dna', point: 'vortex', rock: 'blackhole', ok: 'atom', open: 'nebula' };
  for (const [gesture, shape] of Object.entries(expected)) {
    for (const angle of [0, 0.7, Math.PI / 2, Math.PI, -2.5]) {
      for (const scale of [0.25, 1, 3]) {
        for (const mirror of [1, -1]) {
          const actual = classifyGesture(transform(hand(gesture), angle, scale, mirror));
          assert.equal(actual, gesture, `${gesture}: angle=${angle}, scale=${scale}, mirror=${mirror}`);
          assert.equal(GESTURE_SHAPES[actual], shape);
        }
      }
    }
  }
});

test('a pose outside the gesture vocabulary does not trigger an unrelated shape', () => {
  assert.equal(classifyGesture(hand('unknown')), null);
});

test('world geometry can classify foreshortened image landmarks', () => {
  const distorted = hand('fist');
  assert.equal(classifyGesture(distorted, hand('peace')), 'peace');
  assert.equal(classifyGesture(hand('rock'), []), 'rock');
});

test('malformed and collapsed landmarks never produce gestures or non-finite poses', () => {
  const nonfinite = hand('open');
  nonfinite[8].x = NaN;
  const missingPoint = hand('open');
  missingPoint[7] = null;
  const collapsed = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const points of [undefined, null, [], new Array(21), hand('open').slice(0, 20), nonfinite, missingPoint, collapsed]) {
    assert.equal(classifyGesture(points), null);
    assert.equal(getHandPose(points), null);
  }
  const points2d = hand('open').map(({ x, y }) => ({ x, y }));
  assert.equal(classifyGesture(points2d), 'open');
});

test('camera pose mirrors X, keeps vertical motion upright and clamps movement and scale', () => {
  const points = hand('open');
  const original = getHandPose(points, 4 / 3);
  const shifted = getHandPose(points.map((p) => ({ ...p, x: p.x + 0.1, y: p.y - 0.1 })), 4 / 3);
  assert.ok(Math.abs(shifted.x - original.x + 0.2) < 1e-10);
  assert.ok(Math.abs(shifted.y - original.y - 0.2) < 1e-10);
  assert.equal(shifted.scale, original.scale);
  for (const amount of [0.01, 100]) {
    const pose = getHandPose(transform(points, 0.8, amount), NaN);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(pose.scale >= 0.8 && pose.scale <= 1.2);
    assert.ok(Math.abs(pose.x) <= 1 && Math.abs(pose.y) <= 1);
  }
});

test('new gestures need continuous elapsed time and one noisy frame cannot switch shapes', () => {
  const filter = new GestureStabilizer();
  assert.equal(filter.update('peace', 0), null);
  assert.equal(filter.update('peace', 239), null);
  assert.equal(filter.update('peace', 240), 'peace');
  assert.equal(filter.update('fist', 300), 'peace');
  assert.equal(filter.update('peace', 350), 'peace');
  assert.equal(filter.update('fist', 400), 'peace');
  assert.equal(filter.update('fist', 639), 'peace');
  assert.equal(filter.update('fist', 640), 'fist');
});

test('hysteresis depends on time rather than inference frame rate', () => {
  for (const times of [[0, 240], [0, 60, 120, 180, 240], [0, 16, 32, 64, 100, 150, 200, 240]]) {
    const filter = new GestureStabilizer();
    for (const now of times.slice(0, -1)) assert.equal(filter.update('thumb', now), null);
    assert.equal(filter.update('thumb', times.at(-1)), 'thumb');
  }
});

test('unknown poses release the previous gesture after a short grace period', () => {
  const filter = new GestureStabilizer();
  filter.update('rock', 0);
  assert.equal(filter.update('rock', 240), 'rock');
  assert.equal(filter.update(null, 300), 'rock');
  assert.equal(filter.update('invalid', 479), 'rock');
  assert.equal(filter.update(null, 480), null);
});

test('reset, invalid timestamps and backwards clocks cannot carry a stale gesture', () => {
  const filter = new GestureStabilizer();
  filter.update('open', 0);
  assert.equal(filter.update('open', 240), 'open');
  filter.reset();
  assert.equal(filter.update('fist', 1000), null);
  assert.equal(filter.update('fist', 1240), 'fist');
  assert.equal(filter.update('fist', NaN), null);
  filter.update('fist', 2000);
  assert.equal(filter.update('fist', 2240), 'fist');
  assert.equal(filter.update('fist', 100), null);
});

test('losing the hand immediately resets confirmation before reacquisition', () => {
  const results = [];
  const tracker = new HandTracker({ video: { videoWidth: 640, videoHeight: 480 }, onResult: (result) => results.push(result) });
  const detected = { landmarks: [hand('peace')] };
  tracker.processResult(detected, 0);
  tracker.processResult(detected, 240);
  assert.equal(results.at(-1).shape, 'dna');
  tracker.processResult({ landmarks: [] }, 300);
  assert.equal(results.at(-1), null);
  tracker.processResult(detected, 360);
  assert.equal(results.at(-1).shape, null);
  tracker.processResult(detected, 600);
  assert.equal(results.at(-1).shape, 'dna');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeStream() {
  const track = new EventTarget();
  track.stops = 0;
  track.stop = () => { track.stops += 1; };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

function environment(t, acquire) {
  const stream = fakeStream();
  const frames = new Map();
  let frameId = 0;
  let acquisitions = 0;
  let constraints;
  const globals = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: (options) => {
      acquisitions += 1;
      constraints = options;
      return acquire ? acquire(acquisitions) : Promise.resolve(stream);
    } } },
    document: { hidden: false },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const restore = [];
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  const video = Object.assign(new EventTarget(), {
    srcObject: null, videoWidth: 640, videoHeight: 480, readyState: 2, currentTime: 0,
    play: () => Promise.resolve(), pause: () => {},
  });
  const model = {
    closes: 0, inferences: 0,
    close() { this.closes += 1; },
    detectForVideo() { this.inferences += 1; return { landmarks: [] }; },
  };
  const statuses = [];
  const tracker = new HandTracker({ video, onStatus: (status) => statuses.push(status) });
  tracker.loadModel = () => Promise.resolve(model);
  t.after(() => {
    tracker.dispose();
    restore.forEach((reset) => reset());
  });
  return {
    tracker, video, stream, model, statuses, frames,
    get acquisitions() { return acquisitions; },
    get constraints() { return constraints; },
    frame(now) {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(now);
    },
  };
}

test('camera acquisition is explicit and repeated start calls share a single stream', async (t) => {
  const env = environment(t);
  assert.equal(env.acquisitions, 0);
  await Promise.all([env.tracker.start(), env.tracker.start()]);
  assert.equal(env.acquisitions, 1);
  assert.equal(env.constraints.audio, false);
  assert.equal(env.tracker.state, 'active');
  assert.equal(env.video.srcObject, env.stream);
  assert.equal(env.frames.size, 1);
  await env.tracker.start();
  assert.equal(env.acquisitions, 1);
  env.tracker.stop();
  assert.equal(env.stream.track.stops, 1);
  assert.equal(env.model.closes, 1);
  assert.equal(env.video.srcObject, null);
  assert.equal(env.frames.size, 0);
});

test('a stream granted after cancellation is stopped without reactivating the camera', async (t) => {
  const pending = deferred();
  const lateStream = fakeStream();
  const env = environment(t, () => pending.promise);
  const starting = env.tracker.start();
  env.tracker.stop();
  await starting;
  pending.resolve(lateStream);
  await flush();
  assert.equal(lateStream.track.stops, 1);
  assert.equal(env.tracker.state, 'off');
  assert.equal(env.video.srcObject, null);
  assert.equal(env.frames.size, 0);
});

test('a late model from a cancelled start cannot replace a newer active session', async (t) => {
  const oldStream = fakeStream();
  const newStream = fakeStream();
  const env = environment(t, (count) => Promise.resolve(count === 1 ? oldStream : newStream));
  const pending = deferred();
  const oldModel = { closes: 0, close() { this.closes += 1; } };
  let loads = 0;
  env.tracker.loadModel = () => ++loads === 1 ? pending.promise : Promise.resolve(env.model);
  const firstStart = env.tracker.start();
  await flush();
  assert.equal(loads, 1);
  env.tracker.stop();
  await env.tracker.start();
  await firstStart;
  pending.resolve(oldModel);
  await flush();
  assert.equal(oldModel.closes, 1);
  assert.equal(oldStream.track.stops, 1);
  assert.equal(newStream.track.stops, 0);
  assert.equal(env.video.srcObject, newStream);
  assert.equal(env.tracker.model, env.model);
  assert.equal(env.tracker.state, 'active');
  assert.equal(env.frames.size, 1);
});

test('actual model initialization has a deadline and releases the camera on timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = environment(t);
  const pending = deferred();
  env.tracker.loadModel = () => pending.promise;
  const starting = env.tracker.start();
  await flush();
  assert.equal(env.statuses.at(-1).message, 'El takibi modeli yükleniyor…');
  t.mock.timers.tick(30_001);
  await starting;
  assert.equal(env.tracker.state, 'error');
  assert.match(env.statuses.at(-1).message, /modeli yüklenemedi/);
  assert.equal(env.stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
  pending.resolve(env.model);
  await flush();
  assert.equal(env.model.closes, 1);
});

test('permission denial produces a retryable Turkish status without starting inference', async (t) => {
  const env = environment(t, () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')));
  await env.tracker.start();
  assert.equal(env.tracker.state, 'error');
  assert.match(env.statuses.at(-1).message, /Kamera izni verilmedi/);
  assert.equal(env.model.inferences, 0);
  assert.equal(env.frames.size, 0);
});

test('inference is throttled, skips duplicate frames and stops on a hidden document', async (t) => {
  const env = environment(t);
  await env.tracker.start();
  env.frame(0);
  assert.equal(env.model.inferences, 1);
  env.video.currentTime = 0.03;
  env.frame(30);
  assert.equal(env.model.inferences, 1);
  env.frame(60);
  assert.equal(env.model.inferences, 2);
  env.frame(120);
  assert.equal(env.model.inferences, 2);
  document.hidden = true;
  env.frame(180);
  assert.equal(env.tracker.state, 'off');
  assert.equal(env.stream.track.stops, 1);
  assert.equal(env.frames.size, 0);
});

test('device disconnection releases the model and dispose prevents future acquisition', async (t) => {
  const env = environment(t);
  await env.tracker.start();
  env.stream.track.dispatchEvent(new Event('ended'));
  assert.equal(env.tracker.state, 'error');
  assert.match(env.statuses.at(-1).message, /bağlantısı kesildi/);
  assert.equal(env.model.closes, 1);
  assert.equal(env.frames.size, 0);
  env.tracker.dispose();
  env.tracker.dispose();
  await env.tracker.start();
  assert.equal(env.acquisitions, 1);
});
