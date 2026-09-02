import { DataTable, LegalSection, LegalShell } from '@/components/legal/LegalShell.jsx'
import { LEGAL_DETAILS } from '@/lib/legal.js'

export const metadata = {
  title: 'Privacy Notice',
  description: 'How Leið collects, uses, stores, and shares personal data.',
  alternates: { canonical: '/privacy' },
}

const dataRows = [
  ['Account', 'Internal user and authentication-account IDs, display name, email address, password hash, role, verification state or records, and account timestamps.', 'Create, administer, and secure your account.'],
  ['Session and security', 'Session token, expiry, IP address, user agent, and operational or security records.', 'Keep you signed in, prevent abuse, and diagnose failures.'],
  ['Creative work', 'Song and composition names; saved mixer, note, automation, drum, route, city, and arrangement settings; timestamps; and an optional public share ID.', 'Save, reopen, chain, and share your work.'],
  ['AI Composer', 'Your prompt, the active city and route context sent with it, and the model-generated plan.', 'Provide AI Composer when you explicitly use it.'],
  ['Plan and usage', 'Plan and access source, subscription and customer identifiers, product or variant, status and relevant dates, and export or AI allowance counters.', 'Provide paid or complimentary access and enforce Free and Pro limits.'],
  ['Device preferences', 'Theme, selected city, drum clipboard, tour status, mobile-intro status, autosave preference, and last song ID.', 'Remember local instrument choices in your browser.'],
  ['Usage analytics', 'Page path and referrer; coarse country, device, operating-system, and browser data; and limited product events with properties such as city, form factor, playback mode, track count, or BPM.', 'Measure reliability and improve the instrument.'],
  ['Support', 'Messages and information you send when contacting us.', 'Respond to questions and privacy requests.'],
]

