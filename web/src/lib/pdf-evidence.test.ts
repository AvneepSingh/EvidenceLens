import { describe, it, expect } from 'vitest'
import { evidenceContext, textLines, verifyAnswer, type PdfSource } from './pdf-evidence'
const sources: PdfSource[] = [
  { id: 'a', name: 'report.pdf', pages: [['Revenue is $10 million.', 'Costs are $6 million.'], ['The company has 20 employees.']] },
  { id: 'b', name: 'notes.pdf', pages: [['The target profit is $3 million.']] },
]
const ref = { documentId: 'a', page: 1, startLine: 1, endLine: 2, quote: 'Revenue is $10 million. Costs are $6 million.' }
const answer = (kind: string, citations: unknown[]) => JSON.stringify({ claims: [{ kind, text: 'An answer', citations }] })
describe('PDF evidence verification', () => {
  it('accepts factual and inferred claims with real cross-document references', () => {
    expect(verifyAnswer(answer('factual', [ref]), sources).claims[0].kind).toBe('factual')
    expect(verifyAnswer(answer('inferred', [ref, { documentId: 'b', page: 1, startLine: 1, endLine: 1, quote: 'target profit is $3 million.' }]), sources).claims[0].citations).toHaveLength(2)
  })
  it('rejects invented quotes, missing PDFs, invalid ranges and absent references', () => {
    for (const change of [{ quote: 'Profit is guaranteed.' }, { documentId: 'missing' }, { page: 0 }, { page: 3 }, { startLine: 0 }, { endLine: 9 }, { startLine: 1.5 }, { quote: '' }]) {
      expect(() => verifyAnswer(answer('factual', [{ ...ref, ...change }]), sources)).toThrow()
    }
    expect(() => verifyAnswer(answer('inferred', []), sources)).toThrow()
  })
  it('keeps outside-document thought answers free of evidence claims', () => {
    expect(verifyAnswer(answer('thought', []), sources).claims[0].kind).toBe('thought')
    expect(() => verifyAnswer(answer('thought', [ref]), sources)).toThrow()
  })
  it('rejects malformed and empty responses', () => {
    for (const value of ['not JSON', '{}', '{"claims":[]}', 'null', answer('certain', [])]) expect(() => verifyAnswer(value, sources)).toThrow()
  })
  it('keeps every PDF and page in the prompt with page-local line numbers', () => {
    const context = JSON.parse(evidenceContext(sources))
    expect(context).toHaveLength(2)
    expect(context[0].pages[1]).toEqual({ page: 2, lines: [{ line: 1, text: 'The company has 20 employees.' }] })
  })
  it('forms lines using PDF baselines and explicit end-of-line markers', () => {
    expect(textLines([
      { str: 'Hello', transform: [1, 0, 0, 1, 10, 100] },
      { str: 'world', transform: [1, 0, 0, 1, 40, 100], hasEOL: true },
      { str: 'Next', transform: [1, 0, 0, 1, 10, 80] },
      { str: 'Last', transform: [1, 0, 0, 1, 10, 60] },
    ])).toEqual(['Hello world', 'Next', 'Last'])
  })
})

// Transport optimizations must retain all evidence and original line indexes.
describe('compact chat evidence', () => {
  it('retains every document, page and line with less repeated metadata', async () => {
    const { compactEvidenceContext } = await import('./pdf-evidence')
    const raw = compactEvidenceContext(sources)
    const context = JSON.parse(raw)
    expect(context[0].pages[1]).toEqual({ page: 2, lines: ['The company has 20 employees.'] })
    expect(context[1].documentId).toBe('b')
    expect(raw.length).toBeLessThan(evidenceContext(sources).length)
  })
})
