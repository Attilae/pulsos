import { SeverityNumber } from '@opentelemetry/api-logs'
import { loggerProvider } from '@/instrumentation.js'

// This logger is intentionally isolated from the application's existing loggers.
const logger = loggerProvider?.getLogger('posthog-ai-composer-outcomes')

export function logAiComposerOutcome({ outcome, model, attempt, latencyMs, httpStatus, failureStage }) {
  if (!logger) return

  const attributes = {
    event: 'ai_composer_request_completed',
    outcome,
    model,
    attempt,
  }
  if (Number.isFinite(latencyMs)) attributes.provider_latency_ms = latencyMs
  if (Number.isFinite(httpStatus)) attributes.http_status = httpStatus
  if (failureStage) attributes.failure_stage = failureStage

  logger.emit({
    body: 'AI Composer request completed',
    severityNumber: outcome === 'succeeded' ? SeverityNumber.INFO : SeverityNumber.ERROR,
    attributes,
  })
}

export async function flushPostHogLogs() {
  await loggerProvider?.forceFlush().catch(() => {})
}
