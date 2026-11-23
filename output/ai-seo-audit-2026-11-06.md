# Leið discovery and AI SEO audit

Date: 6 November 2026. Source revision: `e412247`, with pre-existing unrelated working-tree changes. Public origin checked: https://www.layth.space/.

## Assessment

The highest-value improvements are accessible public product copy and pricing, followed by consistent product facts and one useful musical workflow page. Existing robots directives, canonical metadata, and public documentation provide a foundation. This audit does not establish current Google/Bing indexing coverage or AI recommendation rates.

## Evidence and scope

- Read-only source review of public routes, metadata, discovery files, public copy, pricing presentation, and plan allowances.
- Direct HTTP GETs to nine deployed paths: `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/guide`, `/pricing`, `/guides/mcp`, `/guides/composer-skill`, and `/terms`.
- Every direct request received HTTP 429 with `x-vercel-mitigated: challenge` and a Vercel Security Checkpoint page. This is observed behavior for this audit client, not proof that verified Googlebot, Bingbot, or AI search bots receive the same response. The response also prevents inferring whether `/pricing` exists on the deployment from its HTTP result.
- The web retrieval tool returned cached homepage content consisting of “LEIÐ · loading…”. A branded search returned the homepage with a product explanation. These different observations are consistent with differing retrieval/rendering paths; neither establishes complete indexing coverage.
- Small exploratory searches for the domain, brand plus music/MIDI, and generative browser sequencers. These were search-result checks, not a controlled multi-assistant recommendation baseline. They did not establish meaningful independent coverage or its absence.
- No app code, hosting settings, or analytics configuration changed. No build required for this report-only change.

## Findings and fixes

### 1. Investigate hosting challenges on discovery URLs first

**Priority: immediate investigation. Confidence: confirmed for this client; search-crawler impact unknown.**

Even robots and sitemap requests received a JavaScript security challenge. A permissive robots file cannot help a client that cannot retrieve it or the content behind it.

Inspect Vercel Firewall/Bot Management request logs for verified search and AI retrieval traffic. Determine the matching rule and whether legitimate discovery requests are challenged. If necessary, make a narrowly scoped adjustment that lets verified intended crawlers retrieve public pages and discovery files. Retain protection of auth, compose, and other API endpoints.

Acceptance: relevant verified crawler requests return intended content and status codes; robots and sitemap are retrievable; a Search Console live URL test succeeds. A curl user-agent impersonation would not prove verified-bot access.

Reference: https://vercel.com/docs/bot-management

### 2. Put a product explanation and public navigation in server-rendered HTML

**Priority: high. Confidence: confirmed in source.**

`app/page.jsx:12` loads the entire app with `ssr: false`; its initial visible output is a loading message. Readers that do not execute JavaScript lack the explanation, feature facts, and public links needed to understand Leið. This is not proof that Google cannot render or index the app.

Add visible server-rendered product copy and links while preserving the music-first app experience. A dedicated explanatory page is another option, provided it has a prominent crawlable entry point. Do not add hidden crawler-only copy.

Suggested definition: “Leið is a browser-based music sequencer that turns public transport routes into musical patterns. Each line becomes a track, and each stop becomes a note.” Follow with the eight supported cities, current simulated playback status, practical controls, export behavior, and links to pricing and the guide.

Acceptance: a raw HTML response contains the definition and normal links to public information without executing JavaScript.

### 3. Publish pricing without requiring sign-in

**Priority: high. Confidence: confirmed in source.**

`components/UpgradeModal.jsx:51` renders prices inside the signed-in branch. Guests see a sign-in instruction. The guest menu at `components/HeaderMenu.jsx:130` has no pricing link, and the sitemap has no pricing page.

Publish a server-rendered `/pricing` page, link it from the guest navigation and product information, and include it in the sitemap. Explain Free and Pro limits, lifetime versus monthly allowances, billing periods, and which actions require an account.

The current UI constants at `components/UpgradeModal.jsx:22` show €5.99/month and €49/year. These are hardcoded display values; actual checkout charges and tax treatment were not verified. Confirm them against the billing provider before publishing.

Plan facts checked against `lib/billing/plans.js:3`:

| Allowance | Free | Pro |
|---|---|---|
| Active lanes | 6 | Unlimited |
| Chained items | 3 | Unlimited |
| Exports | 3 lifetime | Unlimited |
| AI generations | 3 lifetime | 50 per month |
| Custom uploads | Unavailable | Available |

### 4. Correct inconsistent city and export facts

**Priority: medium; small implementation effort. Confidence: confirmed in source.**

- `app/layout.jsx:21` says seven cities.
- `components/guide/UserGuide.jsx:88` says “all seven cities”.
- `components/guide/guideContent.js:4` and `public/llms.txt` omit Vienna.
- The implemented inventory has eight cities: Budapest, Helsinki, Berlin, Prague, New York, Zürich, Warsaw, and Vienna.
- `public/llms.txt` describes MIDI as “per-track and full mix”. The documented export contract is one loop pass per lane; the header downloads one MIDI file per active lane. WAV handles rendered audio, including the full mix.

Derive counts and city lists from shared facts where practical. State export behavior explicitly, then link `llms.txt` to the authoritative guide and pricing page. Keep that file secondary to visible public content.

The guide already correctly states that playback is simulated and Live mode is unavailable, consistent with all current `liveWsUrl` values being null. Preserve that accuracy across future marketing copy.

### 5. Add one public workflow that demonstrates musical value

**Priority: medium, after access and core facts. Confidence: confirmed page-inventory gap; demand unmeasured.**

`app/sitemap.js:4` lists the homepage, guide, legal/privacy/terms/licenses, and feedback. MCP guide entries depend on the feature flag. The inventory lacks a dedicated pricing or musical workflow page.

Start with “Make a generative ambient loop from a city route”. Explain the complete process, include an audio example and useful screenshots, describe MIDI/WAV output and Free limitations, and link to the instrument, guide, and pricing. Use a truthful update date. This is a proposed content experiment, not a verified keyword opportunity.

## Existing strengths

- `app/robots.js:5` allows general crawling except `/api/` and advertises the sitemap. No explicit AI search bot block was found in these source directives.
- `lib/siteMetadata.js:2` centralizes the origin with `NEXT_PUBLIC_APP_URL` and a `https://www.layth.space` fallback. The public metadata helper supplies self canonicals and social metadata.
- `app/layout.jsx:69` permits indexing/following and declares English.
- A public guide and `llms.txt` already exist in source.
- Upgrade benefit copy agrees with the plan definitions examined.

These source findings do not verify deployed headers, environment values, or third-party billing configuration.

## Remaining evidence to collect

1. Google Search Console live inspection, indexed URLs, exclusion reasons, selected canonicals, and queries/impressions for the homepage and guide. Use Bing Webmaster Tools for Bing coverage. Search-result samples are not a substitute.
2. Vercel request logs/settings to distinguish challenges to this client from challenges to verified crawlers.
3. Billing provider prices and tax presentation.
4. Rendered-page/Rich Results inspection for structured data. No claim of absent schema is made from raw retrieval or the partial source review.
5. A repeatable recommendation baseline: test five commercially relevant prompts three times per selected assistant, record date/model/search mode, recommendation versus citation, factual accuracy, and cited URLs. This audit did not run that experiment.
6. Existing PostHog event coverage for discovery through first playback, export, and paid conversion. Add AI referral and optional self-reported discovery attribution only where needed. No analytics data was queried in this audit.

Core Web Vitals, mobile layout, audio behavior, comprehensive backlinks, and authenticated checkout were outside this discovery audit.

## Delivery order

1. Investigate deployment challenges and verify legitimate discovery access.
2. Add readable public product copy/navigation and publish pricing.
3. Correct city counts, lists, and MIDI wording in the same implementation pass.
4. Publish one demonstrated musical workflow and link it from the core pages.
5. Establish indexing, recommendation, and conversion baselines before expanding content or outreach.

After implementation, run the repository-required build and recheck deployed raw HTML, metadata, links, and HTTP responses. Google requires an indexed page eligible for snippets to appear as a supporting link in its AI features; special AI files or schema are not additional requirements: https://developers.google.com/search/docs/appearance/ai-features
