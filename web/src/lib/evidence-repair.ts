import type { StreamChatResult } from './api'
import { DocumentAPIError, repairDocumentContext, verifyDocumentAnswer, type PreparedContext } from './document-api'
import { verifyAnswer, type PdfSource, type EvidenceAnswer } from './pdf-evidence'
import { plainAnswerText, plainFallbackContext } from './plain-evidence-fallback'

export interface EvidenceDraft { raw: string; result: StreamChatResult }
export type EvidenceResolution =
  | { evidence: EvidenceAnswer; plainText?: never; result: StreamChatResult }
  | { evidence?: never; plainText: string; result: StreamChatResult }
class IncompleteEvidenceError extends Error {}
/** One automatic repair, then one plain-language fallback without verified labels.
 * HTTP/auth/network failures never trigger another expensive generation. */
export async function resolveEvidenceDraft(options: {
  baseUrl: string; apiKey: string; sources: PdfSource[]; prepared: PreparedContext;
  first: EvidenceDraft; signal: AbortSignal;
  generate: (context: PreparedContext) => Promise<EvidenceDraft>;
  onRepair: (context?: PreparedContext) => void;
  onPlainFallback: (context: PreparedContext) => void;
}): Promise<EvidenceResolution> {
  let context = options.prepared
  let draft = options.first
  const answerPlainly = async () => {
    const plainContext = plainFallbackContext(options.prepared)
    options.onPlainFallback(plainContext)
    options.signal.throwIfAborted()
    const fallback = await options.generate(plainContext)
    options.signal.throwIfAborted()
    return { plainText: plainAnswerText(fallback.raw, draft.raw), result: withUsage(draft.result, fallback.result) }
  }
  for (let attempt = 0; attempt <= 1; attempt++) {
    options.signal.throwIfAborted()
    try {
      const checked = await verifyDocumentAnswer(options.baseUrl, options.apiKey, context.context_id, draft.raw, options.signal)
      options.signal.throwIfAborted()
      if (draft.result.finishReason !== 'stop') throw new IncompleteEvidenceError('The evidence answer was incomplete. Try a shorter question or fewer files.')
      return { evidence: verifyAnswer(JSON.stringify(checked), options.sources), result: draft.result }
    } catch (error) {
      options.signal.throwIfAborted()
      const invalidEvidence = error instanceof DocumentAPIError && (
        error.code === 'evidence_validation_error' ||
        ([400, 422].includes(error.status) && /citation|validation|valid.*json|json.*valid|schema|claim/i.test(error.message))
      )
      const incompleteRepair = attempt === 1 && error instanceof IncompleteEvidenceError
      if (!invalidEvidence && !incompleteRepair) throw error
      if (attempt === 1) {
        return answerPlainly()
      }
    }
    options.onRepair()
    try {
      context = await repairDocumentContext(options.baseUrl, options.apiKey, context.context_id, draft.raw, options.signal)
      options.signal.throwIfAborted()
      options.onRepair(context)
      const previousResult = draft.result
      draft = await options.generate(context)
      draft.result = withUsage(previousResult, draft.result)
    } catch (error) {
      options.signal.throwIfAborted()
      // Missing/older repair routes or an unusable repair budget must not block
      // an ordinary answer from the already prepared question/source context.
      if (!(error instanceof DocumentAPIError) || ![400, 404, 422].includes(error.status)) throw error
      return answerPlainly()
    }
  }
  throw new Error('Evidence validation did not complete.')
}

function withUsage(previous: StreamChatResult, current: StreamChatResult): StreamChatResult {
  if (!previous.usage) return current
  if (!current.usage) return { ...current, usage: previous.usage }
  return { ...current, usage: {
    prompt_tokens: previous.usage.prompt_tokens + current.usage.prompt_tokens,
    completion_tokens: previous.usage.completion_tokens + current.usage.completion_tokens,
    total_tokens: previous.usage.total_tokens + current.usage.total_tokens,
  } }
}
