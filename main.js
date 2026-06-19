/**
 * main.js — RubikSynth bootstrap
 *
 * Manages: global Transport, cube mosaic, global UI, VU animation loop
 */
import {
  createSolvedState, applyMove, scramble, buildSolution,
  createCubeSVG, updateCubeSVG, flashFace,
  getFaceIndex, getCenterColor,
  COLOR_CSS, FACE_SIZE,
} from './modules/cube.js';

import {
  createAudioChain, initMasterBus, triggerNote,
  disposeChain, SCALES, ROOT_NOTES,
} from './modules/audio.js';

import {
  renderLegend, renderSidebarParams,
} from './modules/ui.js';

// ─── GLOBAL STATE ─────────────────────────────────────────────────────────────
const state = {
  playing:        false,
  bpm:            100,
  volume:         75,
  scaleType:      'pentatonic',
  cubes:          new Map(),
  nextId:         1,
  audioReady:     false,
  panX:           0,
  panY:           0,
  scale:          1,
  templates:      [],
  solvedCount:    0,
  autoRestart:    true,
  selectedCubeId: null,
};

// ─── CUBE CLASS ───────────────────────────────────────────────────────────────
class CubeInstance {
  constructor(id) {
    this.id          = id;
    this.state       = createSolvedState();
    this.solution    = [];
    this.movesDone   = 0;
    this.schedulerId = null;
    this.paused      = false;

    this.config = {
      subdivision:   '4n',
      synthType:     this._randomSynth(),
      baseOctave:    3 + Math.floor(Math.random() * 3),
      scaleOverride: null,
      attack:        0.02,
      decay:         0.1,
      sustain:       0.3,
      release:       0.5,
      reverbWet:     Math.random() * 0.4,
      delayTime:     ['8n','8n','4n','16n'][Math.floor(Math.random() * 4)],
      delayFeedback: Math.random() * 0.35,
      filterFreq:    800 + Math.random() * 3000,
      panning:       (Math.random() * 2 - 1) * 0.8,
      cubeVolume:    0,
      rootSemitone:  0,   // 0=C, 2=D, 4=E, 5=F, 7=G, 9=A, 11=B
    };

    this.chain = createAudioChain(this.config);

    // DOM refs
    this.card  = null;
    this.svgEl = null;
  }

  _randomSynth() {
    return ['Synth','Synth','FMSynth','AMSynth','PluckSynth'][Math.floor(Math.random() * 5)];
  }

  getScale() {
    return this.config.scaleOverride || state.scaleType;
  }

  start() {
    this.paused = false;
    this._newCycle();
  }

  pause() {
    this.paused = true;
    this._clearSchedule();
  }

  resume() {
    if (this.paused) { this.paused = false; this._scheduleNext(); }
  }

  triggerScramble() {
    this._clearSchedule();
    this.state = createSolvedState();
    this.solution = [];
    this._newCycle();
  }

  restartScheduler() {
    if (!state.playing) return;
    this._clearSchedule();
    this._scheduleNext();
  }

  _clearSchedule() {
    if (this.schedulerId !== null) {
      Tone.Transport.clear(this.schedulerId);
      this.schedulerId = null;
    }
  }

  _newCycle() {
    const moves   = scramble(this.state, 18 + Math.floor(Math.random() * 8));
    this.solution = buildSolution(moves);
    this.movesDone = 0;
    this._scheduleNext();
  }

  _scheduleNext() {
    if (this.paused || !state.playing) return;
    this._clearSchedule(); // guard against double-scheduling
    this.schedulerId = Tone.Transport.scheduleRepeat(time => {
      this._tick(time);
    }, this.config.subdivision, Tone.Transport.now());
  }

