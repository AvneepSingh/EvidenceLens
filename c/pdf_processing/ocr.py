import os
import shutil
from .common import DocumentError


def recognize(image, language="eng", timeout=30):
    import pytesseract
    from PIL import ImageOps
    if not shutil.which("tesseract"):
        raise DocumentError("This page needs OCR. Install Tesseract (apt install tesseract-ocr or brew install tesseract) and retry.")
    if language not in {"eng", "fra", "eng+fra"}:
        raise DocumentError("OCR language must be eng, fra, or eng+fra.")
    available = set(pytesseract.get_languages(config=""))
    missing = set(language.split("+")) - available
    if missing:
        raise DocumentError("Tesseract language data is missing: " + ", ".join(sorted(missing)) +
                            ". Install tesseract-ocr-fra on Debian/Colab or tesseract-lang with Homebrew for French.")
    os.environ["OMP_THREAD_LIMIT"] = "1"
    prepared = ImageOps.autocontrast(ImageOps.exif_transpose(image).convert("L"))
    try:
        return pytesseract.image_to_string(prepared, lang=language, config="--oem 1 --psm 3", timeout=timeout)
    except RuntimeError as error:
        raise DocumentError(f"OCR failed or exceeded its {timeout}-second page limit: {error}") from error
