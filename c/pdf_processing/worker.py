"""One low-priority parsing process per extraction; never shares Qwen's process."""
import json
import os
from pathlib import Path
import sys
from .common import atomic_json
from .extractor import extract
from .formatter import format_text


def main():
    task = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    folder, ident = Path(task["folder"]), task["document_id"]
    os.environ["OMP_THREAD_LIMIT"] = "1"
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    if sys.platform.startswith("linux"):
        import resource
        limit = task["limits"]["memory_mb"] * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    def progress(**fields):
        atomic_json(folder / f"{ident}.status.json", {"status": "processing", **fields})
    try:
        doc = extract(task["input"], task["filename"], ident, task["language"], task["limits"], progress)
        text_path = folder / f"{ident}.txt"
        temporary = text_path.with_suffix(".txt.tmp")
        temporary.write_text(format_text(doc), encoding="utf-8")
        temporary.replace(text_path)
        try:
            doc["text_file"] = str(text_path.relative_to(Path(__file__).resolve().parents[2]))
        except ValueError:
            doc["text_file"] = str(text_path)
        atomic_json(folder / f"{ident}.json", doc)
        atomic_json(folder / f"{ident}.status.json", {"status": "ready", "phase": "ready", "progress": 1,
                    "processed_pages": doc["page_count"], "page_count": doc["page_count"], "ocr": bool(doc["ocr_pages"])})
    except Exception as error:
        message = str(error) or type(error).__name__
        if isinstance(error, ModuleNotFoundError):
            requirements = Path(__file__).resolve().parents[2] / "requirements-pdf.txt"
            message = (f"PDF dependencies are missing from {sys.executable}. Install them using "
                       f"{sys.executable} -m pip install -r {requirements}, then restart EvidenceLens. "
                       f"Missing module: {error.name}.")
        atomic_json(folder / f"{ident}.status.json", {"status": "failed", "phase": "failed", "error": message})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