  _tick(time) {
    if (this.paused) return;

    if (this.solution.length === 0) {
      this._clearSchedule();
      this.card?.classList.add('solved');
      setTimeout(() => this.card?.classList.remove('solved'), 800);

      state.solvedCount++;
      const counterEl = document.getElementById('solved-count');
      if (counterEl) counterEl.textContent = state.solvedCount;

      if (state.autoRestart) {
        const pauseMs = 1400 + Math.random() * 600;
        setTimeout(() => {
          if (!this.paused && state.playing && this.schedulerId === null) {
            this._newCycle();
          }
        }, pauseMs);
      }
      return;
    }

    const move      = this.solution.shift();
    const faceIdx   = getFaceIndex(move);
    const direction = move.includes("'") ? 'ccw' : move.includes('2') ? 'double' : 'cw';

    applyMove(this.state, move);

    const colorIdx = getCenterColor(this.state, faceIdx);

    try {
      triggerNote(this.chain, colorIdx, direction, {
        baseOctave:   this.config.baseOctave,
        scaleType:    this.getScale(),
        subdivision:  this.config.subdivision,
        rootSemitone: this.config.rootSemitone ?? 0,
      }, time);
    } catch (e) {
      console.warn('triggerNote error:', e);
    }

    // Visual update: delay to match the scheduled audio time
    const delayMs = Math.max(0, (time - Tone.now()) * 1000);
    setTimeout(() => {
      if (this.svgEl) {
        updateCubeSVG(this.svgEl, this.state, `cube-${this.id}`);
        flashFace(this.svgEl, faceIdx, `cube-${this.id}`);
      }
    }, delayMs);
  }

  dispose() {
    this.pause();
    disposeChain(this.chain);
  }
}

// ─── CUBE LAYOUT & RENDERING ─────────────────────────────────────────────────
function getNextFreePlacement() {
  const occupied = new Set([...state.cubes.values()].map(c => `${c.q},${c.r}`));
  let ring = 0;
  while (true) {
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        if (Math.max(Math.abs(q), Math.abs(r)) === ring && !occupied.has(`${q},${r}`)) {
          return { q, r };
        }
      }
    }
    ring++;
  }
}

function renderCubeCard(cube) {
  const card = document.createElement('div');
  card.className = 'cube-card';
  card.id        = `card-${cube.id}`;
  card.dataset.cubeId = cube.id;

  // SVG net
  const svgEl = createCubeSVG(`cube-${cube.id}`);
  cube.svgEl  = svgEl;

  const badge = document.createElement('div');
  badge.className = 'scale-badge';
  badge.textContent = '';

  card.appendChild(badge);
  card.appendChild(svgEl);

  // Grid position — interlocking layout vectors u=[4,0], v=[1,2] (in face units)
  const faceX = cube.q * 4 + cube.r * 1;
  const faceY = cube.q * 0 + cube.r * 2;
  card.style.left = `calc(-50% + ${faceX * FACE_SIZE}px)`;
  card.style.top  = `calc(-50% + ${faceY * FACE_SIZE}px)`;

  card.addEventListener('click', () => {
    document.querySelectorAll('.cube-card.selected').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.selectedCubeId = cube.id;
    renderSidebarParams(cube, state.templates, removeCube, id => {
      const c = state.cubes.get(id);
      if (c) c.triggerScramble();
    });
  });

  cube.card = card;
  return card;
}

function addCube() {
  if (state.cubes.size >= 96) return;

  const cube = new CubeInstance(state.nextId++);
  const pos  = getNextFreePlacement();
  cube.q = pos.q;
  cube.r = pos.r;

  state.cubes.set(cube.id, cube);

  const card = renderCubeCard(cube);
  document.getElementById('mosaic').appendChild(card);
  toggleEmptyState();

  if (state.playing) {
    cube.start();
    card.classList.add('playing');
  }
}

function removeCube(id) {
  const cube = state.cubes.get(id);
  if (!cube) return;
  cube.dispose();
  state.cubes.delete(id);
  document.getElementById(`card-${id}`)?.remove();

  if (state.selectedCubeId === id) {
    state.selectedCubeId = null;
    renderSidebarParams(null, state.templates, removeCube, () => {});
  }

  toggleEmptyState();
}

function toggleEmptyState() {
  document.getElementById('empty-state').style.display =
    state.cubes.size === 0 ? 'flex' : 'none';
}

// ─── PLAY / PAUSE ─────────────────────────────────────────────────────────────
async function togglePlay() {
  if (!state.audioReady) {
    await Tone.start();
    initMasterBus();
    state.audioReady = true;
  }

  state.playing = !state.playing;
  const btn  = document.getElementById('btn-play');
  const icon = document.getElementById('play-icon');

  if (state.playing) {
    Tone.Transport.bpm.value = state.bpm;
    Tone.Transport.start();
    btn.classList.add('playing');
    icon.textContent = '⏸';
    state.cubes.forEach(cube => {
      cube.start();
      cube.card?.classList.add('playing');
    });
  } else {
    Tone.Transport.pause();
    btn.classList.remove('playing');
    icon.textContent = '▶';
    state.cubes.forEach(cube => {
      cube.pause();
      cube.card?.classList.remove('playing');
    });
  }
}

