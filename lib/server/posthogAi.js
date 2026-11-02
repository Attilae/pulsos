import { PostHog } from 'posthog-node'

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

if (!posthogKey) {
  if (process.env.NODE_ENV === 'development') {
    throw new Error('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured')
  }
} else if (!posthogHost && process.env.NODE_ENV === 'development') {
  throw new Error('NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured')
}

const posthog = posthogKey && posthogHost
  ? new PostHog(posthogKey, { host: posthogHost, flushAt: 1, flushInterval: 0, privacyMode: true })
  : null

export function aiComposerSessionId(userId) {
  return `ai-composer-${Buffer.from(String(userId)).toString('base64url')}`
}

export async function captureAiGeneration({
  distinctId,
  traceId,
  sessionId,
  spanId,
  model,
  usage,
  latencyMs,
  httpStatus,
  maxTokens,
  stopReason,
  error,
}) {
  if (!posthog) return

  const properties = {
    $ai_trace_id: traceId,
    $ai_session_id: sessionId,
    $ai_span_id: spanId,
    $ai_span_name: 'openrouter_chat_completion',
    $ai_model: model,
    $ai_provider: 'openrouter',
    $ai_latency: latencyMs / 1000,
    $ai_http_status: httpStatus,
    $ai_max_tokens: maxTokens,
  }

  // Never attach prompts or completions, including manually supplied properties.
  if (Number.isFinite(usage?.prompt_tokens)) properties.$ai_input_tokens = usage.prompt_tokens
  if (Number.isFinite(usage?.completion_tokens)) properties.$ai_output_tokens = usage.completion_tokens
  if (stopReason) properties.$ai_stop_reason = stopReason
  if (error) {
    properties.$ai_is_error = true
    properties.$ai_error = error
  }

  try {
    posthog.capture({ distinctId, event: '$ai_generation', properties })
    await posthog.flush()
  } catch {
    // AI observability must not interrupt a composition request.
  }
}
