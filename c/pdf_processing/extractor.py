import math
from pathlib import Path
from .common import DocumentError
from .formatter import numbered_lines
from .ocr import recognize


def usable_text(text):
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return False
    bad = sum(c == "\ufffd" or (ord(c) < 32) for c in chars)
    return bad / len(chars) < .02 and sum(c.isalnum() for c in chars) / len(chars) > .35


def native_text(page):
    """Keep paragraph blocks together and read genuine columns left before right."""
    blocks = [b for b in page.get_text("blocks", sort=False) if len(b) < 7 or b[6] == 0]
    midpoint = page.rect.width / 2
    left = [b for b in blocks if b[2] <= midpoint + 8]
    right = [b for b in blocks if b[0] >= midpoint - 8]
    # A vertical overlap differentiates columns from ordinary indented text.
    columns = any(min(a[3], b[3]) - max(a[1], b[1]) > 15 for a in left for b in right)
    if not columns:
        return "\n".join(b[4] for b in sorted(blocks, key=lambda b: (round(b[1], 1), b[0])))
    spanning = sorted([b for b in blocks if b not in left and b not in right], key=lambda b: b[1])
    ordered = []
    pending = [b for b in blocks if b not in spanning]
    for heading in spanning:
        band = [b for b in pending if b[1] < heading[1]]
        ordered.extend(sorted(band, key=lambda b: (b[0] >= midpoint - 8, b[1], b[0])))
        pending = [b for b in pending if b not in band]
        ordered.append(heading)
    ordered.extend(sorted(pending, key=lambda b: (b[0] >= midpoint - 8, b[1], b[0])))
    return "\n".join(b[4] for b in ordered)


def extract(path, filename, document_id, language, limits, progress):
    import fitz
    from PIL import Image
    path = Path(path)
    pages, methods, warnings = [], [], []
    total_chars = 0

    def add(text, method, page_number, count):
        nonlocal total_chars
        lines = numbered_lines(text)
        total_chars += sum(len(line) for line in lines)
        if total_chars > limits["max_chars"]:
            raise DocumentError("Extracted text exceeds the document character limit.")
        pages.append(lines); methods.append(method)
        if not lines:
            warnings.append(f"Page {page_number} has no readable text after extraction.")
        progress(phase="extracting", processed_pages=page_number, page_count=count,
                 progress=page_number / max(1, count), ocr=method == "ocr")

    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        try:
            pdf = fitz.open(path)
        except Exception as error:
            raise DocumentError("The PDF is empty or corrupted and cannot be opened.") from error
        with pdf:
            if pdf.needs_pass:
                raise DocumentError("Password-protected PDFs are not supported. Upload an unlocked copy.")
            if not 1 <= len(pdf) <= limits["max_pages"]:
                raise DocumentError(f"PDF must contain 1–{limits['max_pages']} pages.")
            for number, page in enumerate(pdf, 1):
                progress(phase="extracting", processed_pages=number - 1, page_count=len(pdf),
                         progress=(number - 1) / len(pdf), ocr=False)
                text = native_text(page)
                usable = usable_text(text)
                image_area = sum(fitz.Rect(info["bbox"]).get_area() for info in page.get_image_info())
                # Detect page-number-only scans and unusable text layers. Large scanned
                # regions with a short native heading also warrant OCR of that page.
                needs_ocr = not usable or (image_area > page.rect.get_area() * .5 and len(text.strip()) < 150)
                method = "native"
                if needs_ocr:
                    progress(phase="ocr", processed_pages=number - 1, page_count=len(pdf),
                             progress=(number - 1) / len(pdf), ocr=True, current_page=number)
                    area = max(1, page.rect.get_area())
                    scale = min(limits["dpi"] / 72, math.sqrt(limits["max_pixels"] / area))
                    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
                    with Image.frombytes("L", (pix.width, pix.height), pix.samples) as image:
                        recognized = recognize(image, language, limits["ocr_seconds"])
                    if usable_text(recognized):
                        text, method = recognized, "ocr"
                    elif not usable:
                        text, method = "", "ocr"
                    else:
                        warnings.append(f"OCR found no additional readable text on page {number}; native text retained.")
                add(text, method, number, len(pdf))
    elif suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        progress(phase="ocr", processed_pages=0, page_count=1, progress=0, ocr=True)
        Image.MAX_IMAGE_PIXELS = limits["max_pixels"]
        try:
            with Image.open(path) as image:
                if image.width * image.height > limits["max_pixels"]:
                    raise DocumentError("Image exceeds the OCR pixel limit.")
                add(recognize(image, language, limits["ocr_seconds"]), "ocr", 1, 1)
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise DocumentError("Image exceeds the OCR pixel limit.") from error
    elif suffix in {".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".html", ".tex"}:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeError as error:
            raise DocumentError("Text files must use UTF-8 encoding.") from error
        if "\0" in text:
            raise DocumentError("The upload is a binary file, not UTF-8 text.")
        add(text, "native", 1, 1)
    else:
        raise DocumentError("Unsupported file. Upload PDF, UTF-8 text, or a PNG/JPEG/WebP/TIFF image.")
    if not any(pages):
        raise DocumentError("No readable text found. Check the scan quality and OCR language.")
    return {"document_id": document_id, "filename": filename, "pages": pages,
            "page_count": len(pages), "page_methods": methods,
            "extraction_method": "hybrid" if len(set(methods)) > 1 else ("ocr" if "ocr" in methods else "native"),
            "ocr_pages": [n for n, method in enumerate(methods, 1) if method == "ocr"], "warnings": warnings}
