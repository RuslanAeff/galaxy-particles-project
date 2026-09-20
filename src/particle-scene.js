import * as THREE from 'three';
import { generateShape, SHAPES } from './shapes.js';
import { captureBlend, damping, nearestAngle, smoothstep } from './motion.js';

const MAX_PARTICLES = 24000;
const SHAPE_IDS = new Set(SHAPES.map(({ id }) => id));
const QUALITY = {
  low: { count: 6000, dpr: 1 },
  balanced: { count: 14000, dpr: 1.5 },
  high: { count: MAX_PARTICLES, dpr: 2 },
};

const vertexShader = /* glsl */ `
  attribute vec3 aTarget;
  attribute vec3 aTargetColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uMorph;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uPointScale;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vec3 p = mix(position, aTarget, uMorph);
    float phase = aSeed * 6.283185;
    p += 0.012 * vec3(sin(uTime * 0.3 + phase), cos(uTime * 0.2 + phase), sin(uTime * 0.25 + phase));
    vColor = mix(color, aTargetColor, uMorph);
    vTwinkle = 0.8 + 0.2 * sin(uTime * 0.8 + phase);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(aSize * uPointScale * uPixelRatio / max(1.0, -viewPosition.z), 1.0, 22.0 * uPixelRatio);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    if (radius > 1.0) discard;
    float core = exp(-radius * radius * 18.0);
    float halo = exp(-radius * radius * 4.5) * 0.36;
    float alpha = (core + halo) * (1.0 - smoothstep(0.7, 1.0, radius));
    gl_FragColor = vec4(vColor * (1.0 + core * 0.35), alpha * vTwinkle * 0.82);
  }
`;

export class ParticleScene {
  constructor(element, { reducedMotion = false, onMetrics, onError, onRestore } = {}) {
    this.element = element;
    this.onMetrics = onMetrics;
    this.onError = onError;
    this.onRestore = onRestore;
    this.abort = new AbortController();
    this.disposed = false;
    this.contextLost = false;
    this.paused = reducedMotion;
    this.reducedMotion = reducedMotion;
    this.speed = 1;
    this.time = 0;
    this.transition = 1;
    this.shape = 'galaxy';
    this.raf = 0;
    this.lastTime = 0;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    this.slowSamples = 0;
    this.fastSamples = 0;
    this.quality = 'auto';
    this.qualityLevel = matchMedia('(pointer: coarse)').matches ? 'low' : 'balanced';
    this.zoom = 1;
    this.rotation = { x: 0, y: 0 };
    this.hand = null;
    this.pointers = new Map();
    this.pinchDistance = 0;
    this.renderFrame = this.renderFrame.bind(this);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'default' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.element.append(this.renderer.domElement);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.datasets = new Map();
    this.cancelWarm = null;
    this.createParticles();
    this.createStars();
    this.warmDatasets();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(element);
    this.applyQuality(this.qualityLevel);
    this.resize();
    this.invalidate();
  }

