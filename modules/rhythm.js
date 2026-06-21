/**
 * rhythm.js — Per-step drum machine
 *
 * Each of the 16 steps holds: '' | 'bombo' | 'caja' | 'hihat'
 * Click on a step cycles through those states.
 *
 * Sync strategy: scheduleRepeat uses startTime=0 so every drum hit is anchored
 * to the global Transport grid. All cubes use the same anchor, so drums and
 * melodic events are always phase-locked regardless of when they are created.
 */

import { getMasterInput } from './audio.js';

export const rhythm = {
  steps:       Array(16).fill(''), // '' | 'bombo' | 'caja' | 'hihat'
  currentStep: -1,
  schedulerId: null,
  volume:      -6,
  kit:         '808',
};

export const TIMBRES      = ['', 'bombo', 'caja', 'hihat'];
export const TIMBRE_CLASS = { bombo: 'step-bombo', caja: 'step-caja', hihat: 'step-hihat' };

export function cycleStep(i) {
  const idx = TIMBRES.indexOf(rhythm.steps[i]);
  rhythm.steps[i] = TIMBRES[(idx + 1) % TIMBRES.length];
}

// ─── DRUM KITS ───────────────────────────────────────────────────────────────
export const KITS = {
  '808': {
    label: 'TR-808',
    bombo: { pitchDecay: 0.06, octaves: 7,  envelopeDecay: 0.35, note: 'C1' },
    caja:  { noiseType: 'white',  envelopeDecay: 0.14 },
    hihat: { frequency: 380,  harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, envelopeDecay: 0.04 },
  },
  '909': {
    label: 'TR-909',
    bombo: { pitchDecay: 0.02, octaves: 10, envelopeDecay: 0.15, note: 'C1' },
    caja:  { noiseType: 'pink',   envelopeDecay: 0.20 },
    hihat: { frequency: 800,  harmonicity: 5.1, modulationIndex: 40, resonance: 6000, octaves: 1.2, envelopeDecay: 0.02 },
  },
  'lofi': {
    label: 'Lo-fi',
    bombo: { pitchDecay: 0.12, octaves: 4,  envelopeDecay: 0.50, note: 'D1' },
    caja:  { noiseType: 'brown',  envelopeDecay: 0.30 },
    hihat: { frequency: 220,  harmonicity: 3.5, modulationIndex: 16, resonance: 2000, octaves: 2.0, envelopeDecay: 0.08 },
  },
  'electro': {
    label: 'Electro',
    bombo: { pitchDecay: 0.01, octaves: 12, envelopeDecay: 0.10, note: 'C1' },
    caja:  { noiseType: 'white',  envelopeDecay: 0.06 },
    hihat: { frequency: 1200, harmonicity: 6.0, modulationIndex: 50, resonance: 8000, octaves: 0.8, envelopeDecay: 0.015 },
  },
  'chip': {
    label: 'Chiptune',
    bombo: { pitchDecay: 0.01, octaves: 8,  envelopeDecay: 0.08, note: 'C2' },
    caja:  { noiseType: 'white',  envelopeDecay: 0.04 },
    hihat: { frequency: 2000, harmonicity: 7.0, modulationIndex: 60, resonance: 10000, octaves: 0.5, envelopeDecay: 0.01 },
  },
};

// ─── SYNTH CHAIN ─────────────────────────────────────────────────────────────
let _synths = null; // { bombo, caja, hihat, vol }

function buildSynths(kitName) {
  const k = KITS[kitName] || KITS['808'];

  const bombo = new Tone.MembraneSynth({
    pitchDecay: k.bombo.pitchDecay,
    octaves:    k.bombo.octaves,
    envelope:   { attack: 0.001, decay: k.bombo.envelopeDecay, sustain: 0, release: 0.05 },
  });
  const caja = new Tone.NoiseSynth({
    noise:    { type: k.caja.noiseType },
    envelope: { attack: 0.001, decay: k.caja.envelopeDecay, sustain: 0, release: 0.03 },
  });
  const hihat = new Tone.MetalSynth({
    frequency:       k.hihat.frequency,
    harmonicity:     k.hihat.harmonicity,
    modulationIndex: k.hihat.modulationIndex,
    resonance:       k.hihat.resonance,
    octaves:         k.hihat.octaves,
    envelope:        { attack: 0.001, decay: k.hihat.envelopeDecay, release: 0.005 },
  });

  return { bombo, caja, hihat };
}

