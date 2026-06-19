/**
 * cube.js — Rubik's 3×3 state machine, moves, SVG net generation
 *
 * State: Uint8Array(54)
 * Faces: U=0-8, F=9-17, R=18-26, B=27-35, L=36-44, D=45-53
 * Colors: 0=white(U), 1=red(F), 2=blue(R), 3=orange(B), 4=green(L), 5=yellow(D)
 *
 * Sticker layout per face (row-major, face perspective):
 *   0 1 2
 *   3 4 5
 *   6 7 8
 *
 * SVG net (T-cross):
 *      [U]
 * [L][F][R][B]
 *      [D]
 */

export const COLOR_CSS  = ['#f0f0f0', '#ff3333', '#1a8cff', '#ff7700', '#00cc55', '#ffd600'];
export const COLOR_NAME = ['White', 'Red', 'Blue', 'Orange', 'Green', 'Yellow'];
export const FACE_NAMES = ['U', 'F', 'R', 'B', 'L', 'D'];

// ─── STATE ────────────────────────────────────────────────────────────────────
export function createSolvedState() {
  const s = new Uint8Array(54);
  for (let f = 0; f < 6; f++) s.fill(f, f * 9, f * 9 + 9);
  return s;
}

// Returns CSS color for each face's center sticker [U,F,R,B,L,D]
export function getCenterColors(state) {
  return [0, 1, 2, 3, 4, 5].map(f => COLOR_CSS[state[f * 9 + 4]]);
}

// ─── FACE ROTATIONS ───────────────────────────────────────────────────────────
function rotateFaceCW(s, start) {
  const f = s.slice(start, start + 9);
  s[start+0]=f[6]; s[start+1]=f[3]; s[start+2]=f[0];
  s[start+3]=f[7]; s[start+4]=f[4]; s[start+5]=f[1];
  s[start+6]=f[8]; s[start+7]=f[5]; s[start+8]=f[2];
}
function rotateFaceCCW(s, start) {
  const f = s.slice(start, start + 9);
  s[start+0]=f[2]; s[start+1]=f[5]; s[start+2]=f[8];
  s[start+3]=f[1]; s[start+4]=f[4]; s[start+5]=f[7];
  s[start+6]=f[0]; s[start+7]=f[3]; s[start+8]=f[6];
}
function rotateFace180(s, start) {
  const f = s.slice(start, start + 9);
  s[start+0]=f[8]; s[start+1]=f[7]; s[start+2]=f[6];
  s[start+3]=f[5]; s[start+4]=f[4]; s[start+5]=f[3];
  s[start+6]=f[2]; s[start+7]=f[1]; s[start+8]=f[0];
}

// ─── STRIP CYCLE (CW: D→A→B→C→D, strips = [A,B,C,D]) ────────────────────────
function cycleStrips(s, strips) {
  const t0 = s[strips[3][0]], t1 = s[strips[3][1]], t2 = s[strips[3][2]];
  for (let i = 3; i > 0; i--) {
    s[strips[i][0]] = s[strips[i-1][0]];
    s[strips[i][1]] = s[strips[i-1][1]];
    s[strips[i][2]] = s[strips[i-1][2]];
  }
  s[strips[0][0]] = t0; s[strips[0][1]] = t1; s[strips[0][2]] = t2;
}

// ─── MOVE TABLE ───────────────────────────────────────────────────────────────
const MOVE_BASE = {
  U: { fi: 0,  s: [[9,10,11],[18,19,20],[27,28,29],[36,37,38]] },
  D: { fi: 45, s: [[15,16,17],[42,43,44],[33,34,35],[26,25,24]] },
  F: { fi: 9,  s: [[44,41,38],[6,7,8],[18,21,24],[47,46,45]] },
  R: { fi: 18, s: [[11,14,17],[2,5,8],[33,30,27],[47,50,53]] },
  L: { fi: 36, s: [[0,3,6],[9,12,15],[45,48,51],[35,32,29]] },
  B: { fi: 27, s: [[2,1,0],[36,39,42],[51,52,53],[24,21,18]] },
};

export function applyMove(state, move) {
  const face = move.replace(/[^UDFLRB]/g, '');
  const dir  = move.includes("'") ? -1 : move.includes('2') ? 2 : 1;
  const def  = MOVE_BASE[face];
  if (!def) return;

  const { fi, s } = def;
  if (dir === 1) {
    rotateFaceCW(state, fi);
    cycleStrips(state, s);
  } else if (dir === -1) {
    rotateFaceCCW(state, fi);
    cycleStrips(state, [s[0], s[3], s[2], s[1]]);
  } else {
    rotateFace180(state, fi);
    cycleStrips(state, s);
    cycleStrips(state, s);
  }
}

// ─── SCRAMBLE & SOLVER ────────────────────────────────────────────────────────
const ALL_MOVES = ['U','D','F','R','L','B'].flatMap(f => [f, f+"'", f+'2']);

