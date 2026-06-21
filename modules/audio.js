/**
 * audio.js — Audio engine using Tone.js (global)
 *
 * Master bus (created at module load, before AudioContext starts):
 *   HPF(40Hz) → Compressor → Limiter → Destination
 *
 * Per-cube chain:
 *   Synth → Volume → Filter(LP) → FeedbackDelay → Reverb → Panner → MasterInput
 */

export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  blues:      [0, 3, 5, 6, 7, 10],
  wholetone:  [0, 2, 4, 6, 8, 10],
};

const COLOR_DEGREE = [0, 1, 2, 3, 4, 5];

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
const _comp = new Tone.Compressor({
  threshold: -24,   // dBFS — gentle threshold, more headroom
  ratio:      3,    // 3:1 — transparent, not crushing
  attack:    0.005, // 5 ms
  release:   0.35,  // 350 ms
  knee:      12,    // wide soft knee — smooth onset
});
const _lim = new Tone.Limiter(-1); // hard ceiling at -1 dBFS

_hpf.connect(_comp);
_comp.connect(_lim);
_lim.toDestination();

/** Returns the input node of the master bus chain. Route all audio here. */
export function getMasterInput() { return _hpf; }

export function initMasterBus() {
  // Master volume: 0 dB — dynamics handled by compressor
  Tone.Destination.volume.value = 0;
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
    panning         = 0,
    cubeVolume      = 0,
    oscillatorType  = 'triangle',
    modulationIndex = 6,
    harmonicity     = 2,
  } = config;

  const synth  = makeSynth(synthType, { attack, decay, sustain, release, oscillatorType, modulationIndex, harmonicity });
  const vol    = new Tone.Volume(cubeVolume);
  const filter = new Tone.Filter(filterFreq, 'lowpass');
  const delay  = new Tone.FeedbackDelay(delayTime, delayFeedback);
  const reverb = new Tone.Reverb({ decay: 2.5, wet: reverbWet });
  const panner = new Tone.Panner(panning);

  reverb.generate();

  synth.chain(vol, filter, delay, reverb, panner, getMasterInput());

  return { synth, vol, filter, delay, reverb, panner, synthType };
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
  const vel    = direction === 'double' ? 0.85 : 0.65 + Math.random() * 0.1;
  const t      = time ?? Tone.now();

  if (chain.synthType === 'PluckSynth') {
    chain.synth.triggerAttack(note, t);
  } else {
    chain.synth.triggerAttackRelease(note, dur, t, vel);
  }
}

// ─── LIVE FX UPDATES ─────────────────────────────────────────────────────────
export function setCubeVolume(chain, db) {
  if (chain.vol) chain.vol.volume.value = Math.max(-40, Math.min(6, db));
}
export function setReverb(chain, wet) {
  if (chain.reverb) chain.reverb.wet.value = Math.max(0, Math.min(1, wet));
}
export function setDelayTime(chain, time) {
  if (chain.delay) chain.delay.delayTime.value = Tone.Time(time).toSeconds();
}
export function setDelayFeedback(chain, fb) {
  if (chain.delay) chain.delay.feedback.value = Math.max(0, Math.min(0.9, fb));
}
export function setFilterFreq(chain, freq) {
  if (chain.filter) chain.filter.frequency.value = freq;
}
export function setPanning(chain, pan) {
  if (chain.panner) chain.panner.pan.value = Math.max(-1, Math.min(1, pan));
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
  chain.panner?.dispose();
}