// ─── TRANSPORT CONTROLS ───────────────────────────────────────────────────────
function syncBPM(val) {
  state.bpm = Math.max(20, Math.min(300, parseInt(val) || 100));
  document.getElementById('input-bpm').value = state.bpm;
  if (state.playing) Tone.Transport.bpm.value = state.bpm;
}

function syncVolume(val) {
  state.volume = Math.max(0, Math.min(100, parseInt(val) || 75));
  Tone.Destination.volume.value = Tone.gainToDb(state.volume / 100);
  updateRangeGradient(document.getElementById('slider-vol'));
}

function updateRangeGradient(input) {
  const min = parseFloat(input.min), max = parseFloat(input.max), val = parseFloat(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to right, rgba(255,255,255,0.7) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
}

// ─── PAN & ZOOM ───────────────────────────────────────────────────────────────
function setupPanZoom() {
  const wrap   = document.getElementById('mosaic-wrap');
  const mosaic = document.getElementById('mosaic');
  let dragging = false, startX = 0, startY = 0;

  function applyTransform() {
    mosaic.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  }

  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.cube-card')) return;
    dragging = true;
    startX = e.clientX - state.panX;
    startY = e.clientY - state.panY;
    wrap.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    state.panX = e.clientX - startX;
    state.panY = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    wrap.style.cursor = 'grab';
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const rect  = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldScale = state.scale;
    state.scale = Math.max(0.1, Math.min(3, state.scale + delta));
    state.panX = mx - (mx - state.panX) * (state.scale / oldScale);
    state.panY = my - (my - state.panY) * (state.scale / oldScale);
    applyTransform();
  }, { passive: false });

  applyTransform();

  // Zoom buttons
  const applyZoom = () => {
    mosaic.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  };
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.scale = Math.min(3, state.scale + 0.2); applyZoom();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.scale = Math.max(0.1, state.scale - 0.2); applyZoom();
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  // Load templates
  try {
    const res = await fetch('templates.yaml');
    if (res.ok) {
      const doc = jsyaml.load(await res.text());
      if (doc?.templates) state.templates = doc.templates;
    }
  } catch { /* templates optional */ }

  renderLegend(document.getElementById('legend'), state.scaleType);
  setupPanZoom();

  // Play button
  document.getElementById('btn-play').addEventListener('click', togglePlay);

  // Add cube
  document.getElementById('btn-add').addEventListener('click', addCube);

  // Sidebar toggle
  document.getElementById('btn-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('closed');
  });

  // BPM (live + commit)
  const bpmInput = document.getElementById('input-bpm');
  bpmInput.addEventListener('input',  e => syncBPM(e.target.value));
  bpmInput.addEventListener('change', e => syncBPM(e.target.value));

  // Volume
  const volSlider = document.getElementById('slider-vol');
  volSlider.addEventListener('input', e => syncVolume(e.target.value));
  updateRangeGradient(volSlider);

  // Global scale
  document.getElementById('select-scale').addEventListener('change', e => {
    state.scaleType = e.target.value;
    renderLegend(document.getElementById('legend'), state.scaleType);
  });

  // Scramble all
  document.getElementById('btn-scramble-all').addEventListener('click', () => {
    state.cubes.forEach(c => c.triggerScramble());
  });

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('Remove all cubes?')) return;
    renderSidebarParams(null, state.templates, removeCube, () => {});
    [...state.cubes.keys()].forEach(id => removeCube(id));
  });

  // Auto-restart
  document.getElementById('check-autorestart').addEventListener('change', e => {
    state.autoRestart = e.target.checked;
  });

  // Help modal
  document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help-modal-overlay').classList.remove('hidden');
  });
  document.getElementById('btn-close-help').addEventListener('click', () => {
    document.getElementById('help-modal-overlay').classList.add('hidden');
  });
  document.getElementById('help-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  toggleEmptyState();
}

document.addEventListener('DOMContentLoaded', init);
