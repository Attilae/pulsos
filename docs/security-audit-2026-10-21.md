# Leið security audit

Date: 2026-10-21. Baseline: `a3cc9a4` (`feat(composer): make the AI composer panel draggable on desktop`).

## Assessment

The highest application risk found is AI cost abuse: failed, already-paid generations release the user's quota. Other findings concern persistent storage abuse, billing entitlement rules, feedback email admission, and the separately deployed feed. Authentication and ownership checks reviewed were generally sound; no confirmed account takeover, cross-user record access, or application XSS was found in this review.

The dependency tree also needs attention. npm reports **24 vulnerable package entries: 3 critical, 15 high, 5 moderate, 1 low**. These are package-level advisory ratings, not 24 demonstrated vulnerabilities in this site. Production-filtered audit reports 23 entries (3 critical, 14 high, 5 moderate, 1 low); shared dependency paths mean this is not a definitive inventory of code executing in production.

This is a repository audit with isolated local checks, not a production penetration test or certification. No production traffic, real model charges, database writes, or deployment changes were performed. Only this report and dependency evidence were added; application code was not changed.

## Scope and evidence

Reviewed Next API authentication/ownership, preset and composition persistence, shared links, billing checkout/portal/webhook, entitlements, MCP authorization, feedback/Turnstile, feed WebSocket handling, client HTML sinks, sample loading, and Next response configuration. Dependency evidence is captured in [full npm audit](security/npm-audit-2026-10-21.json) and [production-filtered npm audit](security/npm-audit-production-2026-10-21.json).

Not verified: actual production headers/cookies, Vercel firewall policies, active feature flags, deployed feed reachability, production environment values, database privileges/backups, provider settings, Git history secrets, or third-party infrastructure security. No DSP/WASM memory-safety audit was performed. A scan of tracked credential-like filenames and common secret patterns identified example environment files only; this is not proof that all secrets or historical commits are clean.

## Prioritized findings

| ID | Severity | Finding | Evidence confidence |
| --- | --- | --- | --- |
| S01 | High | Paid AI failures refund quota, enabling repeat cost abuse | Handler reproduced with mocked provider |
| S02 | High remediation priority | Runtime dependencies have published security advisories | Lockfile + current npm report; exploit reachability varies |
| S03 | Medium | Persistent song storage lacks application quotas and bounded schemas | Source confirmed; no load test |
| S04 | Medium | Unpaid/past-due/paused subscriptions retain Pro indefinitely | Pure-logic reproduction |
| S05 | Medium, conditional | Test subscriptions can grant production entitlements | Source confirmed; provider configuration unverified |
| S06 | Medium | Feedback admission is non-atomic and fails open | Source confirmed; no mail abuse attempted |
| S07 | Medium, conditional | Feed WebSocket resources lack admission/backpressure limits | Source confirmed; deployment unverified |
| S08 | Low | Repository does not define global browser security headers | Config confirmed; production headers unverified |

### S01: AI cost is not bounded by the displayed allowance

**Evidence:** `app/api/compose/route.js:54` accepts client message arrays without content/role/size bounds. Lines 70–87 can make two provider generations; line 118 releases the claimed allowance when both results fail JSON parsing. `lib/ai/planSchema.js:23–24` deliberately omits provider array bounds.

**Impact:** A signed-in user can repeatedly cause paid work that fails to produce valid JSON without consuming allowance. Requests for oversized output are one plausible trigger for truncation. Arbitrary input also increases prompt cost. Existing per-user quota claims do not bound spending on this failure path.

**Validation:** An isolated import of the actual handler with auth, usage services and provider fetch mocked returned two HTTP 502 responses for truncated provider output. Those two requests caused four provider calls, two quota claims and two releases: net quota usage zero. No real provider was contacted, and an exact adversarial prompt has not been validated against the deployed model.

**Fix:** Keep user-facing success credits separate from an irrevocable attempt/token budget. Count billable truncations and retries toward a per-user and global spend limit. Bound request bytes, message count, roles and content length; construct trusted prompts on the server; add deadlines and concurrency limits. Provider/schema errors may still refund success credits while consuming the abuse budget.

**Acceptance:** Repeated mocked `finish_reason: length` and malformed-JSON responses eventually return 429 before another provider call. Retry cost is counted. Oversized input is rejected before quota/provider work.

### S02: Patch the dependency tree, with feature-specific reachability checks

