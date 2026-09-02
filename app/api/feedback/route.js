// Feedback / bug-report intake. Open to signed-out visitors, so this is the one
// route in the app that has to defend itself: honeypot → Turnstile → validation
// → per-IP rate limit, in that order, before anything touches the database.
//
// The row is written first and the two emails are best-effort after it. A
// Resend outage must not make someone retype a bug report they already sent.

import { randomUUID, createHash } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth.js'
import { db } from '@/lib/db/index.js'
import { feedback } from '@/lib/db/schema.js'
import { sendEmail } from '@/lib/email.js'
import { LEGAL_DETAILS } from '@/lib/legal.js'
import { verifyTurnstile, clientIp } from '@/lib/turnstile.js'
import {
  normalizeFeedback,
  formatFeedbackEmail,
  formatFeedbackAutoReply,
  TURNSTILE_ACTION,
} from '@/lib/feedback.js'

const RATE_LIMIT = 5          // reports per IP…
const RATE_WINDOW_MS = 3600e3 // …per hour

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Salted so the stored value is not reversible to an address by anyone holding
// the table. BETTER_AUTH_SECRET is already required for the app to boot.
function hashIp(ip) {
  if (!ip) return null
  return createHash('sha256').update(`${ip}:${process.env.BETTER_AUTH_SECRET || ''}`).digest('hex')
}

async function recentCount(ipHash) {
  if (!ipHash) return 0
  const since = new Date(Date.now() - RATE_WINDOW_MS)
  const [row] = await db
    .select({ n: sql`count(*)::int` })
    .from(feedback)
    .where(and(eq(feedback.ipHash, ipHash), gt(feedback.createdAt, since)))
  return row?.n ?? 0
}

export async function POST(req) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid payload' }, { status: 400, headers: NO_STORE })
  }

  // Bots fill every field they find. Accept and discard — telling them they
  // were caught just teaches them to skip it next time.
  if (typeof body.website === 'string' && body.website.trim()) {
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }

  const ip = clientIp(req.headers)
  const captcha = await verifyTurnstile(body.captchaToken, ip, { action: TURNSTILE_ACTION })
  if (!captcha.ok) {
    return Response.json(
      { error: 'captcha check failed — please try again' },
      { status: 400, headers: NO_STORE },
    )
  }

  const parsed = normalizeFeedback(body)
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400, headers: NO_STORE })
  }
  const value = parsed.value

  const ipHash = hashIp(ip)
  try {
    if (await recentCount(ipHash) >= RATE_LIMIT) {
      return Response.json(
        { error: 'too many reports from here — please try again later' },
        { status: 429, headers: NO_STORE },
      )
    }
  } catch (err) {
    // A failed rate-limit read must not block a legitimate report.
    console.error('[feedback] rate-limit check failed', err)
  }

  // Signed-in is a nice-to-have for triage, never a gate.
  const session = await auth.api.getSession({ headers: req.headers }).catch(() => null)
  const userId = session?.user?.id ?? null

  const id = randomUUID()
  try {
    await db.insert(feedback).values({
      id,
      userId,
      kind: value.kind,
      email: value.email,
      message: value.message,
      context: value.context,
      ipHash,
    })
  } catch (err) {
    console.error('[feedback] insert failed', err)
    return Response.json({ error: 'could not save your report' }, { status: 500, headers: NO_STORE })
  }

  const to = process.env.FEEDBACK_TO || LEGAL_DETAILS.contactEmail
  const serviceName = LEGAL_DETAILS.serviceName

  try {
    const mail = formatFeedbackEmail(value, { serviceName, userId })
    // reply_to means hitting Reply in the inbox answers the submitter directly.
    await sendEmail({ to, subject: mail.subject, text: mail.text, replyTo: value.email })
  } catch (err) {
    console.error('[feedback] operator email failed', err)
  }

  try {
    const reply = formatFeedbackAutoReply(value, { serviceName })
    await sendEmail({ to: value.email, subject: reply.subject, text: reply.text })
  } catch (err) {
    console.error('[feedback] auto-reply failed', err)
  }

  return Response.json({ ok: true, id }, { status: 201, headers: NO_STORE })
}
