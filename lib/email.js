// Minimal email sender. Uses Resend when RESEND_API_KEY is set; otherwise logs
// to the console so magic-link / verification flows work in local dev without
// any provider account.

const FROM = process.env.EMAIL_FROM || 'Transit DAW <onboarding@resend.dev>'

export async function sendEmail({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.log('\n[email:dev] (no RESEND_API_KEY — logging instead of sending)')
    console.log(`  to:      ${to}`)
    if (replyTo) console.log(`  replyTo: ${replyTo}`)
    console.log(`  subject: ${subject}`)
    console.log(`  body:    ${text ?? html}\n`)
    return { dev: true }
  }

  // `reply_to` is only added when asked for, so the magic-link caller in
  // lib/auth.js keeps sending the exact payload it always did.
  const payload = { from: FROM, to, subject, text, html }
  if (replyTo) payload.reply_to = replyTo

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Resend ${res.status}: ${detail}`)
  }
  return res.json()
}
