# EvidenceLens Python document pipeline

EvidenceLens preprocesses documents before using the existing text chat API:

```text
Chat upload → existing Python gateway → isolated extraction worker
           → PyMuPDF native text / Pytesseract OCR fallback
           → UTF-8 TXT + JSON source metadata
Question   → overlapping chunks → BM25 retrieval → bounded plain-text messages
           → existing Colibri /v1/chat/completions → citation validation → chat
```

The inference engine, model weights, model selection, and ordinary text chat
path are unchanged. No embedding model, separate API server, or external OCR
service is introduced. `c/pdf_processing/` supplies the optional document routes
in `c/openai_server.py`. The frontend uses its existing configured API base URL,
including reverse-proxy prefixes, authentication, host checks, and CORS policy.

## Setup and launch

From the repository root:

```bash
./start-evidencelens.sh
```

The launcher uses the current Python interpreter if PyMuPDF, Pytesseract, and
Pillow are installed. Otherwise it installs `requirements-pdf.txt` in the
project's `.evidencelens/venv` and launches the same gateway with that interpreter.
Extraction subprocesses inherit this Python environment. Subsequent launches
reuse the environment. If a virtual environment lacks pip, the launcher first
tries `ensurepip`, then uses the base interpreter's pip with its supported
`--python` option to install pip into that environment. An unusable environment
is preserved as `venv.incomplete.<id>` before recreation. Stop an older running gateway with Ctrl+C, then restart;
rebuilding the frontend alone cannot load new Python routes into an old process.

Install the Tesseract system executable separately if scanned PDFs are needed:

```bash
# Debian / Ubuntu / Colab
apt-get install -y tesseract-ocr tesseract-ocr-eng
# Optional French OCR
apt-get install -y tesseract-ocr-fra

# macOS
brew install tesseract
# Optional additional languages, including French
brew install tesseract-lang
```

Use `sudo` for system package installation when your environment requires it.
Native text extraction and plain chat work without the Tesseract executable;
a scan produces an actionable error if OCR or its selected language is missing.

### Google Colab

Keep the existing working model and Colibri engine. In the notebook environment,
install the Python and OCR dependencies:

```python
%pip install -r /content/EvidenceLens/requirements-pdf.txt
!apt-get update -qq
!apt-get install -y tesseract-ocr tesseract-ocr-eng
```

Launch from `/content/EvidenceLens` in a terminal or notebook background process:

```bash
./start-evidencelens.sh --host 0.0.0.0 --no-browser
```

Expose the port using Colab's supported proxy instead of opening a notebook's
`127.0.0.1` URL on your laptop:

```python
from google.colab import output
output.serve_kernel_port_as_window(8000)
```

If an older Colab copy stops with `venv/bin/python: No module named pip`, repair
that environment without deleting it:

```python
!python3 -m pip --python /content/EvidenceLens/.evidencelens/venv/bin/python install pip
!bash /content/EvidenceLens/start-evidencelens.sh --host 0.0.0.0 --no-browser
```

The updated launcher performs this repair automatically.

Use the selected port if different. If using the frontend separately, set its
existing Connection base URL to the proxied gateway URL plus `/v1`. Document
routes and chat must use the same updated gateway. Paths are resolved relative
to the checkout, so Python code does not depend on `/content` or a developer's
home directory. Colab commands are documented, not executed as part of local
validation.

## Extraction and storage

Each upload receives a random document ID; original filenames are metadata,
not storage paths. The default location is `data/extracted/`, excluded from Git:

```text
data/extracted/
  <id>.upload.pdf     original PDF (other formats keep their extension)
  <id>.task.json      worker inputs and limits
  <id>.status.json    progress, ready, error, or cancellation state
  <id>.log            extraction worker output
  <id>.txt            structured UTF-8 text
  <id>.json           source metadata and page-local lines
  <context-id>.context.json  document IDs and selected passages for validation
```

Change the directory with `EVIDENCELENS_DATA_DIR`. Metadata's `text_file` identifies
the actual TXT location. Identical original filenames cannot collide.

TXT format:

```text
[FILE: paper.pdf]
[DOCUMENT_ID: <id>]
[PAGE: 1]
[L1] Abstract
[L2] The paper presents a recursive model.

[FILE: paper.pdf]
[DOCUMENT_ID: <id>]
[PAGE: 2]
[L1] Introduction
```

JSON metadata includes `document_id`, `filename`, `page_count`, `pages` (arrays
of lines), `page_methods`, `ocr_pages`, `extraction_method`, `text_file`, and
warnings. Physical PDF pages and line numbers are 1-based. Line numbering
restarts on every page. Long lines are wrapped during extraction before assigning
source indexes; the stored representation is authoritative for citations.

PyMuPDF extracts text blocks first. A column heuristic keeps overlapping left
and right paragraph columns together rather than alternating their lines. Empty
or unusable text layers trigger page OCR. A large scanned region with little
selectable text also triggers OCR, handling scans that have only a native page
number or heading. OCR renders only that page at bounded resolution, converts
it to grayscale with Pillow, applies autocontrast, and invokes Pytesseract with
a timeout. Readable native pages skip OCR. Blank/unreadable pages retain their
physical page index and generate a warning; wholly unreadable files fail.

The original text is preserved in source metadata; OCR results are never sent as
images to Qwen. OCR errors and complex layouts remain possible. Password-protected
PDFs and Word files are unsupported.

## Retrieval and context budget

Pages are divided into roughly 3,000 UTF-8-byte chunks (about 500–1,000 tokens
for common text), with two overlapping source lines. Chunks never cross pages.
BM25 scores query terms across every attached document. Each document's best
passage is considered before additional globally ranked passages. If the budget
cannot include every file, the coverage summary says how many were included.
Small collections can be included completely when they fit.

