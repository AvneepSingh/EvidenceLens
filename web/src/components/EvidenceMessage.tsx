import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { DocumentPreview } from './DocumentPreview'
import type { Citation, EvidenceAnswer, PdfSource } from '../lib/pdf-evidence'
export function EvidenceMessage({ answer, sources, baseUrl, apiKey }: { answer: EvidenceAnswer; sources: PdfSource[]; baseUrl: string; apiKey: string }) {
  const [selected, setSelected] = useState<Citation | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => { panel.current?.querySelector('.highlight')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const source = sources.find(s => s.id === selected?.documentId)
  return <div className="chat-evidence">{answer.claims.map((claim, i) => <article className={`pdf-claim ${claim.kind}`} key={i}>
    <span className="pdf-kind">{claim.kind === 'thought' ? 'Thought answer' : claim.kind === 'factual' ? 'Factual' : 'Inferred'}</span><p>{claim.text}</p>
    {claim.kind === 'thought' && <small>Outside-document reasoning; unsupported by the attached files.</small>}
    {claim.citations.map((c, j) => <button type="button" className="pdf-citation" key={j} onClick={() => setSelected(c)}><strong>{sources.find(s => s.id === c.documentId)?.name} · p. {c.page} · lines {c.startLine}–{c.endLine}</strong><q>{c.quote}</q><small>Quote checked · inspect source ↗</small></button>)}
  </article>)}
  <small className="evidence-disclaimer">Quotes and locations are checked. Claim labels are model judgments. OCR text may contain recognition errors.</small>
  {selected && source && <section className="pdf-source" aria-label="Source evidence"><div className="pdf-section-title"><h2>{source.name} · Page {selected.page}</h2><button aria-label="Close source" onClick={() => setSelected(null)}><X /></button></div><div className="pdf-source-lines" ref={panel}>{source.pages[selected.page - 1].map((line, i) => <div key={i} className={i + 1 >= selected.startLine && i + 1 <= selected.endLine ? 'highlight' : ''}><span>{i + 1}</span><p>{line}</p></div>)}</div></section>}
    {selected && source?.backend && <details className="original-document"><summary>Extracted TXT and original PDF</summary><DocumentPreview source={source} baseUrl={baseUrl} apiKey={apiKey} initialPage={selected.page} onClose={() => setSelected(null)} /></details>}
  </div>
}
