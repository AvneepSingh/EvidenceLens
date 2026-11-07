import type { StreamChatResult } from './api'
import { DocumentAPIError, repairDocumentContext, verifyDocumentAnswer, type PreparedContext } from './document-api'
import { verifyAnswer, type PdfSource } from './pdf-evidence'

export interface EvidenceDraft { raw: string; result: StreamChatResult }
/** One automatic repair only. Both drafts must pass the original source checks.
 * HTTP/auth/network failures never trigger another expensive generation. */
export async function resolveEvidenceDraft(options: {
  baseUrl: string; apiKey: string; sources: PdfSource[]; prepared: PreparedContext;
  first: EvidenceDraft; signal: AbortSignal;
  generate: (context: PreparedContext) => Promise<EvidenceDraft>;
  onRepair: (context?: PreparedContext) => void;
}) {
  let context = options.prepared
  let draft = options.first
  for (let attempt = 0; attempt <= 1; attempt++) {
    options.signal.throwIfAborted()
    try {
      const checked = await verifyDocumentAnswer(options.baseUrl, options.apiKey, context.context_id, draft.raw, options.signal)
      options.signal.throwIfAborted()
      if (draft.result.finishReason !== 'stop') throw new Error('The evidence answer was incomplete. Try a shorter question or fewer files.')
      return { evidence: verifyAnswer(JSON.stringify(checked), options.sources), result: draft.result }
    } catch (error) {
      options.signal.throwIfAborted()
      if (!(error instanceof DocumentAPIError) || error.code !== 'evidence_validation_error') throw error
      if (attempt === 1) throw new Error(`The answer still failed validation after one automatic repair. ${error.message} Try a more specific question.`)
    }
    options.onRepair()
    context = await repairDocumentContext(options.baseUrl, options.apiKey, context.context_id, draft.raw, options.signal)
    options.signal.throwIfAborted()
    options.onRepair(context)
    const previousUsage = draft.result.usage
    draft = await options.generate(context)
    if (previousUsage && draft.result.usage) {
      draft.result = { ...draft.result, usage: {
        prompt_tokens: previousUsage.prompt_tokens + draft.result.usage.prompt_tokens,
        completion_tokens: previousUsage.completion_tokens + draft.result.usage.completion_tokens,
        total_tokens: previousUsage.total_tokens + draft.result.usage.total_tokens,
      } }
    }
  }
  throw new Error('Evidence validation did not complete.')
}
