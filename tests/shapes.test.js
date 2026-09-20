import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, generateShape } from '../src/shapes.js';

const IDS = ['galaxy', 'torus', 'dna', 'vortex', 'blackhole', 'atom', 'nebula'];
const FULL_COUNT = 24000;
const REDUCED_COUNT = 6000;

test('every selectable formation has complete, unique metadata', () => {
  assert.deepEqual(SHAPES.map(({ id }) => id), IDS);
  assert.deepEqual(SHAPES.map(({ gesture, emoji }) => [gesture, emoji]), [
    ['Başparmak', '👍'],
    ['Yumruk', '✊'],
    ['Zafer işareti', '✌️'],
    ['İşaret parmağı', '☝️'],
    ['Rock işareti', '🤘'],
    ['OK işareti', '👌'],
    ['Açık el', '🖐️'],
  ]);
  for (const shape of SHAPES) {
    for (const key of ['name', 'subtitle', 'description', 'gesture', 'emoji']) {
      assert.equal(typeof shape[key], 'string');
      assert.ok(shape[key].trim().length > 0);
    }
    assert.match(shape.accent, /^#[\da-f]{6}$/i);
  }
});

for (const id of IDS) {
  test(`${id}: valid buffers, finite colors and bounded geometry`, () => {
    const { positions, colors } = generateShape(id, FULL_COUNT);
    assert.ok(positions instanceof Float32Array);
    assert.ok(colors instanceof Float32Array);
    assert.equal(positions.length, FULL_COUNT * 3);
    assert.equal(colors.length, FULL_COUNT * 3);

    for (let i = 0; i < positions.length; i += 3) {
      const radius = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      assert.ok(Number.isFinite(radius), `non-finite position at particle ${i / 3}`);
      assert.ok(radius <= 4.5, `radius ${radius} at particle ${i / 3}`);
      if (id === 'dna' || id === 'vortex') {
        assert.ok(Math.abs(positions[i + 1]) <= 3.2);
      }
      for (let channel = 0; channel < 3; channel += 1) {
        assert.ok(Number.isFinite(colors[i + channel]));
        assert.ok(colors[i + channel] >= 0 && colors[i + channel] <= 1);
      }
    }
  });

  test(`${id}: same seed reproduces data and a smaller draw range preserves the prefix`, () => {
    const full = generateShape(id, FULL_COUNT, 42);
    const reduced = generateShape(id, REDUCED_COUNT, 42);
    const repeated = generateShape(id, REDUCED_COUNT, 42);
    assert.deepEqual(reduced, repeated);
    assert.deepEqual(reduced.positions, full.positions.subarray(0, REDUCED_COUNT * 3));
    assert.deepEqual(reduced.colors, full.colors.subarray(0, REDUCED_COUNT * 3));
    assert.notDeepEqual(reduced.positions, generateShape(id, REDUCED_COUNT, 43).positions);
  });
}

test('empty datasets are supported, invalid inputs fail explicitly', () => {
  assert.equal(generateShape('galaxy', 0).positions.length, 0);
  assert.equal(generateShape('galaxy', 0).colors.length, 0);
  assert.throws(() => generateShape('unknown', 10), /Unknown particle shape/);
  for (const count of [-1, 0.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => generateShape('galaxy', count), /Particle count/);
  }
  for (const seed of [NaN, Infinity, '42', null]) {
    assert.throws(() => generateShape('galaxy', 10, seed), /Particle seed/);
  }
});

test('DNA keeps both strands and all discrete rungs at reduced quality', () => {
  const { positions } = generateShape('dna', REDUCED_COUNT);
  const strands = [0, 0];
  const rungs = new Set();
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = positions.subarray(i, i + 3);
    const radius = Math.hypot(x, z);
    if (radius > 1.04) {
      const relativeAngle = Math.atan2(z, x) - y * 2.65;
      strands[Math.cos(relativeAngle) > 0 ? 0 : 1] += 1;
    } else if (radius < 0.9) {
      const rung = Math.round((y + 2.7) / 0.225);
      assert.ok(Math.abs(y - (-2.7 + rung * 0.225)) < 0.013);
      rungs.add(rung);
    }
  }
  assert.ok(strands.every((count) => count > 1500), `strand coverage ${strands}`);
  assert.equal(rungs.size, 25);
});

test('atom keeps a nucleus and three geometrically distinct orbital planes at reduced quality', () => {
  const { positions } = generateShape('atom', REDUCED_COUNT);
  let nucleus = 0;
  const orbits = [0, 0, 0];
  const normals = [0, 1, 2].map((orbit) => {
    const angle = orbit * Math.PI / 3;
    return [Math.sin(angle) * 0.882, -Math.cos(angle) * 0.882, 0.471];
  });
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = positions.subarray(i, i + 3);
    const radius = Math.hypot(x, y, z);
    if (radius < 0.6) {
      nucleus += 1;
    } else {
      assert.ok(radius > 2.78 && radius < 2.92);
      const distances = normals.map(([nx, ny, nz]) => Math.abs(x * nx + y * ny + z * nz));
      const closest = Math.min(...distances);
      assert.ok(closest < 0.015, `particle lies outside all orbital planes: ${closest}`);
      orbits[distances.indexOf(closest)] += 1;
    }
  }
  assert.ok(nucleus > 900);
  assert.ok(orbits.every((count) => count > 1200), `orbit coverage ${orbits}`);
});

test('black hole keeps its center empty and retains its ring and disk at reduced quality', () => {
  const { positions } = generateShape('blackhole', REDUCED_COUNT);
  let ring = 0;
  let disk = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = positions.subarray(i, i + 3);
    const radius = Math.hypot(x, y, z);
    assert.ok(radius > 0.9, 'the center must not contain particles');
    assert.ok(Math.hypot(x, y) > 0.85, 'the initial view must retain a dark center');
    if (radius < 1.05) ring += 1;
    if (radius > 1.6) disk += 1;
  }
  assert.ok(ring > 1000);
  assert.ok(disk > 3500);
});

test('galaxy keeps a core and four spiral arms at reduced quality', () => {
  const { positions } = generateShape('galaxy', REDUCED_COUNT);
  let core = 0;
  const arms = [0, 0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = positions.subarray(i, i + 3);
    // Undo the two display tilts to recover the spiral in its native plane.
    const diskX = x * 0.978 - y * 0.208;
    const tiltedY = x * 0.208 + y * 0.978;
    const diskY = tiltedY * 0.745 + z * 0.667;
    const radius = Math.hypot(diskX, diskY);
    if (radius < 0.85) core += 1;
    if (radius > 1.2) {
      const phase = Math.atan2(diskY, diskX) - 1.75 * Math.log(0.7 + radius);
      const quarterTurns = phase / (TAU / 4);
      const closestArm = ((Math.round(quarterTurns) % 4) + 4) % 4;
      const distance = Math.abs(quarterTurns - Math.round(quarterTurns));
      if (distance < 0.12) arms[closestArm] += 1;
    }
  }
  assert.ok(core > 1000);
  assert.ok(arms.every((count) => count > 700), `arm coverage ${arms}`);
});

const TAU = Math.PI * 2;