  createParticles() {
    const data = this.dataset(this.shape);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(data.colors.slice(), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aTarget', new THREE.BufferAttribute(data.positions, 3));
    this.geometry.setAttribute('aTargetColor', new THREE.BufferAttribute(data.colors, 3));
    const sizes = new Float32Array(MAX_PARTICLES);
    const seeds = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const random = Math.abs(Math.sin(i * 127.1 + 311.7));
      seeds[i] = random;
      sizes[i] = 0.4 + random * random * 1.8 + (i % 137 === 0 ? 1.5 : 0);
    }
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4.7);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMorph: { value: 1 }, uTime: { value: 0 },
        uPixelRatio: { value: 1 }, uPointScale: { value: 25 },
      },
      vertexShader, fragmentShader, vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
  }

  createStars() {
    const positions = new Float32Array(450 * 3);
    for (let i = 0; i < 450; i++) {
      positions[i * 3] = Math.sin(i * 127.1) * 30;
      positions[i * 3 + 1] = Math.sin(i * 269.5 + 1) * 24;
      positions[i * 3 + 2] = -12 - Math.abs(Math.sin(i * 77.7)) * 20;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x9c91b0, size: 0.024, transparent: true, opacity: 0.48, depthWrite: false });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  dataset(id) {
    let data = this.datasets.get(id);
    if (!data) {
      data = generateShape(id, MAX_PARTICLES);
      this.datasets.set(id, data);
    }
    return data;
  }

  // Only the visible formation is built during startup. The rest are generated
  // one at a time while the browser is idle, so the first frame is never blocked
  // and an early selection still gets its data on demand.
  warmDatasets() {
    const queue = SHAPES.map(({ id }) => id).filter((id) => !this.datasets.has(id));
    const defer = globalThis.requestIdleCallback
      ? (run) => { const handle = requestIdleCallback(run, { timeout: 1500 }); return () => cancelIdleCallback(handle); }
      : (run) => { const handle = setTimeout(run, 120); return () => clearTimeout(handle); };
    const step = () => {
      this.cancelWarm = null;
      if (this.disposed) return;
      this.dataset(queue.shift());
      if (queue.length) this.cancelWarm = defer(step);
    };
    if (queue.length) this.cancelWarm = defer(step);
  }

  setShape(id) {
    if (this.shape === id || !SHAPE_IDS.has(id)) return;
    const attributes = this.geometry.attributes;
    captureBlend(attributes.position.array, attributes.aTarget.array, this.transition);
    captureBlend(attributes.color.array, attributes.aTargetColor.array, this.transition);
    const target = this.dataset(id);
    attributes.aTarget.array = target.positions;
    attributes.aTargetColor.array = target.colors;
    for (const key of ['position', 'color', 'aTarget', 'aTargetColor']) attributes[key].needsUpdate = true;
    this.shape = id;
    this.transition = this.paused || this.reducedMotion ? 1 : 0;
    this.invalidate();
  }

  setHand(hand) { this.hand = hand; this.invalidate(); }
  setSpeed(speed) { this.speed = speed; }
  setPaused(paused) {
    this.paused = paused;
    this.lastTime = 0;
    this.sampleTime = this.sampleFrames = 0;
    if (paused) this.transition = 1;
    this.onMetrics?.({ fps: paused ? 0 : null, count: QUALITY[this.qualityLevel].count });
    this.invalidate();
  }
  setReducedMotion(value) { this.reducedMotion = value; if (value) this.setPaused(true); }

  setQuality(value) {
    if (value !== 'auto' && !QUALITY[value]) return;
    this.quality = value;
    this.slowSamples = this.fastSamples = 0;
    this.applyQuality(value === 'auto' ? (matchMedia('(pointer: coarse)').matches ? 'low' : 'balanced') : value);
  }

  applyQuality(level) {
    this.qualityLevel = level;
    this.geometry.setDrawRange(0, QUALITY[level].count);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[level].dpr));
    this.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.onMetrics?.({ count: QUALITY[level].count, fps: null });
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const { width, height } = this.element.getBoundingClientRect();
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    // Fit the full bounding sphere, including when a narrow viewport constrains width.
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    this.cameraDistance = 4.9 / Math.sin(Math.min(verticalFov, horizontalFov) / 2);
    this.camera.far = Math.max(100, this.cameraDistance * 4);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.material.uniforms.uPointScale.value = Math.min(this.width, this.height) * 0.075;
    this.invalidate();
  }

  bindEvents() {
    const options = { signal: this.abort.signal };
    const canvas = this.renderer.domElement;
    this.element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.element.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.element.focus({ preventScroll: true });
      this.pinchDistance = this.getPinchDistance();
    }, options);
    this.element.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      previous.x = event.clientX;
      previous.y = event.clientY;
      if (this.pointers.size === 2) {
        const distance = this.getPinchDistance();
        if (this.pinchDistance > 0) this.zoom = THREE.MathUtils.clamp(this.zoom * distance / this.pinchDistance, 0.65, 1.6);
        this.pinchDistance = distance;
      } else {
        this.rotation.y += dx * 0.006;
        this.rotation.x = THREE.MathUtils.clamp(this.rotation.x + dy * 0.006, -1.4, 1.4);
      }
      this.invalidate();
    }, options);
    const release = (event) => { this.pointers.delete(event.pointerId); this.pinchDistance = this.getPinchDistance(); };
    this.element.addEventListener('pointerup', release, options);
    this.element.addEventListener('pointercancel', release, options);
    this.element.addEventListener('lostpointercapture', release, options);
    this.element.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-event.deltaY * 0.001), 0.65, 1.6);
      this.invalidate();
    }, { ...options, passive: false });
    this.element.addEventListener('keydown', (event) => {
      const actions = {
        ArrowLeft: () => { this.rotation.y -= 0.15; },
        ArrowRight: () => { this.rotation.y += 0.15; },
        ArrowUp: () => { this.rotation.x = Math.max(-1.4, this.rotation.x - 0.15); },
        ArrowDown: () => { this.rotation.x = Math.min(1.4, this.rotation.x + 0.15); },
        '+': () => { this.zoom = Math.min(1.6, this.zoom * 1.1); },
        '-': () => { this.zoom = Math.max(0.65, this.zoom / 1.1); },
      };
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); this.invalidate(); }
    }, options);
    document.addEventListener('visibilitychange', () => {
      this.lastTime = 0;
      this.sampleFrames = this.sampleTime = 0;
      this.pointers.clear();
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; }
      else this.invalidate();
    }, options);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.onError?.('Grafik bağlantısı kesildi. Bağlantı geri geldiğinde sahne devam edecek.');
    }, options);
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.lastTime = 0;
      this.onRestore?.();
      this.invalidate();
    }, options);
  }

  getPinchDistance() {
    if (this.pointers.size !== 2) return 0;
    const [a, b] = this.pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  resetView() {
    this.rotation.x = this.rotation.y = 0;
    this.zoom = 1;
    this.invalidate();
  }

  invalidate() {
    if (!this.raf && !this.disposed && !this.contextLost && !document.hidden) {
      this.raf = requestAnimationFrame(this.renderFrame);
    }
  }

  renderFrame(now) {
    this.raf = 0;
    if (this.disposed || this.contextLost || document.hidden) return;
    const elapsed = this.lastTime ? (now - this.lastTime) / 1000 : 1 / 60;
    this.lastTime = now;
    const dt = Math.min(elapsed, 0.05);
    if (!this.paused) {
      this.time += dt * this.speed;
      this.transition = Math.min(1, this.transition + dt / 1.35);
    }
    this.material.uniforms.uMorph.value = smoothstep(this.transition);
    this.material.uniforms.uTime.value = this.time;
    const amount = this.paused ? 1 : damping(7, dt);
    const targetX = this.hand ? this.hand.x * 0.9 : 0;
    const targetY = this.hand ? this.hand.y * 0.7 : 0;
    this.group.position.x += (targetX - this.group.position.x) * amount;
    this.group.position.y += (targetY - this.group.position.y) * amount;
    this.group.rotation.x += (this.rotation.x - this.group.rotation.x) * amount;
    this.group.rotation.y += (this.rotation.y + Math.sin(this.time * 0.13) * 0.15 - this.group.rotation.y) * amount;
    const roll = this.hand ? -this.hand.roll * 0.4 : Math.sin(this.time * 0.08) * 0.07;
    this.group.rotation.z += (nearestAngle(this.group.rotation.z, roll) - this.group.rotation.z) * amount;
    const scale = this.hand ? this.hand.scale : 1;
    this.group.scale.setScalar(this.group.scale.x + (scale - this.group.scale.x) * amount);
    this.camera.position.z = this.cameraDistance / this.zoom;
    this.renderer.render(this.scene, this.camera);
    if (!this.paused) {
      this.sampleTime += elapsed;
      this.sampleFrames++;
      if (this.sampleTime >= 1) {
        const fps = Math.round(this.sampleFrames / this.sampleTime);
        this.onMetrics?.({ fps, count: QUALITY[this.qualityLevel].count });
        if (this.quality === 'auto') this.adaptQuality(fps);
        this.sampleTime = this.sampleFrames = 0;
      }
      this.invalidate();
    }
  }

  adaptQuality(fps) {
    this.slowSamples = fps < 42 ? this.slowSamples + 1 : 0;
    this.fastSamples = fps >= 57 ? this.fastSamples + 1 : 0;
    const levels = ['low', 'balanced', 'high'];
    const index = levels.indexOf(this.qualityLevel);
    if (this.slowSamples >= 3 && index > 0) {
      this.applyQuality(levels[index - 1]);
      this.slowSamples = this.fastSamples = 0;
    } else if (this.fastSamples >= 18 && index < 2 && !matchMedia('(pointer: coarse)').matches) {
      this.applyQuality(levels[index + 1]);
      this.slowSamples = this.fastSamples = 0;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cancelWarm?.();
    this.cancelWarm = null;
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.geometry.dispose();
    this.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.datasets.clear();
  }
}
