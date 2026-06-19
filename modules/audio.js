/**
 * audio.js — Audio engine using Tone.js (global)
 *
 * Per-cube chain: Synth → Filter → FeedbackDelay → Reverb → Panner → Meter → Destination
 * Master bus: Compressor → Limiter → Destination
 */

export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  blues:      [0, 3, 5, 6, 7, 10],
  wholetone:  [0, 2, 4, 6, 8, 10],
};

// 6 colors map to 6 scale degrees
const COLOR_DEGREE = [0, 1, 2, 3, 4, 5];

export function colorToNote(colorIdx, baseOctave = 4, scaleType = 'pentatonic') {
  const scale   = SCALES[scaleType] || SCALES.pentatonic;
  const degree  = COLOR_DEGREE[colorIdx % COLOR_DEGREE.length] % scale.length;
  const semitone = scale[degree];
  const midi = 60 + (baseOctave - 4) * 12 + semitone;
  return Tone.Frequency(midi, 'midi').toNote();
}

// ─── MASTER BUS ───────────────────────────────────────────────────────────────
// Volume limiting via Tone.Destination (safe — doesn't break the audio graph)
export function initMasterBus() {
  Tone.Destination.volume.value = -3; // -3 dB headroom
}

// ─── PER-CUBE CHAIN ───────────────────────────────────────────────────────────
export function createAudioChain(config = {}) {
  const {
    synthType    = 'Synth',
    attack       = 0.02,
    decay        = 0.1,
    sustain      = 0.3,
    release      = 0.5,
    reverbWet    = 0.25,
    delayTime    = '8n',
    delayFeedback= 0.2,
    filterFreq   = 2000,
    panning      = 0,
    cubeVolume   = 0,   // dB, 0 = unity
  } = config;

  const synth  = makeSynth(synthType, attack, decay, sustain, release);
  const vol    = new Tone.Volume(cubeVolume);
  const filter = new Tone.Filter(filterFreq, 'lowpass');
  const delay  = new Tone.FeedbackDelay(delayTime, delayFeedback);
  const reverb = new Tone.Reverb({ decay: 2.5, wet: reverbWet });
  const panner = new Tone.Panner(panning);
  const meter  = new Tone.Meter({ smoothing: 0.88 });

  reverb.generate();

  synth.chain(vol, filter, delay, reverb, panner, Tone.Destination);
  panner.connect(meter);

  return { synth, vol, filter, delay, reverb, panner, meter, synthType };
}

function makeSynth(type, attack, decay, sustain, release) {
  const env = { attack, decay, sustain, release };
  switch (type) {
    case 'FMSynth':
      return new Tone.FMSynth({ envelope: env, modulationIndex: 6, harmonicity: 3 });
    case 'AMSynth':
      return new Tone.AMSynth({ envelope: env, harmonicity: 2 });
    case 'MonoSynth':
      return new Tone.MonoSynth({ envelope: env, oscillator: { type: 'sawtooth' } });
    case 'PluckSynth':
      return new Tone.PluckSynth({ attackNoise: 1, dampening: 3800, resonance: 0.7 });
    default: // 'Synth'
      return new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: env });
  }
}

// ─── TRIGGER NOTE (sample-accurate) ──────────────────────────────────────────
// time: Web Audio context time from Transport.scheduleRepeat callback
export function triggerNote(chain, colorIdx, direction, config, time) {
  const {
    baseOctave  = 4,
    scaleType   = 'pentatonic',
    subdivision = '4n',
  } = config;

  const octave = direction === 'ccw' ? Math.max(2, baseOctave - 1) : baseOctave;
  const note   = colorToNote(colorIdx, octave, scaleType);
  const dur    = direction === 'double' ? '2n' : subdivision;
  const vel    = direction === 'double' ? 0.85 : 0.65 + Math.random() * 0.1;

  const t = time ?? Tone.now();

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
  chain.synth = makeSynth(config.synthType, config.attack, config.decay, config.sustain, config.release);
  chain.synth.connect(chain.filter);
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

// ─── VU LEVEL (0–1) ──────────────────────────────────────────────────────────
export function getLevel(chain) {
  if (!chain.meter) return 0;
  const v = chain.meter.getValue();
  return typeof v === 'number' ? Math.max(0, (v + 60) / 60) : 0;
}

// ─── DISPOSE ─────────────────────────────────────────────────────────────────
export function disposeChain(chain) {
  chain.synth?.dispose();
  chain.vol?.dispose();
  chain.filter?.dispose();
  chain.delay?.dispose();
  chain.reverb?.dispose();
  chain.panner?.dispose();
  chain.meter?.dispose();
}