**Evidence:** `package-lock.json` resolves Next **15.5.18**, MapLibre **5.24.0**, MCP server/client **2.0.0**, `ws` **8.20.1**, `adm-zip` **0.5.17**, and `proxy-addr` **2.0.7**. The attached npm JSON contains all advisory ranges and fix availability.

Prioritize these paths:

| Package | Advisory / minimum outside reported range | Site context |
| --- | --- | --- |
| Next | [Image optimization RCE advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4); other reported 15.x advisories extend below **15.5.27** | App Router is deployed. No `next/image` imports found, so AVIF exploit reachability is unproven. No attacker-controlled remote image config was found in Next config. Windows-only and self-hosting advisories must not be treated as proven Vercel exploits. |
| MapLibre | [HTML sanitizer bypass](https://github.com/advisories/GHSA-jrc7-96c5-q579); affected through **6.4.0** | No MapLibre `setHTML` calls found; map uses a fixed style. Advisory is critical, but no application XSS path was demonstrated. |
| MCP server | [Validation memory exhaustion](https://github.com/advisories/GHSA-46jr-4wx8-v453); **2.3.0** | Relevant when MCP is enabled; local bearer/consent checks reduce exposure. Other SDK advisories depend on transport reuse or SDK auth helpers. |
| `ws` | [Fragment/chunk memory exhaustion](https://github.com/advisories/GHSA-96hv-2xvq-fx4p); **8.21.0** | Relevant to any publicly reachable feed, independently of the frontend Live toggle. |
| `adm-zip` | [Declared-size memory exhaustion](https://github.com/advisories/GHSA-7q85-xj36-vmfc); **0.6.1** | GTFS ingestion/tooling trust boundary, rather than a discovered public upload endpoint. |
| `proxy-addr` | [IPv4-mapped trust-subnet spoofing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h); **2.0.8** | Critical advisory requires the relevant trusted-proxy configuration. An application bypass was not established. |

These versions describe the captured advisory ranges, not a guarantee against future advisories. Update to supported patched releases, refresh the lockfile, and audit the feed's separately installed dependency tree too. Review MapLibre major-version compatibility. Avoid blindly running `npm audit fix --force`: npm proposes a Drizzle Kit downgrade to 0.18.1 for part of the development chain.

**Acceptance:** Re-run both audit commands; investigate remaining entries by actual dependency path and deployed feature. Run `npm test` and `npm run build` after upgrades, plus map/MCP/feed smoke checks. Stop the dev server before building because both use `.next`.

### S03: Authenticated users can grow stored song data without an application budget

**Evidence:** `lib/server/presets.js:44–80` stores JSON without a bounded snapshot schema, per-user row/byte quota or write throttle. `app/api/presets/route.js:20–24` checks required fields but not these limits. Registration does not require email verification.

**Impact:** A free account can accumulate large or numerous records, consuming database storage, transfer and parsing resources. Platform request limits may bound an individual request but do not cap aggregate storage. Shared records can also impose parsing costs on recipients. No database exhaustion was attempted.

**Fix:** Validate snapshots with bounded arrays, strings, nesting and total encoded bytes. Enforce per-user row and aggregate storage budgets atomically in the persistence service used by every writer, including MCP. Apply write throttles; bound list responses. Assess compositions under the same policy. Email verification can reduce disposable-account abuse but does not replace quotas.

**Acceptance:** Oversized snapshots are rejected; concurrent writes cannot exceed row/byte budgets; ordinary save/import/share behavior survives validation.

### S04: Payment failure has no finite entitlement boundary

**Evidence:** `lib/billing/plans.js:28–37` grants access to `unpaid`, `past_due` and `paused` without checking dates. Only `cancelled` checks `endsAt`. `resolveAccess` then supplies Pro limits, also used by MCP.

**Validation:** Calling the real `resolveAccess` with each of those statuses, `endsAt` and `renewsAt` both `2000-01-01`, and audit date `2026-10-21` returns `pro` for all three.

**Impact:** Users can retain paid features indefinitely after nonpayment while their status remains one of these values. This may reflect a deliberate grace policy; the finding is that the grace has no enforced deadline.

**Fix/acceptance:** Define explicit payment-failure and pause rules, including a bounded grace period. Test before, at and after the deadline, cancellation, and payment recovery. Preserve explicit administrative overrides.

### S05: Test billing data is not excluded from entitlement decisions

**Evidence:** `app/api/billing/webhook/route.js:66` stores `testMode`; `lib/billing/server.js:17–25` and `lib/billing/plans.js:32–55` do not filter it out.

**Condition/impact:** A validly signed test subscription accepted by the production endpoint and matching configured store/variant filters can grant live Pro. This is not a signature bypass. Separate variant IDs or isolated webhook configuration may prevent the trigger; those provider settings were not inspected.

**Fix/acceptance:** Explicitly separate billing environments in webhook admission and entitlement queries. A valid signed test event must not create live entitlement, while development test checkout remains usable. Decide how to clean up pre-existing test records.

### S06: Feedback can amplify email abuse

**Evidence:** `app/api/feedback/route.js:35–42` counts records separately from insertion at lines 91–99. Lines 80–83 allow processing after rate-limit read errors. Lines 116–118 send an auto-reply to an unverified supplied email, quoting attacker-controlled content (`lib/feedback.js:116–128`). `lib/turnstile.js:69–77` skips verification when the secret is absent, including in production.

**Impact:** Concurrent requests can pass the five-per-hour check together. Database read failures remove this admission control. Attackers can send unwanted reflected content to third-party recipients. Correctly configured CAPTCHA mitigates automation but does not make admission atomic or bound global email spend.

**Fix:** Use an atomic admission counter, recipient/global send budgets and a bounded request body. Fail closed or queue without sending when admission storage fails. Require explicit production CAPTCHA configuration if relied upon. Consider a neutral acknowledgment that does not quote submitted content.

**Acceptance:** Parallel requests respect the limit, admission failures send no email, and missing production CAPTCHA configuration is surfaced. Confirm proxy-sanitized client IP handling in deployment; spoofability was not established here.

### S07: Public feed sockets can consume unbounded resources

**Evidence:** `feed/index.js:33` creates the WebSocket server without origin admission, connection budgets or explicit small payload limits. HTTP CORS at lines 35–47 does not govern WebSocket upgrades. Broadcast at lines 61–65 lacks `bufferedAmount` checks and slow-client eviction.

**Condition/impact:** If deployed publicly, many connections or slow readers can grow memory/work. The app currently disables Live; this does not establish that an independently deployed feed is unreachable. Origin checks alone cannot stop non-browser attackers.

**Fix/acceptance:** Add per-IP/global connection budgets, upgrade origin policy for browser clients, conservative message limits, heartbeat cleanup and bounded buffered output. Terminate lagging sockets. Patch `ws` as in S02. Validate using a controlled slow-reader load test outside production.

### S08: Browser security headers are not configured globally in the repository

**Evidence:** `next.config.js:9` defines WASM caching/type headers only. No global CSP, framing policy, `nosniff`, referrer or permissions policy is defined there. Production may add headers at the hosting layer; this was not checked.

**Impact:** Defense against framing, content injection and unnecessary browser capabilities depends on deployment defaults. Absence of CSP is not itself evidence of XSS.

**Fix/acceptance:** Inspect deployed responses first. Add `frame-ancestors` and an appropriate framing fallback, `X-Content-Type-Options`, referrer policy and a minimal permissions policy. Develop CSP in report-only mode, accounting for Next scripts, the fixed theme bootstrap, map workers/tiles, WebAssembly/audio worklets, Turnstile and analytics. Verify actual headers and core audio/map/auth flows before enforcing. Keep HSTS consistent with hosting and subdomain requirements.

## Controls that held up in review

- Preset/composition reads, writes, deletes and share changes scope by authenticated owner, including upsert conflict predicates. No IDOR confirmed.
- Billing webhook verifies raw bytes with timing-safe HMAC, deduplicates transactionally, filters store/variant IDs and rejects stale provider updates.
- Checkout identity comes from the session; portal lookup is user-scoped.
- MCP checks its feature flag, origin, bearer audience/resource, Pro access and active consent. Disconnect revokes consent/tokens; writes use schemas and optimistic concurrency.
- Account role is not client-writable (`input: false`). Better Auth has production rate limiting, although shared serverless-wide storage is not configured; distributed enforcement needs deployment verification.
- The sole `dangerouslySetInnerHTML` is a fixed theme initializer (`app/layout.jsx:13,82`). Leaflet icon HTML uses sanitized color and numeric scale (`components/MapView.jsx:90–91,262,287–293`); reviewed labels use React escaping.
- Sample URLs come from built-in preset maps; custom audio consumes a local File. No arbitrary remote sample-fetch exploit found.

## Validation and recommended sequence

Existing targeted tests passed: **52/52**, using:

```sh
node --test test/auth-origins.test.js test/turnstile-hostnames.test.js test/feedback-validate.test.js test/server-purity.test.js test/mcp-tools.test.js test/billing-plans.test.js
```

Passing tests verify their existing contracts; they do not disprove the findings, and the billing tests currently accept the permissive status policy. The billing reproduction above ran directly against the pure module. The AI reproduction used mocked dependencies and was not added as a permanent regression test. No build was run because the deliverables change documentation/evidence only.

1. Close S01's billable-failure loophole and patch deployed dependencies (S02).
2. Enforce persistent storage budgets (S03), define finite billing grace and test/live isolation (S04–S05).
3. Make feedback admission atomic and bounded (S06). Check whether the feed is publicly deployed and address S07 before exposing it.
4. Verify production response headers, auth rate-limit storage, proxy IP sanitization, webhook environment separation, and feature flags. Address S08 against observed deployment behavior.
5. Add focused regression tests for the fixes, then rerun dependency audit and the full suite/build. Reassess residual findings against the actual deployed configuration.

## Remediation status (2026-10-21)

| ID | Status | Change |
| --- | --- | --- |
| S01 | Fixed | Non-refundable per-call attempt budgets (per user via `AI_ATTEMPT_BUDGETS`, global via `AI_GLOBAL_DAILY_ATTEMPTS`) in atomic `rate_counters`; body bounded to `[system, user]`, 256 KB, 4000-char prompt; 90 s provider deadline. The system prompt is now built on the server from validated structured fields (`lib/ai/composeRequest.js`); a client-supplied prompt is no longer accepted. |
| S02 | Fixed (prod deps) | Next 15.5.28 (nested PostCSS pinned via `overrides`), MapLibre 6.15.0 (worker served from `public/vendor`), MCP SDK 2.3.1, `ws` 8.22.0, `adm-zip` 0.6.1, transitive fixes via `npm audit fix`; feed tree reports 0. Remaining: 4 moderate in the dev-only `drizzle-kit` → `@esbuild-kit` → `esbuild` chain (dev-server advisory; drizzle-kit serves nothing). |
| S03 | Fixed | `lib/storageLimits.js` record bounds; per-user row/byte budgets checked under an advisory lock inside each write transaction (`lib/server/presets.js`, `lib/server/compositionLimits.js`), shared write throttle, bounded lists. Password sign-up now requires email verification; pre-existing accounts were grandfathered by migration `0009`. |
| S04 | Fixed | `past_due` gets a 14-day grace from the failed renewal; `unpaid`/`paused` grant nothing; trials end at `trialEndsAt` + grace. Overrides unchanged. |
| S05 | Fixed | Test-mode subscriptions ignored by the webhook and entitlement queries unless `LEMONSQUEEZY_TEST_MODE=true`. Existing test rows are filtered out, not deleted. |
| S06 | Fixed | Atomic per-IP + global admission, fails closed (503); 32 KB body cap; neutral auto-reply with per-recipient and global budgets; production build rejects reports without a Turnstile secret unless `TURNSTILE_DISABLED=true`; client IP prefers platform-set headers. |
| S07 | Fixed | Origin check on upgrade, global/per-IP connection caps (`TRUST_PROXY` for proxied deployments), 1 KB `maxPayload`, inbound messages close the socket, 30 s heartbeat, slow clients over 1 MB buffered are terminated. Socket logic moved to `feed/wsServer.js`; `test/feed-ws.test.js` load-tests it on loopback (admission, 1008/1009 closes, a stalled reader dropped at the 256 KB cap under a ~32 MB paced broadcast while a live reader receives all of it, heartbeat eviction). Not run against a deployed feed. |
| S08 | Partially fixed | Enforced `frame-ancestors`/`base-uri`/`object-src` CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; full CSP in report-only. Production headers and report-only violations still to be reviewed before enforcing. |

Migrations `drizzle/0008_*.sql` (`rate_counters`) and `drizzle/0009_verify_existing_users.sql` must be applied before deploying: compose, feedback and song writes depend on the first, and without the second existing password users can't sign in.
