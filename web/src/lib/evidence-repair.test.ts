import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEvidenceDraft } from './evidence-repair'
import type { PreparedContext } from './document-api'
import type { StreamChatResult } from './api'
afterEach(() => vi.unstubAllGlobals())
const answer = { claims: [{ kind: 'factual', text: 'Nine tasks are complete.', citations: [{ documentId: 'doc', page: 1, startLine: 1, endLine: 1, quote: 'Nine tasks are complete.' }] }] }
const sources = [{ id: 'doc', name: 'paper.pdf', pages: [['Nine tasks are complete.']], backend: true }]
const prepared: PreparedContext = { context_id: 'first', messages: [{ role: 'user', content: 'Original question and source' }], response_tokens: 1024,
  coverage: { complete: true, selected_lines: 1, total_lines: 1, selected_chunks: 1, total_chunks: 1, documents_selected: 1, documents_total: 1 },
  budget: { context_tokens: 8192, prompt_token_upper_bound: 100, response_tokens: 1024, accounting: 'conservative_utf8_bytes' } }
const result: StreamChatResult = { finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, requestId: 'request', queueWaitMs: null, compaction: null }
const rejected = () => new Response(JSON.stringify({ error: { code: 'evidence_validation_error', message: 'Invalid JSON or unsupported citation.' } }), { status: 400 })
const json = (value: unknown) => new Response(JSON.stringify(value))
const defaults = () => ({ baseUrl: '/v1', apiKey: '', sources, prepared, first: { raw: 'broken JSON', result }, signal: new AbortController().signal,
  generate: vi.fn().mockResolvedValue({ raw: JSON.stringify(answer), result }), onRepair: vi.fn() })

describe('bounded answer repair', () => {
  it('returns valid first answers without another generation', async () => {
    const request = vi.fn().mockResolvedValue(json({ answer })); vi.stubGlobal('fetch', request)
    const options = defaults(); const resolved = await resolveEvidenceDraft(options)
    expect(resolved.evidence).toEqual(answer); expect(options.generate).not.toHaveBeenCalled(); expect(options.onRepair).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('feeds the failed draft to repair and verifies the second draft using its new context', async () => {
    const repaired = { ...prepared, context_id: 'repaired' }
    const request = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(json(repaired)).mockResolvedValueOnce(json({ answer }))
    vi.stubGlobal('fetch', request)
    const options = defaults(); const resolved = await resolveEvidenceDraft(options)
    expect(request.mock.calls[1][0]).toBe('/v1/documents/repair')
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ context_id: 'first', answer: 'broken JSON' })
    expect(options.generate).toHaveBeenCalledExactlyOnceWith(repaired)
    expect(JSON.parse(request.mock.calls[2][1].body).context_id).toBe('repaired')
    expect(resolved.evidence).toEqual(answer); expect(resolved.result.usage?.total_tokens).toBe(30)
  })
  it('stops after one failed repair without displaying unsupported evidence', async () => {
    const request = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(json({ ...prepared, context_id: 'repaired' })).mockResolvedValueOnce(rejected())
    vi.stubGlobal('fetch', request); const options = defaults()
    await expect(resolveEvidenceDraft(options)).rejects.toThrow('after one automatic repair')
    expect(options.generate).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(3)
  })
  it.each([401, 404, 500])('does not retry HTTP %i failures', async status => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Service unavailable.', code: 'document_error' } }), { status }))
    vi.stubGlobal('fetch', request); const options = defaults()
    await expect(resolveEvidenceDraft(options)).rejects.toThrow('Service unavailable')
    expect(options.generate).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1)
  })
  it('does not retry network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network disconnected')))
    const options = defaults(); await expect(resolveEvidenceDraft(options)).rejects.toThrow('Network disconnected')
    expect(options.generate).not.toHaveBeenCalled()
  })
  it('honors Stop before repair can generate', async () => {
    const controller = new AbortController(); const options = { ...defaults(), signal: controller.signal }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { controller.abort(); return rejected() }))
    await expect(resolveEvidenceDraft(options)).rejects.toMatchObject({ name: 'AbortError' })
    expect(options.generate).not.toHaveBeenCalled()
  })
  it('can repair truncated malformed JSON but never accepts an unfinished final draft', async () => {
    const request = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(json({ ...prepared, context_id: 'repaired' })).mockResolvedValueOnce(json({ answer }))
    vi.stubGlobal('fetch', request); const options = defaults()
    options.first.result = { ...result, finishReason: 'length' }
    options.generate.mockResolvedValue({ raw: JSON.stringify(answer), result: { ...result, finishReason: 'length' } })
    await expect(resolveEvidenceDraft(options)).rejects.toThrow('incomplete')
    expect(options.generate).toHaveBeenCalledTimes(1)
  })
})
