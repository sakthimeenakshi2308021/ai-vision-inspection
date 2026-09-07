# AI Vision Inspection & Measurement

A smartphone-browser prototype for AI-assisted mechanical component inspection.

## Demo workflow

**Camera / image → reference detection → pixel-to-mm calibration → component identification → dimensional measurement → visual inspection → engineering result → PDF report**

## Stack

- HTML/CSS/JavaScript
- OpenCV.js for classical computer vision
- Browser MediaDevices API for smartphone camera
- jsPDF for report generation
- No backend required for the prototype

## Engineering reasoning

### Calibration
A known-size square reference is placed beside the component. The prototype detects a large near-square contour and estimates:

`mm_per_pixel = known_reference_mm / detected_reference_pixels`

This works only when the reference and component are approximately coplanar and perspective is limited.

### AI vs classical CV
Classical CV is used for edge/contour extraction and geometry because these operations are transparent and directly tied to measurement. A lightweight AI-assisted decision layer is represented by component-class scoring from geometric features. This is intentionally labelled as an estimate rather than a metrology-grade measurement.

### Uncertainty
The prototype assumes approximately ±2 pixels of edge-location uncertainty and propagates it through the scale:

`measurement_uncertainty ≈ 2 × mm_per_pixel`

This is a simplified model. Perspective, lens distortion, camera angle, lighting, blur and reference placement can increase real error.

### What the prototype measures reasonably
- 2D overall length/width when the object and reference are on the same plane
- Approximate diameter for circular parts
- Silhouette-based geometry
- Reference-based scale

### What it does not reliably measure
- Hidden depth / true 3D geometry
- Aerospace-grade dimensional tolerances
- Fine thread pitch from a normal-distance image
- Surface roughness
- Internal/hidden defects
- Exact dimensions under strong perspective or lens distortion

## Fastener demonstration

For a bolt-like silhouette, the prototype maps the measured width to the nearest candidate in a small ISO metric database (M6/M8/M10/M12). The standard and pitch are **database-matched estimates**, not directly measured values.

## Running

Open `index.html` through a local HTTPS/localhost server or deploy the folder to GitHub Pages/Vercel. Smartphone camera access requires a secure context.

Example local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` on the computer. For a phone on the same network, use the computer's local IP; camera permissions may require HTTPS depending on browser/security settings.

## Suggested demo components

1. Washer or circular component
2. Flat plate/bracket
3. Bolt (required fastener)

Place a 50 mm square reference beside each part, keep both in roughly the same plane, use good lighting, and capture several views.

## Submission checklist

- [ ] Working prototype
- [ ] 3 different components including a fastener
- [ ] PDF reports
- [ ] 4–5 minute demonstration recording
- [ ] Private GitHub repository
- [ ] README with calibration, AI/CV choice, uncertainty and limitations
- [ ] Invite required collaborators from the assignment
