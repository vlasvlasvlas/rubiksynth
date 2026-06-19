# RubikSynth

Cubos de Rubik 2D que se resuelven solos generando música en tiempo real. Cada color es una nota, cada giro un sonido. Síntesis, efectos y escalas configurables por cubo.

**Demo** → [vlasvlasvlas.github.io/rubiksynth](https://vlasvlasvlas.github.io/rubiksynth)

---

## Cómo correrlo

Necesitás un servidor HTTP local (no funciona con `file://`):

```bash
python3 -m http.server 8080
# luego abrí http://localhost:8080
```

---

## Cómo funciona el sistema de sonido

Cada cubo tiene su propia cadena de audio independiente:

```
Synth → Volume → Filter → Delay → Reverb → Panner → Destination
```

El sintetizador genera una nota por cada movimiento del cubo. El color de la cara girada determina el grado de la escala, la dirección del giro determina la octava y la duración.

---

## Agregar o editar sonidos — `templates.yaml`

Todo el sistema de síntesis es configurable desde `templates.yaml`. Cada template es un preset que se puede aplicar a cualquier cubo desde el inspector del sidebar.

### Estructura de un template

```yaml
templates:
  - name: "Mi Sonido"
    config:
      # ── SINTETIZADOR ──────────────────────────────────────────
      synthType: "Synth"        # Synth | FMSynth | AMSynth | MonoSynth | PluckSynth
      oscillatorType: "triangle" # sine | triangle | square | sawtooth  (Synth / MonoSynth)
      modulationIndex: 6        # intensidad de modulación        (FMSynth)
      harmonicity: 2            # relación portadora/modulador    (FMSynth / AMSynth)

      # ── SECUENCIA ─────────────────────────────────────────────
      baseOctave: 4             # octava base: 2–6
      subdivision: "4n"         # grilla: 32n | 16n | 8n | 4n | 2n
      scaleOverride: null       # escala propia o null (usa la global)
                                # pentatonic | major | minor | blues | wholetone

      # ── ENVELOPE (ADSR) ───────────────────────────────────────
      attack: 0.02              # segundos  0.01–2.0   (ignorado en PluckSynth)
      decay: 0.1                # segundos  0.01–2.0
      sustain: 0.3              # nivel     0.0–1.0
      release: 0.5              # segundos  0.1–5.0

      # ── MEZCLA Y FX ───────────────────────────────────────────
      cubeVolume: 0             # dB        -40–+6
      reverbWet: 0.25           # 0.0–1.0
      delayTime: "8n"           # 32n | 16n | 8n | 4n | 2n
      delayFeedback: 0.2        # 0.0–0.85
      filterFreq: 2000          # Hz        100–8000
      panning: 0.0              # -1.0 (izq) → 0 (centro) → 1.0 (der)
```

### Referencia de tipos de sintetizador

| synthType   | Descripción                                          | Parámetros extra           |
|-------------|------------------------------------------------------|----------------------------|
| `Synth`     | Oscilador simple. Limpio, versátil.                  | `oscillatorType`           |
| `FMSynth`   | Modulación de frecuencia. Timbres metálicos/complejos.| `modulationIndex` `harmonicity` |
| `AMSynth`   | Modulación de amplitud. Efecto trémolo/campana.      | `harmonicity`              |
| `MonoSynth` | Monofónico con filtro integrado. Bueno para leads.   | `oscillatorType`           |
| `PluckSynth`| Modelo Karplus-Strong (cuerda pulsada). Ignora ADSR. | —                          |

### Referencia de escalas (`scaleOverride`)

| Valor         | Intervalos (semitonos)    |
|---------------|---------------------------|
| `pentatonic`  | 0 2 4 7 9                 |
| `major`       | 0 2 4 5 7 9 11            |
| `minor`       | 0 2 3 5 7 8 10            |
| `blues`       | 0 3 5 6 7 10              |
| `wholetone`   | 0 2 4 6 8 10              |

### Ejemplo: agregar un template nuevo

Abrí `templates.yaml` y agregá al final:

```yaml
  - name: "Mi Bass"
    config:
      synthType: "MonoSynth"
      oscillatorType: "sawtooth"
      baseOctave: 2
      subdivision: "8n"
      scaleOverride: "blues"
      attack: 0.01
      decay: 0.3
      sustain: 0.4
      release: 0.2
      cubeVolume: 0
      reverbWet: 0.05
      delayTime: "8n"
      delayFeedback: 0.1
      filterFreq: 600
      panning: -0.3
```

Guardá el archivo, recargá la página — el template aparece en el selector del inspector de cualquier cubo.

---

## Estructura del proyecto

```
rubiksynth/
├── index.html          # Shell HTML
├── main.js             # Bootstrap, clase CubeInstance, pan/zoom, VU loop
├── style.css           # Estilos
├── templates.yaml      # Presets de síntesis — editá aquí para agregar sonidos
└── modules/
    ├── audio.js        # Motor de audio (Tone.js): cadena, triggerNote, fx
    ├── cube.js         # Estado Rubik 3×3, movimientos, SVG net
    └── ui.js           # Inspector del sidebar, leyenda de colores
```

---

## Stack

- [Tone.js 14](https://tonejs.github.io/) — síntesis y scheduling de audio
- [js-yaml](https://github.com/nodeca/js-yaml) — carga de templates
- Vanilla JS (ES modules) — sin bundler, sin frameworks
