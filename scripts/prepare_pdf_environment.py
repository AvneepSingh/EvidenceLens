#!/usr/bin/env python3
"""Find/repair the PDF Python environment, including Colab's pip-less venvs.

stdout contains ONLY the interpreter path, so the launcher can capture it safely.
Installer output and diagnostics go to stderr. No inference/model operations run.
"""
from pathlib import Path
import subprocess
import sys
import uuid

PDF_IMPORTS = "import fitz, pytesseract, PIL"
PYTHON_CHECK = "import sys; sys.exit(sys.version_info < (3, 10))"


def probe(command):
    try:
        return subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except OSError:
        return False


def install(command):
    subprocess.run(command, check=True, stdout=sys.stderr, stderr=sys.stderr)


def bootstrap_pip(base_python, target_python):
    if probe([target_python, "-m", "pip", "--version"]):
        return
    print("Repairing EvidenceLens's Python environment: pip is missing.", file=sys.stderr)
    # This is offline when the interpreter includes ensurepip's bundled wheels.
    if probe([target_python, "-m", "ensurepip", "--upgrade"]):
        return
    # Debian/Colab can disable or omit ensurepip. The base interpreter's pip
    # officially supports managing a different interpreter without pip installed.
    if probe([base_python, "-m", "pip", "--version"]):
        install([base_python, "-m", "pip", "--python", target_python, "install", "pip"])
        if probe([target_python, "-m", "pip", "--version"]):
            return
    raise RuntimeError(
        "Could not bootstrap pip in the PDF environment. Install python3-pip and python3-venv "
        "(apt-get install python3-pip python3-venv on Debian/Colab), then rerun. "
        "Base pip must support --python (pip 22.3+). No model was changed.")


def prepare(root, base_python=sys.executable):
    root = Path(root).resolve()
    if probe([base_python, "-c", PDF_IMPORTS]):
        return base_python
    folder = root / ".evidencelens" / "venv"
    target = str(folder / "bin" / "python")
    if not probe([target, "-c", PYTHON_CHECK]):
        # Preserve an unusable/incomplete environment rather than deleting it.
        if folder.exists():
            backup = folder.with_name("venv.incomplete." + uuid.uuid4().hex[:8])
            folder.rename(backup)
            print(f"Preserved the incomplete Python environment at {backup}", file=sys.stderr)
        print("Creating EvidenceLens's Python environment ...", file=sys.stderr)
        install([base_python, "-m", "venv", "--without-pip", str(folder)])
    if not probe([target, "-c", PDF_IMPORTS]):
        bootstrap_pip(base_python, target)
        install([target, "-m", "pip", "install", "-r", str(root / "requirements-pdf.txt")])
        if not probe([target, "-c", PDF_IMPORTS]):
            raise RuntimeError("PDF packages did not import after installation. Check the installation errors above.")
    return target


if __name__ == "__main__":
    try:
        print(prepare(sys.argv[1]))
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"EvidenceLens Python setup: {error}", file=sys.stderr)
        sys.exit(1)