const providers = [
  ['Vercel', 'Application and static-data hosting, delivery, operational logs, and cookie-free web analytics.', 'https://vercel.com/legal/privacy-policy'],
  ['Neon', 'Managed Postgres database for accounts and saved work.', 'https://neon.com/privacy-policy'],
  ['Resend', 'Delivery of magic-link, account, and feedback emails.', 'https://resend.com/legal/privacy-policy'],
  ['OpenRouter and the selected model provider', 'Process prompts, route context, and generated plans only when a signed-in user invokes AI Composer.', 'https://openrouter.ai/privacy'],
  ['Lemon Squeezy', 'Processes checkout, subscription, tax, invoice, and billing-support information as merchant of record.', 'https://www.lemonsqueezy.com/privacy'],
  ['Cloudflare', 'Runs the Turnstile bot check on the feedback form; the check receives your IP address and browser signals.', 'https://www.cloudflare.com/privacypolicy/'],
  ['CARTO', 'Supplies map tiles; tile requests can include network and browser data.', 'https://carto.com/privacy'],
  ['GitHub Pages', 'Supplies optional melodic sample files hosted for Tone.js and tonejs-instruments; requests can include network and browser data.', 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement'],
]

export default function PrivacyPage() {
  return (
    <LegalShell
      current="/privacy"
      kicker="Privacy notice / route 01"
      title="Your data, mapped plainly."
      summary="This notice describes the personal data handled by Leið, where it travels, and the controls you have over it."
    >
      <LegalSection number={1} title="Controller and scope">
        <p>
          The controller for Leið is <strong>{LEGAL_DETAILS.operatorName}</strong>,{' '}
          {LEGAL_DETAILS.operatorAddress}. Privacy enquiries and requests can be sent to{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a>.
        </p>
        <p>
          This notice applies to the Leið website, its account system, saved songs and
          compositions, public share links, AI Composer, and related support communication.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Data we handle">
        <DataTable headers={['Category', 'Data', 'Purpose']} rows={dataRows} />
        <p>
          Route, stop, and vehicle information comes from public-transport data sources and is
          used to generate music. It is not used to identify passengers. Audio samples and
          impulse responses you upload to the instrument are decoded locally and are not uploaded
          to Leið or included in saved song snapshots. MIDI and WAV exports are generated on your device.
          Leið records only the export allowance used, not the exported file or its contents.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Why processing is lawful">
        <ul>
          <li><strong>Contract:</strong> to provide accounts, authentication, saved work, sharing, and requested features.</li>
          <li><strong>Legitimate interests:</strong> to secure, maintain, troubleshoot, measure, and improve the service while limiting the data used.</li>
          <li><strong>Legal obligation:</strong> to keep or disclose billing, tax, accounting, or other records where applicable law requires it.</li>
          <li><strong>Consent:</strong> where the law requires it. Consent may be withdrawn at any time without affecting earlier lawful processing.</li>
        </ul>
      </LegalSection>

      <LegalSection number={4} title="Processors and recipients">
        <p>Leið uses the following service providers to operate the website:</p>
        <DataTable
          headers={['Provider', 'Role', 'Privacy information']}
          rows={providers.map(([provider, role, url]) => [
            provider,
            role,
            <a key={url} href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a>,
          ])}
        />
        <p>
          Public transport agencies and feed operators supply route and vehicle data. They do
          not receive your Leið account data from us. Providers may process data outside Hungary
          or the European Economic Area using the transfer mechanisms described in their own
          privacy information and data-processing terms.
        </p>
        <p>
          AI Composer is optional. Leið sends your prompt together with a system message describing
          the active city, available route names and IDs, and instrument controls to OpenRouter,
          which routes the request to the configured model provider. Leið does not deliberately
          add your name or email to that request and does not store the raw prompt or returned plan
          in its database. If you apply a plan and save the song, the resulting instrument settings
          become part of that saved song. OpenRouter and model-provider retention or training
          practices vary, so do not submit confidential, sensitive, or third-party personal data.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Cookies and browser storage">
        <p>
          Leið uses essential authentication cookies to keep signed-in accounts secure. Local
          storage remembers the theme, active city, drum clipboard, product-tour and mobile-intro
          state, autosave choice, and last opened song. These local preferences remain on the
          device until you clear them or your browser storage.
        </p>
        <p>
          Leið does not use advertising cookies or behavioural profiling. It uses Vercel Web
          Analytics, which does not use cookies, for page views and a small set of product events
          such as opening or troubleshooting the app, selecting a city, starting playback,
          generating or applying an AI plan, or sending a drum pattern. Vercel derives a
          daily-resetting visitor hash and provides aggregate reporting. These events do not
          include account names or emails, song content, prompts, exported files, or audio.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Public song sharing">
        <p>
          Sharing is off by default. If you publish a saved song, Leið creates an unlisted bearer
          link: no sign-in is required, and anyone who has the URL can retrieve the song name,
          city, schema version, and complete saved creative state and import a copy. Do not put
          personal, confidential, or third-party protected information in names or content you
          share. You can unpublish the link from the song menu, but that cannot recall copies
          already imported or saved.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Retention and deletion">
        <p>
          Account data and saved creative work are kept while the account is active, until you
          delete the relevant work, or until an account-deletion request is completed. You can
          delete individual saved songs in the service. Verification records and sessions expire
          when they are no longer needed for authentication. Billing subscription history and
          usage records are kept while the account is active and longer where needed for tax,
          accounting, fraud prevention, disputes, or legal claims. Support correspondence,
          operational logs, and security records are retained only as long as reasonably necessary
          for those purposes and provider operations.
        </p>
        <p>
          You may request account and personal-data deletion at any time by emailing{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a>. Data
          is removed from live systems when the request is completed; residual copies may remain
          in protected backups until their normal rotation completes, or longer where law or a
          legal claim requires it.
        </p>
        <p>
          Leið does not retain AI prompts or generated plans in its application database, but
          OpenRouter and the selected model provider may retain request or response data under
          their own settings and policies. Vercel’s analytics visitor hash resets every 24 hours;
          aggregated analytics and provider records follow the provider’s configured retention.
        </p>
        <p>
          When you begin checkout, Leið sends your display name, email address, and internal user
          ID to Lemon Squeezy to associate the purchase with your account. Leið stores the
          resulting subscription identifiers, status and dates needed for access control, but
          does not receive or store your full payment-card details. Lemon Squeezy retains payment,
          invoice, tax, and transaction records under its own legal obligations and policies.
        </p>
      </LegalSection>

      <LegalSection number={8} title="Children">
        <p>
          Leið is not intended for children under {LEGAL_DETAILS.minimumAge}. In Hungary, a user
          under {LEGAL_DETAILS.parentalConsentAge} must have a parent or legal guardian authorize
          any consent-based processing needed for an account. If the law where you live sets a
          different threshold, that rule applies. A guardian who believes a child provided data
          without the required authorization should contact us so it can be removed.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Your rights">
        <p>
          Depending on the circumstances, you may ask to access, correct, erase, restrict, or
          receive a portable copy of your personal data; object to processing based on legitimate
          interests; and withdraw consent. You also have the right to complain to a supervisory
          authority.
        </p>
        <p>
          AI Composer proposes musical settings for you to review and apply. Leið does not use
          solely automated processing to make decisions about you that produce legal or similarly
          significant effects.
        </p>
        <p>
          In Hungary, the supervisory authority is the{' '}
          <a href="https://www.naih.hu/about-the-authority" target="_blank" rel="noreferrer">
            National Authority for Data Protection and Freedom of Information (NAIH)
          </a>. Contact us first if you can—we would like the opportunity to resolve the issue.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Security and changes">
        <p>
          Reasonable technical and organisational safeguards are used to protect data, but no
          internet service can promise absolute security. Keep your password confidential and
          tell us promptly if you suspect unauthorized account access.
        </p>
        <p>
          This notice may change when the product, providers, or law changes. Material updates
          will be announced in the service or by email where appropriate, and the updated date at
          the top of this page will change.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
