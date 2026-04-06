import pytesseract
import os
import cv2
import numpy as np

def run_diagnostic():
    print("--- OCR Diagnostic ---")
    
    # 1. Check Tesseract Path
    binary_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(binary_path):
        print(f"[OK] Tesseract binary found at: {binary_path}")
        pytesseract.pytesseract.tesseract_cmd = binary_path
    else:
        print(f"[FAIL] Tesseract binary NOT found at {binary_path}")
        print("Please ensure Tesseract-OCR is installed correctly.")
        return

    # 2. Check Tesseract Version
    try:
        ver = pytesseract.get_tesseract_version()
        print(f"[OK] Tesseract Version: {ver}")
    except Exception as e:
        print(f"[FAIL] Could not get Tesseract version: {e}")
        return

    # 3. Dummy OCR Test
    print("Running sample OCR test...")
    # Create a white image with black text
    img = np.full((100, 300), 255, dtype=np.uint8)
    cv2.putText(img, "TEST OK", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, 0, 2)
    
    try:
        text = pytesseract.image_to_string(img).strip()
        if "TEST" in text:
            print(f"[SUCCESS] OCR result: '{text}'")
        else:
            print(f"[WARNING] OCR returned: '{text}' (Expected 'TEST OK')")
    except Exception as e:
        print(f"[FAIL] OCR execution error: {e}")

if __name__ == "__main__":
    run_diagnostic()
