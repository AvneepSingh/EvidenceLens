# EvidenceLens web

React/Vite interface for an OpenAI-compatible colibrì server.
Use Node.js 22.12+ (or a supported newer release) for the Vite toolchain.


From the repository root, the complete EvidenceLens launcher is:

```sh
./start-evidencelens.sh
```

It installs web dependencies when needed, builds this checkout's UI, and opens
it through this checkout's gateway on the same port as the model API. Your
existing configured model and engine are reused, including a model configured
from a different colibri checkout. The original setup is left unchanged;
EvidenceLens keeps its own configuration in `.evidencelens/` at the repo root.
If Node is older than the toolchain requires, the launcher runs Node 22 through
npm's package cache. npm and Python 3.10+ must already be installed.

Options: `--check` builds and validates without starting the model server;
`--model-dir /path/to/model` uses a downloaded model; `--port 8001` changes the
interface and API port together; `--no-browser` disables automatic opening.
Other model setup options are passed to the existing `coli setup` flow. If the
original colibri server is running on the chosen port, stop it with Ctrl+C in
its terminal before launching EvidenceLens. Ctrl+C also stops EvidenceLens.

For frontend development only:

```sh
npm install
npm run dev
```

The default endpoint is `http://127.0.0.1:8000/v1`. Start the gateway from this checkout and use **Probe server** to load its models.
Plain chat can use an OpenAI-compatible backend, but uploads require this
checkout's `/v1/documents` routes at the same configured base URL.

Local validation:

```sh
npm test
npm run build
```

Besides Chat and Brain, the **Profiling** tab charts where the engine spent
each turn's wall time (I/O wait, expert matmul, attention, LM head) from the
server's `/profile` endpoint — a rolling window of per-turn `PROF` snapshots
emitted by the engine.

When `/v1/models` marks the selected model with `"capabilities":
["image_generation"]` (Qwen-Image-2.1 under `coli serve`), the chat view
generates pictures instead of text. The composer then offers size presets
(every side a multiple of 32, from 256 to 2048) or a custom size, the number of
denoising steps and a seed; an empty seed draws a new random one for every
picture. The request goes to `POST /v1/images/generations` with `"stream":
true`: the turn shows the stage (encoding the prompt, denoising step k of N,
decoding), the elapsed time and, when the engine sends them, blurred previews.
If the stream never starts, the same request is made once without it. A
finished picture carries its size, steps, seed and time, and can be downloaded
as PNG, have its seed copied, or be made again with a new seed. Image turns
stay on screen when you switch back to a text model but are never sent to it.

The test suite stays browser-light: API requests use a mocked `fetch`, while
runtime capability and storage behavior are covered through pure helpers. It
checks that `/health` and `/profile` are resolved next to (not below) the OpenAI `/v1` prefix,
supports both boolean and numeric `scheduler.active` responses, and sends the
colibrì-specific `cache_slot` field only when KV-slot support was advertised.

The endpoint and selected model are persisted locally. API keys are intentionally
memory-only; startup/persistence also removes the legacy `colibri.apiKey` value.

## Files and evidence in chat

The main chat supports up to 12 PDF, text, or image attachments. Use **Upload
files**, drag files into the composer, or paste an image. Files stay attached
for follow-up questions. Send with an empty message to request a brief abstract.
Removing a file affects future questions; earlier answers retain their original
source snapshots. New chat starts an empty collection. Archived conversations
restore their source collection when reopened. Reload clears in-memory chats.
The existing image attachment button remains available for vision models.

Uploads now use the existing Python gateway's `/v1/documents` routes. They run
PyMuPDF extraction and Pytesseract/Pillow OCR in isolated, bounded subprocesses,
then persist numbered UTF-8 TXT and JSON metadata under `data/extracted/`.
The browser no longer downloads PDF.js, Tesseract.js, WASM OCR cores, or language
models. Tesseract's system executable and selected languages must be installed
on the backend host for scans. Native searchable pages skip OCR.

The compact ring shows upload and page extraction progress with Stop in its
center. Chips show successful attachments; failures use the existing error
banner. Preview a chip to inspect numbered text, download TXT, or open the
original PDF. Answers retain their original source snapshots.

Before a document question, `documents/context` applies page-local overlapping
chunks and BM25 retrieval across attachments. It returns plain-text messages and
a safe context/response budget, honoring the model's context window up to 32,768
tokens. Only string content is sent through the unchanged chat-completions API;
no raw file, image, or multimodal payload is included. Coverage is shown so partial
retrieval is explicit. Ordinary text chat continues on its original streaming path.

`documents/verify` checks the final answer against saved retrieved lines, then the
frontend checks quotations against its source text. Unsupported references reject
the answer. Source inspection includes TXT and original-PDF controls. New backend
routes share chat authentication, host checks, and CORS; API helpers preserve
Colab/reverse-proxy URL prefixes. See [the pipeline guide](../docs/pdf-processing.md)
for endpoints, setup, resource limits, and retention.

Claims are classified independently:

- **Factual:** directly stated in the files, with supporting references.
- **Inferred:** derived indirectly, with explanations and references requested
  from every relevant file, including conflicting evidence.
- **Thought answer:** outside-document reasoning when the files do not answer.

Every document ID, physical PDF page, extracted line range, and quotation is
checked against the original extracted text. Invalid references reject the
whole answer. Click a reference to inspect numbered source lines. These checks
verify quote provenance, not semantic entailment: labels, completeness, and
conclusions remain model judgments. OCR quotations are checked against OCR text,
which can itself be imperfect. Text files and images each have one source page.

Defaults: 64 MiB, 500 pages, and 2 million extracted characters per file;
30 seconds of OCR per page, 300 seconds per job, and one concurrent extraction.
Documents persist server-side; removing an attachment does not delete its files.
The full source remains available for inspection, while only budgeted relevant
passages go to the model. The Python guide lists configurable limits. Frontend
controls remain in English; existing app locales still work.

The EvidenceLens branding uses an SVG document/lens mark, warm off-white, gold,
and brown palettes, and a complementary dark mode. Existing storage keys and
engine model names are preserved for compatibility.
