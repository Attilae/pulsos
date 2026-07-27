import Link from 'next/link'
import { LegalSection, LegalShell } from '@/components/legal/LegalShell.jsx'

export const metadata = {
  title: 'Legal',
  description: 'Privacy, terms, and licences for Leið, the public-transport sonification instrument.',
  alternates: { canonical: '/legal' },
}

export default function LegalPage() {
  return (
    <LegalShell
      current="/legal"
      kicker="Legal desk / route 00"
      title="Clear rules. No fine print tricks."
      summary="The short route into how Leið handles your data, the rules for using the instrument, and the credits behind its sounds."
    >
      <LegalSection number={1} title="Choose a document">
        <p>
          The <Link href="/privacy">Privacy Notice</Link> explains what personal data Leið
          handles, why it is needed, who receives it, and the choices and rights available to you.
        </p>
        <p>
          The <Link href="/terms">Terms of Service</Link> explain the conditions for using the
          instrument, creating an account, publishing shared-song links, and using AI Composer.
        </p>
        <p>
          The <Link href="/licenses">Licences & credits</Link> identify third-party audio assets,
          map data, and transport data used by the instrument.
        </p>
      </LegalSection>
      <LegalSection number={2} title="A plain-language promise">
        <p>
          Leið does not use advertising trackers or behavioural profiling. Privacy-preserving
          analytics record page views and a limited set of product events so the instrument can
          be improved. Browser storage is used for essential sessions and to remember instrument
          preferences. Local audio uploads and exported files stay on your device unless you
          choose to put them somewhere else.
        </p>
      </LegalSection>
      <LegalSection number={3} title="Contact">
        <p>
          Questions, access requests, deletion requests, or concerns can be sent to{' '}
          <a href="mailto:hello@deettalabs.com">hello@deettalabs.com</a>.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
