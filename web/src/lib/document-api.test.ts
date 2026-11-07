import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareDocumentContext, verifyDocumentAnswer, fetchDocumentResource } from './document-api'
import { streamChat } from './api'
afterEach(() => vi.unstubAllGlobals())
describe('backend document context transport', () => {
  it('keeps proxy prefixes and forwards only IDs and plain text to retrieval', async () => {
    const prepared = { context_id: 'context', messages: [{ role: 'system', content: 'instructions' }, { role: 'user', content: '[L1] Preserved evidence' }], response_tokens: 1024 }
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(prepared)))
    vi.stubGlobal('fetch', request)
    await prepareDocumentContext('https://colab.example/proxy/8000/v1', 'secret', ['document'], 'Question?', [{ role: 'user', content: 'Earlier question' }], 32768, 1024, new AbortController().signal)
    expect(request.mock.calls[0][0]).toBe('https://colab.example/proxy/8000/v1/documents/context')
    const body = JSON.parse(request.mock.calls[0][1].body)
    expect(body.document_ids).toEqual(['document'])
    expect(body).not.toHaveProperty('images')
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer secret')
    request.mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
    await streamChat({ baseUrl: 'http://localhost:8000/v1', apiKey: '', model: 'unchanged-qwen', messages: prepared.messages.map((m, i) => ({ ...m, role: m.role as 'system' | 'user', id: String(i) })), temperature: 0, maxTokens: prepared.response_tokens, enableThinking: false, signal: new AbortController().signal, onDelta: () => {} })
    const modelBody = JSON.parse(request.mock.calls[1][1].body)
    expect(modelBody.messages.every((m: { content: unknown }) => typeof m.content === 'string')).toBe(true)
    expect(JSON.stringify(modelBody)).not.toContain('image_url')
  })
  it('requires server verification against the retrieved context', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Citation was not in retrieved context.' } }), { status: 400 }))
    vi.stubGlobal('fetch', request)
    await expect(verifyDocumentAnswer('/proxy/v1', '', 'selection', 'model answer', new AbortController().signal)).rejects.toThrow('not in retrieved context')
    expect(JSON.parse(request.mock.calls[0][1].body).context_id).toBe('selection')
  })
  it('downloads preserved TXT through the same authenticated API', async () => {
    const request = vi.fn().mockResolvedValue(new Response('[FILE: paper.pdf]\n[PAGE: 1]\n[L1] Abstract'))
    vi.stubGlobal('fetch', request)
    const text = await fetchDocumentResource('/v1', 'secret', 'document', 'text')
    expect(await text.text()).toContain('[L1] Abstract')
    expect(request.mock.calls[0][0]).toBe('/v1/documents/document/text')
  })
})
