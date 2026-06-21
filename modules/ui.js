/**
 * ui.js — Color legend and cube inspector sidebar
 */
import { COLOR_CSS, COLOR_NAME } from './cube.js';
import {
  setReverb, setDelayTime, setDelayFeedback,
  setFilterFreq, setPanning, setCubeVolume,
  replaceSynth, updateEnvelope, ROOT_NOTES,
} from './audio.js';

function updateRangeGradient(input) {
  const min = parseFloat(input.min), max = parseFloat(input.max), val = parseFloat(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to right, rgba(255,255,255,0.7) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
}

// ─── LEGEND ───────────────────────────────────────────────────────────────────
const SCALE_NOTES = {
  pentatonic: ['C', 'D', 'E', 'G', 'A', 'C'],
  major:      ['C', 'D', 'E', 'F', 'G', 'A'],
  minor:      ['C', 'D', 'Eb', 'F', 'G', 'Ab'],
  blues:      ['C', 'Eb', 'F', 'F#', 'G', 'Bb'],
  wholetone:  ['C', 'D', 'E', 'F#', 'Ab', 'Bb'],
};

export function renderLegend(container, scaleType) {
  const notes = SCALE_NOTES[scaleType] || SCALE_NOTES.pentatonic;
  container.innerHTML = '';
  COLOR_CSS.forEach((css, i) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `
      <div class="legend-swatch" style="background:${css}"></div>
      <span class="legend-name">${COLOR_NAME[i]}</span>
      <span class="legend-note">${notes[i]}</span>
    `;
    container.appendChild(row);
  });
}

