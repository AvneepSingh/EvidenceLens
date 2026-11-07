import { useEffect, useRef, useState } from 'react'
import type { PdfSource } from './pdf-evidence'
export interface FileProgress { label: string; value: number }
export function useChatFiles(slot: number, baseUrl: string, apiKey: string, onError: (error: string) => void) {
  const [collections, setCollections] = useState<Record<number, PdfSource[]>>({})
  const [progress, setProgress] = useState<FileProgress | null>(null)
  const [ocrLanguage, setOcrLanguage] = useState('eng')
  const controller = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const sources = collections[slot] || []
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { controller.current?.abort() }, [slot, baseUrl, apiKey])
  const replace = (sources: PdfSource[], target = slot) => setCollections(all => ({ ...all, [target]: sources }))
  const upload = async (files: File[]) => {
    if (!files.length || busy.current) return
    if (sources.length + files.length > 12) { onError('Attach up to 12 files per chat.'); return }
    busy.current = true
    const activeSlot = slot
    const abort = new AbortController(); controller.current = abort
    setProgress({ label: 'Opening files', value: 0 }); onError('')
    try {
      const { loadDocument } = await import('./pdf-loader')
      const added: PdfSource[] = []
      for (let i = 0; i < files.length; i++) {
        abort.signal.throwIfAborted()
        added.push(await loadDocument(files[i], { baseUrl, apiKey, signal: abort.signal, language: ocrLanguage,
          onProgress: (value, label) => { if (!abort.signal.aborted) setProgress({ label, value: (i + value) / files.length }) } }))
      }
      abort.signal.throwIfAborted()
      setCollections(all => ({ ...all, [activeSlot]: [...(all[activeSlot] || []), ...added] }))
    } catch (e) { if (!abort.signal.aborted) onError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; controller.current = null; setProgress(null) }
  }
  return { sources, replace, upload, progress, ocrLanguage, setOcrLanguage, stop: () => controller.current?.abort(),
    remove: (id: string) => replace(sources.filter(s => s.id !== id)) }
}
