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
- **Local extraction and OCR:** PDF.js reads existing PDF text. Pages without
  text and image uploads use Tesseract.js in a browser worker. English, French,
  and combined English/French recognition are available.
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
scan when accuracy matters. Invalid references cause the answer to be rejected
rather than displayed as verified.

Page numbers count from the first physical PDF page. Line numbers are generated
from extracted text and restart on each page; they can differ from printed line
numbers or visual reading order. Text files and images each have one source page.

## Run EvidenceLens

Requirements:

- Python **3.10+**.
- Node.js and npm. The frontend toolchain supports Node **22.12+**; the launcher
  runs a cached Node 22 package through npm when the installed version is older.
- A compatible text-generating model and enough disk space and memory for it.
  First-time model and dependency installation requires an internet connection.

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

PDF extraction and OCR run in the browser. OCR workers, WASM cores, and language
data are served by the app; scans are not sent to an external OCR service.
Extracted text is sent to the selected model endpoint when you submit a question.
With the default local gateway it stays local; choosing a remote endpoint sends
that text to the remote service.

Documents and conversations are held in browser memory and clear on reload.
Endpoint and model preferences are saved locally; API keys are kept in memory.

Text PDFs skip OCR because their text layer is faster to extract. OCR helps make
scans searchable; it does not accelerate model inference. A large model can still
be very slow on a low-memory CPU machine, even for a small PDF. Model startup,
reading the prompt, and generating the answer are separate from file extraction.

Current limits:

- Up to **12 files** per chat.
- Up to **64 MiB**, **1,000 PDF pages**, and **2 million extracted characters**
  per file, with a **120-second extraction timeout**.
- Up to **100,000 characters** of serialized document evidence per question.
  The full collection is sent; pages are not silently omitted. The model's own
  context window can impose a smaller limit.
- Supported uploads include PDFs, common text formats, and images. Word files
  and password-protected PDFs are unsupported.
- OCR falls back on PDF pages without extracted text. Complex layouts or pages
  mixing searchable text and scanned content may require preprocessing.

## Development

The application retains Colibri's architecture: a React/Vite frontend, the
existing Python API gateway, and native inference engines. File extraction,
OCR, and citation checks are frontend additions; document questions use the
existing `/v1/chat/completions` streaming endpoint.

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
Document extraction uses [PDF.js](https://github.com/mozilla/pdf.js), and OCR uses
[Tesseract.js](https://github.com/naptha/tesseract.js).

This repository retains the [Apache 2.0 license](LICENSE), original attribution
in [NOTICE](NOTICE), and [third-party notices](THIRD_PARTY_NOTICES.md).
