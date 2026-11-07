// Parsing and OCR now run in Python, behind the existing gateway. Keeping this
// small adapter preserves the chat attachment hook's public contract.
import { uploadDocument } from './document-api'
export function loadDocument(file: File, options: {
  baseUrl: string; apiKey: string; signal: AbortSignal; language?: string;
  onProgress: (value: number, label: string) => void
}) {
  return uploadDocument(options.baseUrl, options.apiKey, file, options)
}
