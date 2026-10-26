# Leið legal and privacy audit

Date: 21 October 2026. Repository baseline: `a3cc9a4`, plus the working tree reviewed that day. Public site: <https://www.layth.space/> (the supplied `layth.space` redirects there).

## Outcome

**Add privacy consent controls if the current optional analytics and device telemetry are retained.** A decorative cookie acceptance bar would not fix the underlying issue. Optional measurement must actually respect the choice, including device access before transmission. Alternatively, remove optional measurement and document any narrowly justified necessary storage.

The highest priorities are:

1. Gate optional analytics and performance telemetry, and update the privacy notice.
2. Resolve the Casio samples' NonCommercial licence before relying on them in a commercial service.
3. Verify the complete paid checkout, statutory withdrawal function, confirmations, and refund process with Lemon Squeezy.
4. Establish retention and deletion procedures, especially for feedback records that survive account deletion.

This is a technical compliance assessment with current legal-source research, not a legal opinion or certification. Hungarian operator status, contracts, production settings and business procedures still need verification. Recommendations are distinguished below from established code facts.

## Scope and evidence

Reviewed account and legal surfaces, analytics, performance monitoring, browser storage, billing integration, feedback, AI processing, public sharing and asset credits. CodeGraph-assisted review was supplemented for newer files missing from its index.

Public browser observations in a fresh, signed-out session:

| Check | Result |
| --- | --- |
| Homepage | Loads the Leið instrument and its product tour. No consent banner or privacy-preferences control observed. |
| Browser storage | Initially no JavaScript-visible cookies or storage keys. Dismissing the tour writes `transit-daw:tourStatus`. This is not an audit of HttpOnly cookies or signed-in storage. |
| Scripts | A same-origin generated analytics script, `/74e3b3386391dd4c/script.js`, is requested before any consent choice. Same-origin delivery does not establish that a service is first-party processing. |
| Performance monitor | `window.leidPerf` exists before playback or a consent choice. Individual device reads were established from source, not separately instrumented in production. |
| Legal navigation | Header menu exposes Legal overview, Terms of service, Privacy notice, Licences & credits and Feedback. |
| Legal pages | `/legal`, `/privacy` and `/terms` load. Privacy text includes the operator and provider list and is dated 29 July 2026. Its telemetry description matches the gap below. Terms mention 14-day withdrawal but expose no withdrawal-specific hyperlink in the inspected page. |

No account was created, payment made, AI prompt submitted or feedback sent. Playback telemetry transmission, authenticated cookies, hosted checkout and mobile behaviour were not exercised. The deployed commit was not independently matched to the repository baseline. No production settings, contracts, logs, database rows or secrets were inspected. This is not a penetration test or exhaustive worldwide legal review.

## Findings

### LA-01 · High · Optional measurement has no consent gate

**Confirmed implementation gap; final exemption analysis requires legal review.**

Evidence:

- `app/layout.jsx:86` mounts Vercel `<Analytics />` unconditionally.
- `lib/productAnalytics.js:5` sends product events without a consent or objection gate.
- `components/App.jsx:140` starts the performance monitor automatically.
- `lib/perfMonitor.js:75` reads the WebGL renderer, including the unmasked renderer where available. `:102` reads CPU cores, device memory, browser/platform and battery information.
- `lib/perfStats.js:146` packs OS/browser, cores, memory, GPU class, power source, audio configuration, workload and performance statistics for analytics. The raw GPU name and battery percentage remain local in this path.
- `lib/perfMonitor.js:285` can send `perf_session` once playback reaches the minimum duration. At `:336`, a sample rate of zero prevents reporting but still calls `collectDevice()`.

The EDPB explains that device-access rules reach beyond cookies, including instructed client-side processing and transmission. Whether an exemption applies depends on the particular purpose and implementation. Vercel describes its own analytics as cookie-free; that is not a legal determination for Leið's additional hardware telemetry. [EDPB final technical-scope guidelines](https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf), [Vercel privacy documentation](https://vercel.com/docs/analytics/privacy-policy).

**Recommended fix:** default optional measurement off. Gate analytics mounting, every custom-event call, and optional hardware collection. Keep any device-local diagnostics needed for an explicitly requested sound check separate from remote analytics and collect only what that function needs. Do not present `NEXT_PUBLIC_PERF_SAMPLE_RATE=0` as a complete privacy fix.

**Acceptance:** a fresh visitor can use the instrument without optional measurement; rejecting prevents optional collection and sends; withdrawing stops future measurement, including queued reports; reloading retains the choice.

