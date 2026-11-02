import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { logs } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

if (!posthogKey) {
  if (process.env.NODE_ENV === 'development') {
    throw new Error('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured')
  }
} else if (!posthogHost && process.env.NODE_ENV === 'development') {
  throw new Error('NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured')
}

export const loggerProvider = posthogKey && posthogHost
  ? new LoggerProvider({
      resource: resourceFromAttributes({ 'service.name': 'transport-daw' }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${posthogHost.replace(/\/$/, '')}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${posthogKey}`,
              'Content-Type': 'application/json',
            },
          }),
        }),
      ],
    })
  : null

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && loggerProvider) {
    logs.setGlobalLoggerProvider(loggerProvider)
  }
}
