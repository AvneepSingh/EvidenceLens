import { describe, expect, it } from 'vitest'
import { plainAnswerText, plainFallbackContext } from './plain-evidence-fallback'
import type { PreparedContext } from './document-api'
describe('plain-language fallback', () => {
  it('removes JSON instructions and preserves the original question and source passages', () => {
    const context = { context_id: 'original', messages: [{ role: 'system', content: 'Return ONLY JSON with claims and citations' }, { role: 'user', content: 'DOCUMENT CONTEXT: nine tasks\nORIGINAL USER QUESTION: how many tasks?' }], response_tokens: 1000 } as PreparedContext
    const fallback = plainFallbackContext(context)
    expect(fallback.messages[0].content).not.toContain('Return ONLY JSON')
    expect(fallback.messages[0].content).toContain('you may use your general knowledge')
    expect(fallback.messages[0].content).toContain('state uncertainty when you do not know')
    expect(fallback.messages[1]).toEqual(context.messages[1])
    expect(fallback.response_tokens).toBe(1000)
    expect(context.messages[0].content).toContain('Return ONLY JSON')
  })
  it('keeps ordinary prose and renders JSON-shaped answers as text only', () => {
    expect(plainAnswerText('Nine tasks are complete.')).toBe('Nine tasks are complete.')
    expect(plainAnswerText(JSON.stringify({ claims: [{ text: 'Nine tasks.' }, { text: 'Three tasks remain.' }] }))).toBe('Nine tasks.\n\nThree tasks remain.')
    expect(plainAnswerText('```json\n{"answer":"Nine tasks."}\n```')).toBe('Nine tasks.')
  })
  it('recovers readable claim text if the final plain response is malformed too', () => {
    const previous = JSON.stringify({ claims: [{ text: 'Nine tasks are complete.', citations: [{ page: 999 }] }] })
    expect(plainAnswerText('{"claims": [', previous)).toBe('Nine tasks are complete.')
  })
  it('does not expose another malformed or unsupported JSON object', () => {
    for (const raw of ['{"claims": [', '{"unknown":true}', '']) expect(plainAnswerText(raw)).toContain('did not return readable answer text')
  })
})
