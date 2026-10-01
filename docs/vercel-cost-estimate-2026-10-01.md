# Leið hosting costs and affordable pricing

Checked 1 October 2026. User counts mean **monthly active users**, as confirmed by the owner.

**Recommendation: keep €5.99/month and €49/year for now. Do not add a more expensive subscription just to cover Vercel. Budget approximately $25, $75 and $150/month for Vercel at 100, 500 and 1,000 MAU until production compute is profiled. Protect AI spend first.** These are planning budgets, not hard spending caps or promised invoices.

## What was actually checked

Read-only review of the current worktree, official current vendor pricing, and the authenticated Vercel dashboard. No plan, checkout, deployment or application setting was changed. The worktree has ongoing feature changes and is not necessarily identical to the deployed build.

The Vercel team “Attila’s projects” is currently **Hobby**. Leið is the project `pulsos`; several other projects share the team. The following are **project totals**, rather than the much larger team totals, from the dashboard’s Sep 1, 4am–Oct 1, 4am range:

| Measured resource | Last 30 days |
| --- | ---: |
| CDN requests | approximately 5,300 |
| Function invocations | approximately 1,600 |
| Fluid Active CPU | 21 minutes 59 seconds |
| Fluid Provisioned Memory | 44.9 GB-hours |
| Fast Data Transfer | 403.2 MB |
| Fast Origin Transfer | 6.33 MB |
| Build CPU minutes | 406 minutes |
| Blob storage | 200.39 MB |
| ISR reads | 567 |
| Web Analytics events | 186 |