const INVERSE = {};
for (const f of ['U','D','F','R','L','B']) {
  INVERSE[f]     = f+"'";
  INVERSE[f+"'"] = f;
  INVERSE[f+'2'] = f+'2';
}

const OPPOSITE = { U:'D', D:'U', F:'B', B:'F', R:'L', L:'R' };

export function scramble(state, n = 20) {
  const moves = [];
  let lastFace = '', prevFace = '';
  for (let i = 0; i < n; i++) {
    let m, face, attempts = 0;
    do {
      m = ALL_MOVES[Math.floor(Math.random() * ALL_MOVES.length)];
      face = m.replace(/[^UDFLRB]/g, '');
      attempts++;
    } while (
      attempts < 20 &&
      (face === lastFace || (face === OPPOSITE[lastFace] && face === prevFace))
    );
    moves.push(m);
    applyMove(state, m);
    prevFace = lastFace;
    lastFace = face;
  }
  return moves;
}

export function buildSolution(scrambleMoves) {
  return scrambleMoves.slice().reverse().map(m => INVERSE[m]);
}

// ─── SVG NET GENERATION ───────────────────────────────────────────────────────
export const STICKER_SIZE = 30;
export const STICKER_GAP  = 3;
export const FACE_SIZE    = STICKER_SIZE * 3 + STICKER_GAP * 2; // 96
export const NET_PAD      = 2;
export const SVG_W        = FACE_SIZE * 4 + NET_PAD * 2;       // 388
export const SVG_H        = FACE_SIZE * 3 + NET_PAD * 2;       // 292

// Face positions in the T-cross net (col, row)
const FACE_POS = [
  { col: 1, row: 0 }, // U
  { col: 1, row: 1 }, // F
  { col: 2, row: 1 }, // R
  { col: 3, row: 1 }, // B
  { col: 0, row: 1 }, // L
  { col: 1, row: 2 }, // D
];

export function createCubeSVG(cubeId) {
  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', SVG_W);
  svg.setAttribute('height', SVG_H);
  svg.setAttribute('class', 'cube-net');
  svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);

  for (let f = 0; f < 6; f++) {
    const { col, row } = FACE_POS[f];
    const ox = NET_PAD + col * FACE_SIZE;
    const oy = NET_PAD + row * FACE_SIZE;

    // Face background
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('x', ox); bg.setAttribute('y', oy);
    bg.setAttribute('width', FACE_SIZE); bg.setAttribute('height', FACE_SIZE);
    bg.setAttribute('fill', 'rgba(255,255,255,0.025)');
    bg.setAttribute('rx', 3);
    svg.appendChild(bg);

    // Face label
    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', ox + FACE_SIZE / 2);
    lbl.setAttribute('y', oy + FACE_SIZE / 2);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('dominant-baseline', 'middle');
    lbl.setAttribute('font-size', '8');
    lbl.setAttribute('fill', 'rgba(255,255,255,0.1)');
    lbl.setAttribute('font-family', 'JetBrains Mono, monospace');
    lbl.setAttribute('pointer-events', 'none');
    lbl.textContent = FACE_NAMES[f];
    svg.appendChild(lbl);

    // Sticker group
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('id', `${cubeId}-face-${f}`);

    for (let si = 0; si < 9; si++) {
      const sc = si % 3;
      const sr = Math.floor(si / 3);
      const x  = ox + sc * (STICKER_SIZE + STICKER_GAP);
      const y  = oy + sr * (STICKER_SIZE + STICKER_GAP);

      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('id', `${cubeId}-s-${f * 9 + si}`);
      rect.setAttribute('class', 'sticker');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', STICKER_SIZE); rect.setAttribute('height', STICKER_SIZE);
      rect.setAttribute('rx', 3); rect.setAttribute('ry', 3);
      rect.setAttribute('fill', COLOR_CSS[f]);
      group.appendChild(rect);
    }
    svg.appendChild(group);
  }
  return svg;
}

export function updateCubeSVG(svgEl, state, cubeId) {
  for (let i = 0; i < 54; i++) {
    const rect = svgEl.querySelector(`#${cubeId}-s-${i}`);
    if (rect) rect.setAttribute('fill', COLOR_CSS[state[i]]);
  }
}

export function flashFace(svgEl, faceIdx, cubeId) {
  const group = svgEl.querySelector(`#${cubeId}-face-${faceIdx}`);
  if (!group) return;
  group.classList.remove('face-flash');
  void group.offsetWidth;
  group.classList.add('face-flash');
  group.addEventListener('animationend', () => group.classList.remove('face-flash'), { once: true });
}

export function getFaceIndex(move) {
  return FACE_NAMES.indexOf(move.replace(/[^UDFLRB]/g, ''));
}

export function getCenterColor(state, faceIdx) {
  return state[faceIdx * 9 + 4];
}