The default evidence budget is 12,000 units, configurable with
`EVIDENCELENS_CONTEXT_BUDGET`. Accounting uses a conservative UTF-8 byte upper
bound on Qwen's text-token count, not a tokenizer or embedding model download.
The request respects the lower of the gateway's actual context limit and the
requested window, up to 32,768 tokens. It reserves response tokens, chat-template
framing, the question, instructions, and bounded recent conversation history.
Only complete source lines are selected; no clipped quote is substituted for
an original line. This conservative method can use substantially less than the
model's nominal capacity, especially for non-ASCII text.

Prepared model messages contain only `role` and string `content`. Document text
is included as untrusted reference material in a user message, separate from
trusted system instructions. No raw file bytes, images, image URLs, or multimodal
content are included. Ordinary chat without files uses its original path.

The interface reports complete or partial context coverage. With partial
retrieval, the model is instructed to say when available passages are insufficient,
not to assert that the entire document lacks an answer.

## Citation validation

The existing factual/inferred/thought response schema is retained for the chat
interface. After generation completes, the backend validates it against the
saved retrieval selection, and the frontend performs its source-text check.
Document-grounded claims require exact quotations (allowing whitespace changes),
valid IDs, physical pages, and existing line ranges. Every cited line must have
been included in the retrieved context. Duplicate filenames are distinguished
by document ID. Malformed or unsupported citations reject the answer.

Validation establishes provenance, not semantic entailment or truth. Model
classification and reasoning still require review. OCR citations match preserved
OCR text, which can differ from the original scan. Click a citation to inspect
numbered source lines; expand its document controls to download TXT or open the
original PDF at the cited page. Attachment preview offers the same controls.
Downloads are fetched through authenticated API requests.

## Endpoints

All routes use the gateway's existing authentication, host validation, and CORS.
They are under the same configured `/v1` prefix as chat.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/documents` | Service version, extraction limits, OCR availability. |
| POST | `/v1/documents?filename=paper.pdf&language=eng` | Raw bounded upload, returns HTTP 202 with `document_id`. |
| GET | `/v1/documents/<id>` | Progress, pages processed, OCR status, errors, and ready source data. |
| POST | `/v1/documents/<id>/cancel` | Cancel a job; send `{}` as JSON. |
| GET | `/v1/documents/<id>/text` | Download preserved structured UTF-8 TXT. |
| GET | `/v1/documents/<id>/original` | Download/open the original document. |
| POST | `/v1/documents/context` | Retrieve context for document IDs, a question, and optional text history. |
| POST | `/v1/documents/verify` | Validate a model answer using its saved `context_id`. |

Context input includes `document_ids`, `question`, `history`, `context_tokens`,
and `response_tokens`. Output includes `context_id`, text-only `messages`,
`response_tokens`, `coverage`, and `budget`. Send these messages through the
unchanged chat-completions API. Verification input is
`{"context_id":"...","answer":"<model JSON text>"}`.

## Resource limits and retention

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `EVIDENCELENS_MAX_FILE_MB` | 64 | Maximum upload size in MiB. |
| `EVIDENCELENS_MAX_PAGES` | 500 | Maximum PDF pages. |
| `EVIDENCELENS_MAX_CHARACTERS` | 2000000 | Extracted characters per file. |
| `EVIDENCELENS_OCR_SECONDS` | 30 | Tesseract timeout per page. |
| `EVIDENCELENS_EXTRACTION_SECONDS` | 300 | Total job deadline. |
| `EVIDENCELENS_EXTRACTION_JOBS` | 1 | Concurrent extraction jobs, capped at 2. |
| `EVIDENCELENS_EXTRACTION_MEMORY_MB` | 1536 | Worker address-space cap on Linux. |
| `EVIDENCELENS_CONTEXT_BUDGET` | 12000 | Conservative evidence budget before model/context reservations. |

Renders are capped at 12 million pixels. Extraction jobs use separate low-priority
processes, with OCR limited to one OpenMP thread. They do not acquire the inference
scheduler or call the Qwen engine. Native parsing and OCR still share the host's
CPU and memory, so some resource competition remains possible. Linux enforces the
address-space cap; macOS relies on upload, page, pixel, character, and time limits.

Stop cancels parsing and its OCR process group on POSIX. Shutdown also stops
active jobs. A server restart marks interrupted jobs failed; upload those files
again. Windows uses process termination and Pytesseract's page timeout; POSIX
process-group termination is not available there.

Unlike the old browser-only pipeline, uploads and extracted TXT persist on the
server. Chat state is still in browser memory. Removing a chat attachment does
not delete its persisted files. There is no automatic retention policy: stop the
server and remove unneeded document artifacts from the managed data directory
when appropriate. Server data and logs are excluded from Git.

## Validation

```bash
# Use Python with requirements-pdf.txt installed; the launcher-created venv works.
.evidencelens/venv/bin/python -m unittest discover -s tests -p test_pdf_processing.py
python3 -m unittest discover -s scripts -p test_evidencelens_launch.py
PYTHONPATH=c .evidencelens/venv/bin/python -m unittest discover -s c/tests -p test_openai_server.py

cd web
npm test
npm run build
```

Tests cover native research-style PDFs, actual scanned OCR, mixed pages, columns,
Unicode, duplicate names, empty/corrupt inputs, large PDFs, retrieval budgets,
page/line consistency, cross-file citations, out-of-context citation rejection,
untrusted document instructions, job limits/cancellation, authentication, TXT and
original downloads, text-only model transport, and ordinary text chat.
