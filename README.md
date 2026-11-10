<p align="center">
  <img src="web/public/evidencelens-icon.svg" width="76" alt="EvidenceLens document and lens logo">
</p>

<h1 align="center">EvidenceLens</h1>

<p align="center">Chat with your documents. Inspect the evidence behind each answer.</p>

**EvidenceLens is a document-focused chat interface inspired by and built on
[Colibri](https://github.com/JustVugg/colibri).** It extends Colibri's existing
web interface with file uploads, local OCR, and answers whose quotations can be
checked against the source documents. Colibri provides the underlying inference
engine, model setup, and API gateway.

Upload files directly in chat, ask questions across them, or request a brief
abstract. Answers distinguish direct statements, inferences, and thoughts outside
the supplied documents, with clickable page and line references where applicable.

## Features

- **Files inside chat:** attach PDFs, text files, or images without switching to
  a separate analysis tab. Files stay attached for follow-up questions.
- **Quick abstracts:** attach files and send an empty message to request a brief
  abstract.
- **Python extraction and OCR:** PyMuPDF reads selectable PDF text first.
  Isolated workers use Pytesseract and Pillow for pages that need OCR, including
  mixed searchable/scanned PDFs. English and French work when their Tesseract
  language data is installed.
- **Reusable structured text:** uploads produce UTF-8 TXT and JSON metadata
  with original filenames, physical pages, and page-local numbered lines.
- **Relevant context:** overlapping chunks and BM25 retrieval select source
  passages within the model's context budget instead of sending every page.
- **Checked references:** document IDs, page numbers, extracted line ranges,
  and quoted text are checked before supported answers appear.
- **Source inspection:** click a citation to view the matching numbered lines.
- **Compact progress control:** a small progress circle has Stop in its center.
  Extraction shows measured progress; generation shows an indeterminate ring
  and elapsed time.
- **EvidenceLens design:** warm off-white, gold, and brown styling, a document
  and lens logo, and light and dark themes.

Existing Colibri workspaces, including ordinary chat, System One, Brain, and
Profiling, remain available. Their capabilities depend on the selected model.

## Screenshots

### Chat workspace

![EvidenceLens chat workspace with file upload, OCR language selection, and workspace navigation](ss/Screenshot%202026-11-09%20at%207.52.20%E2%80%AFPM.png)

Upload documents directly in chat, choose an OCR language, and ask questions from the same composer.

### Factual answers with source references

![Factual answer showing checked quotations with PDF filenames, page numbers, and line ranges](ss/Screenshot%202026-11-09%20at%207.55.00%E2%80%AFPM.png)

Document-grounded answers show their classification and clickable source references, including page numbers and extracted line ranges.

### Plain-language fallback

![Plain-language answer about an attached PDF with an automatic source verification unavailable notice](ss/Screenshot%202026-11-09%20at%207.54.27%E2%80%AFPM.png)

When structured answer repair fails, chat can still provide a plain-language answer. The verification notice distinguishes it from a checked evidence response.

## How answers are labeled

| Label | Meaning | References |
| --- | --- | --- |
| **Factual** | Directly stated in the attached documents. | Supporting source quotations with page and line numbers. |
| **Inferred** | Derived indirectly from document contents. | An explanation and references to the passages needed for the inference, across relevant files. |
| **Thought answer** | Outside-document reasoning when the documents do not contain the answer. | No claimed document evidence. |

Labels apply to individual claims, so one reply can contain multiple types.
The model is instructed to consider all attached files and cite conflicting
evidence as well as supporting evidence.

**Reference checking verifies where a quotation came from, not whether it proves
the model's conclusion.** Classification, reasoning, and completeness remain
model judgments. OCR can also introduce recognition errors; inspect the original
scan when accuracy matters. Invalid JSON or references trigger one automatic
repair pass using the original question, source context, draft text, and validation
feedback. The repaired answer is checked again before being shown. If it still
fails, one final request answers in ordinary prose using the original question
and document excerpts, without failed drafts or JSON-format instructions. This
plain answer is marked as not automatically source-verified. When the excerpts
are insufficient, it can use general knowledge while distinguishing that from
document-backed information.

Page numbers count from the first physical PDF page. Line numbers are generated
from extracted text and restart on each page; they can differ from printed line
numbers or visual reading order. Text files and images each have one source page.

## Run EvidenceLens

Requirements:

- Python **3.10+**.
- Node.js and npm. The frontend toolchain supports Node **22.12+**; the launcher
  runs a cached Node 22 package through npm when the installed version is older.
- The Tesseract system executable for scanned pages (native text PDFs work without it).
- A compatible text-generating model and enough disk space and memory for it.
  First-time model and dependency installation requires an internet connection.

To install the Python dependencies manually in your gateway's Python environment:

```bash
python -m pip install -r requirements.txt
```

The launcher can also create and prepare its own Python environment automatically.
Tesseract itself is a separate system installation for scanned pages.

From the repository root:

```bash
./start-evidencelens.sh
```

The launcher installs web dependencies when needed, builds this checkout's
EvidenceLens interface, starts the existing model gateway, and opens the browser.
By default, the interface is at **http://127.0.0.1:8000** and the OpenAI-compatible
API is at **http://127.0.0.1:8000/v1**. They share the same server, so no manual
endpoint setup is needed for this launch flow.

If Colibri is already configured on your machine, EvidenceLens reuses its model
and engine while launching this checkout's gateway and interface. EvidenceLens
keeps its own configuration in `.evidencelens/`; the original setup is unchanged.
Without a ready configuration, it uses Colibri's existing model setup flow.

Useful options:

```bash
# Use an already downloaded model
./start-evidencelens.sh --model-dir /path/to/model

# Choose another port for both the interface and API
./start-evidencelens.sh --port 8001

# Build and check the launch configuration without starting a model server
./start-evidencelens.sh --check

# Run without automatically opening the browser
./start-evidencelens.sh --no-browser

# Show all launcher options
./start-evidencelens.sh --help
```

Press **Ctrl+C** in the launch terminal to stop the server. If an older Colibri
server occupies the chosen port, stop that launch first or choose another port.
Use `start-evidencelens.sh` for this interface; `start-here.sh` remains the original
Colibri setup entry point.

## Try it with small PDFs

The [test-pdfs](test-pdfs) folder contains three small, one-page documents:

| File | Purpose |
| --- | --- |
| [01-project-facts.pdf](test-pdfs/01-project-facts.pdf) | Direct factual answers. |
| [02-project-targets.pdf](test-pdfs/02-project-targets.pdf) | Combine with the facts PDF to test inference across files. |
| [03-scanned-receipt.pdf](test-pdfs/03-scanned-receipt.pdf) | An image-only PDF that requires OCR. |

Open chat, choose **Upload files**, and attach the first two PDFs. Ask:

> Has Northstar met its completion target? Show the calculation.

The expected inference is **9 / 12 = 75%**, meeting the **75%** target, with
references to both PDFs. For more questions and expected results, see the
[testing guide](test-pdfs/README.md).

## Privacy, performance, and limits

PDF extraction and OCR run on your Python gateway. The original upload and
structured TXT/JSON are stored in the application-managed `data/extracted/`
directory, excluded from Git. Extraction uses separate low-priority processes,
not the inference engine. No external OCR service is used. Extracted passages
are sent as text to the selected chat endpoint; raw PDFs and page images never
reach the text-only Qwen model.

Documents persist on the server until you remove their stored artifacts.
Removing an attachment affects subsequent questions but does not delete its
stored files. Conversations and attachment selections remain in browser memory
and clear on reload. API keys remain memory-only. Configure retention and access
appropriately for the server you run.

Text PDFs skip unnecessary OCR. OCR makes scans searchable; it does not speed up
model inference. A large model can still answer slowly on a low-memory CPU host.

Current defaults: 12 chat attachments; 64 MiB, 500 pages, and 2 million extracted
characters per file; 30 seconds of OCR per page and 300 seconds per extraction
job; one concurrent extraction job. BM25 context selection reserves space for
instructions, the question, history, and the answer, respecting the gateway's
actual context limit up to 32,768 tokens. The interface shows whether coverage
is complete or partial. Citation checks require every referenced line to have
been included in the retrieved passages.

Install the Tesseract executable for scanned documents (`brew install tesseract`
on macOS or `apt-get install tesseract-ocr` on Debian/Colab). Native extraction
works without OCR; missing executable/language errors are shown clearly.
Word files and password-protected PDFs remain unsupported. OCR and complex
multi-column layouts can still introduce errors.

See the [Python pipeline guide](docs/pdf-processing.md) for dependencies,
Google Colab startup, API endpoints, storage, configuration, and limits.

## Development

The application retains Colibri's architecture: a React/Vite frontend, the
existing Python API gateway, and native inference engines. Python document
routes extend the gateway with extraction, retrieval, and citation validation. The existing UI and `/v1/chat/completions` streaming path
remain in use; no inference-engine changes or embedding model are required.

To run the frontend separately:

```bash
cd web
npm ci
npm run dev
```

Open **http://localhost:5173**. Start your model gateway separately, then configure
**Settings → Connection** with its base URL, such as
`http://127.0.0.1:8000/v1`, click **Probe server**, and select a text model.

Checks:

```bash
# Frontend tests and production build, from web/
npm test
npm run build

# Launcher regression tests, from the repository root
python3 -m unittest discover -s scripts -p test_evidencelens_launch.py

# Python extraction, OCR, retrieval, and API tests
.evidencelens/venv/bin/python -m unittest discover -s tests -p test_pdf_processing.py
```

See the [web interface README](web/README.md) for implementation details and the
[original Colibri README](README.colibri.md) for engine setup, supported model
families, hardware options, and inherited command-line tools. The other language
README files currently describe the upstream Colibri project.

## Inspiration and acknowledgments

EvidenceLens is inspired by **Colibri's approach to running language models
locally** and is directly built on its source code. It adds a document-oriented
workflow and its own interface branding while retaining Colibri's engine and
server architecture.

Credit for the original Colibri project belongs to **Vincenzo Fornaro
([JustVugg](https://github.com/JustVugg)) and the Colibri contributors**.
See the [upstream repository](https://github.com/JustVugg/colibri) for their work.
Document extraction uses [PyMuPDF](https://github.com/pymupdf/PyMuPDF); OCR uses
[Pytesseract](https://github.com/madmaze/pytesseract),
[Tesseract](https://github.com/tesseract-ocr/tesseract), and
[Pillow](https://github.com/python-pillow/Pillow).

This repository retains the [Apache 2.0 license](LICENSE), original attribution
in [NOTICE](NOTICE), and [third-party notices](THIRD_PARTY_NOTICES.md).
