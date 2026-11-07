"""Routes hosted by the existing authenticated Colibri HTTP handler."""
import threading
import re
import shutil
from urllib.parse import parse_qs, urlsplit
from .common import DocumentError, EvidenceValidationError
from .service import DocumentService

_lock = threading.Lock()


def service_for(server):
    with _lock:
        if not hasattr(server, "documents_service"):
            server.documents_service = DocumentService()
        return server.documents_service


def handle(handler, request_id):
    path = urlsplit(handler.path).path
    if path != "/v1/documents" and not path.startswith("/v1/documents/"):
        return False
    # Same host checks, API-key requirements and CORS as the chat API.
    handler.require_auth()
    service = service_for(handler.server)
    parts = path.removeprefix("/v1/documents").strip("/").split("/")
    try:
        if handler.command == "GET" and path == "/v1/documents":
            handler.send_json(200, {"service": "evidencelens_documents", "version": 1, "answer_repair": True,
                              "limits": service.limits, "ocr_available": bool(shutil.which("tesseract"))}, request_id)
        elif handler.command == "POST" and path == "/v1/documents":
            if handler.headers.get_all("Transfer-Encoding") or len(handler.headers.get_all("Content-Length", [])) != 1:
                raise DocumentError("Uploads need exactly one Content-Length and no Transfer-Encoding.")
            try:
                raw_size = handler.headers.get("Content-Length", "")
                if not re.fullmatch(r"[0-9]+", raw_size):
                    raise ValueError("Invalid length")
                size = int(raw_size)
            except ValueError as error:
                raise DocumentError("Invalid upload size.") from error
            query = parse_qs(urlsplit(handler.path).query)
            ident = service.submit(handler.rfile, size, query.get("filename", [""])[0], query.get("language", ["eng"])[0])
            handler._body_read = True
            handler.send_json(202, {"document_id": ident, "status": "processing"}, request_id)
        elif handler.command == "POST" and parts == ["context"]:
            handler.send_json(200, service.context(handler.read_json(), getattr(handler.server, "context_limit", None)), request_id)
        elif handler.command == "POST" and parts == ["repair"]:
            handler.send_json(200, service.repair(handler.read_json(), getattr(handler.server, "context_limit", None)), request_id)
        elif handler.command == "POST" and parts == ["verify"]:
            handler.send_json(200, service.verify(handler.read_json()), request_id)
        elif handler.command == "POST" and len(parts) == 2 and parts[1] == "cancel":
            handler.read_json()
            handler.send_json(200, service.cancel(parts[0]), request_id)
        elif handler.command == "GET" and len(parts) == 1 and parts[0]:
            handler.send_json(200, service.status(parts[0]), request_id)
        elif handler.command == "GET" and len(parts) == 2 and parts[1] in {"text", "original"}:
            target, content_type = service.download(parts[0], parts[1])
            size = target.stat().st_size
            handler.send_response(200)
            handler.send_header("Content-Type", content_type)
            handler.send_header("Content-Length", str(size))
            handler.send_header("Content-Disposition", f'inline; filename="{parts[0]}.{ "txt" if parts[1] == "text" else "pdf"}"')
            handler.send_header("Cache-Control", "no-store")
            handler.send_cors_headers(); handler.end_headers()
            with target.open("rb") as file:
                while data := file.read(65536):
                    handler.wfile.write(data)
        else:
            raise DocumentError("Document route not found.", 404)
    except DocumentError as error:
        # Reject upload framing early rather than draining an untrusted huge body.
        if handler.command == "POST" and path == "/v1/documents" and not handler._body_read:
            handler.close_connection = True
        handler.send_json(error.status, {"error": {"message": str(error), "code": "evidence_validation_error" if isinstance(error, EvidenceValidationError) else "document_error"}}, request_id,
                          {"Retry-After": "2"} if error.status == 429 else None)
    return True