// ─── INSPECTOR ────────────────────────────────────────────────────────────────
export function renderSidebarParams(cube, templates, onDelete, onScramble) {
  const inspector = document.getElementById('cube-inspector');
  const body      = document.getElementById('cube-inspector-body');

  if (!cube) {
    inspector.style.display = 'none';
    return;
  }

  inspector.style.display = 'block';
  const cfg = cube.config;

  body.innerHTML = `
    <div class="insp-section-label">Preset</div>
    <div class="inspector-row">
      <select id="insp-template" style="width:100%">
        <option value="">(Custom)</option>
        ${templates.map((t, i) => `<option value="${i}">${t.name}</option>`).join('')}
      </select>
    </div>

    <div class="insp-section-label" style="margin-top:14px">Secuencia</div>
    <div class="inspector-row">
      <span class="inspector-label">Escala</span>
      <select id="insp-scale">
        <option value="">(global)</option>
        <option value="pentatonic" ${cfg.scaleOverride==='pentatonic'?'selected':''}>Pentatónica</option>
        <option value="major"      ${cfg.scaleOverride==='major'?'selected':''}>Mayor</option>
        <option value="minor"      ${cfg.scaleOverride==='minor'?'selected':''}>Menor</option>
        <option value="blues"      ${cfg.scaleOverride==='blues'?'selected':''}>Blues</option>
        <option value="wholetone"  ${cfg.scaleOverride==='wholetone'?'selected':''}>Tonos enteros</option>
      </select>
    </div>

    <div class="inspector-row">
      <span class="inspector-label">Pausa</span>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8rem;color:var(--text-muted)">
        <input type="checkbox" id="insp-random-pause" ${cfg.randomPause ? 'checked' : ''}>
        aleatoria
      </label>
    </div>

    <div class="insp-section-label" style="margin-top:14px">Synth</div>
    <div class="inspector-row">
      <span class="inspector-label">Type</span>
      <select id="insp-synth">
        ${['Synth','FMSynth','AMSynth','MonoSynth','PluckSynth'].map(t =>
          `<option value="${t}" ${cfg.synthType === t ? 'selected' : ''}>${t}</option>`
        ).join('')}
      </select>
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Octave</span>
      <input type="number" id="insp-octave" min="2" max="6" value="${cfg.baseOctave}" style="width:60px">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Raíz</span>
      <select id="insp-root">
        ${ROOT_NOTES.map((n, i) => `<option value="${i}" ${(cfg.rootSemitone??0)===i?'selected':''}>${n}</option>`).join('')}
      </select>
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Grid</span>
      <select id="insp-subdiv">
        ${[['32n','1/32'],['16n','1/16'],['8n','1/8'],['4n','1/4'],['2n','1/2']].map(([v,l]) =>
          `<option value="${v}" ${cfg.subdivision === v ? 'selected' : ''}>${l}</option>`
        ).join('')}
      </select>
    </div>

    <div class="insp-section-label" style="margin-top:14px">Envelope</div>
    <div class="inspector-row">
      <span class="inspector-label">A</span>
      <input type="range" id="insp-a" min="1" max="200" value="${Math.round(cfg.attack * 100)}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">D</span>
      <input type="range" id="insp-d" min="1" max="200" value="${Math.round(cfg.decay * 100)}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">S</span>
      <input type="range" id="insp-s" min="0" max="100" value="${Math.round(cfg.sustain * 100)}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">R</span>
      <input type="range" id="insp-r" min="10" max="500" value="${Math.round(cfg.release * 100)}">
    </div>

    <div class="insp-section-label" style="margin-top:14px">FX</div>
    <div class="inspector-row">
      <span class="inspector-label">Volume</span>
      <input type="range" id="insp-vol" min="-40" max="6" value="${cfg.cubeVolume ?? 0}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Reverb</span>
      <input type="range" id="insp-reverb" min="0" max="100" value="${Math.round(cfg.reverbWet * 100)}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Delay</span>
      <input type="range" id="insp-delay-fb" min="0" max="85" value="${Math.round(cfg.delayFeedback * 100)}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Filter</span>
      <input type="range" id="insp-filter" min="100" max="8000" value="${cfg.filterFreq}">
    </div>
    <div class="inspector-row">
      <span class="inspector-label">Pan</span>
      <input type="range" id="insp-pan" min="-100" max="100" value="${Math.round(cfg.panning * 100)}">
    </div>

    <div class="action-row">
      <button class="action-btn" id="insp-scramble">Scramble</button>
      <button class="action-btn danger" id="insp-delete">Remove</button>
    </div>
  `;

  // Init range gradients
  body.querySelectorAll('input[type=range]').forEach(updateRangeGradient);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const markCustom = () => { body.querySelector('#insp-template').value = ''; };

  // ── Template ─────────────────────────────────────────────────────────────
  // Only timbre parameters are inherited from the preset.
  // Grid/sequence parameters (subdivision, scaleOverride, baseOctave,
  // rootSemitone, pauseAfterSolve) are intentionally preserved.
  const TIMBRE_KEYS = [
    'synthType','oscillatorType','modulationIndex','harmonicity',
    'attack','decay','sustain','release',
    'reverbWet','delayTime','delayFeedback','filterFreq',
    'panning','cubeVolume',
  ];

  body.querySelector('#insp-template').addEventListener('change', e => {
    const idx = e.target.value;
    if (idx === '') return;
    const tpl = templates[parseInt(idx, 10)].config;
    // Apply only timbre keys, leave sequence/grid keys untouched
    TIMBRE_KEYS.forEach(k => { if (k in tpl) cfg[k] = tpl[k]; });
    replaceSynth(cube.chain, cfg);
    setReverb(cube.chain, cfg.reverbWet);
    setDelayFeedback(cube.chain, cfg.delayFeedback);
    setDelayTime(cube.chain, cfg.delayTime);
    setFilterFreq(cube.chain, cfg.filterFreq);
    // Update only the timbre-related inputs
    body.querySelector('#insp-synth').value       = cfg.synthType;
    body.querySelector('#insp-a').value           = Math.round(cfg.attack * 100);
    body.querySelector('#insp-d').value           = Math.round(cfg.decay * 100);
    body.querySelector('#insp-s').value           = Math.round(cfg.sustain * 100);
    body.querySelector('#insp-r').value           = Math.round(cfg.release * 100);
    body.querySelector('#insp-vol').value         = cfg.cubeVolume ?? 0;
    body.querySelector('#insp-reverb').value      = Math.round(cfg.reverbWet * 100);
    body.querySelector('#insp-delay-fb').value    = Math.round(cfg.delayFeedback * 100);
    body.querySelector('#insp-filter').value      = cfg.filterFreq;
    body.querySelectorAll('input[type=range]').forEach(updateRangeGradient);
    e.target.value = idx;
  });

  // ── Scale override ────────────────────────────────────────────────────────
  body.querySelector('#insp-scale').addEventListener('change', e => {
    cfg.scaleOverride = e.target.value || null;
    markCustom();
  });

  // ── Root note ─────────────────────────────────────────────────────────────
  body.querySelector('#insp-root').addEventListener('change', e => {
    cfg.rootSemitone = parseInt(e.target.value);
    markCustom();
  });

  // ── Synth type ────────────────────────────────────────────────────────────
  body.querySelector('#insp-synth').addEventListener('change', e => {
    cfg.synthType = e.target.value;
    replaceSynth(cube.chain, cfg);
    markCustom();
  });

  // ── Octave ────────────────────────────────────────────────────────────────
  body.querySelector('#insp-octave').addEventListener('input', e => {
    cfg.baseOctave = Math.max(2, Math.min(6, parseInt(e.target.value) || 4));
    markCustom();
  });

  // ── Subdivision ───────────────────────────────────────────────────────────
  body.querySelector('#insp-subdiv').addEventListener('change', e => {
    cfg.subdivision = e.target.value;
    cube.restartScheduler();
    markCustom();
  });

  // ── Random pause ──────────────────────────────────────────────────────────────
  body.querySelector('#insp-random-pause').addEventListener('change', e => {
    cfg.randomPause = e.target.checked;
    markCustom();
  });

  // ── ADSR ──────────────────────────────────────────────────────────────────
  const syncADSR = () => {
    cfg.attack  = parseInt(body.querySelector('#insp-a').value) / 100;
    cfg.decay   = parseInt(body.querySelector('#insp-d').value) / 100;
    cfg.sustain = parseInt(body.querySelector('#insp-s').value) / 100;
    cfg.release = parseInt(body.querySelector('#insp-r').value) / 100;
    updateEnvelope(cube.chain, cfg);
    markCustom();
  };
  ['#insp-a','#insp-d','#insp-s','#insp-r'].forEach(id => {
    const el = body.querySelector(id);
    el.addEventListener('input', e => { updateRangeGradient(e.target); syncADSR(); });
  });

  // ── FX ────────────────────────────────────────────────────────────────────
  body.querySelector('#insp-vol').addEventListener('input', e => {
    cfg.cubeVolume = parseInt(e.target.value);
    setCubeVolume(cube.chain, cfg.cubeVolume);
    updateRangeGradient(e.target); markCustom();
  });
  body.querySelector('#insp-reverb').addEventListener('input', e => {
    cfg.reverbWet = parseInt(e.target.value) / 100;
    setReverb(cube.chain, cfg.reverbWet);
    updateRangeGradient(e.target); markCustom();
  });
  body.querySelector('#insp-delay-fb').addEventListener('input', e => {
    cfg.delayFeedback = parseInt(e.target.value) / 100;
    setDelayFeedback(cube.chain, cfg.delayFeedback);
    updateRangeGradient(e.target); markCustom();
  });
  body.querySelector('#insp-filter').addEventListener('input', e => {
    cfg.filterFreq = parseInt(e.target.value);
    setFilterFreq(cube.chain, cfg.filterFreq);
    updateRangeGradient(e.target); markCustom();
  });
  body.querySelector('#insp-pan').addEventListener('input', e => {
    cfg.panning = parseInt(e.target.value) / 100;
    setPanning(cube.chain, cfg.panning);
    updateRangeGradient(e.target); markCustom();
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  body.querySelector('#insp-scramble').addEventListener('click', () => onScramble(cube.id));
  body.querySelector('#insp-delete').addEventListener('click', () => {
    onDelete(cube.id);
    renderSidebarParams(null, templates, onDelete, onScramble);
  });
}