[Project usage dashboard](https://vercel.com/attilas-projects-3eb38dc3/pulsos/usage). Separately, [production analytics](https://vercel.com/attilas-projects-3eb38dc3/pulsos/analytics?period=30d) showed 31 visitors and 62 page views for Sep 1–Oct 1. Analytics visitors are not authenticated MAU, and production analytics do not match usage across all environments. Do not divide all development/preview compute by those visitors to claim a measured production cost per user.

Hobby currently has no platform charge within its limits. A product selling subscriptions should budget for **Pro**: Vercel describes Hobby as personal/non-commercial. [Vercel pricing](https://vercel.com/pricing).

## Current Vercel prices used

| Item | Current price or treatment |
| --- | --- |
| Pro platform, one deploying seat | $20/month, including a $20 monthly infrastructure credit |
| Additional deploying seats | $20/month each |
| Flat Rate CDN included tier | 1 million requests and 1 TB/month |
| Next Flat Rate CDN tier | additional $20/month; 10 million requests and 50 TB |
| Fluid CPU, Frankfurt planning rate | $0.184/CPU-hour |
| Fluid memory, Frankfurt planning rate | $0.0152/GB-hour |
| Function invocations | $0.60/million, billed from the first Pro invocation |
| Fast Origin Transfer | starting at $0.06/GB; separate from Flat Rate CDN |
| Web Analytics | $3/100,000 events, subject to the shared credit |
| Builds | $0.0035/CPU-minute |
| Blob storage | $0.023/GB-month |

Sources: [Pro fees and credit](https://vercel.com/docs/plans/pro-plan), [Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn), [Fluid pricing](https://vercel.com/docs/functions/usage-and-pricing), [origin transfer](https://vercel.com/docs/manage-cdn-usage), [analytics](https://vercel.com/docs/analytics/limits-and-pricing), [builds](https://vercel.com/docs/builds/managing-builds), [Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing).

This uses the current credit-based Pro rules, not older per-product Pro allowances. Flat Rate CDN must be enabled and the project eligible. Capacity tiers are additional subscription charges; crossing capacity ordinarily changes the tier next cycle. The model shows the ongoing bill at the required tier. If delivery becomes predominantly bulk media/files, confirm eligibility with Vercel rather than assuming the same CDN treatment.

All service costs below are USD before invoice taxes. Frankfurt is a conservative European compute assumption, **not a verified deployed region**. Source specifies no region or function memory. US rates can be lower. CLI project inspection confirmed Next.js and Node 24.x, but did not expose deployed memory/region. The usage CLI returned a billing 404; dashboard totals were read directly.

## Why the app should be inexpensive to host

- Tone.js, synths, effects, wasm DSP, playback, MIDI and WAV exports run on the listener’s device. Playing music for an hour does not run a Vercel function for an hour.
- All cities currently have live feeds disabled. No always-on transport feed is included in this estimate; restoring it adds separately hosted infrastructure.
- Auth, song persistence, entitlements, billing and AI proxy requests use Vercel Functions and external Postgres.
- Autosave has an 800ms debounce and makes roughly two API calls per completed save: PUT the song, then GET the list. Listening alone does not save. There is no periodic entitlement polling; auth can refresh on focus.
- MCP itself does not call an app-funded model. Automated clients can still generate substantial function and database traffic.

Code evidence: [autosave](../lib/useSongPersistence.js), [entitlements](../lib/shared/EntitlementsContext.jsx), [plans](../lib/billing/plans.js), [compose proxy](../app/api/compose/route.js), [MCP](../app/mcp/route.js), [city configuration](../lib/shared/cities.js).

Measured local route files span **2.56–72.54 MB full JSON** and **0.20–6.91 MB slim JSON**. Locally gzipped equivalents are 0.19–5.62 MB and 0.028–1.17 MB respectively. These are file measurements, not measurements of production delivery or Blob compression. Local impulse responses total 23.17 MB, drum samples 0.58 MB and wasm 0.12 MB. Many instrument samples come from an external Tone sample host. Phone slim payloads and good caching matter for load time as well as transfer cost. Actual production Blob URL overrides were not inspected.

## Calculation and Vercel estimate

Planning assumptions per MAU: eight creative sessions/month, 15 completed autosaves/session, five other API calls/session, 70 static requests/session and ten analytics events/session. This deliberately assumes every MAU edits a saved song; real free/browsing visitors may use substantially fewer calls. Delivered static assets are budgeted at 25 MB/session, plus API traffic. Counts include ordinary auth/entitlement traffic but no additional high-volume MCP automation or abuse.

Assume 10% Pro; each uses 20 AI generations/month. Assume 20% of remaining free MAU are new and use all three lifetime trial generations. Free trials are not a recurring allowance for every free user.

| Monthly workload | 100 MAU | 500 MAU | 1,000 MAU |
| --- | ---: | ---: | ---: |
| API invocations | 28,254 | 141,270 | 282,540 |
| CDN requests | 92,254 | 461,270 | 922,540 |
| Delivered data | 20.6 GB | 102.9 GB | 205.8 GB |
| AI generations | 254 | 1,270 | 2,540 |

Two compute cases prevent false precision:

1. **Ordinary request model:** 50ms active CPU and 0.5s wall time per ordinary API call, 2GB function allocation; AI attempts use 0.1s CPU and 60s wall time. Memory durations are summed conservatively without a concurrency discount. These are unmeasured planning assumptions.
2. **Observed ratio model:** preserve the dashboard averages of 0.824s CPU and 0.02806 GB-hours memory per invocation for the workload above. This may overstate ordinary production CRUD costs because the source traffic includes development/previews and a different AI mix. It is a useful cautious budget case, not a maximum or an optimized production benchmark.

| Monthly Vercel invoice | 100 MAU | 500 MAU | 1,000 MAU |
| --- | ---: | ---: | ---: |
| Ordinary request model | $20 | $20 | $20 |
| Observed compute ratio | $20 | $69.70 | $137.97 |
| Suggested temporary budget | **$25** | **$75** | **$150** |

Formula: **$20 platform + CDN tier charge + max(0, metered infrastructure − $20 credit)**. One team credit is applied once. Extra seats, add-ons and other projects’ usage are excluded; on the existing shared team they consume the same credit and CDN capacity. There is only about 77,000 CDN requests of headroom at 1,000 MAU in this model; other projects or extra sessions can require the additional $20 CDN tier.

At 1,000 MAU the ordinary case has $8.87 gross metered usage, including $2.60 memory, $0.73 CPU, $2.40 analytics, $1.55 origin transfer and $1.42 builds. The observed-ratio case instead has $120.52 memory and $11.90 CPU, producing $137.97 gross usage. This memory gap is the main uncertainty to investigate.

The observed 44.9 GB-hours divided by 1,600 calls equals approximately **101 GB-seconds per call**. That is not a measured request duration: allocation and concurrency affect the relationship. Separate production from previews and profile `/api/compose`, session/auth and CRUD before increasing prices. Long provider calls, failed/retried generations and database waits are hypotheses, not confirmed causes.

## AI and the whole operating budget

Current source defaults to **GPT-5 Mini**, not the older Sonnet model mentioned in repository guidance. Local model override is unset; a production override remains unverified. [OpenRouter lists](https://openrouter.ai/openai/gpt-5-mini) $0.25/million input and $2/million output tokens. [Standard credit purchases](https://openrouter.ai/pricing) add 5.5%; small purchases may have a fee floor.

The generated system prompt is roughly 29–31k characters and the response schema another 8k. Four characters/token is only a heuristic; **10k input tokens** is the planning assumption. Normal generations assume 4k total billable output tokens including reasoning and a 10% retry rate: **$0.01219/generation** including credit-purchase fee. No prompt-cache discount is assumed.

One quota unit permits an 8k-output attempt and a 10k-output retry. With ordinary 10k input per attempt, that is **$0.04326/unit** including the purchase fee, or **$2.16 for 50 generations**. This is a stress example, not an absolute cap: inputs are unbounded and refunded failed attempts can incur additional spend.

| Combined monthly budget, 10% Pro | 100 MAU | 500 MAU | 1,000 MAU |
| --- | ---: | ---: | ---: |
| Ordinary Vercel + normal AI + DB reserve | $33.10 | $55.48 | $80.95 |
| Observed-ratio Vercel + normal AI + DB reserve | $33.10 | $105.17 | $198.92 |
| Observed ratio + every Pro uses 50, every generation uses both output caps | $53.96 | $210.22 | $409.02 |

DB reserves are **$10/$20/$30 placeholders**, not measured Neon invoices or guarantees. Neon Launch compute is [listed at $0.106/CU-hour](https://neon.com/blog/major-compute-price-reduction-on-neon); an always-active 0.25 CU for 720h is $19.08 before storage/history. Actual DB configuration, scale-to-zero and email/provider plans can change the budget. Domains, paid email, support, developer compensation, refunds, chargebacks and a future live-feed host are excluded.

## Can the current subscriptions cover it?

Current UI advertises **€5.99/month or €49/year**, with **50 AI/month** on Pro. Free has six active lanes, three song-chain items and three lifetime AI generations/exports. Pro has unlimited lanes/items/exports. Annual sticker revenue is €4.08/month, a 31.8% discount from monthly billing. [Price display](../components/UpgradeModal.jsx); actual Lemon Squeezy variant prices/tax configuration were not independently verified.

[Lemon Squeezy fees](https://docs.lemonsqueezy.com/help/getting-started/fees) are 5% + $0.50, with +0.5% subscriptions and +1.5% international cards; non-US bank payouts can add 1%. PayPal and settlement/FX effects can add more. The examples below assume international card + subscription + 1% bank payout. [Tax-inclusive pricing](https://docs.lemonsqueezy.com/help/payments/sales-tax-vat) reduces the merchant’s pretax proceeds.

| Net proceeds per subscriber per month | Monthly subscription | Annual subscription, amortized |
| --- | ---: | ---: |
| No VAT example | €5.08 | €3.72 |
| Hypothetical 27% tax included in sticker price | €3.82 | €2.86 |

Currency comparison uses **€1 = $1.1355**, the [ECB’s 30 September 2026 reference rate](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.eu.html); settlement rates will differ. The 27% example is a sensitivity assumption, not a claim that every buyer or vendor invoice has that tax treatment.

At 1,000 MAU, 100 Pro subscribers produce approximately **€382/month** if all monthly, or **€286/month** if all annual under the tax-inclusive example. The normal combined cost is €71; preserving today’s compute ratio gives €175; combining that ratio with the AI quota stress gives €360. Thus ordinary use supports the current price, while **mostly annual subscribers, heavy AI and inefficient compute together can lose money**.

At that scale, normal costs need about **19 monthly or 25 annual subscribers** to break even; observed-ratio normal-AI costs need 46 or 62. These counts hold the assumed AI usage mix fixed and are indicative, not a conversion forecast. At 100 MAU, ten monthly Pro users approximately cover normal costs; ten annual Pro users are marginal under the tax-inclusive case.

## Recommended changes, without raising the base price

1. Keep Free + Pro and existing advertised prices while collecting real production costs. Do not promise unlimited app-funded AI.
2. Add server input/token limits, short request timeouts, per-user rate/concurrency limits and provider/key spending limits. Log provider input/output/reasoning tokens, cost, retry status and outcome. Preserve user-friendly quota refunds while separately capping billed attempts/spend; failures must not create unlimited funded retries.
3. Reduce unnecessary persistence calls: stop fetching the complete song list after every successful autosave and consider a 5–10s save interval with explicit/exit saves. Profile first so reliability is maintained. Cache repeated entitlement reads within a request; MCP currently performs repeated DB lookups.
4. Use the correct phone payloads, inspect actual delivery compression/cache headers and load impulse responses only when needed. Keep heavy asset hosting eligible for the chosen CDN plan.
5. After spend controls exist, optional **50 extra AI generations for approximately €4** can serve enthusiastic users without requiring everyone to pay more. The ordinary-input double-attempt stress cost is about €1.90; an illustrative tax-inclusive €4 pack nets about €2.40 before its compute cost. Measure actual costs before launching the pack.
6. A cheaper **Creator plan around €29/year with the core DAW and no recurring app-funded AI** is an optional access experiment if users ask for it. Hosting does not require a third plan today; validate willingness to pay and cannibalization first. For the affordability goal, loosening the three-lifetime-export limit is also worth considering because exports run locally.

Start with Vercel alerts around $50/$100/$150 and an OpenRouter budget appropriate to paid subscriber count. These are proposed operational settings, not applied changes. A project-pausing hard cap would interrupt service; choose that behavior deliberately.

Reproduce or change the assumptions with `node scripts/estimate-vercel-costs.mjs` or `node scripts/estimate-vercel-costs.mjs 100 500 1000`. The calculator is local-only and prints its full assumptions and separate cost lines. Scenario arithmetic was executed and checked; no application build was necessary because this adds only a report and an independent calculator.
