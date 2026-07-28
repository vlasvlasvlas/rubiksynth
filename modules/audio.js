/**
 * audio.js — Audio engine using Tone.js (global)
 *
 * Master bus (created at module load, before AudioContext starts):
 *   HPF(40Hz) → MasterGain → Compressor → Limiter → Mono → Destination
 *
 * Per-cube chain:
 *   Synth → FixedGate → Filter(LP) → FeedbackDelay → Reverb → MasterInput
 */

export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  blues:      [0, 3, 5, 6, 7, 10],
  wholetone:  [0, 2, 4, 6, 8, 10],
};

const COLOR_DEGREE = [0, 1, 2, 3, 4, 5];
const MASTER_OUTPUT_TRIM = 0.78;
const FIXED_CUBE_DB = -9;
const MAX_REVERB_WET = 0.32;
const MAX_DELAY_FEEDBACK = 0.28;
const ALLOWED_DELAY_TIMES = new Set(['32n', '16n', '8n', '4n', '2n']);

export const ROOT_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function colorToNote(colorIdx, baseOctave = 4, scaleType = 'pentatonic', rootSemitone = 0) {
  const scale    = SCALES[scaleType] || SCALES.pentatonic;
  const degree   = COLOR_DEGREE[colorIdx % COLOR_DEGREE.length] % scale.length;
  const semitone = scale[degree];
  const midi     = 60 + (baseOctave - 4) * 12 + semitone + rootSemitone;
  return Tone.Frequency(midi, 'midi').toNote();
}

// ─── MASTER BUS ───────────────────────────────────────────────────────────────
// Created at module load so every chain created later feeds into it.
// Tone.js defers AudioContext start until Tone.start(), so creating nodes here is safe.
const _hpf  = new Tone.Filter(40, 'highpass');  // cut sub-bass mud
const _masterGain = new Tone.Gain(0.75 * MASTER_OUTPUT_TRIM);
const _comp = new Tone.Compressor({
  threshold: -26,
  ratio:      4,
  attack:    0.005, // 5 ms
  release:   0.22,
  knee:      12,    // wide soft knee — smooth onset
});
const _lim = new Tone.Limiter(-3);
const _mono = new Tone.Mono();

_hpf.connect(_masterGain);
_masterGain.connect(_comp);
_comp.connect(_lim);
_lim.connect(_mono);
_mono.toDestination();

/** Returns the input node of the master bus chain. Route all audio here. */
export function getMasterInput() { return _hpf; }

export function initMasterBus() {
  // Keep Tone's destination neutral; live level is controlled only here.
  Tone.Destination.volume.value = 0;
  setMasterVolume(75);
}

export function setMasterVolume(value) {
  const pct = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
  const gain = (pct / 100) * MASTER_OUTPUT_TRIM;
  _masterGain.gain.rampTo(gain, 0.08);
  return pct;
}

function normalizeReverbWet(wet) {
  return Math.max(0, Math.min(MAX_REVERB_WET, Number(wet) || 0));
}

function normalizeDelayFeedback(feedback) {
  return Math.max(0, Math.min(MAX_DELAY_FEEDBACK, Number(feedback) || 0));
}

function normalizeDelayTime(time) {
  return ALLOWED_DELAY_TIMES.has(time) ? time : '8n';
}

function velocityTrim(synthType, oscillatorType) {
  if (synthType === 'FMSynth') return 0.62;
  if (synthType === 'AMSynth') return 0.68;
  if (synthType === 'PluckSynth') return 0.7;
  if (oscillatorType === 'square') return 0.62;
  if (oscillatorType === 'sawtooth') return 0.68;
  return 0.82;
}

