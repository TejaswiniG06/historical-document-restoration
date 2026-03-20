"""somewhat fixed torn areas"""

"""
Document Restoration Pipeline v5
Key insight: OpenCV inpaint fails on large regions.
Instead we use PAPER COLOUR FILL:
- Estimate the paper colour from clean regions
- Replace stains/tears directly with paper colour
- Then let the ink shine through via background normalisation
"""
import base64, logging, os, traceback
from pathlib import Path
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from skimage.metrics import peak_signal_noise_ratio as psnr
    from skimage.metrics import structural_similarity as ssim
    from skimage.filters import wiener
    HAS_SKIMAGE = True
except ImportError:
    HAS_SKIMAGE = False

try:
    from scipy.signal import convolve2d
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

try:
    import pytesseract
    _tp = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(_tp):
        pytesseract.pytesseract.tesseract_cmd = _tp
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

try:
    import easyocr
    _easyocr_reader = None
    HAS_EASYOCR = True
except ImportError:
    HAS_EASYOCR = False

try:
    from pdf2image import convert_from_bytes
    HAS_PDF2IMAGE = True
except ImportError:
    HAS_PDF2IMAGE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI(title="Document Restoration API", version="5.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def encode_image(img):
    ok, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode()

def decode_upload(data):
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Cannot decode image")
    return img

def pdf_to_first_image(data):
    pages = convert_from_bytes(data, dpi=200)
    return cv2.cvtColor(np.array(pages[0].convert("RGB")), cv2.COLOR_RGB2BGR)

def get_paper_colour(img):
    """
    Estimate the paper (background) colour by sampling the brightest,
    least-saturated pixels — these are guaranteed to be clean paper.
    Returns a BGR colour tuple.
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s = hsv[:,:,1].astype("float32")
    v = hsv[:,:,2].astype("float32")
    # Clean paper = low saturation AND high brightness
    paper_mask = ((s < 30) & (v > 180)).astype(np.uint8)
    if paper_mask.sum() < 100:
        # fallback: top 10% brightest pixels
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        thresh = np.percentile(gray, 90)
        paper_mask = (gray > thresh).astype(np.uint8)
    b = int(np.median(img[:,:,0][paper_mask > 0]))
    g = int(np.median(img[:,:,1][paper_mask > 0]))
    r = int(np.median(img[:,:,2][paper_mask > 0]))
    return (b, g, r)

# ── Step 1: Perspective ───────────────────────────────────────────────────────

def detect_and_correct_perspective(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray,(5,5),0), 75, 200)
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
    doc = None
    for c in cnts:
        a = cv2.approxPolyDP(c, 0.02*cv2.arcLength(c,True), True)
        if len(a) == 4: doc = a; break
    if doc is None: return img, False
    pts = doc.reshape(4,2).astype("float32")
    s, d = pts.sum(1), np.diff(pts, axis=1)
    ord_ = np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], dtype="float32")
    tl,tr,br,bl = ord_
    w = int(max(np.linalg.norm(br-bl), np.linalg.norm(tr-tl)))
    h = int(max(np.linalg.norm(tr-br), np.linalg.norm(tl-bl)))
    dst = np.array([[0,0],[w-1,0],[w-1,h-1],[0,h-1]], dtype="float32")
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(ord_,dst),(w,h)), True

# ── Step 2: Analysis ──────────────────────────────────────────────────────────

def analyze_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s_ch = hsv[:,:,1]
    v_ch = hsv[:,:,2]

    blur_score     = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    noise_score    = float((cv2.blur(gray.astype("float32")**2,(5,5))
                            - cv2.blur(gray.astype("float32"),(5,5))**2).mean())
    contrast_score = float(gray.std())
    bg_est         = cv2.GaussianBlur(gray,(51,51),0).astype("float32")
    irregularity   = float(np.std(gray.astype("float32") - bg_est))

    # Colour stains: large high-sat blobs
    sat_mask  = ((s_ch > 45) & (v_ch > 75)).astype(np.uint8)*255
    k_open    = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(10,10))
    large_sat = cv2.morphologyEx(sat_mask, cv2.MORPH_OPEN, k_open)
    stain_px  = int(large_sat.sum()/255)

    # Torn regions: large dark blobs OR irregular dark border damage
    _, dark_strict = cv2.threshold(gray, 40, 255, cv2.THRESH_BINARY_INV)
    _, dark_loose  = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
    k_big          = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(20,20))
    large_dark     = cv2.morphologyEx(dark_strict, cv2.MORPH_OPEN, k_big)
    # Border damage: dark pixels near any edge (loose threshold)
    h_g, w_g = gray.shape
    bw2, bh2 = max(15, w_g//10), max(15, h_g//10)
    border2  = np.zeros_like(gray, np.uint8)
    border2[:bh2,:]=255; border2[-bh2:,:]=255
    border2[:,:bw2]=255; border2[:,-bw2:]=255
    border_dark = cv2.bitwise_and(dark_loose, border2)
    k_b = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(12,12))
    border_dark = cv2.morphologyEx(border_dark, cv2.MORPH_OPEN, k_b)
    combined    = cv2.bitwise_or(large_dark, border_dark)
    dark_ratio  = float(combined.sum()/255/max(combined.size,1))

    _, binary     = cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    text_density  = float((binary==0).sum()/binary.size)

    return {
        "blur_score":        round(blur_score,2),
        "is_blurry":         blur_score < 100.0,
        "noise_score":       round(noise_score,2),
        "is_noisy":          noise_score > 150.0,
        "contrast_score":    round(contrast_score,2),
        "is_low_contrast":   contrast_score < 45.0,
        "stain_irregularity":round(irregularity,2),
        "has_stains":        irregularity > 15.0,
        "has_colour_stains": stain_px > 400,
        "stain_pixel_count": stain_px,
        "dark_ratio":        round(dark_ratio,4),
        "has_torn_regions":  dark_ratio > 0.001,
        "text_density":      round(text_density,4),
        "has_broken_text":   0.02 < text_density < 0.25,
    }

def build_pipeline(p):
    return {
        "colour_stain_removal": p["has_colour_stains"],
        "torn_region_fill":     p["has_torn_regions"],
        "bg_normalise":         p["has_stains"],
        "contrast_enhance":     p["is_low_contrast"],
        "denoise":              p["is_noisy"],
        "deblur":               p["is_blurry"],
        "morphological_repair": p["has_broken_text"],
        "sharpen":              True,
    }

# ── Step 7A: Colour stain removal via paper-colour fill ──────────────────────

def remove_colour_stains(img):
    """
    1. Find large saturated blobs (real stains)
    2. Protect all dark ink pixels
    3. Fill stain regions with smooth paper colour (Gaussian-blurred fill)
       so there are no hard edges
    """
    paper_bgr = get_paper_colour(img)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h_ch, s_ch, v_ch = cv2.split(hsv)

    # Detect coloured blobs: high saturation + bright (not dark ink)
    candidate = ((s_ch > 45) & (v_ch > 75)).astype(np.uint8)*255

    # Open to remove thin features (ink strokes don't survive)
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(10,10))
    blob   = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, k_open)

    # Keep only large connected components
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(blob, connectivity=8)
    stain_mask = np.zeros_like(blob)
    for lbl in range(1, num_labels):
        if stats[lbl, cv2.CC_STAT_AREA] > 250:
            stain_mask[labels==lbl] = 255

    if stain_mask.sum() == 0:
        return img

    # Protect ink: dark pixels must never be filled
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ink_mask = (gray < 100).astype(np.uint8)*255
    stain_mask = cv2.bitwise_and(stain_mask, cv2.bitwise_not(ink_mask))

    # Grow mask to cover stain edges
    k_d = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13))
    stain_mask = cv2.dilate(stain_mask, k_d, iterations=2)
    stain_mask = cv2.bitwise_and(stain_mask, cv2.bitwise_not(ink_mask))

    # Build paper fill image: uniform paper colour
    paper_fill = np.full_like(img, paper_bgr)

    # Blend: stain region → paper colour, rest → original
    # Use soft alpha from the mask for smooth edges
    alpha = cv2.GaussianBlur(stain_mask.astype("float32")/255, (21,21), 0)
    alpha3 = np.stack([alpha,alpha,alpha], axis=2)
    result = (paper_fill.astype("float32") * alpha3
              + img.astype("float32") * (1.0 - alpha3))
    return result.clip(0,255).astype("uint8")

# ── Step 9: Torn region fill ──────────────────────────────────────────────────

def fill_torn_regions(img):
    """
    Fill large dark torn/missing areas and dark border damage with paper colour.
    Uses two-threshold detection (strict interior + loose border) and smooth
    Gaussian blending so there are no hard fill edges.
    """
    paper_bgr = get_paper_colour(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # ── Interior tears: very dark blobs (holes, burns) ──
    _, dark_strict = cv2.threshold(gray, 40, 255, cv2.THRESH_BINARY_INV)
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (18, 18))
    interior_torn = cv2.morphologyEx(dark_strict, cv2.MORPH_OPEN, k_open)

    # ── Border damage: moderately dark pixels near edges ──
    _, dark_loose = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
    h, w = gray.shape
    bw, bh = max(20, w // 10), max(20, h // 10)
    border = np.zeros_like(gray, np.uint8)
    border[:bh, :] = 255; border[-bh:, :] = 255
    border[:, :bw] = 255; border[:, -bw:] = 255
    border_dark = cv2.bitwise_and(dark_loose, border)
    k_b = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    border_dark = cv2.morphologyEx(border_dark, cv2.MORPH_OPEN, k_b)
    # Flood outward from border damage so ragged edges are fully covered
    border_dark = cv2.dilate(border_dark,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (30, 30)),
                             iterations=2)

    # ── Combine ──
    torn = cv2.bitwise_or(interior_torn, border_dark)

    if torn.sum() == 0:
        return img

    # ── Protect real ink inside torn zones ──
    # Ink is dark but thin — erosion removes large dark blobs, keeps strokes
    ink_mask = (gray < 60).astype(np.uint8) * 255
    k_ink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (6, 6))
    ink_only = cv2.erode(ink_mask, k_ink, iterations=1)   # thin strokes survive
    torn = cv2.bitwise_and(torn, cv2.bitwise_not(ink_only))

    # ── Soft alpha blend so fill has no hard edge ──
    alpha = cv2.GaussianBlur(torn.astype("float32") / 255, (41, 41), 0)
    alpha = np.clip(alpha * 1.4, 0, 1)          # push mid-tones toward 1
    alpha3 = np.stack([alpha, alpha, alpha], axis=2)

    paper_fill = np.full_like(img, paper_bgr, dtype=np.float32)
    result = paper_fill * alpha3 + img.astype("float32") * (1.0 - alpha3)
    return result.clip(0, 255).astype("uint8")

# ── Step 7B: Background normalisation ────────────────────────────────────────

def normalise_background(img):
    """
    Flatten uneven paper tone / yellowing.
    Large dilation kernel estimates background, then we normalise.
    Blend 55% normalised + 45% original to keep ink dark.
    """
    result = np.zeros_like(img, dtype="float32")
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(61,61))
    for i in range(3):
        ch  = img[:,:,i].astype("float32")
        bg  = cv2.morphologyEx(ch, cv2.MORPH_DILATE, k)
        result[:,:,i] = np.clip((ch/(bg+1e-6))*255, 0, 255)
    norm = result.astype("uint8")
    return cv2.addWeighted(norm, 0.55, img, 0.45, 0)

# ── Step 5B: Contrast ─────────────────────────────────────────────────────────

def enhance_contrast(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l,a,b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8)).apply(l)
    return cv2.cvtColor(cv2.merge([l,a,b]), cv2.COLOR_LAB2BGR)

# ── Step 5A: Denoise ──────────────────────────────────────────────────────────

def denoise(img):
    return cv2.bilateralFilter(img, d=9, sigmaColor=75, sigmaSpace=75)

# ── Step 5C: Deblur ───────────────────────────────────────────────────────────

def deblur(img):
    if HAS_SKIMAGE and HAS_SCIPY:
        out = np.zeros_like(img)
        for i in range(3):
            out[:,:,i]=(wiener(img[:,:,i].astype("float64"),(5,5))*255).clip(0,255).astype("uint8")
        return out
    return cv2.addWeighted(img,1.5,cv2.GaussianBlur(img,(0,0),3),-0.5,0)

# ── Step 8: Morphological repair ─────────────────────────────────────────────

def morph_repair(img):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2,2))
    return cv2.morphologyEx(img, cv2.MORPH_CLOSE, k, iterations=1)

# ── Step 10: Sharpen ──────────────────────────────────────────────────────────

def sharpen_text(img):
    blur = cv2.GaussianBlur(img,(0,0),1.5)
    return cv2.addWeighted(img, 1.8, blur, -0.8, 0)

# ── Step 6: OCR prep ──────────────────────────────────────────────────────────

def prepare_for_ocr(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.adaptiveThreshold(gray,255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,10)

# ── Step 11: OCR ──────────────────────────────────────────────────────────────

def run_ocr(binary):
    if HAS_TESSERACT:
        try:
            t = pytesseract.image_to_string(binary, config="--psm 6")
            if t.strip(): return t.strip()
        except Exception as e: logger.warning(f"Tesseract:{e}")
    if HAS_EASYOCR:
        global _easyocr_reader
        if _easyocr_reader is None:
            _easyocr_reader = easyocr.Reader(["en"], gpu=False)
        try:
            return "\n".join(r[1] for r in _easyocr_reader.readtext(binary)).strip()
        except Exception as e: logger.warning(f"EasyOCR:{e}")
    return "[OCR unavailable]"

# ── Step 12: Metrics ──────────────────────────────────────────────────────────

def compute_metrics(orig, proc):
    if not HAS_SKIMAGE:
        return {"psnr":None,"ssim":None,"note":"scikit-image not installed"}
    if orig.shape != proc.shape:
        proc = cv2.resize(proc,(orig.shape[1],orig.shape[0]))
    og = cv2.cvtColor(orig,cv2.COLOR_BGR2GRAY).astype("float64")
    pr = cv2.cvtColor(proc,cv2.COLOR_BGR2GRAY).astype("float64")
    return {
        "psnr": round(float(psnr(og,pr,data_range=255)),2),
        "ssim": round(float(ssim(og,pr,data_range=255)),4),
    }

# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_pipeline(img):
    steps = {}
    corrected, fixed = detect_and_correct_perspective(img)
    if fixed: steps["1_perspective_corrected"] = encode_image(corrected)
    working = corrected.copy()
    orig    = img.copy()

    profile  = analyze_image(working)
    pipeline = build_pipeline(profile)

    # 1. Remove large coloured stains with paper-colour fill
    if pipeline["colour_stain_removal"]:
        working = remove_colour_stains(working)
        steps["7a_colour_stains_removed"] = encode_image(working)

    # 2. Fill torn/dark regions with paper colour
    if pipeline["torn_region_fill"]:
        working = fill_torn_regions(working)
        steps["9_torn_regions_filled"] = encode_image(working)

    # 3. Normalise background
    if pipeline["bg_normalise"]:
        working = normalise_background(working)
        steps["7b_background_normalised"] = encode_image(working)

    # 4. Contrast
    if pipeline["contrast_enhance"]:
        working = enhance_contrast(working)
        steps["5b_contrast_enhanced"] = encode_image(working)

    # 5. Denoise
    if pipeline["denoise"]:
        working = denoise(working)
        steps["5a_denoised"] = encode_image(working)

    # 6. Deblur
    if pipeline["deblur"]:
        working = deblur(working)
        steps["5c_deblurred"] = encode_image(working)

    # 7. Morph repair
    if pipeline["morphological_repair"]:
        working = morph_repair(working)
        steps["8_morphological_repair"] = encode_image(working)

    # 8. Sharpen (always)
    working = sharpen_text(working)
    steps["10_sharpened"] = encode_image(working)

    # 9. OCR binary
    binary = prepare_for_ocr(working)
    steps["6_ocr_ready_binary"] = encode_image(binary)

    return {
        "original":         encode_image(img),
        "restored":         encode_image(working),
        "binary":           encode_image(binary),
        "steps":            {k:v for k,v in steps.items() if v},
        "damage_profile":   profile,
        "pipeline_applied": pipeline,
        "ocr_text":         run_ocr(binary),
        "metrics":          compute_metrics(orig, working),
    }

# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status":"ok","capabilities":{
        "tesseract":HAS_TESSERACT,"easyocr":HAS_EASYOCR,
        "pdf2image":HAS_PDF2IMAGE,"skimage":HAS_SKIMAGE}}

@app.post("/restore")
async def restore_document(file: UploadFile = File(...)):
    raw = await file.read()
    ext = Path(file.filename or "").suffix.lower()
    try:
        img = pdf_to_first_image(raw) if ext==".pdf" else decode_upload(raw)
    except Exception as e:
        raise HTTPException(400, detail=f"Cannot read file: {e}")
    try:
        result = run_pipeline(img)
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(500, detail=f"Pipeline error: {e}")
    return JSONResponse(content=result)
