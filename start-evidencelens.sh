#!/bin/sh
# Build this checkout's EvidenceLens UI and run it with the existing model engine.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "${1-}" in
    -h|--help)
        cat <<'HELP'
Usage: ./start-evidencelens.sh [options]

Build and open EvidenceLens with its model API on the same address.
Reuses your configured model; keeps an independent setup in .evidencelens/.

  --model-dir DIR     Use a model already downloaded
  --model ID          Install a catalog model through the existing setup flow
  --port PORT         Choose the API and interface port (default: saved or 8000)
  --host HOST         Bind address (default: saved or 127.0.0.1)
  --ctx TOKENS        Set the model context size
  --no-browser        Run without opening the browser
  --check             Build and validate the launch configuration, then exit
  --yes               Accept the existing setup flow's defaults
  --reconfigure       Choose another model

Other setup options are passed to coli setup. Ctrl+C stops the server.
Requires Python 3.10+ and npm. Uses Node 22 through npm if your Node is too old.
HELP
        exit 0 ;;
esac
python_bin=
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 &&
        "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
        python_bin=$(command -v "$candidate")
        break
    fi
done
if [ -z "$python_bin" ]; then
    echo "EvidenceLens needs Python 3.10 or newer. Install Python and run this script again." >&2
    exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
    echo "EvidenceLens needs Node.js and npm. Install Node.js 22.12+ and run this script again." >&2
    exit 1
fi
# Keep build dependencies on a supported Node even when the shell's Node is old.
use_cached_node=0
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>=24?0:1)' 2>/dev/null; then
    use_cached_node=1
    echo "Using Node.js 22 through npm (downloaded once and cached)."
fi
run_npm() {
    if [ "$use_cached_node" -eq 1 ]; then
        npm exec --yes --package=node@22 -- npm "$@"
    else
        npm "$@"
    fi
}
# Keep optional Python preprocessing dependencies out of the system interpreter.
if ! "$python_bin" -c 'import fitz, pytesseract, PIL' >/dev/null 2>&1; then
    pdf_python="$here/.evidencelens/venv/bin/python"
    if [ ! -x "$pdf_python" ]; then
        echo "Creating EvidenceLens's Python environment ..."
        "$python_bin" -m venv "$here/.evidencelens/venv"
    fi
    if ! "$pdf_python" -c 'import fitz, pytesseract, PIL' >/dev/null 2>&1; then
        "$pdf_python" -m pip install -r "$here/requirements-pdf.txt"
    fi
    python_bin="$pdf_python"
fi
if ! command -v tesseract >/dev/null 2>&1; then
    echo "Tesseract is missing: searchable PDFs still work; scans need Tesseract."
    echo "Install with: brew install tesseract (macOS), or apt install tesseract-ocr (Linux/Colab)."
fi
cd "$here/web"
echo "Building EvidenceLens from $here/web ..."
# npm ci keeps the lockfile authoritative, using the recorded versions.
# Subsequent launches can use the verified installation until the lockfile changes.
dependency_hash=$("$python_bin" -c 'import hashlib; print(hashlib.sha256(open("package-lock.json", "rb").read() + open("package.json", "rb").read()).hexdigest())')
installed_hash=
if [ -f node_modules/.evidencelens-dependencies ]; then
    installed_hash=$(cat node_modules/.evidencelens-dependencies)
fi
if [ "$dependency_hash" != "$installed_hash" ] || [ ! -d node_modules/vite ]; then
    run_npm ci --include=optional
    printf '%s\n' "$dependency_hash" > node_modules/.evidencelens-dependencies
fi
run_npm run build
cd "$here"
exec "$python_bin" "$here/scripts/evidencelens_launch.py" "$@"