export function initRhythmSynth() {
  disposeRhythmSynth();
  const { bombo, caja, hihat } = buildSynths(rhythm.kit);
  const vol = new Tone.Volume(rhythm.volume);

  // Route through the same master bus as cubes (Compressor → Limiter → Destination)
  bombo.connect(vol);
  caja.connect(vol);
  hihat.connect(vol);
  vol.connect(getMasterInput());

  _synths = { bombo, caja, hihat, vol };
}

export function setRhythmKit(kitName) {
  rhythm.kit = kitName;
  if (!_synths) return;
  const { bombo, caja, hihat } = buildSynths(kitName);
  _synths.bombo.dispose();
  _synths.caja.dispose();
  _synths.hihat.dispose();
  bombo.connect(_synths.vol);
  caja.connect(_synths.vol);
  hihat.connect(_synths.vol);
  _synths.bombo = bombo;
  _synths.caja  = caja;
  _synths.hihat = hihat;
}

export function disposeRhythmSynth() {
  if (_synths) {
    _synths.bombo.dispose();
    _synths.caja.dispose();
    _synths.hihat.dispose();
    _synths.vol.dispose();
    _synths = null;
  }
}

// ─── TRANSPORT ───────────────────────────────────────────────────────────────
export function startRhythm() {
  stopRhythm();
  // Derive the correct starting step from the current Transport position so that
  // after a pause/resume the pattern continues from where it left off rather than
  // always resetting to step 0.
  const stepSec = Tone.Time('16n').toSeconds();
  const pos     = Tone.Transport.seconds;
  // The first callback fires at the next 16n grid point; pre-set currentStep so
  // that incrementing it in the callback lands on the correct step.
  const nextGridStep = stepSec > 0 ? Math.ceil(pos / stepSec) % 16 : 0;
  rhythm.currentStep = (nextGridStep - 1 + 16) % 16;

  rhythm.schedulerId = Tone.Transport.scheduleRepeat((time) => {
    rhythm.currentStep = (rhythm.currentStep + 1) % 16;
    const t = rhythm.steps[rhythm.currentStep];
    if (!t || !_synths) return;
    const note = (KITS[rhythm.kit] || KITS['808']).bombo.note;
    if      (t === 'bombo') _synths.bombo.triggerAttackRelease(note, '16n', time);
    else if (t === 'caja')  _synths.caja.triggerAttackRelease('16n', time);
    else if (t === 'hihat') _synths.hihat.triggerAttackRelease('16n', time);
  }, '16n', 0);
}

export function stopRhythm() {
  if (rhythm.schedulerId !== null) {
    Tone.Transport.clear(rhythm.schedulerId);
    rhythm.schedulerId = null;
  }
  rhythm.currentStep = -1;
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────
export function setSwing(amount) {
  Tone.Transport.swing = amount;
  Tone.Transport.swingSubdivision = '16n';
}

export function setRhythmVolume(db) {
  rhythm.volume = db;
  if (_synths?.vol) _synths.vol.volume.value = db;
}

// ─── PRESET LOADING ───────────────────────────────────────────────────────────
export function loadRhythmPreset(preset) {
  if (!preset) return;
  for (let i = 0; i < 16; i++) {
    if      (preset.bombo?.[i])  rhythm.steps[i] = 'bombo';
    else if (preset.caja?.[i])   rhythm.steps[i] = 'caja';
    else if (preset.hihat?.[i])  rhythm.steps[i] = 'hihat';
    else                         rhythm.steps[i] = '';
  }
  if (typeof preset.swing === 'number') setSwing(preset.swing);
}
