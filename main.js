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
  disposeChain, setDelayTime,
} from './modules/audio.js';

import {
  rhythm, startRhythm, stopRhythm, setSwing,
  loadRhythmPreset, cycleStep, TIMBRE_CLASS,
  initRhythmSynth, setRhythmVolume, setRhythmKit, KITS,
} from './modules/rhythm.js';

import {
  renderLegend, renderSidebarParams,
} from './modules/ui.js';

// Random pause values (in bars) — always multiples of 0.5 so re-entry stays on the grid.
// Weighted towards 1-2 bars; 0 = restart at the very next bar boundary (no silence).
const PAUSE_OPTIONS = [0, 1, 1, 2, 2, 3];

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
  rhythms:        [],
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
      rootSemitone:  0,
      randomPause:   true, // pick a random bar-aligned pause on each solve
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
    // If the cube just solved and is waiting for the scheduleOnce to fire,
    // don't create a new scheduler — the pending restart will pick up the
    // new subdivision when _newCycle → _scheduleNext runs.
    if (this.solution.length === 0 && this.schedulerId === null) return;
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
    this._scheduleNext();
    // Show scrambled state immediately so the SVG doesn't flicker on the first tick
    if (this.svgEl) updateCubeSVG(this.svgEl, this.state, `cube-${this.id}`);
  }

  _scheduleNext() {
    if (this.paused || !state.playing) return;
    this._clearSchedule();
    // startTime=0 anchors this cube to the global Transport grid (same as the rhythm).
    // Tone.js schedules the first callback at the next subdivision boundary from t=0,
    // which is always phase-locked with any other startTime=0 scheduleRepeat.
    this.schedulerId = Tone.Transport.scheduleRepeat(time => {
      this._tick(time);
    }, this.config.subdivision, 0);
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
        const pauseBars = this.config.randomPause
          ? PAUSE_OPTIONS[Math.floor(Math.random() * PAUSE_OPTIONS.length)]
          : 1;
        const barSec  = Tone.Time('1m').toSeconds();
        // Epsilon keeps restartAt strictly in the future even when pos lands on a bar boundary.
        const pos     = Tone.Transport.seconds + 1e-6;
        const nextBar = barSec > 0 ? Math.ceil(pos / barSec) * barSec : barSec;
        const restartAt = nextBar + pauseBars * barSec;
        Tone.Transport.scheduleOnce(() => {
          if (!this.paused && state.playing && this.schedulerId === null) {
            this._newCycle();
          }
        }, restartAt);
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
    initRhythmSynth();
    state.audioReady = true;
  }

  state.playing = !state.playing;
  const btn  = document.getElementById('btn-play');
  const icon = document.getElementById('play-icon');

  if (state.playing) {
    Tone.Transport.bpm.value = state.bpm;
    Tone.Transport.start();
    startRhythm();
    btn.classList.add('playing');
    icon.textContent = '⏸';
    state.cubes.forEach(cube => {
      cube.start();
      cube.card?.classList.add('playing');
    });
  } else {
    Tone.Transport.pause();
    stopRhythm();
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
  state.bpm = parseInt(val) || 100;
  document.getElementById('input-bpm').value = state.bpm;
  if (state.playing) {
    Tone.Transport.bpm.value = state.bpm;
    // Re-apply delay times so existing FeedbackDelay nodes track the new BPM.
    state.cubes.forEach(cube => {
      if (cube.chain && cube.config?.delayTime) {
        setDelayTime(cube.chain, cube.config.delayTime);
      }
    });
  }
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

  // Start smaller on mobile so cubes aren't gigantic
  if (window.innerWidth < 768) state.scale = 0.55;

  function applyTransform() {
    mosaic.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  }

  // ── Mouse ──────────────────────────────────────────────────────────────────
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

  // ── Touch (pan + pinch zoom) ───────────────────────────────────────────────
  let touchStartX = 0, touchStartY = 0, lastPinchDist = 0;

  function pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      if (e.target.closest('.cube-card')) return;
      touchStartX = e.touches[0].clientX - state.panX;
      touchStartY = e.touches[0].clientY - state.panY;
    } else if (e.touches.length === 2) {
      lastPinchDist = pinchDist(e.touches);
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      state.panX = e.touches[0].clientX - touchStartX;
      state.panY = e.touches[0].clientY - touchStartY;
    } else if (e.touches.length === 2) {
      const dist     = pinchDist(e.touches);
      const oldScale = state.scale;
      state.scale    = Math.max(0.1, Math.min(3, state.scale * (dist / lastPinchDist)));
      lastPinchDist  = dist;
      // Zoom toward midpoint of two fingers
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = wrap.getBoundingClientRect();
      const cx = mx - rect.left, cy = my - rect.top;
      state.panX = cx - (cx - state.panX) * (state.scale / oldScale);
      state.panY = cy - (cy - state.panY) * (state.scale / oldScale);
    }
    applyTransform();
  }, { passive: false });

  applyTransform();

  // ── Zoom buttons ───────────────────────────────────────────────────────────
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.scale = Math.min(3, state.scale + 0.2); applyTransform();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.scale = Math.max(0.1, state.scale - 0.2); applyTransform();
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
      if (doc?.rhythms)   state.rhythms   = doc.rhythms;
    }
  } catch { /* templates optional */ }

  // Set Transport BPM immediately so any nodes created before first Play
  // (e.g. FeedbackDelay converting '8n' to seconds) use the correct tempo.
  Tone.Transport.bpm.value = state.bpm;

  renderLegend(document.getElementById('legend'), state.scaleType);
  setupPanZoom();

  // Play button
  document.getElementById('btn-play').addEventListener('click', togglePlay);

  // Add cube
  document.getElementById('btn-add').addEventListener('click', addCube);

  // Sidebar toggle + mobile overlay
  const sidebar        = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function openSidebar()  {
    sidebar.classList.remove('closed');
    sidebarOverlay.classList.add('active');
  }
  function closeSidebar() {
    sidebar.classList.add('closed');
    sidebarOverlay.classList.remove('active');
  }
  function toggleSidebar() {
    sidebar.classList.contains('closed') ? openSidebar() : closeSidebar();
  }

  document.getElementById('btn-sidebar').addEventListener('click', toggleSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

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

  // ── Rhythm module ─────────────────────────────────────────────────────────
  const swingSlider = document.getElementById('slider-swing');
  swingSlider.addEventListener('input', e => {
    setSwing(parseInt(e.target.value) / 100);
    updateRangeGradient(e.target);
    document.getElementById('select-rhythm').value = '';
  });
  updateRangeGradient(swingSlider);

  const rhythmVolSlider = document.getElementById('slider-rhythm-vol');
  rhythmVolSlider.addEventListener('input', e => {
    setRhythmVolume(parseInt(e.target.value));
    updateRangeGradient(e.target);
  });
  updateRangeGradient(rhythmVolSlider);

  // Kit selector — populate from KITS object
  const kitSelect = document.getElementById('select-kit');
  Object.entries(KITS).forEach(([key, kit]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = kit.label;
    kitSelect.appendChild(opt);
  });
  kitSelect.addEventListener('change', e => setRhythmKit(e.target.value));

  // Populate rhythm dropdown from YAML
  const rhythmSelect = document.getElementById('select-rhythm');
  state.rhythms.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = r.name;
    rhythmSelect.appendChild(opt);
  });

  rhythmSelect.addEventListener('change', e => {
    const idx = e.target.value;
    if (idx === '') return;
    const preset = state.rhythms[parseInt(idx, 10)];
    if (!preset) return;
    loadRhythmPreset(preset);
    // Sync swing slider to preset value
    const swingPct = Math.round((preset.swing ?? 0) * 100);
    swingSlider.value = swingPct;
    updateRangeGradient(swingSlider);
    initStepSequencer();
  });

  initStepSequencer();

  // Animate current step highlight
  (function animateSteps() {
    const btns = document.querySelectorAll('.step-btn');
    btns.forEach((btn, i) => {
      btn.classList.toggle('step-current', state.playing && i === rhythm.currentStep);
    });
    requestAnimationFrame(animateSteps);
  })();

  toggleEmptyState();
}

function initStepSequencer() {
  const seq = document.getElementById('step-sequencer');
  seq.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const btn = document.createElement('button');
    btn.className = 'step-btn';
    applyStepClass(btn, rhythm.steps[i]);
    btn.dataset.step = i;
    btn.title = `Step ${i + 1}`;
    btn.addEventListener('click', () => {
      cycleStep(i);
      applyStepClass(btn, rhythm.steps[i]);
      document.getElementById('select-rhythm').value = '';
    });
    seq.appendChild(btn);
  }
}

function applyStepClass(btn, val) {
  btn.classList.remove('step-bombo', 'step-caja', 'step-hihat');
  if (val) btn.classList.add(TIMBRE_CLASS[val]);
}

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('beforeunload', () => {
  Tone.Transport.stop();
  state.cubes.forEach(cube => cube.dispose());
  Tone.getContext().dispose();
});