// ─── PER-CUBE CHAIN ───────────────────────────────────────────────────────────
export function createAudioChain(config = {}) {
  const {
    synthType       = 'Synth',
    attack          = 0.02,
    decay           = 0.1,
    sustain         = 0.3,
    release         = 0.5,
    reverbWet       = 0.25,
    delayTime       = '8n',
    delayFeedback   = 0.2,
    filterFreq      = 2000,
    oscillatorType  = 'triangle',
    modulationIndex = 6,
    harmonicity     = 2,
  } = config;

  const synth  = makeSynth(synthType, { attack, decay, sustain, release, oscillatorType, modulationIndex, harmonicity });
  const vol    = new Tone.Volume(FIXED_CUBE_DB);
  const filter = new Tone.Filter(filterFreq, 'lowpass');
  const delay  = new Tone.FeedbackDelay(normalizeDelayTime(delayTime), normalizeDelayFeedback(delayFeedback));
  const reverb = new Tone.Reverb({ decay: 1.8, wet: normalizeReverbWet(reverbWet) });

  reverb.generate();

  synth.chain(vol, filter, delay, reverb, getMasterInput());

  return { synth, vol, filter, delay, reverb, synthType };
}

function makeSynth(type, { attack, decay, sustain, release, oscillatorType, modulationIndex, harmonicity }) {
  const env = { attack, decay, sustain, release };
  switch (type) {
    case 'FMSynth':
      return new Tone.FMSynth({ envelope: env, modulationIndex, harmonicity });
    case 'AMSynth':
      return new Tone.AMSynth({ envelope: env, harmonicity });
    case 'MonoSynth':
      return new Tone.MonoSynth({ envelope: env, oscillator: { type: oscillatorType } });
    case 'PluckSynth':
      return new Tone.PluckSynth({ attackNoise: 1, dampening: 3800, resonance: 0.7 });
    default:
      return new Tone.Synth({ oscillator: { type: oscillatorType }, envelope: env });
  }
}

// ─── TRIGGER NOTE (sample-accurate) ──────────────────────────────────────────
export function triggerNote(chain, colorIdx, direction, config, time) {
  const {
    baseOctave   = 4,
    scaleType    = 'pentatonic',
    subdivision  = '4n',
    rootSemitone = 0,
  } = config;

  const octave = direction === 'ccw' ? Math.max(2, baseOctave - 1) : baseOctave;
  const note   = colorToNote(colorIdx, octave, scaleType, rootSemitone);
  const dur    = direction === 'double' ? '2n' : subdivision;
  const baseVel = direction === 'double' ? 0.52 : 0.4 + Math.random() * 0.04;
  const vel    = baseVel * velocityTrim(chain.synthType, config.oscillatorType);
  const t      = time ?? Tone.now();

  if (chain.synthType === 'PluckSynth') {
    chain.synth.triggerAttack(note, t, vel);
  } else {
    chain.synth.triggerAttackRelease(note, dur, t, vel);
  }
}

// ─── LIVE FX UPDATES ─────────────────────────────────────────────────────────
export function setReverb(chain, wet) {
  if (chain.reverb) chain.reverb.wet.rampTo(normalizeReverbWet(wet), 0.08);
}
export function setDelayTime(chain, time) {
  if (chain.delay) chain.delay.delayTime.rampTo(Tone.Time(normalizeDelayTime(time)).toSeconds(), 0.08);
}
export function setDelayFeedback(chain, fb) {
  if (chain.delay) chain.delay.feedback.rampTo(normalizeDelayFeedback(fb), 0.08);
}
export function setFilterFreq(chain, freq) {
  if (chain.filter) chain.filter.frequency.rampTo(freq, 0.08);
}

export function replaceSynth(chain, config) {
  chain.synth.disconnect();
  chain.synth.dispose();
  chain.synth = makeSynth(config.synthType, {
    attack:          config.attack,
    decay:           config.decay,
    sustain:         config.sustain,
    release:         config.release,
    oscillatorType:  config.oscillatorType  ?? 'triangle',
    modulationIndex: config.modulationIndex ?? 6,
    harmonicity:     config.harmonicity     ?? 2,
  });
  chain.synth.connect(chain.vol ?? chain.filter);
  chain.synthType = config.synthType;
}

export function updateEnvelope(chain, config) {
  if (chain.synth?.envelope) {
    chain.synth.envelope.attack  = config.attack;
    chain.synth.envelope.decay   = config.decay;
    chain.synth.envelope.sustain = config.sustain;
    chain.synth.envelope.release = config.release;
  }
}

// ─── DISPOSE ─────────────────────────────────────────────────────────────────
export function disposeChain(chain) {
  chain.synth?.dispose();
  chain.vol?.dispose();
  chain.filter?.dispose();
  chain.delay?.dispose();
  chain.reverb?.dispose();
}
