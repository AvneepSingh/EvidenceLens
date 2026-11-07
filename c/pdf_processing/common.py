import json
import os
from pathlib import Path
import re
import uuid


class DocumentError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def valid_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
        raise DocumentError("Invalid document or context ID.")
    return value


def positive_env(name, default, maximum):
    try:
        return max(1, min(maximum, int(os.environ.get(name, default))))
    except (TypeError, ValueError):
        return default


def safe_filename(name):
    if not isinstance(name, str) or not name.strip() or len(name.encode("utf-8")) > 512:
        raise DocumentError("Provide a filename of at most 512 UTF-8 bytes.")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    # Filenames are display metadata, never filesystem paths or prompt headers.
    return "".join(c for c in name if c.isprintable()).strip() or "document.pdf"
