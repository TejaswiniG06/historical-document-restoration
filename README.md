# Document Restoration Pipeline

Adaptive OCR + image restoration system.
**Pipeline: Analyze → Decide → Apply → Preserve Text**

```
document_restorer/
├── backend/
│   ├── main.py           ← FastAPI app (full pipeline)
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        └── App.jsx
```

---

## 1. Backend setup

### System dependencies

**Ubuntu/Debian**
```bash
sudo apt-get install -y tesseract-ocr poppler-utils
```

**macOS**
```bash
brew install tesseract poppler
```

**Windows**
- Tesseract: https://github.com/UB-Mannheim/tesseract/wiki
- Poppler: https://github.com/oschwartz10612/poppler-windows/releases
- Add both to PATH

### Python setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Check http://localhost:8000/health — you'll see which capabilities are active.

---

## 2. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Pipeline overview

| Step | What it does | Conditional? |
|------|-------------|--------------|
| 1 | Perspective correction (Canny + contour) | Always attempted |
| 2 | Damage analysis (blur, noise, contrast, stain, text) | Always runs |
| 3 | Adaptive decision engine | Always runs |
| 5a | Denoising (fastNlMeans / bilateral) | Only if noisy |
| 5b | Contrast enhancement (CLAHE on LAB L channel) | Only if low contrast |
| 5c | Deblurring (Wiener / unsharp mask) | Only if blurry |
| 7 | Stain / background removal | Only if stains detected |
| 8 | Morphological text repair | Only if broken text |
| 9 | Inpainting (Telea) | Only if missing regions |
| 6 | Adaptive thresholding → OCR-ready binary | Always |
| 11 | OCR (Tesseract → EasyOCR fallback) | Always |
| 12 | PSNR + SSIM metrics | Always |

---

## Tuning thresholds

Thresholds in `analyze_image()` in `main.py`:

| Metric | Variable | Default | Meaning |
|--------|----------|---------|---------|
| Blur | `blur_score < 100` | 100 | Laplacian variance |
| Noise | `noise_score > 150` | 150 | Local pixel variance |
| Contrast | `contrast_score < 40` | 40 | Gray std dev |
| Stains | `irregularity > 20` | 20 | BG subtraction std |
| Broken text | `0.02 < text_density < 0.15` | — | Foreground pixel ratio |

Adjust these for your document corpus.
