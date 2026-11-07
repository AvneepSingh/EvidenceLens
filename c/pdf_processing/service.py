import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid
from .citations import validate_answer
from .common import DocumentError, atomic_json, positive_env, read_json, safe_filename, valid_id
from .retrieval import prepare_context


class DocumentService:
    def __init__(self, folder=None):
        self.folder = Path(folder or os.environ.get("EVIDENCELENS_DATA_DIR") or
                           Path(__file__).resolve().parents[2] / "data" / "extracted").resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        self.limits = {"max_bytes": positive_env("EVIDENCELENS_MAX_FILE_MB", 64, 128) * 1024 * 1024,
                       "max_pages": positive_env("EVIDENCELENS_MAX_PAGES", 500, 1000),
                       "max_chars": positive_env("EVIDENCELENS_MAX_CHARACTERS", 2_000_000, 10_000_000),
                       "ocr_seconds": positive_env("EVIDENCELENS_OCR_SECONDS", 30, 120),
                       "job_seconds": positive_env("EVIDENCELENS_EXTRACTION_SECONDS", 300, 1800),
                       "memory_mb": positive_env("EVIDENCELENS_EXTRACTION_MEMORY_MB", 1536, 4096),
                       "max_pixels": 12_000_000, "dpi": 180}
        self.slots = threading.BoundedSemaphore(positive_env("EVIDENCELENS_EXTRACTION_JOBS", 1, 2))
        self.lock = threading.Lock()
        self.jobs = {}

    def submit(self, reader, size, filename, language="eng"):
        if not 1 <= size <= self.limits["max_bytes"]:
            raise DocumentError(f"Upload must be between 1 byte and {self.limits['max_bytes'] // 1048576} MiB.", 413)
        filename = safe_filename(filename)
        if language not in {"eng", "fra", "eng+fra"}:
            raise DocumentError("Invalid OCR language.")
        suffix = Path(filename).suffix.lower()
        if suffix not in {".pdf", ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".html", ".tex", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
            raise DocumentError("Unsupported upload. Use PDF, UTF-8 text, or an image.")
        if not self.slots.acquire(blocking=False):
            raise DocumentError("Another document is being extracted. Wait for it to finish or stop it before uploading another.", 429)
        ident = uuid.uuid4().hex
        path = self.folder / f"{ident}.upload{suffix}"
        try:
            remaining = size
            with path.open("xb") as output:
                while remaining:
                    data = reader.read(min(65536, remaining))
                    if not data:
                        raise DocumentError("Upload was interrupted before the file was complete.")
                    output.write(data); remaining -= len(data)
            task = {"document_id": ident, "folder": str(self.folder), "input": str(path),
                    "filename": filename, "language": language, "limits": self.limits}
            atomic_json(self.folder / f"{ident}.task.json", task)
            atomic_json(self.folder / f"{ident}.status.json", {"status": "processing", "phase": "starting", "progress": 0,
                        "processed_pages": 0, "page_count": None})
            job = {"cancelled": threading.Event(), "process": None, "finished": threading.Event()}
            with self.lock:
                self.jobs[ident] = job
            threading.Thread(target=self._run, args=(ident, job), daemon=True).start()
        except BaseException:
            path.unlink(missing_ok=True)
            self.slots.release()
            raise
        return ident

    @staticmethod
    def _terminate(process):
        if process is None or process.poll() is not None:
            return
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
            process.wait(timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            try:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                pass

    def _run(self, ident, job):
        process = None
        try:
            env = dict(os.environ, OMP_THREAD_LIMIT="1", OPENBLAS_NUM_THREADS="1")
            with (self.folder / f"{ident}.log").open("wb") as log:
                process = subprocess.Popen([sys.executable, "-m", "pdf_processing.worker", str(self.folder / f"{ident}.task.json")],
                                           cwd=Path(__file__).resolve().parents[1], env=env,
                                           stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=os.name == "posix")
                with self.lock:
                    job["process"] = process
                deadline = time.monotonic() + self.limits["job_seconds"]
                while process.poll() is None:
                    if job["cancelled"].wait(.1):
                        self._terminate(process)
                        break
                    if time.monotonic() >= deadline:
                        self._terminate(process)
                        atomic_json(self.folder / f"{ident}.status.json", {"status": "failed", "phase": "failed", "error": "Document extraction exceeded its total time limit."})
                        break
            if job["cancelled"].is_set():
                for suffix in (".json", ".txt", ".txt.tmp"):
                    (self.folder / f"{ident}{suffix}").unlink(missing_ok=True)
                atomic_json(self.folder / f"{ident}.status.json", {"status": "cancelled", "phase": "cancelled"})
            else:
                state = read_json(self.folder / f"{ident}.status.json")
                if state["status"] == "processing":
                    atomic_json(self.folder / f"{ident}.status.json", {"status": "failed", "phase": "failed", "error": "The extraction worker exited unexpectedly. See the document log on the server."})
        except Exception as error:
            self._terminate(process)
            atomic_json(self.folder / f"{ident}.status.json", {"status": "failed", "phase": "failed", "error": str(error)})
        finally:
            with self.lock:
                self.slots.release()
                self.jobs.pop(ident, None)
                job["finished"].set()

    def close(self):
        with self.lock:
            jobs = list(self.jobs.items())
        for ident, job in jobs:
            try:
                ready = read_json(self.folder / f"{ident}.status.json")["status"] == "ready"
            except (OSError, ValueError):
                ready = False
            if not ready:
                job["cancelled"].set()
                self._terminate(job.get("process"))
        for _, job in jobs:
            job["finished"].wait(6)

    def status(self, ident):
        ident = valid_id(ident)
        try:
            state = read_json(self.folder / f"{ident}.status.json")
        except FileNotFoundError as error:
            raise DocumentError("Document not found.", 404) from error
        if state["status"] == "processing":
            with self.lock:
                active = ident in self.jobs
            if not active:
                state = {"status": "failed", "phase": "failed", "error": "Extraction was interrupted by a server restart. Upload the file again."}
        if state["status"] == "ready":
            with self.lock:
                finalizing = ident in self.jobs
            if finalizing:
                return {"document_id": ident, **state, "status": "processing", "phase": "finalizing", "progress": .99}
            doc = self.document(ident)
            state = {**state, "document": {"id": ident, "name": doc["filename"], "pages": doc["pages"], "ocrPages": doc["ocr_pages"],
                       "backend": True, "extractionMethod": doc["extraction_method"], "textFile": doc["text_file"], "warnings": doc["warnings"]}}
        return {"document_id": ident, **state}

    def document(self, ident):
        ident = valid_id(ident)
        try:
            return read_json(self.folder / f"{ident}.json")
        except FileNotFoundError as error:
            raise DocumentError("Document is not ready or no longer exists. Upload it again.", 404) from error

    def cancel(self, ident):
        ident = valid_id(ident)
        with self.lock:
            job = self.jobs.get(ident)
            if job:
                job["cancelled"].set()
        if job:
            return {"status": "cancelling"}
        return self.status(ident)

    def context(self, body, model_context=None):
        ids = body.get("document_ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 12 or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            raise DocumentError("Provide 1–12 unique document IDs.")
        docs = [self.document(i) for i in ids]
        requested = body.get("context_tokens", 32768)
        if type(requested) is not int or not 2048 <= requested <= 32768:
            raise DocumentError("Context window must be an integer from 2,048 to 32,768 tokens.")
        limit = min(requested, model_context or 32768)
        selection = prepare_context(docs, body.get("question"), body.get("history"), limit, body.get("response_tokens", 2048))
        ident = uuid.uuid4().hex
        atomic_json(self.folder / f"{ident}.context.json", {"document_ids": ids, "chunks": selection["chunks"], "created": time.time()})
        return {"context_id": ident, **{k: v for k, v in selection.items() if k != "chunks"}}

    def verify(self, body):
        ident = valid_id(body.get("context_id"))
        try:
            context = read_json(self.folder / f"{ident}.context.json")
        except FileNotFoundError as error:
            raise DocumentError("Retrieved context not found. Ask the question again.", 404) from error
        docs = [self.document(i) for i in context["document_ids"]]
        return {"answer": validate_answer(body.get("answer"), docs, context["chunks"])}

    def download(self, ident, kind):
        doc = self.document(ident)
        if kind == "text":
            return self.folder / f"{ident}.txt", "text/plain; charset=utf-8"
        task = read_json(self.folder / f"{ident}.task.json")
        # The path is reconstructed from our ID and stored extension, never from a request path.
        suffix = Path(task["filename"]).suffix.lower()
        return self.folder / f"{ident}.upload{suffix}", "application/pdf" if suffix == ".pdf" else "application/octet-stream"
