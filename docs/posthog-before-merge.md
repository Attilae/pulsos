# PostHog verification

Reviewed locally on 2026-11-02 against PostHog EU project 331018.

## Configuration

- Vercel project: `pulsos`.
- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`, and
  `POSTHOG_PROJECT_ID` are configured for Production, Preview, and Development.
- `POSTHOG_API_KEY` is a private build credential. Production has a Secret;
  Preview needs the same configuration if source maps are wanted there.
- `next.config.js` uses `@posthog/nextjs-config` when both private build settings
  are present. Upload failures fail the build, and maps are deleted after upload.
  Without credentials, ordinary local builds work without uploading maps.
- AI observability excludes prompts and responses. The SDK uses privacy mode,
  and the manual capture helper never adds input/output content properties.

## Verified

- All 549 tests pass, including regression coverage for prompt/response
  exclusion and delivery to PostHog when Vercel analytics throws.
- Production build passes. The final build ran with network access and completed
  without the sandbox DNS failures from the earlier run.
- Production-mode app runs at `http://localhost:3002`.
- PostHog received pageviews, `city_selected`, `$identify`, and one deliberately
  triggered `$exception` labelled "PostHog setup verification: intentional browser
  exception". The latter is test data, not an application defect.
- Browser ingestion requests and exception-module downloads returned HTTP 200.
  No PostHog CSP violation appeared in the local browser console. The CSP's
  report-only script policy now includes the configured PostHog asset origin.
- Identity code handles resolved returning sessions, logout, and account switches
  by source review. A runtime identification event was observed after local login.
  A PostHog query confirmed that browser identification and the server's AI
  generation used the same distinct user ID.
- The application's tab error boundary and root global boundary both report
  exceptions through a guarded helper.
- A real signed-in composition produced one OpenRouter generation using
  `openai/gpt-5-mini`: HTTP 200, 1.592 seconds provider latency, 12,084 input
  tokens and 1,337 output tokens. The stored trace contains no prompt or response
  content. [Verified trace](https://eu.posthog.com/project/331018/ai-observability/traces/b39bc8a1-5f3b-493f-a1ff-855f44ddf4cd).
- PostHog Logs received `ai_composer_request_completed` for service
  `transport-daw`, with `outcome=succeeded`, `attempt=1`, HTTP status 200 and
  informational severity at 11:33:19 UTC.

## Remaining runtime checks

- The successful request did not exercise a parse retry. Shared retry trace IDs
  and separate span IDs were checked by source review.
- After the next authorized deployment, verify source-map upload in the build
  log and symbol sets in PostHog. Trigger a labelled browser exception on that
  deployment and confirm its stack resolves to source files.
- Repeat the browser checks on the deployment's actual origin and headers.
  Local verification cannot establish the behavior of an undeployed build.

## Local sign-in

When `RESEND_API_KEY` is absent, `lib/email.js` prints magic and verification links
to the server console instead of sending mail. This also applies to `npm start`.
Use the logged link privately for local testing. Real email delivery requires a
Resend key and an authorized sender; authentication should not be bypassed.

## Review notes

Session replay is disabled in the project's remote settings. Installing the SDK
alone does not establish that recordings are being made.

`npm audit` reports existing application/dependency vulnerabilities, including a
critical Better Auth advisory. These are outside the PostHog dependency changes;
the source-map package is not listed as a vulnerable package. Review those
separately before deploying.

No commit, merge, or deployment was performed during this review.

## References

- [Next.js SDK setup](https://posthog.com/docs/libraries/next-js)
- [Source-map uploads](https://posthog.com/docs/error-tracking/upload-source-maps/nextjs)
- [Next.js Logs](https://posthog.com/docs/logs/installation/nextjs)
- [Browser bot filtering](https://posthog.com/docs/web-analytics/troubleshooting#do-stats-include-bots-and-crawlers)
