import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'
import { fetchDocumentResource } from '../lib/document-api'
import type { PdfSource } from '../lib/pdf-evidence'

export function DocumentPreview({ source, baseUrl, apiKey, onClose, initialPage = 1 }: {
  source: PdfSource; baseUrl: string; apiKey: string; onClose: () => void; initialPage?: number
}) {
  const [page, setPage] = useState(initialPage)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const urls = useRef<string[]>([])
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)) }, [])
  useEffect(() => { setPage(initialPage); setError('') }, [source.id, initialPage])
  const download = async (kind: 'text' | 'original') => {
    const stop = new AbortController(); controller.current = stop
    const tab = kind === 'original' ? window.open('', '_blank') : null
    setBusy(true); setError('')
    try {
      const blob = await fetchDocumentResource(baseUrl, apiKey, source.id, kind, stop.signal)
      const url = URL.createObjectURL(blob); urls.current.push(url)
      if (kind === 'original' && tab) { tab.opener = null; tab.location.href = `${url}#page=${page}` }
      else {
        const anchor = document.createElement('a'); anchor.href = url
        anchor.download = kind === 'text' ? `${source.name}.extracted.txt` : source.name
        anchor.click()
      }
    } catch (cause) { tab?.close(); if (!stop.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="document-preview" aria-label={`Extracted text preview: ${source.name}`}>
    <header><strong>{source.name}</strong><button type="button" aria-label="Close preview" onClick={onClose}><X /></button></header>
    <div className="document-preview-controls"><label>Page <select aria-label="Preview page" value={page} onChange={e => setPage(Number(e.target.value))}>{source.pages.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select> of {source.pages.length}</label>
      <span>{source.extractionMethod || 'extracted'} · {source.ocrPages?.includes(page) ? 'OCR page' : 'native text'}</span>
      {source.backend && <><button type="button" disabled={busy} onClick={() => void download('text')}><Download /> TXT</button>{/\.pdf$/i.test(source.name) && <button type="button" disabled={busy} onClick={() => void download('original')}><ExternalLink /> Original PDF</button>}</>}
    </div>
    {error && <p role="alert">{error}</p>}
    {source.warnings?.map((warning, i) => <p className="pdf-note" key={i}>{warning}</p>)}
    <div className="pdf-source-lines">{source.pages[page - 1]?.map((line, i) => <div key={i}><span>{i + 1}</span><p>{line}</p></div>)}</div>
  </section>
}