### LA-02 · High · Privacy notice does not describe the performance telemetry

**Confirmed disclosure mismatch.** `app/privacy/page.jsx:17` describes coarse device/browser information and limited product properties. It omits the hardware, battery, audio and performance profile above. The public `/privacy` page has the same omission. This finding does not establish behavioural profiling or automated decision-making about people.

**Recommended fix:** distinguish information read locally from fields sent remotely; explain purpose, recipient, choice and retention. Update `/legal` as well as `/privacy`. Describe all browser-storage categories and link to a detailed inventory. A generic statement that consent applies where required does not implement consent.

The notice also lists legal bases broadly (`:63`) and retention criteria generally (`:127`). Map each purpose to its basis and use concrete periods or meaningful criteria supported by real practice. GDPR Article 13 addresses these disclosures and transfer safeguards. [GDPR, Article 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1772981449498&uri=CELEX%3A32016R0679).

**Acceptance:** published disclosures match actual collected fields, provider settings and user controls; update dates reflect the real publication date.

### LA-03 · High · Casio sample rights conflict with the commercial direction

**Confirmed restrictive licence; permission outside that licence is unknown.** `lib/soundSpecs.js:36` exposes Casio samples and identifies CC BY-NC-SA 4.0. `app/licenses/page.jsx:29` repeats that licence. The upstream README identifies the same terms. Leið offers paid subscriptions and exports.

The licence restricts commercial use; attribution alone does not remove that restriction. Review both the service's use and what users may do with rendered output. Do not conclude that every output or the whole application automatically inherits ShareAlike. [Upstream Casio notice](https://github.com/Tonejs/audio/blob/master/casio/README.md), [CC BY-NC-SA 4.0 terms](https://creativecommons.org/licenses/by-nc-sa/4.0/).

**Recommended fix:** replace the set with commercially cleared recordings, or retain written commercial permission covering hosting, playback and intended output use. Account for existing saved songs referencing the preset. Keep source, licence version and permission evidence for every bundled sample and impulse response.

**Acceptance:** a rights manifest covers the shipped assets and the commercial use actually offered.

### LA-04 · High, conditional · Paid checkout and withdrawal need end-to-end verification

**Confirmed local integration limitations; hosted compliance is unverified.**

`components/UpgradeModal.jsx:26` presents pricing and upgrade actions; `:63` says cancellation is available. `app/api/billing/checkout/route.js:6` sends customer/account and variant information without local terms-version or immediate-performance evidence. `app/terms/page.jsx:111` acknowledges statutory withdrawal but refers users to checkout, receipt, portal or contact. No dedicated withdrawal function or model form was found in the reviewed local flow. Lemon Squeezy may supply some of this externally.

Ordinary cancellation of renewal and statutory withdrawal are different. EU rules introduce an online withdrawal function, applicable from 19 June 2026; Hungary's current regulation includes the function, confirmation and acknowledgment mechanics. Establish the seller and responsibility split with the merchant of record before deciding where the function belongs. [Directive (EU) 2023/2673](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32023L2673), [Hungarian Government Decree 45/2014, §§19–23](https://njt.jog.gov.hu/jogszabaly/2014-45-20-22), [Lemon Squeezy merchant-of-record description](https://www.lemonsqueezy.com/reporting/merchant-of-record).

**Recommended verification:** inspect a test-mode EU checkout and receipt for seller identity, total including taxes, currency, billing interval, renewal, cancellation, contract information, withdrawal instructions/form and durable confirmation. Verify the online withdrawal route, submission confirmation and receipt. Record any express request for early service performance. Avoid assuming that immediate SaaS access automatically extinguishes withdrawal rights under a digital-content exception. Review complaints and alternative-dispute-resolution information with the operator's adviser.

**Acceptance:** retain a test purchase evidence pack and successfully exercise both cancellation and applicable withdrawal/refund handling. Amend Leið's promises to match the actual hosted flow.

### LA-05 · Medium · Feedback survives user deletion and has no code-level expiry

**Confirmed persistence behaviour; manual processes are unknown.** `lib/db/schema.js:378` stores feedback email, message, context, salted IP hash, status and timestamp. Its user reference uses `onDelete: 'set null'`: deleting a user leaves those fields intact. The one-hour rate window in `app/api/feedback/route.js:23` limits a count query, not record lifetime. No cleanup job was found in the reviewed application/scripts.

