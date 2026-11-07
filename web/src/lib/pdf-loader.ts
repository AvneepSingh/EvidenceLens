import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { textLines, type PdfSource } from './pdf-evidence'
import { abortable } from './abortable'
GlobalWorkerOptions.workerSrc = workerUrl
interface LoadOptions { signal?: AbortSignal; language?: string; onProgress?: (value: number, label: string) => void }
const id = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-')
const linesFromText = (text: string) => text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)

export async function loadDocument(file: File, options: LoadOptions = {}): Promise<PdfSource> {
  if (file.size > 64 * 1024 * 1024) throw new Error(`${file.name}: exceeds 64 MiB.`)
  const controller = new AbortController()
  const stop = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', stop, { once: true })
  if (options.signal?.aborted) stop()
  const signal = controller.signal
  const timeout = setTimeout(() => controller.abort(new Error(`${file.name}: extraction exceeded 120 seconds. Try a shorter file.`)), 120_000)
  const report = (value: number, label: string) => { if (!signal.aborted) options.onProgress?.(value, label) }
  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined
  let pendingWorker: Promise<NonNullable<typeof worker>> | undefined
  let terminate: (() => void) | undefined
  let task: ReturnType<typeof getDocument> | undefined
  let ocrPage = 1, ocrCount = 1
  let rendering: { cancel: () => void } | undefined
  const cancel = () => { rendering?.cancel(); terminate?.(); void task?.destroy() }
  signal.addEventListener('abort', cancel, { once: true })
  const ocr = async (image: File | HTMLCanvasElement, page: number, count: number) => {
    ocrPage = page; ocrCount = count
    report((page - 1) / count, `Preparing OCR · ${file.name} · page ${page}/${count}`)
    if (!worker) {
      const { createWorker } = await abortable(import('tesseract.js'), signal)
      pendingWorker = createWorker(options.language || 'eng', 1, {
        workerPath: new URL('/ocr/worker.min.js', location.origin).href,
        corePath: new URL('/ocr/core', location.origin).href,
        langPath: new URL('/ocr/lang', location.origin).href,
        workerBlobURL: false,
        logger: event => {
          const value = event.status === 'recognizing text' ? event.progress : 0
          report(((ocrPage - 1) + value) / ocrCount, `OCR · ${file.name} · page ${ocrPage}/${ocrCount}`)
        },
      })
      // If Stop arrives during initialization, dispose of the worker when ready.
      void pendingWorker.then(w => { if (signal.aborted) void w.terminate() }, () => {})
      worker = await abortable(pendingWorker, signal)
      terminate = () => { if (worker) { void worker.terminate(); worker = undefined } }
    }
    const result = await abortable(worker.recognize(image), signal)
    return linesFromText(result.data.text)
  }
  try {
    signal.throwIfAborted()
    report(0, `Reading ${file.name}`)
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'
    if (!isPdf) {
      let lines: string[]
      if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name)) {
        lines = await ocr(file, 1, 1)
      } else if (/\.(txt|md|markdown|json|csv|tsv|log|xml|ya?ml|html|tex)$/i.test(file.name) || file.type.startsWith('text/')) {
        const text = await abortable(file.text(), signal)
        if (text.includes('\0')) throw new Error(`${file.name}: unsupported binary file.`)
        if (text.length > 2_000_000) throw new Error(`${file.name}: exceeds 2 million characters.`)
        lines = linesFromText(text)
      } else throw new Error(`${file.name}: use PDF, text, or an image for OCR. Word files are not supported.`)
      if (!lines.length) throw new Error(`${file.name}: no readable text found. Try another OCR language or a clearer scan.`)
      if (lines.join('\n').length > 2_000_000) throw new Error(`${file.name}: exceeds 2 million characters.`)
      report(1, `${file.name} ready`)
      return { id: id(), name: file.name, pages: [lines], ...(file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name) ? { ocrPages: [1] } : {}) }
    }
    task = getDocument({ data: new Uint8Array(await abortable(file.arrayBuffer(), signal)), isEvalSupported: false })
    const pdf = await abortable(task.promise, signal)
    if (pdf.numPages > 1000) throw new Error(`${file.name}: exceeds 1,000 pages.`)
    const pages: string[][] = []; const ocrPages: number[] = []
    let chars = 0
    for (let n = 1; n <= pdf.numPages; n++) {
      signal.throwIfAborted()
      const page = await abortable(pdf.getPage(n), signal)
      try {
        const content = await abortable(page.getTextContent(), signal)
        let lines = textLines(content.items.filter(item => 'str' in item))
        if (!lines.length) {
          const canvas = document.createElement('canvas')
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min(2, 2200 / Math.max(base.width, base.height))
          const viewport = page.getViewport({ scale })
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('OCR needs canvas support in your browser.')
          const render = page.render({ canvasContext: context, canvas, viewport })
          rendering = render
          try { await abortable(render.promise, signal); lines = await ocr(canvas, n, pdf.numPages) }
          finally { rendering = undefined; canvas.width = canvas.height = 0 }
          ocrPages.push(n)
        }
        chars += lines.join('\n').length
        if (chars > 2_000_000) throw new Error(`${file.name}: exceeds 2 million extracted characters.`)
        pages.push(lines)
        report(n / pdf.numPages, `Reading ${file.name} · page ${n}/${pdf.numPages}`)
      } finally { page.cleanup() }
    }
    if (!pages.some(p => p.length)) throw new Error(`${file.name}: no readable text. Try another OCR language or a clearer scan.`)
    return { id: id(), name: file.name, pages, ...(ocrPages.length ? { ocrPages } : {}) }
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', stop)
    signal.removeEventListener('abort', cancel)
    terminate?.(); await task?.destroy()
  }
}
export const loadPdf = loadDocument
