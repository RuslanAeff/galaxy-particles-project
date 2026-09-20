import assert from 'node:assert/strict';
import test from 'node:test';
import { captureBlend, damping, nearestAngle, smoothstep } from '../src/motion.js';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
};

test('shape progress has exact endpoints, stays bounded and eases symmetrically', () => {
  assert.equal(smoothstep(-2), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(3), 1);
  let previous = 0;
  for (let step = 0; step <= 100; step += 1) {
    const progress = step / 100;
    const value = smoothstep(progress);
    assert.ok(value >= previous && value <= 1);
    close(value + smoothstep(1 - progress), 1);
    previous = value;
  }
});

test('interrupting a morph preserves the displayed positions and colors at the next morph start', () => {
  // Fractions are known eased weights for 0, 1/4, 1/2, 3/4 and 1.
  const samples = [[0, 0], [0.25, 0.15625], [0.5, 0.5], [0.75, 0.84375], [1, 1]];
  const original = new Float32Array([-3, 1.5, 0.2, 2.1, -1.2, 0.9, 0.1, 0.4, 0.8]);
  const destination = new Float32Array([2.5, -0.2, 1.8, -0.4, 2.2, -1.6, 0.9, 0.7, 0.2]);
  const nextDestination = new Float32Array([-1, 3, 0, 1, -2, 2, 0.4, 0.6, 1]);
  const destinationCopy = destination.slice();

  for (const [progress, easedWeight] of samples) {
    const source = original.slice();
    const displayedBefore = Array.from(source, (value, index) =>
      value * (1 - easedWeight) + destination[index] * easedWeight);
    captureBlend(source, destination, progress);

    // The replacement target has zero weight on its first frame, even when a
    // previous transition was interrupted before its destination was reached.
    for (let index = 0; index < source.length; index += 1) {
      const displayedAfter = source[index] * (1 - smoothstep(0)) + nextDestination[index] * smoothstep(0);
      close(displayedAfter, displayedBefore[index], 3e-7);
    }
    assert.deepEqual(destination, destinationCopy, 'cached shape data must remain reusable');
  }
});

test('rapid repeated retargeting remains continuous and reaches the final destination', () => {
  const source = new Float32Array([-2.4, 1.2, 0.7, 2.1, -1.4, -0.9]);
  const targets = [
    new Float32Array([1, -2, 1.8, -2.2, 0.8, 1.1]),
    new Float32Array([0.2, 2.7, -1.3, 0.8, -1.9, 0.3]),
    new Float32Array([-1.5, 0.4, 2.2, 2.3, 0.6, -1.1]),
  ];
  let target = targets[0];
  for (let interruption = 0; interruption < 30; interruption += 1) {
    const progress = interruption % 3 === 0 ? 0 : (interruption % 7) / 10;
    const weight = smoothstep(progress);
    const displayed = Array.from(source, (value, index) => value * (1 - weight) + target[index] * weight);
    captureBlend(source, target, progress);
    target = targets[(interruption + 1) % targets.length];
    for (let index = 0; index < source.length; index += 1) {
      close(source[index], displayed[index], 3e-7);
      assert.ok(Number.isFinite(source[index]));
      assert.ok(Math.abs(source[index]) <= 2.7, 'retargeting must not overshoot any formation');
    }
  }
  captureBlend(source, target, 1);
  assert.deepEqual(source, target);
});

test('capturing an out-of-range transition clamps to a valid endpoint', () => {
  const source = new Float32Array([-3, 0.5, 2]);
  const target = new Float32Array([4, -0.8, 1]);
  const unchanged = source.slice();
  captureBlend(source, target, -1);
  assert.deepEqual(source, unchanged);
  captureBlend(source, target, 2);
  assert.deepEqual(source, target);
});

test('damping stays bounded and cannot overshoot after short, negative or long frame intervals', () => {
  for (const rate of [0, 0.1, 7, 40]) {
    for (const seconds of [-10, -0.001, 0, 1 / 240, 1 / 60, 0.05, 1, 60]) {
      const amount = damping(rate, seconds);
      assert.ok(Number.isFinite(amount));
      assert.ok(amount >= 0 && amount <= 1, `rate=${rate}, elapsed=${seconds}`);
      if (seconds <= 0 || rate === 0) assert.equal(amount, 0);
      for (const [current, target] of [[-7, 4], [8, -3]]) {
        const next = current + (target - current) * amount;
        assert.ok(next >= Math.min(current, target) && next <= Math.max(current, target));
      }
    }
  }
});

test('splitting elapsed time into multiple updates preserves the same damping response', () => {
  const rate = 7;
  const initial = -3;
  const target = 2.5;
  for (const [first, second] of [[0, 0.05], [1 / 60, 1 / 144], [0.013, 0.037], [0.04, 0.01]]) {
    const oneUpdate = initial + (target - initial) * damping(rate, first + second);
    const intermediate = initial + (target - initial) * damping(rate, first);
    const twoUpdates = intermediate + (target - intermediate) * damping(rate, second);
    close(oneUpdate, twoUpdates);
  }
});

test('24, 60 and 144 FPS converge to the same hand pose over equal elapsed time', () => {
  const positions = [];
  for (const fps of [24, 60, 144]) {
    let position = -2;
    for (let frame = 0; frame < fps; frame += 1) {
      position += (4 - position) * damping(7, 1 / fps);
    }
    positions.push(position);
  }
  close(positions[0], positions[1]);
  close(positions[1], positions[2]);
  assert.ok(positions[0] > 3.99 && positions[0] < 4);
});

test('roll follows the short path in both directions across the minus-pi/pi boundary', () => {
  const offset = 0.04;
  const nearPositivePi = Math.PI - offset;
  const nearNegativePi = -Math.PI + offset;
  close(nearestAngle(nearPositivePi, nearNegativePi) - nearPositivePi, offset * 2);
  close(nearestAngle(nearNegativePi, nearPositivePi) - nearNegativePi, -offset * 2);

  let roll = nearPositivePi;
  for (let frame = 0; frame < 60; frame += 1) {
    const previous = roll;
    roll += (nearestAngle(roll, nearNegativePi) - roll) * damping(7, 1 / 60);
    assert.ok(roll >= previous, 'crossing pi must keep moving forward instead of reversing');
    assert.ok(roll - previous < offset);
  }
  close(roll, Math.PI + offset, 0.0001);
});

test('angle unwrapping preserves orientation and the current revolution count', () => {
  const tau = Math.PI * 2;
  for (const current of [-8 * tau - 0.4, -Math.PI, 0, Math.PI, 9 * tau + 0.2]) {
    for (const target of [-3 * tau + 0.1, -Math.PI, -0.3, 0, Math.PI, 5 * tau - 0.1]) {
      const result = nearestAngle(current, target);
      assert.ok(Math.abs(result - current) <= Math.PI + 1e-12);
      close(Math.sin(result), Math.sin(target));
      close(Math.cos(result), Math.cos(target));
    }
    close(nearestAngle(current, current + 4 * tau), current);
  }
});
