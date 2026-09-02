import { LegalSection, LegalShell } from '@/components/legal/LegalShell.jsx'
import FeedbackForm from '@/components/FeedbackForm.jsx'
import { LEGAL_DETAILS } from '@/lib/legal.js'

export const metadata = {
  title: 'Feedback & Bug Reports',
  description: 'Report a bug or send feedback about Leið — the transit-driven web DAW.',
  alternates: { canonical: '/feedback' },
}

export default function FeedbackPage() {
  return (
    <LegalShell
      current="/feedback"
      kicker="Support"
      title="Feedback & bug reports"
      summary="Something broken, something missing, or something you want? Tell us here — it reaches a person, and you get a copy by email."
    >
      <LegalSection number={1} title="Send us a report">
        <FeedbackForm />
      </LegalSection>

      <LegalSection number={2} title="What happens next">
        <p>
          Every report is stored and emailed to us, and you get an immediate copy of what you
          sent. There is no ticket queue and no bot in between — a person reads it. If we need
          more detail to reproduce a bug, we reply to the address you gave.
        </p>
        <p>
          We keep the message, your email address, and the diagnostics listed above the send
          button so we can answer you and fix what you found. See the{' '}
          <a href="/privacy">privacy notice</a> for how long that is kept and who processes it.
          You can also just write to{' '}
          <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a>.
        </p>
        <p>
          Bug reports travel much further with three things: what you did, what you expected,
          and what happened instead. If it is about sound, the city and line names help — the
          audio engine behaves differently per line type.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
