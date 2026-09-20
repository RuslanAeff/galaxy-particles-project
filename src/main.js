import './styles.css';
import { ParticleScene } from './particle-scene.js';
import { HandTracker } from './hand-tracker.js';
import { SHAPES } from './shapes.js';

const $ = (id) => document.getElementById(id);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const numberFormat = new Intl.NumberFormat('tr-TR');
const icons = {
  galaxy: '<path d="M19 14c-5-5-13 0-10 7s16 5 17-4S13 1 7 10s-2 20 9 21"/><path d="M15 18c5 5 13 0 10-7S9 6 8 15s13 16 19 7"/><circle cx="17" cy="16" r="2"/>',
  torus: '<ellipse cx="17" cy="17" rx="14" ry="9" transform="rotate(-30 17 17)"/><ellipse cx="17" cy="17" rx="9" ry="5" transform="rotate(-30 17 17)"/>',
  dna: '<path d="M10 3c0 10 14 18 14 28M24 3c0 10-14 18-14 28M11 6h12M13 10h8M14 14h6M14 20h6M12 25h10M10 29h14"/>',
  vortex: '<ellipse cx="17" cy="8" rx="13" ry="4"/><path d="M5 9c2 8 7 16 12 21 4-5 8-13 12-21M8 15c6 3 12 3 18 0M11 21c4 2 8 2 12 0"/>',
  blackhole: '<ellipse cx="17" cy="18" rx="15" ry="5" transform="rotate(-20 17 18)"/><circle cx="17" cy="16" r="8"/><path d="M10 12a8 8 0 0 1 14 1"/><circle cx="17" cy="16" r="5" fill="currentColor" opacity=".12"/>',
  atom: '<ellipse cx="17" cy="17" rx="14" ry="5"/><ellipse cx="17" cy="17" rx="14" ry="5" transform="rotate(60 17 17)"/><ellipse cx="17" cy="17" rx="14" ry="5" transform="rotate(-60 17 17)"/><circle cx="17" cy="17" r="2" fill="currentColor"/>',
  nebula: '<circle cx="17" cy="17" r="11" stroke-dasharray="1 4"/><circle cx="17" cy="17" r="6" stroke-dasharray="1 3"/><circle cx="17" cy="17" r="1"/><path d="M5 7h2M27 26h2M26 6h1M6 26h1"/>',
};

let scene;
let selectedId = 'galaxy';
let paused = motionPreference.matches;
let tourEnabled = false;
let tourTimer;
let toastTimer;
let disposed = false;
const events = new AbortController();
const listen = (element, event, handler) => element.addEventListener(event, handler, { signal: events.signal });

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

for (const [index, shape] of SHAPES.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shape-button';
  button.dataset.shape = shape.id;
  button.style.setProperty('--shape-accent', shape.accent);
  button.setAttribute('aria-label', shape.name + ' — ' + shape.gesture);
  button.setAttribute('aria-pressed', String(shape.id === selectedId));
  button.title = shape.name + ' (' + (index + 1) + ')';
  // Metadata and icon paths are static, trusted application content.
  button.innerHTML = '<span class="shape-icon" aria-hidden="true"><svg viewBox="0 0 34 34">' + icons[shape.id] + '</svg></span><span class="shape-text"><span class="shape-title">' + shape.name + '</span><span class="shape-gesture">' + shape.gesture + '</span></span><span class="shape-number" aria-hidden="true">0' + (index + 1) + '</span>';
  listen(button, 'click', () => selectShape(shape.id, 'manual'));
  $('shape-list').append(button);

  const guide = document.createElement('div');
  guide.className = 'guide-item';
  guide.innerHTML = '<span aria-hidden="true">' + shape.emoji + '</span><span>' + shape.gesture + '<small>' + shape.name + '</small></span>';
  $('gesture-guide').append(guide);
}

const tracker = new HandTracker({
  video: $('webcam'),
  onStatus({ state, message }) {
    const isOn = state === 'active' || state === 'loading';
    $('tracking-status').dataset.state = state;
    $('status-text').textContent = state === 'off' ? 'Keşif modu · Kamera kapalı' : message;
    $('camera-button').setAttribute('aria-pressed', String(isOn));
    $('camera-button-label').textContent = state === 'loading' ? 'Başlatmayı iptal et' : state === 'active' ? 'El takibini kapat' : 'El takibini başlat';
    $('camera-preview').hidden = state !== 'active';
    $('gesture-card').hidden = state !== 'active';
    if (!isOn) scene?.setHand(null);
    if (state === 'active') {
      $('gesture-label').textContent = 'Elini kameraya göster';
      $('gesture-emoji').textContent = '✋';
    }
  },
  onResult(hand) {
    scene?.setHand(hand);
    if (hand?.shape) selectShape(hand.shape, 'hand');
    $('gesture-label').textContent = hand?.gesture || 'Elini kameraya göster';
    $('gesture-emoji').textContent = SHAPES.find(({ id }) => id === hand?.shape)?.emoji || '✋';
  },
});

function selectShape(id, origin = 'manual') {
  const shape = SHAPES.find((item) => item.id === id);
  if (!shape) return;
  if (origin === 'manual') {
    tracker.stop();
    setTour(false);
  }
  if (id === selectedId && origin !== 'initial') return;
  selectedId = id;
  scene?.setShape(id);
  document.querySelectorAll('.shape-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.shape === id));
  });
  $('scene-subtitle').textContent = shape.name;
  $('shape-description').textContent = shape.description;
  $('scene').setAttribute('aria-label', shape.name + ' parçacık görünümü. Sürükleyerek veya ok tuşlarıyla döndürün; tekerlek veya artı ve eksi tuşlarıyla yakınlaştırın.');
}

