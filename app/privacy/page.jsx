import { DataTable, LegalSection, LegalShell } from '@/components/legal/LegalShell.jsx'
import { LEGAL_DETAILS } from '@/lib/legal.js'

export const metadata = {
  title: 'Privacy Notice',
  description: 'How Leið collects, uses, stores, and shares personal data.',
  alternates: { canonical: '/privacy' },
}

const dataRows = [
  ['Account', 'Name, email address, password hash, account and verification timestamps.', 'Create and secure your account.'],
  ['Session and security', 'Session token, expiry, IP address, user agent, and security logs.', 'Keep you signed in, prevent abuse, and diagnose failures.'],
  ['Creative work', 'Saved song snapshots, composition names and items, city, BPM, and optional public share ID.', 'Save, reopen, chain, and share your work.'],
  ['AI Composer', 'The prompt you submit and the route/context messages needed to generate a plan.', 'Provide AI Composer when you explicitly use it.'],
  ['Plan and usage', 'Subscription status, provider identifiers, renewal/end dates, and export or AI allowance counters.', 'Provide paid features and enforce Free and Pro limits.'],
  ['Device preferences', 'Selected city, drum clipboard, tour status, autosave preference, last song ID, and mobile bypass.', 'Remember local instrument choices in your browser.'],
  ['Support', 'Messages and information you send when contacting us.', 'Respond to questions and privacy requests.'],
]

const providers = [
  ['Vercel', 'Application hosting, delivery, and operational logs.', 'https://vercel.com/legal/privacy-policy'],
  ['Neon', 'Managed Postgres database for accounts and saved work.', 'https://neon.com/privacy-policy'],
  ['Resend', 'Delivery of magic-link and account emails.', 'https://resend.com/legal/privacy-policy'],
  ['OpenRouter', 'Processes prompts only when a signed-in user invokes AI Composer.', 'https://openrouter.ai/privacy'],
  ['Lemon Squeezy', 'Processes checkout, subscription, tax, invoice, and billing-support information as merchant of record.', 'https://www.lemonsqueezy.com/privacy'],
  ['CARTO', 'Supplies map tiles; tile requests can include network and browser data.', 'https://carto.com/privacy'],
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
          impulse responses you open in the instrument are decoded locally and are not included
          in saved song snapshots. MIDI and WAV exports are generated on your device.
          Leið records only the export allowance used, not the exported file or its contents.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Why processing is lawful">
        <ul>
          <li><strong>Contract:</strong> to provide accounts, authentication, saved work, sharing, and requested features.</li>
          <li><strong>Legitimate interests:</strong> to secure, maintain, troubleshoot, and improve the service while limiting the data used.</li>
          <li><strong>Legal obligation:</strong> where records must be kept or disclosed under applicable law.</li>
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
      </LegalSection>

      <LegalSection number={5} title="Cookies and browser storage">
        <p>
          Leið uses essential authentication cookies to keep signed-in accounts secure. Local
          storage remembers the active city, drum clipboard, product-tour state, autosave choice,
          and last opened song. Session storage remembers a mobile-gate bypass until the browser
          session ends.
        </p>
        <p>
          As of the date above, Leið does not use advertising cookies, behavioural profiling, or
          third-party analytics. If that changes, this notice and any required consent controls
          will be updated before non-essential tracking is enabled.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Public song sharing">
        <p>
          Sharing is off by default. If you publish a saved song, Leið creates a share ID. Anyone
          with that link can view the song state and import a copy. Do not put personal,
          confidential, or third-party protected information in names or content you share. You
          can unpublish the link from the song menu.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Retention and deletion">
        <p>
          Account data and saved creative work are kept while the account is active. Accounts
          that have been inactive for 12 months may be removed after reasonable advance notice.
          Verification records and sessions expire when they are no longer needed for
          authentication. Operational and security logs are retained only as long as reasonably
          necessary for security, troubleshooting, and provider operations.
        </p>
        <p>
          You may request account and personal-data deletion at any time by emailing{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a>. Data
          is removed from live systems when the request is completed; residual copies may remain
          in protected backups until their normal rotation completes, or longer where law or a
          legal claim requires it.
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
