# Curvase

An Adobe After Effects extension for interactive Bezier easing curve editing. Curvase provides a visual graph editor that lets you design custom cubic-bezier timing curves and apply them directly to selected keyframes.

## Features

- Interactive canvas with draggable control point handles for shaping cubic-bezier curves
- Real-time visual feedback with curve preview, handle lines, and grid overlay
- Numeric input fields for precise control point coordinate entry
- Built-in presets: Ease, Ease In, Ease Out, Ease In Out, Linear, Overshoot
- One-click application of custom easing to selected After Effects keyframes
- Automatic handling of 1D, 2D, and 3D animated properties
- Undo support (single undo group per application)
- Adapts to the host application theme

## Compatibility

- Adobe After Effects 2020 (v17.0) or Newer
- CEP 9 (CSXS 9.0)

## Installation

1. Copy the `curvase-extensions` folder to your CEP extensions directory:
   - **Windows:** `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions`
   - **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/`
2. Open PlayerDebugMode.reg file
3. Restart After Effects.
4. Open the panel from **Window → Extensions → Curvase**.

## Usage

1. In After Effects, select a layer and reveal animated properties in the timeline.
2. Select at least two consecutive keyframes on one or more properties.
3. Open the Curvase panel.
4. Drag the orange (P1) and blue (P2) control handles to shape the desired easing curve, or choose a preset.
5. Click **Apply to Keyframes**.

## File Structure

```
curvase-extensions/
├── CSXS/
│   └── manifest.xml        Extension manifest (CEP 9, AE 17.0+)
├── lib/
│   └── CSInterface-4.0.0.js  Adobe CEP interface library
├── jsx/
│   └── curvase.jsx         ExtendScript: keyframe easing logic
├── index.html              Panel UI
├── style.css               Panel styles
├── curvase.js              Bezier canvas editor module
├── ext.js                  CEP integration and initialization
└── MainScript.jsx          ExtendScript entry point and loader
```

5/3/2026 - 5/10/2026

Main Developers
-Crayon
-Kabelauxx
-Cryztalz

Some Idea From
-J1zo

Demak Demek Tools From
-Ciko
