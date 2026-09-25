import os
import cv2
import numpy as np
from PIL import Image

base = os.path.dirname(os.path.abspath(__file__))
raw_candidates = [
    os.path.join(base, "logo-raw.png"),
    os.path.join(base, "logo-master.png"),
    r"C:\Users\HARSHIL\.gemini\antigravity\brain\c355fcbb-58e3-4ffb-9df0-0d71db5fee0a\.user_uploaded\media_1790332726869.jpg"
]

src_path = next((p for p in raw_candidates if os.path.exists(p)), None)
if not src_path:
    raise FileNotFoundError("Could not find source logo image.")

img_bgr = cv2.imread(src_path)

# 1. Inpaint Gemini watermark at bottom right [Y: 444..498, X: 908..964]
mask = np.zeros(img_bgr.shape[:2], dtype=np.uint8)
mask[444:498, 908:964] = 255
kernel = np.ones((5, 5), np.uint8)
mask = cv2.dilate(mask, kernel, iterations=1)
inpainted_bgr = cv2.inpaint(img_bgr, mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)

clean_rgb = cv2.cvtColor(inpainted_bgr, cv2.COLOR_BGR2RGB)
pil_clean = Image.fromarray(clean_rgb)

# 2. Perfect full logo crop (Emblem + Text): X: 229..810, Y: 30..513
logo_full = pil_clean.crop((229, 30, 810, 513))

# 3. Perfect square icon / mark crop (Emblem only): X: 329..699, Y: 48..418 (370x370)
logo_mark = pil_clean.crop((329, 48, 699, 418))
logo_mark_512 = logo_mark.resize((512, 512), Image.Resampling.LANCZOS)
logo_mark_256 = logo_mark.resize((256, 256), Image.Resampling.LANCZOS)
logo_mark_64 = logo_mark.resize((64, 64), Image.Resampling.LANCZOS)
logo_mark_32 = logo_mark.resize((32, 32), Image.Resampling.LANCZOS)

target_dirs = [
    base,
    os.path.abspath(os.path.join(base, "..", "..", "frontend"))
]

for d in target_dirs:
    os.makedirs(d, exist_ok=True)
    pil_clean.save(os.path.join(d, "logo-master.png"), optimize=True)
    logo_full.save(os.path.join(d, "logo.png"), optimize=True)
    logo_mark_512.save(os.path.join(d, "logo-mark.png"), optimize=True)
    logo_mark_256.save(os.path.join(d, "logo-mark-256.png"), optimize=True)
    logo_mark_64.save(os.path.join(d, "favicon.png"), optimize=True)
    logo_mark_32.save(os.path.join(d, "favicon.ico"), format="ICO")

print("Logo generation complete: master, logo.png, logo-mark.png, and favicons created cleanly.")