**Recommended fix:** define separate lifetimes for anti-abuse identifiers and useful support correspondence. Remove rate-limit hashes after their justified window, subject to documented security exceptions. Include retained feedback and email copies in account-deletion/access procedures. Explain feedback context and IP-hash handling in the notice. A salted hash should not automatically be treated as anonymous.

**Acceptance:** a deletion rehearsal accounts for feedback records and support mail; cleanup has an owner, schedule and evidence of execution.

### LA-06 · Medium · Rights handling and retention require an operating procedure

**Verification gap, not proof of a legal breach.** `/privacy` and `/terms` offer email-based deletion and data requests. A self-service delete/export button is not inherently required. However, the application UI is not evidence that requests are fulfilled across accounts, saved work, billing records, feedback, email and backups.

Create a request register, proportionate identity checks, an export format, deletion checklist, exception log and response templates. Test with a disposable account; document backup rotation and restoration handling. The usual response deadline is one month, subject to lawful exceptions and extensions. [European Commission guidance on individual requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en).

### LA-07 · Medium · Provider contracts and transfers are not established by policy links

**Operational verification gap.** `app/privacy/page.jsx:21` already lists Vercel, Neon, Resend, OpenRouter/model providers, Lemon Squeezy, Cloudflare, CARTO and GitHub Pages. `:85` refers generally to their transfer terms. This review did not establish actual regions, contracts, subprocessors or safeguards.

Create a provider register with role, data, location, retention, contract and applicable transfer tool. Distinguish processors from independent controllers. Describe the actual safeguards and how users can obtain information about them. Do not substitute a cookie choice for vendor contracting or transfer assessment. [EDPB guidance for small businesses on international transfers](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en).

