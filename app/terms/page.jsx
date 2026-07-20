import Link from 'next/link'
import { LegalSection, LegalShell } from '@/components/legal/LegalShell.jsx'
import { LEGAL_DETAILS } from '@/lib/legal.js'

export const metadata = {
  title: 'Terms of Service',
  description: 'Terms governing use of the Leið public-transport sonification instrument.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <LegalShell
      current="/terms"
      kicker="Terms of service / route 02"
      title="The rules of the instrument."
      summary="Use Leið creatively and lawfully. These terms set the boundaries for accounts, shared work, AI output, and service availability."
    >
      <LegalSection number={1} title="Agreement and operator">
        <p>
          These Terms of Service form an agreement between you and{' '}
          <strong>{LEGAL_DETAILS.operatorName}</strong>, {LEGAL_DETAILS.operatorAddress}, for your
          use of {LEGAL_DETAILS.serviceName}. By using the service or creating an account, you
          agree to these terms and acknowledge the <Link href="/privacy">Privacy Notice</Link>. If
          you do not agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Age and guardian authorization">
        <p>
          You must be at least {LEGAL_DETAILS.minimumAge} to use Leið. If you are under{' '}
          {LEGAL_DETAILS.parentalConsentAge}, or below the age at which you may independently agree
          to these terms or authorize data processing where you live, a parent or legal guardian
          must review and authorize your use. The guardian is responsible for the minor’s use of
          the service.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Accounts">
        <p>
          Account information must be accurate enough to operate and secure the account. You are
          responsible for your credentials and activity under your account. Tell us promptly at{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a> if you
          suspect unauthorized access. You may not sell, transfer, automate the creation of, or
          impersonate another person through an account.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Your work and permissions">
        <p>
          You retain the rights you hold in original names, arrangements, uploaded material, and
          creative choices you make with Leið. You give us a limited permission to host, process,
          reproduce, and transmit saved work only as needed to operate the service and features
          you request. This permission ends when the relevant content is deleted, subject to
          normal backup rotation and legal requirements.
        </p>
        <p>
          You must have the rights needed for any audio, text, or other material you use. Public
          transport data, map tiles, built-in samples, software, and other third-party material
          remain subject to their respective licences and attribution requirements.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Shared links">
        <p>
          When you enable sharing, anyone with the link can view the saved song state and import a
          copy. You are responsible for what you choose to publish. We may disable shared content
          or links that infringe rights, expose personal data, break these terms, or create legal
          or security risk. Unpublishing prevents future access through that share ID but cannot
          recall copies others already imported or saved.
        </p>
      </LegalSection>

      <LegalSection number={6} title="AI Composer">
        <p>
          AI Composer sends your prompt and relevant musical context to OpenRouter and a selected
          model provider. Do not submit confidential, sensitive, unlawful, or third-party personal
          information. Generated plans may be inaccurate, repetitive, unsuitable, or similar to
          other output. Review them before use. We do not promise that AI output is unique,
          copyrightable, or free of third-party claims.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Acceptable use">
        <p>You may not use Leið to:</p>
        <ul>
          <li>break applicable law or infringe another person’s rights;</li>
          <li>upload malware, probe security, bypass access controls, or disrupt the service;</li>
          <li>scrape, overload, or automate requests in a way that harms the service or its providers;</li>
          <li>publish private, deceptive, abusive, hateful, or unlawful material;</li>
          <li>misrepresent generated music or public-transport data as safety-critical or official transit guidance.</li>
        </ul>
      </LegalSection>

      <LegalSection number={8} title="Transit data and service availability">
        <p>
          Leið is a musical instrument, not a journey planner or transport authority. Transit
          feeds may be delayed, incomplete, simulated, or unavailable; live mode may be disabled.
          Do not rely on the service for travel, safety, emergency, accessibility, or operational
          decisions.
        </p>
        <p>
          The service may change, pause, lose features, or be discontinued. We may suspend access
          where reasonably necessary for maintenance, security, legal compliance, provider limits,
          or a breach of these terms. We do not guarantee uninterrupted availability or permanent
          storage, so keep local exports of work that matters to you.
        </p>
      </LegalSection>

      <LegalSection number={9} title="No warranties">
        <p>
          To the extent permitted by law, Leið is provided “as is” and “as available,” without
          warranties that it will be error-free, continuously available, fit for a particular
          purpose, or that generated output will meet your expectations. Nothing here excludes
          warranties or consumer rights that cannot lawfully be excluded.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Liability">
        <p>
          To the extent permitted by law, the operator is not liable for indirect or consequential
          loss, lost data, lost profit, missed transport, or loss caused by third-party services,
          feeds, or user material. Nothing in these terms limits liability that cannot legally be
          limited, including liability for intentional conduct or other mandatory consumer-law
          protections.
        </p>
      </LegalSection>

      <LegalSection number={11} title="Ending use and account deletion">
        <p>
          You may stop using Leið at any time. To request account deletion, email{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a> from
          the account address. We may terminate or restrict an account for a material or repeated
          breach, security risk, or legal requirement, giving notice where reasonably possible.
          Provisions that logically continue—such as ownership, disclaimers, and liability
          limits—survive termination.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Law, disputes, and updates">
        <p>
          These terms are governed by the laws of {LEGAL_DETAILS.governingLaw}. Courts in Hungary
          have jurisdiction, except where mandatory consumer law gives you the right to bring a
          claim elsewhere. Please contact{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a> first
          so we can try to resolve a concern informally.
        </p>
        <p>
          We may update these terms for product, provider, security, or legal changes. Material
          changes will be announced in the service or by email where appropriate. Continuing to
          use Leið after revised terms take effect means you accept them; if you do not, stop using
          the service and request account deletion.
        </p>
      </LegalSection>
    </LegalShell>
  )
}

