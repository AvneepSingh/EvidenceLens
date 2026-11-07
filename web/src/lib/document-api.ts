import { endpoint, type ChatMessage } from './api'
import type { EvidenceAnswer, PdfSource } from './pdf-evidence'
import { abortable } from './abortable'

const auth = (key: string) => key ? { Authorization: `Bearer ${key}` } : undefined
async function read<T>(response: Response): Promise<T> {
  let data
  try { data = await response.json() }
  catch { throw new Error('Document processing is unavailable. Start the updated EvidenceLens gateway and upload the file again.') }
  if (!response.ok) throw new Error(data.error?.message || `Document service: HTTP ${response.status}`)
  return data as T
}
export interface PreparedContext {
  context_id: string
  messages: Array<{ role: ChatMessage['role']; content: string }>
  response_tokens: number
  coverage: { complete: boolean; selected_lines: number; total_lines: number; selected_chunks: number; total_chunks: number; documents_selected: number; documents_total: number }
  budget: { context_tokens: number; prompt_token_upper_bound: number; response_tokens: number; accounting: string }
}
async function post<T>(baseUrl: string, apiKey: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return read<T>(await fetch(endpoint(baseUrl, path), { method: 'POST', headers: { ...auth(apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }))
}
export async function uploadDocument(baseUrl: string, apiKey: string, file: File,
  { signal, language = 'eng', onProgress }: { signal: AbortSignal; language?: string; onProgress: (progress: number, label: string) => void }): Promise<PdfSource> {
  if (!file.size || file.size > 64 * 1024 * 1024) throw new Error(`${file.name}: files must be nonempty and no larger than 64 MiB.`)
  signal.throwIfAborted()
  let id: string | undefined
  try {
    const uploaded = await new Promise<{ document_id: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const stop = () => xhr.abort()
      xhr.open('POST', endpoint(baseUrl, `documents?filename=${encodeURIComponent(file.name)}&language=${encodeURIComponent(language)}`))
      if (apiKey) xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total * .2, `Uploading ${file.name}`) }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText)
          if (xhr.status >= 200 && xhr.status < 300) resolve(data)
          else reject(new Error(data.error?.message || `Upload failed: HTTP ${xhr.status}`))
        } catch { reject(new Error('PDF processing is unavailable at this endpoint. Start the updated EvidenceLens gateway and try again.')) }
      }
      xhr.onerror = () => reject(new Error('Could not reach the document service. Check the server connection.'))
      xhr.onabort = () => reject(signal.reason || new DOMException('Upload stopped', 'AbortError'))
      xhr.onloadend = () => signal.removeEventListener('abort', stop)
      signal.addEventListener('abort', stop, { once: true })
      xhr.send(file)
    })
    id = uploaded.document_id
    if (!id) throw new Error('The document service returned no document ID.')
    while (true) {
      signal.throwIfAborted()
      const state = await read<{ status: string; phase: string; progress?: number; processed_pages?: number; page_count?: number; current_page?: number; error?: string; document?: PdfSource }>(
        await fetch(endpoint(baseUrl, `documents/${id}`), { headers: auth(apiKey), signal }))
      if (state.status === 'ready' && state.document) { onProgress(1, `${file.name} ready · ${state.page_count} pages`); return state.document }
      if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.error || 'Document extraction stopped.')
      const label = state.phase === 'ocr' ? `OCR · page ${state.current_page || (state.processed_pages || 0) + 1}/${state.page_count || '?'}` :
        `Extracting text · ${state.processed_pages || 0}/${state.page_count || '?'} pages`
      onProgress(.2 + .8 * Math.max(0, Math.min(1, state.progress || 0)), `${file.name} · ${label}`)
      await abortable(new Promise<void>(resolve => window.setTimeout(resolve, 400)), signal)
    }
  } finally {
    if (signal.aborted && id) void post(baseUrl, apiKey, `documents/${id}/cancel`, {}).catch(() => {})
  }
}
export function prepareDocumentContext(baseUrl: string, apiKey: string, documentIds: string[], question: string,
  history: Array<{ role: string; content: string }>, contextTokens: number, responseTokens: number, signal: AbortSignal) {
  return post<PreparedContext>(baseUrl, apiKey, 'documents/context', {
    document_ids: documentIds, question, history, context_tokens: Math.min(32768, contextTokens), response_tokens: responseTokens,
  }, signal)
}
export async function verifyDocumentAnswer(baseUrl: string, apiKey: string, contextId: string, answer: string, signal: AbortSignal) {
  return (await post<{ answer: EvidenceAnswer }>(baseUrl, apiKey, 'documents/verify', { context_id: contextId, answer }, signal)).answer
}
export async function fetchDocumentResource(baseUrl: string, apiKey: string, id: string, resource: 'text' | 'original', signal?: AbortSignal) {
  const response = await fetch(endpoint(baseUrl, `documents/${encodeURIComponent(id)}/${resource}`), { headers: auth(apiKey), signal })
  if (!response.ok) { await read(response); throw new Error('Document download failed.') }
  return response.blob()
}
