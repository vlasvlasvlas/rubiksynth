# RubikSynth

Cubos de Rubik 2D que se resuelven solos generando música en tiempo real. Cada color es una nota, cada giro es un sonido. Síntesis, efectos, escala y ritmo configurables por cubo.

**Demo** → [vlasvlasvlas.github.io/rubiksynth](https://vlasvlasvlas.github.io/rubiksynth)

---

## Cómo correrlo

Necesitás un servidor HTTP local (no funciona con `file://`):

```bash
python3 -m http.server 8080
# luego abrí http://localhost:8080
```

---

## Controles principales

| Control | Descripción |
|---|---|
| **▶ / ⏸** | Iniciar o pausar todos los cubos y el ritmo |
| **BPM** | Tempo global — sin límite, afecta cubos y ritmo |
| **Vol** | Volumen maestro |
| **Loop** | Si está activo, los cubos reinician automáticamente al resolver. Si se desactiva, cada cubo resuelve una vez y se detiene. |
| **+ Cubo** | Agrega un cubo con síntesis aleatoria |
| **✕ Limpiar** | Elimina todos los cubos |
| **Solucionados** | Contador acumulativo de resoluciones |

---

## Cómo funciona el cubo

Cada cubo genera una secuencia de movimientos aleatorios (scramble) y luego los revierte en orden inverso — así el cubo "se resuelve". Cada movimiento dispara una nota:

- **Color** de la cara girada → grado de la escala
- **Dirección CW** → octava base, duración = subdivisión del cubo
- **Dirección CCW** → octava −1
- **Doble giro (x2)** → duración doble, velocidad más alta

Cuando el cubo termina de resolverse, espera un tiempo aleatorio (alineado al compás) y vuelve a empezar con un scramble nuevo.

---

## Inspector de cubo

Hacé click sobre cualquier cubo para abrir su inspector en el sidebar.

### Preset

Aplica un template de síntesis predefinido. **Solo afecta el timbre** — no modifica la escala, raíz, subdivisión ni pausa configuradas en el cubo.

### Secuencia

| Parámetro | Descripción |
|---|---|
| **Escala** | Escala propia del cubo, o `(global)` para usar la del selector principal |
| **Pausa → aleatoria** | Cuando está activo, el tiempo entre reinicios es aleatorio (0, 1, 2 o 3 compases). Mantiene el tempo — los valores siempre son múltiplos de barra. |

### Synth

| Parámetro | Descripción |
|---|---|
| **Type** | Tipo de sintetizador |
| **Octave** | Octava base (2–6) |
| **Raíz** | Nota raíz de la escala (C, C#, D…) |
| **Grid** | Subdivisión rítmica: 1/32, 1/16, 1/8, 1/4, 1/2 |

### Envelope (ADSR), FX

Attack, Decay, Sustain, Release, Volume, Reverb, Delay, Filter, Pan — ajustables en vivo.

---

## Módulo de ritmo

El secuenciador de 16 pasos corre en sincronía con los cubos. Todos comparten el mismo grid desde el origen del Transport — no hay deriva aunque se agreguen cubos en cualquier momento.

### Controles

| Control | Descripción |
|---|---|
| **Preset** | Carga un patrón rítmico predefinido desde `templates.yaml` |
| **Kit** | Cambia el timbre de batería: TR-808, TR-909, Lo-fi, Electro, Chiptune |
| **Volumen** | Volumen del ritmo independiente del master |
| **Swing** | Desplaza los tiempos impares del grid de 16ths |

### Paso a paso

Hacé click en cada casilla del secuenciador para ciclar el sonido asignado:

| Color | Sonido |
|---|---|
| Rojo | Bombo (kick) |
| Blanco | Caja (snare) |
| Amarillo | Hi-hat |
| Vacío | Silencio |

---

## Arquitectura de audio

### Master bus (global)

```
HPF 40 Hz → Compressor (−24 dB, 3:1) → Limiter (−1 dBFS) → Destination
```

El filtro pasa-altos elimina sub-bajos, el compresor controla la dinámica sin aplastar, el limiter es el techo duro. Se crea una sola vez al cargar el módulo — todos los cubos y el ritmo pasan por él.

### Cadena por cubo

```
Synth → Volume → Filter (LP) → FeedbackDelay → Reverb → Panner → Master bus
```

### Sincronización

Todos los schedulers (cubos y ritmo) usan `startTime=0` en `Tone.Transport.scheduleRepeat`. Esto los ancla al origen del Transport — el primer evento se calcula como el próximo múltiplo de la subdivisión desde t=0. Sin importar cuándo se crea un cubo o se reinicia el ritmo, todos re-entran en el grid exacto.

El scheduling de audio corre en el thread de la Web Audio API, separado del hilo JS. Los callbacks de Tone.js sí corren en JS pero con anticipación (lookahead ~100 ms): programan eventos Web Audio con el tiempo exacto antes de que ocurran, por lo que jitter de JS menor al lookahead no produce desincronización audible.

---

## Editar sonidos y ritmos — `templates.yaml`

### Template de síntesis

```yaml
templates:
  - name: "Mi Sonido"
    config:
      synthType: "Synth"          # Synth | FMSynth | AMSynth | MonoSynth | PluckSynth
      oscillatorType: "triangle"  # sine | triangle | square | sawtooth  (Synth / MonoSynth)
      modulationIndex: 6          # intensidad FM           (FMSynth)
      harmonicity: 2              # relación portadora/mod  (FMSynth / AMSynth)
      attack: 0.02                # seg  0.01–2.0  (ignorado en PluckSynth)
      decay: 0.1
      sustain: 0.3
      release: 0.5
      cubeVolume: 0               # dB  -40–+6
      reverbWet: 0.25             # 0.0–1.0
      delayTime: "8n"             # 32n | 16n | 8n | 4n | 2n
      delayFeedback: 0.2          # 0.0–0.85
      filterFreq: 2000            # Hz  100–8000
      panning: 0.0                # -1.0 izq → 0 centro → 1.0 der
```

> Los campos `subdivision`, `scaleOverride`, `baseOctave`, `rootSemitone` no se aplican desde el template — se preservan los valores que el usuario ya tenía en el cubo.

### Preset rítmico

```yaml
rhythms:
  - name: "Mi Ritmo"
    swing: 0.0         # 0.0 recto → 1.0 shuffle máximo
    bombo: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]   # 16 pasos, 1=golpe 0=silencio
    caja:  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]
    hihat: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0]
```

Grid: beat 1 = pasos 0–3, beat 2 = 4–7, beat 3 = 8–11, beat 4 = 12–15.

### Referencia de tipos de sintetizador

| synthType | Descripción | Parámetros extra |
|---|---|---|
| `Synth` | Oscilador simple | `oscillatorType` |
| `FMSynth` | Modulación de frecuencia, timbres metálicos | `modulationIndex` `harmonicity` |
| `AMSynth` | Modulación de amplitud, efecto trémolo | `harmonicity` |
| `MonoSynth` | Monofónico con filtro integrado | `oscillatorType` |
| `PluckSynth` | Modelo Karplus-Strong (cuerda pulsada), ignora ADSR | — |

### Referencia de escalas

| Valor | Intervalos |
|---|---|
| `pentatonic` | 0 2 4 7 9 |
| `major` | 0 2 4 5 7 9 11 |
| `minor` | 0 2 3 5 7 8 10 |
| `blues` | 0 3 5 6 7 10 |
| `wholetone` | 0 2 4 6 8 10 |

---

## Estructura del proyecto

```
rubiksynth/
├── index.html          # Shell HTML
├── main.js             # Bootstrap, CubeInstance, pan/zoom
├── style.css           # Estilos
├── templates.yaml      # Presets de síntesis y ritmo
└── modules/
    ├── audio.js        # Motor de audio: master bus, cadena por cubo, triggerNote
    ├── cube.js         # Estado Rubik 3×3, movimientos, scramble, SVG net
    ├── rhythm.js       # Secuenciador de 16 pasos, kits de batería, swing
    └── ui.js           # Inspector del sidebar, leyenda de colores
```

---

## Stack

- [Tone.js 14](https://tonejs.github.io/) — síntesis y scheduling de audio (CDN)
- [js-yaml](https://github.com/nodeca/js-yaml) — carga de templates (CDN)
- Vanilla JS (ES modules) — sin bundler, sin frameworks