function scheduleTour() {
  clearTimeout(tourTimer);
  if (tourEnabled && !paused && !document.hidden && scene) {
    tourTimer = setTimeout(() => {
      const index = SHAPES.findIndex(({ id }) => id === selectedId);
      selectShape(SHAPES[(index + 1) % SHAPES.length].id, 'tour');
      scheduleTour();
    }, 8000);
  }
}

function setTour(enabled) {
  tourEnabled = enabled;
  $('tour-button').setAttribute('aria-pressed', String(enabled));
  $('tour-label').textContent = enabled ? 'Keşfi durdur' : 'Otomatik keşif';
  scheduleTour();
}

function syncPause() {
  $('pause-button').setAttribute('aria-pressed', String(paused));
  $('pause-button').setAttribute('aria-label', paused ? 'Animasyonu sürdür' : 'Animasyonu duraklat');
  $('pause-button').innerHTML = paused
    ? '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="m6 3 10 7-10 7z"/></svg>'
    : '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5 4h3v12H5zm7 0h3v12h-3z"/></svg>';
  scene?.setPaused(paused);
  scheduleTour();
}

function showSceneError(message) {
  $('scene-loading').hidden = true;
  $('scene-error').hidden = false;
  $('scene-error-text').textContent = message;
  $('camera-button').disabled = true;
  tracker.stop();
  setTour(false);
}

function initializeScene() {
  scene?.dispose();
  scene = null;
  $('scene-error').hidden = true;
  $('scene-loading').hidden = false;
  try {
    scene = new ParticleScene($('scene'), {
      reducedMotion: motionPreference.matches,
      onMetrics({ count, fps }) {
        if (count != null) $('particle-count').textContent = numberFormat.format(count);
        if (fps != null) $('fps').textContent = String(fps);
      },
      onError: showSceneError,
      onRestore() { $('scene-error').hidden = true; $('camera-button').disabled = false; },
    });
    scene.setShape(selectedId);
    scene.setSpeed(Number($('speed').value));
    scene.setQuality($('quality').value);
    syncPause();
    $('camera-button').disabled = false;
    $('scene-loading').hidden = true;
  } catch (error) {
    console.error('Particle scene could not start:', error);
    showSceneError('Bu deneyim WebGL 2 gerektiriyor. Tarayıcını güncelleyip donanım hızlandırmasını etkinleştirmeyi dene.');
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else toast('Bu tarayıcıda tam ekran desteklenmiyor.');
  } catch { toast('Tam ekran açılamadı. Tarayıcı izinlerini kontrol et.'); }
}

listen($('camera-button'), 'click', () => {
  if (tracker.state === 'loading' || tracker.state === 'active') tracker.stop();
  else { setTour(false); void tracker.start(); }
});
listen($('camera-close'), 'click', () => tracker.stop());
listen($('tour-button'), 'click', () => {
  if (!scene) return;
  if (paused && !tourEnabled) { toast('Otomatik keşif için önce animasyonu sürdür.'); return; }
  tracker.stop();
  setTour(!tourEnabled);
});
listen($('pause-button'), 'click', () => { paused = !paused; syncPause(); });
listen($('speed'), 'input', () => {
  const speed = Number($('speed').value);
  $('speed-value').textContent = speed.toFixed(1) + '×';
  scene?.setSpeed(speed);
});
listen($('quality'), 'change', () => scene?.setQuality($('quality').value));
listen($('reset-button'), 'click', () => { scene?.resetView(); toast('Görünüm sıfırlandı.'); });
listen($('fullscreen-button'), 'click', () => void toggleFullscreen());
listen(document, 'fullscreenchange', () => {
  $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Tam ekrandan çık' : 'Tam ekranı aç');
});
listen($('help-button'), 'click', () => $('help-dialog').showModal());
listen($('help-close'), 'click', () => $('help-dialog').close());
listen($('help-dialog'), 'click', (event) => {
  if (event.target !== $('help-dialog')) return;
  const rect = $('help-dialog').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('help-dialog').close();
});
listen($('retry-button'), 'click', initializeScene);
listen(motionPreference, 'change', (event) => {
  scene?.setReducedMotion(event.matches);
  if (event.matches) { paused = true; setTour(false); syncPause(); }
});
listen(document, 'visibilitychange', () => {
  if (document.hidden) tracker.stop();
  scheduleTour();
});
listen(document, 'keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || $('help-dialog').open) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.isContentEditable || target?.matches('input, select, textarea')) return;
  const index = Number(event.key) - 1;
  if (event.code === 'Space') {
    // The space bar belongs to a focused control, which activates on it.
    if (target?.matches('button, a[href], summary')) return;
    event.preventDefault();
    paused = !paused;
    syncPause();
  } else if (Number.isInteger(index) && index >= 0 && index < SHAPES.length) selectShape(SHAPES[index].id);
  else if (event.key.toLowerCase() === 'r') scene?.resetView();
  else if (event.key.toLowerCase() === 'f') void toggleFullscreen();
});

function dispose() {
  if (disposed) return;
  disposed = true;
  clearTimeout(tourTimer);
  clearTimeout(toastTimer);
  events.abort();
  tracker.dispose();
  scene?.dispose();
}
// Preserve a bfcache-restored page, but never preserve an active camera stream.
listen(window, 'pagehide', (event) => { tracker.stop(); if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);

selectShape(selectedId, 'initial');
initializeScene();
