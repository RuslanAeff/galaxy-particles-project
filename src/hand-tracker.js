import { classifyGesture, GestureStabilizer, GESTURE_LABELS, GESTURE_SHAPES, getHandPose } from './gestures.js';

// Keep this version equal to @mediapipe/tasks-vision in package.json.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FRAME_INTERVAL = 1000 / 18;

const aborted = () => new DOMException('Başlatma iptal edildi.', 'AbortError');
const assertActive = (signal) => { if (signal.aborted) throw aborted(); };
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());
const closeModel = (model) => { try { model?.close(); } catch { /* Already disposed. */ } };

function waitFor(promise, signal, timeoutMs, message, releaseLateValue = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const clean = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clean();
      reject(error);
    };
    const cancel = () => fail(aborted());
    const timer = setTimeout(() => fail(new Error(message)), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then((value) => {
      if (settled) {
        releaseLateValue(value);
        return;
      }
      settled = true;
      clean();
      resolve(value);
    }, fail);
    if (signal.aborted) cancel();
  });
}

function videoReady(video, signal) {
  return new Promise((resolve, reject) => {
    const clean = () => {
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('canplay', check);
      signal.removeEventListener('abort', cancel);
    };
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        clean();
        resolve();
      }
    };
    const cancel = () => { clean(); reject(aborted()); };
    video.addEventListener('loadeddata', check);
    video.addEventListener('canplay', check);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else check();
  });
}

function errorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': return 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verip yeniden deneyebilirsin.';
    case 'NotFoundError':
    case 'DevicesNotFoundError': return 'Kamera bulunamadı. Bir kamera bağlayıp yeniden dene.';
    case 'NotReadableError':
    case 'TrackStartError': return 'Kamera açılamadı. Kamerayı kullanan diğer uygulamaları kapatıp yeniden dene.';
    case 'OverconstrainedError': return 'Kamera bu görüntü ayarlarını desteklemiyor. Başka bir kamera ile yeniden dene.';
    case 'SecurityError': return 'Tarayıcı kamera erişimini engelledi. Sayfayı HTTPS veya localhost üzerinden aç.';
    default: return error?.message?.startsWith('Kamera') || error?.message?.startsWith('El takibi')
      ? error.message
      : 'El takibi başlatılamadı. İnternet bağlantını kontrol edip yeniden dene.';
  }
}

export class HandTracker {
  constructor({ video, onStatus = () => {}, onResult = () => {} }) {
    this.video = video;
    this.onStatus = onStatus;
    this.onResult = onResult;
    this.state = 'off';
    this.stream = null;
    this.model = null;
    this.controller = null;
    this.startup = null;
    this.frame = null;
    this.generation = 0;
    this.disposed = false;
    this.trackListeners = [];
    this.stabilizer = new GestureStabilizer();
    this.pose = null;
    this.hadHand = false;
    this.tick = this.tick.bind(this);
  }

  status(state, message) {
    this.state = state;
    this.onStatus({ state, message });
  }

  async start() {
    if (this.disposed || this.state === 'active') return;
    if (this.startup) return this.startup;
    const run = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.status('loading', 'Kamera izni bekleniyor…');
    const startup = this.initialize(run, controller.signal);
    this.startup = startup;
    try {
      await startup;
    } finally {
      if (this.startup === startup) this.startup = null;
    }
  }