For AI, `app/api/compose/route.js` defaults to `openai/gpt-5-mini` and has no explicit no-training/ZDR restriction in the reviewed request. Account settings may supply restrictions. Verify them and the configured production provider; do not claim zero retention without evidence. [OpenRouter provider-policy documentation](https://github.com/OpenRouterTeam/docs/blob/main/guides/privacy/provider-logging.mdx).

### LA-08 · Medium, conditional · Confirm trader identity and contractual acceptance

**Partly present; business facts are unknown.** `lib/legal.js:3` supplies a personal name, postal address and email. It does not supply legal status, registration/tax identifiers, telephone or detailed hosting-provider identity. Add applicable information after verifying who operates the service and who sells the subscription. Hungarian electronic-commerce disclosure duties include status-dependent registration/tax information and hosting information, subject to statutory conditions. [Act CVIII of 2001, §4](https://njt.jog.gov.hu/jogszabaly/2001-108-00-00).

`components/AuthControl.jsx:49` includes age/guardian wording, but no signup terms-version, acceptance timestamp or guardian evidence was found in `lib/db/schema.js`. Consider clear terms acknowledgement at registration with an auditable version. Keep it separate from optional analytics consent and privacy-notice acknowledgment. Review magic-link entry too.

Assess contract capacity and child-consent handling against the intended audience and legal basis. A missing date-of-birth field is not automatically a violation; avoid collecting extra identity data without need. GDPR Article 8 concerns consent-based processing in the specified child-services context, not every account operation. [GDPR, Article 8](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1772981449498&uri=CELEX%3A32016R0679).

### LA-09 · Medium, conditional · Complete source-rights and regulatory applicability reviews

- **Transit rights:** `app/licenses/page.jsx:42` has agency credits, but general references to BKK/MTA/source terms and Warsaw's distributor are not a retained permission record. Check actual downloaded dataset versions for commercial use, redistribution, attribution and modification conditions. Preserve the licence with each dataset release. Current credits are a useful starting point, not proof of breach or clearance.
- **Accessibility:** assess the paid e-commerce journey and applicable Hungarian implementation. The European Accessibility Act has applied since 28 June 2025; service microenterprises may qualify for an exemption. Verify size and scope before asserting either a duty or an exemption. [EU accessibility guidance](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/accessibility/index_en.htm).
- **AI transparency:** the feature is already visibly labelled AI Composer. Review the first-interaction disclosure against current Article 50 guidance; no missing AI label was established. Do not assume that musical plans automatically require the same disclosure as deepfakes. [Commission Article 50 guidance](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act).
- **Shared content:** terms already provide a reporting email and bearer-link warning. Assess hosting/DSA classification and applicable notice handling before expanding public publishing. An unlisted song link alone does not establish an online-platform classification. [Digital Services Act](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?qid=1788618312851&uri=CELEX%3A32022R2065).

## Consent-control implementation brief

Recommended first layer: **Accept optional analytics**, **Reject optional analytics**, **Settings**, and a Privacy link. Necessary authentication/storage is explained separately. Preferences are optional; rejection must leave the instrument usable. Keep choices equally understandable and accessible, without preselected optional consent or treating continued browsing as agreement. Withdrawal should remain available from a persistent Privacy settings entry. [EDPB cookie-banner taskforce report](https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf).

Suggested copy, to validate against the final implementation:

> We use essential storage for sign-in and instrument settings. With your permission, we also collect usage and device performance information to improve Leið. You can change your choice in Privacy settings.

Engineering requirements:

1. Use a central, versioned consent state with an explicit unknown state. Optional processing stays off until affirmative choice.
2. Gate `<Analytics />`, `trackProductEvent` and optional collection in `startPerfMonitor`. Prevent reports scheduled before rejection or withdrawal from being sent later.
3. Store purpose choices, timestamp and notice version with proportionate evidence. Do not collect additional identity data solely to prove a choice.
4. Minimise hardware fields. Keep requested on-device sound diagnostics available without silently opting users into remote reporting.
5. Honour the same choice across tabs and repeat visits; allow changes and withdrawal. Renew permission when purposes materially change, using a documented review policy.
6. Check URLs/custom events for share IDs, magic-link tokens and other private values before analytics transmission.
7. Verify fresh visit, reject, accept, reload, withdrawal, cleared storage and unavailable storage in a production-like browser. Check network and device API access, not just whether the banner disappears.

A separate cookie-policy route is optional document organisation; accurate accessible storage information and effective controls are what matter. A necessary-only implementation can avoid optional consent UI if its exemptions are substantiated.

## Browser-storage inventory

These keys were identified in source. Most were not created in the brief live session. No application `sessionStorage` usage was found. Local storage has no automatic expiry in the reviewed paths.

| Key | Purpose | Source |
| --- | --- | --- |
| `leid-theme` | Theme | `lib/shared/ThemeContext.jsx:5` |
| `leid.cityId` | Selected city | `lib/shared/CityContext.jsx:6` |
| `leid.drumClipboard` | Drum clipboard | `lib/shared/DrumClipboardContext.jsx:10` |
| `leid-intro-seen` | Intro dismissal | `components/FirstRunNotice.jsx:24` |
| `transit-daw:tourStatus` | Tour state | `lib/tourState.js:3` |
| `transit-daw:lastSongId` | Last song | `lib/persistence.js:18` |
| `transit-daw:autosaveEnabled` | Autosave preference | `lib/useSongPersistence.js:29` |
| `leid-audio-latency` | Audio latency preference | `lib/audioSession.js:39` |
| `leid-perf-hud` | Diagnostic HUD preference | `lib/perfMonitor.js:30` |
| `leid-ai-composer-pos` | Panel position | `components/AIComposerPanel.jsx:31` |
| `leid-guide-first-song-v1` | Guide progress | `components/guide/UserGuide.jsx:10` |

Classify each by actual purpose and when the user requests it; do not blanket-label every preference essential. Document cookie names, lifetime, provider and security attributes after inspecting real signed-in responses. `lib/auth.js` does not explicitly configure those details, so framework defaults must be verified rather than guessed. Turnstile is a separate security-purpose assessment; the feedback form already discloses Cloudflare. [Cloudflare Turnstile privacy addendum](https://www.cloudflare.com/turnstile-privacy-policy/).

## Existing strengths

The site already provides privacy, terms, legal and licence surfaces; a named operator and contact; a provider list; a NAIH complaint link; local-upload/export explanations; public-sharing warnings; consumer-rights protections in the terms; and substantial audio/data/software credits. Build on these rather than replacing them with generic boilerplate.

## Work order and completion evidence

| Order | Owner | Deliverable |
| --- | --- | --- |
| 1 | Engineering + operator | Optional measurement consent or removal, with before/after network and device-access evidence. |
| 2 | Operator + rights adviser | Casio replacement or written permission; versioned asset manifest. |
| 3 | Operator + billing provider | Hosted checkout/receipt review and demonstrated withdrawal/refund route. |
| 4 | Engineering + operator | Accurate privacy/storage disclosures, feedback cleanup and rehearsed rights requests. |
| 5 | Operator + legal adviser | Trader details, vendor/transfer register, audience policy and applicable regulatory scope. |

This audit changes documentation only. It does not implement consent or amend public legal text. No build was required because application code was unchanged. Close findings only when the corresponding implementation or operating evidence has been checked.
