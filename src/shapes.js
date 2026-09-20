const TAU = Math.PI * 2;
const DEFAULT_SEED = 0xdecafbad;

export const SHAPES = Object.freeze([
  {
    id: 'galaxy',
    name: 'Spiral Galaksi',
    subtitle: 'Yıldızların ortak yörüngesi',
    description: 'Sıcak bir çekirdeğin etrafında uzanan dört spiral kol; lavanta, buz mavisi ve altın renkli yıldızlar.',
    gesture: 'Başparmak',
    emoji: '👍',
    accent: '#b8a4ff',
  },
  {
    id: 'torus',
    name: 'Işık Halkası',
    subtitle: 'Kesintisiz bir döngü',
    description: 'Turkuazdan mora geçen binlerce parçacık, içi boş bir halkanın kıvrımlı yüzeyini çiziyor.',
    gesture: 'Yumruk',
    emoji: '✊',
    accent: '#79dfed',
  },
  {
    id: 'dna',
    name: 'Çift Sarmal',
    subtitle: 'Yaşamın geometrisi',
    description: 'İki ince sarmal ve aralarında düzenli aralıklarla uzanan bağlar, yaşamın tanıdık ritmini oluşturuyor.',
    gesture: 'Zafer işareti',
    emoji: '✌️',
    accent: '#f1a3cf',
  },
  {
    id: 'vortex',
    name: 'Kozmik Girdap',
    subtitle: 'Merkeze doğru bir yolculuk',
    description: 'Beş ışık akışı, geniş bir ağızdan ince bir merkeze doğru kıvrılarak uzayda bir girdap oluşturuyor.',
    gesture: 'İşaret parmağı',
    emoji: '☝️',
    accent: '#8de3cc',
  },
  {
    id: 'blackhole',
    name: 'Kara Delik',
    subtitle: 'Işığın sınırında',
    description: 'Karanlık bir merkezin çevresinde ince bir ışık halkası ve bakır tonlarında bir birikim diski parlıyor.',
    gesture: 'Rock işareti',
    emoji: '🤘',
    accent: '#ffc58b',
  },
  {
    id: 'atom',
    name: 'Atom',
    subtitle: 'Küçük ölçekte büyük bir evren',
    description: 'Üç farklı düzlemde uzanan zarif yörüngeler, küçük ve parlak bir çekirdeğin çevresinde kesişiyor.',
    gesture: 'OK işareti',
    emoji: '👌',
    accent: '#a7c9ff',
  },
  {
    id: 'nebula',
    name: 'Bulutsu',
    subtitle: 'Yeni yıldızlara yer aç',
    description: 'Mor, mavi ve pembe toz bulutları, daha yoğun yıldız yuvalarının çevresinde küresel bir hacme yayılıyor.',
    gesture: 'Açık el',
    emoji: '🖐️',
    accent: '#d7a2f6',
  },
].map((shape) => Object.freeze(shape)));

const SHAPE_IDS = new Set(SHAPES.map(({ id }) => id));

// Mulberry32 keeps formation generation reproducible without touching Math.random.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashId(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Build a centered formation in world units. Components are interleaved and the
 * random sequence never depends on count: reducing drawRange preserves every
 * component, and a smaller dataset exactly matches the larger dataset's prefix.
 *
 * @param {string} id One of SHAPES[].id.
 * @param {number} count Non-negative integer number of particles.
 * @param {number} [seed] Finite numeric seed, coerced to an unsigned 32-bit value.
 * @returns {{positions: Float32Array, colors: Float32Array}}
 */