  async initialize(run, signal) {
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Kamera için HTTPS veya localhost bağlantısı ve güncel bir tarayıcı gerekiyor.');
      }
      const stream = await waitFor(navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
      }), signal, 30_000, 'Kamera izni zaman aşımına uğradı. İzin ayarlarını kontrol edip yeniden dene.', stopTracks);
      if (signal.aborted || run !== this.generation) {
        stopTracks(stream);
        return;
      }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        const ended = () => this.fail(new Error('Kamera bağlantısı kesildi. Yeniden başlatabilirsin.'), run);
        track.addEventListener('ended', ended);
        this.trackListeners.push(() => track.removeEventListener('ended', ended));
      }
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await waitFor(this.video.play().then(() => videoReady(this.video, signal)), signal, 12_000,
        'Kamera görüntüsü alınamadı. Kamerayı yeniden başlatmayı dene.');
      assertActive(signal);
      this.status('loading', 'El takibi modeli yükleniyor…');

      // Import, model download, WASM initialization and graph creation all share the deadline.
      // The non-abortable WASM initializer is closed if it finishes after cancellation.
      const model = await waitFor(this.loadModel(signal), signal, 30_000,
        'El takibi modeli yüklenemedi. İnternet bağlantını kontrol edip yeniden dene.', closeModel);
      if (signal.aborted || run !== this.generation) {
        closeModel(model);
        return;
      }
      this.model = model;
      this.lastInference = -Infinity;
      this.lastVideoTime = -1;
      this.lastPoseTime = 0;
      this.status('active', 'Kamera açık · Elini kadraja getir');
      this.frame = requestAnimationFrame(this.tick);
    } catch (error) {
      if (run === this.generation && !signal.aborted) this.fail(error, run);
    }
  }

  async loadModel(signal) {
    // Nothing from MediaPipe is loaded before the user explicitly starts the camera.
    const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    assertActive(signal);
    const response = await fetch(MODEL_URL, { signal });
    if (!response.ok) throw new Error('El takibi modeli indirilemedi. İnternet bağlantını kontrol edip yeniden dene.');
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    assertActive(signal);
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    assertActive(signal);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
  }

  tick(now) {
    this.frame = null;
    if (this.state !== 'active' || this.disposed) return;
    if (document.hidden) {
      this.stop();
      return;
    }
    try {
      if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime
          && now - this.lastInference >= FRAME_INTERVAL) {
        this.lastInference = now;
        this.lastVideoTime = this.video.currentTime;
        // detectForVideo is synchronous: only one inference runs, at most 18 times per second.
        const result = this.model.detectForVideo(this.video, now);
        this.processResult(result, now);
      }
      if (this.state === 'active') this.frame = requestAnimationFrame(this.tick);
    } catch {
      this.fail(new Error('El takibi durdu. Kamerayı yeniden başlatabilirsin.'), this.generation);
    }
  }

  processResult(result, now) {
    const landmarks = result?.landmarks?.[0];
    const nextPose = getHandPose(landmarks, this.video.videoWidth / this.video.videoHeight);
    if (!nextPose) {
      this.stabilizer.reset();
      this.pose = null;
      if (this.hadHand) this.onResult(null);
      this.hadHand = false;
      return;
    }
    const gesture = this.stabilizer.update(classifyGesture(landmarks, result.worldLandmarks?.[0]), now);
    if (this.pose) {
      const alpha = 1 - Math.exp(-Math.max(0, now - this.lastPoseTime) / 95);
      this.pose.x += (nextPose.x - this.pose.x) * alpha;
      this.pose.y += (nextPose.y - this.pose.y) * alpha;
      this.pose.scale += (nextPose.scale - this.pose.scale) * alpha;
      const angle = Math.atan2(Math.sin(nextPose.roll - this.pose.roll), Math.cos(nextPose.roll - this.pose.roll));
      this.pose.roll += angle * alpha;
    } else {
      this.pose = nextPose;
    }
    this.lastPoseTime = now;
    this.hadHand = true;
    this.onResult({
      ...this.pose,
      shape: GESTURE_SHAPES[gesture] ?? null,
      gesture: GESTURE_LABELS[gesture] ?? 'Hareketi sabit tut',
    });
  }

  release() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.startup = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const remove of this.trackListeners) remove();
    this.trackListeners = [];
    stopTracks(this.stream);
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    closeModel(this.model);
    this.model = null;
    this.stabilizer.reset();
    this.pose = null;
    this.hadHand = false;
    this.onResult(null);
  }

  fail(error, run) {
    if (run !== this.generation || this.disposed) return;
    this.release();
    this.status('error', errorMessage(error));
  }

  stop() {
    this.release();
    this.status('off', 'Kamera kapalı · Fare veya dokunarak keşfet');
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
  }
}