export function generateShape(id, count, seed = DEFAULT_SEED) {
  if (!SHAPE_IDS.has(id)) {
    throw new RangeError(`Unknown particle shape: ${String(id)}`);
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Particle count must be a non-negative safe integer.');
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('Particle seed must be a finite number.');
  }

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const random = createRandom((seed >>> 0) ^ hashId(id));
  const noise = (width) => (random() + random() - 1) * width;

  for (let i = 0; i < count; i += 1) {
    let x;
    let y;
    let z;
    let red;
    let green;
    let blue;

    if (id === 'galaxy') {
      const component = i % 10;
      let radius;
      let angle;
      let depth;

      if (component < 2) {
        radius = 0.8 * Math.pow(random(), 0.7);
        angle = random() * TAU;
        depth = noise(0.28) * (1 - radius / 1.1);
      } else if (component === 2) {
        radius = 3.9 * Math.sqrt(random());
        angle = random() * TAU;
        depth = noise(0.22);
      } else {
        radius = 0.3 + 3.58 * Math.pow(random(), 0.66);
        const arm = Math.floor(i / 10) % 4;
        angle = arm * TAU / 4 + 1.75 * Math.log(0.7 + radius);
        angle += noise(0.055 + 0.11 / (radius + 0.3));
        radius += noise(0.065);
        depth = noise(0.085 + radius * 0.015);
      }

      const diskX = Math.cos(angle) * radius;
      const diskY = Math.sin(angle) * radius;
      const tiltedY = diskY * 0.745 - depth * 0.667;
      z = diskY * 0.667 + depth * 0.745;
      // A slight diagonal gives the initial, front-facing camera a clear view.
      x = diskX * 0.978 + tiltedY * 0.208;
      y = -diskX * 0.208 + tiltedY * 0.978;

      const outer = clamp01((radius - 0.2) / 2.8);
      const blueStar = random() < 0.2;
      red = mix(1, blueStar ? 0.55 : 0.73, outer);
      green = mix(0.82, blueStar ? 0.8 : 0.62, outer);
      blue = mix(0.57, 1, outer);
      if (component === 2) {
        red *= 0.67;
        green *= 0.67;
        blue *= 0.78;
      }
    } else if (id === 'torus') {
      const angle = random() * TAU;
      const tubeAngle = random() * TAU;
      const tubeRadius = 0.63 + noise(0.028);
      const radius = 2.52 + Math.cos(tubeAngle) * tubeRadius;
      x = Math.cos(angle) * radius;
      const diskY = Math.sin(angle) * radius;
      const depth = Math.sin(tubeAngle) * tubeRadius;
      y = diskY * 0.574 - depth * 0.819;
      z = diskY * 0.819 + depth * 0.574;
      const gradient = 0.5 + 0.5 * Math.sin(angle + tubeAngle * 0.45);
      red = mix(0.36, 0.81, gradient);
      green = mix(0.92, 0.59, gradient);
      blue = mix(0.94, 1, gradient);
    } else if (id === 'dna') {
      const isRung = i % 8 >= 6;
      if (isRung) {
        const rung = Math.floor(random() * 25);
        const rungY = -2.7 + rung * 0.225;
        const angle = rungY * 2.65;
        const across = random() * 2 - 1;
        x = Math.cos(angle) * across * 1.08 + noise(0.015);
        y = rungY + noise(0.012);
        z = Math.sin(angle) * across * 1.08 + noise(0.015);
        const gradient = (across + 1) * 0.5;
        red = mix(0.48, 1, gradient);
        green = mix(0.88, 0.61, gradient);
        blue = mix(1, 0.82, gradient);
      } else {
        const strand = i % 2;
        y = (random() * 2 - 1) * 2.95;
        const angle = y * 2.65 + strand * Math.PI;
        x = Math.cos(angle) * 1.1 + noise(0.037);
        z = Math.sin(angle) * 1.1 + noise(0.037);
        y += noise(0.018);
        red = strand ? 1 : 0.43;
        green = strand ? 0.57 : 0.89;
        blue = strand ? 0.8 : 1;
      }
    } else if (id === 'vortex') {
      const height = random();
      const radius = 0.18 + 2.53 * Math.pow(height, 1.45);
      const stream = Math.floor(i / 10) % 5;
      let angle = TAU * (height * 2.65 + stream / 5);
      angle += i % 10 === 0 ? random() * TAU : noise(0.045);
      x = Math.cos(angle) * (radius + noise(0.037));
      y = height * 5.6 - 2.8 + noise(0.025);
      z = Math.sin(angle) * (radius + noise(0.037));
      red = mix(0.42, 0.87, height);
      green = mix(0.96, 0.64, height);
      blue = mix(0.82, 1, height);
    } else if (id === 'blackhole') {
      const angle = random() * TAU;
      if (i % 12 < 3) {
        // A face-on photon ring leaves the center empty even at the initial view.
        const radius = 0.96 + noise(0.022);
        x = Math.cos(angle) * radius;
        y = Math.sin(angle) * radius;
        z = noise(0.045);
        red = 1;
        green = 0.86 + random() * 0.1;
        blue = 0.57 + random() * 0.18;
      } else {
        const radius = 1.72 + 2.12 * Math.pow(random(), 1.55);
        const spiral = angle + Math.log(radius) * 1.6;
        const diskX = Math.cos(spiral) * radius;
        const diskY = Math.sin(spiral) * radius;
        const depth = noise(0.022 + radius * 0.011);
        const tiltedY = diskY * 0.54 - depth * 0.842;
        z = diskY * 0.842 + depth * 0.54;
        x = diskX * 0.955 + tiltedY * 0.296;
        y = -diskX * 0.296 + tiltedY * 0.955;
        const outer = (radius - 1.72) / 2.12;
        red = mix(1, 0.77, outer);
        green = mix(0.79, 0.33, outer);
        blue = mix(0.46, 0.2, outer);
      }
    } else if (id === 'atom') {
      if (i % 5 === 0) {
        const radius = 0.57 * Math.cbrt(random());
        const angle = random() * TAU;
        const elevation = random() * 2 - 1;
        const horizontal = Math.sqrt(1 - elevation * elevation);
        x = radius * horizontal * Math.cos(angle);
        y = radius * elevation;
        z = radius * horizontal * Math.sin(angle);
        red = 1;
        green = 0.7 + random() * 0.22;
        blue = 0.67 + random() * 0.22;
      } else {
        const orbit = Math.floor(i / 5) % 3;
        const angle = random() * TAU;
        const radius = 2.85 + noise(0.031);
        const orbitX = Math.cos(angle) * radius;
        const orbitY = Math.sin(angle) * radius * 0.471;
        const orientation = orbit * Math.PI / 3;
        x = orbitX * Math.cos(orientation) - orbitY * Math.sin(orientation);
        y = orbitX * Math.sin(orientation) + orbitY * Math.cos(orientation);
        z = Math.sin(angle) * radius * 0.882 + noise(0.025);
        red = orbit === 0 ? 0.48 : orbit === 1 ? 0.77 : 1;
        green = orbit === 0 ? 0.87 : orbit === 1 ? 0.66 : 0.8;
        blue = orbit === 2 ? 0.59 : 1;
      }
    } else {
      const angle = random() * TAU;
      const elevation = random() * 2 - 1;
      const horizontal = Math.sqrt(1 - elevation * elevation);
      if (i % 4 === 0) {
        // Six small, interleaved nurseries give the volume pockets of density.
        const cloud = Math.floor(i / 4) % 6;
        const cloudAngle = cloud * TAU / 6;
        const radius = 0.85 * Math.cbrt(random());
        x = Math.cos(cloudAngle) * 1.35 + radius * horizontal * Math.cos(angle);
        y = Math.sin(cloudAngle * 2) * 0.85 + radius * elevation;
        z = Math.sin(cloudAngle) * 1.25 + radius * horizontal * Math.sin(angle);
      } else {
        const radius = 3.48 * Math.pow(random(), 0.48);
        const twist = angle + 0.48 * Math.sin(elevation * 4 + radius);
        const ripple = 0.9 + 0.1 * Math.sin(angle * 3 + elevation * 5);
        x = radius * horizontal * Math.cos(twist) * ripple;
        y = radius * elevation;
        z = radius * horizontal * Math.sin(twist) * ripple;
      }
      const hue = 0.5 + 0.5 * Math.sin(x * 0.85 + z * 0.7 - y * 0.6);
      const center = Math.max(0, 1 - Math.hypot(x, y, z) / 1.4) * 0.45;
      red = mix(mix(0.41, 0.94, hue), 1, center);
      green = mix(mix(0.74, 0.46, hue), 0.84, center);
      blue = mix(1, 0.95, center);
    }

    const offset = i * 3;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    colors[offset] = red;
    colors[offset + 1] = green;
    colors[offset + 2] = blue;
  }

  return { positions, colors };
}
