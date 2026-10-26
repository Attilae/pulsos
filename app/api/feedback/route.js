// Feedback / bug-report intake. Open to signed-out visitors, so this is the one
// route in the app that has to defend itself: honeypot → Turnstile → validation
// → admission (per-IP and global budgets), in that order, before the report is
// stored. Admission is an atomic counter (lib/server/rateCounter.js), so parallel
// requests can't all pass together, and it fails closed: if it can't be checked,
// nothing is stored or mailed.
//
// The row is written first and the two emails are best-effort after it. A
// Resend outage must not make someone retype a bug report they already sent.
// The auto-reply goes to an unverified address, so it has its own per-recipient
// and global budgets and never quotes the submission.

import { randomUUID, createHash } from 'node:crypto'
import { auth } from '@/lib/auth.js'
import { db } from '@/lib/db/index.js'
import { feedback } from '@/lib/db/schema.js'
import { sendEmail } from '@/lib/email.js'
import { LEGAL_DETAILS } from '@/lib/legal.js'
import { verifyTurnstile, clientIp } from '@/lib/turnstile.js'
import { consumeBudget } from '@/lib/server/rateCounter.js'
import { DAY_MS, HOUR_MS } from '@/lib/rateWindow.js'
import {
  FEEDBACK_MAX_BODY_BYTES,
  normalizeFeedback,
  formatFeedbackEmail,
  formatFeedbackAutoReply,
  TURNSTILE_ACTION,
} from '@/lib/feedback.js'

const RATE_LIMIT = 5 // reports per IP per hour
const GLOBAL_DAILY_LIMIT = Number(process.env.FEEDBACK_DAILY_LIMIT) || 200
const REPLIES_PER_RECIPIENT = 2 // auto-replies per address per day
const GLOBAL_DAILY_REPLIES = Number(process.env.FEEDBACK_DAILY_REPLY_LIMIT) || 100

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Salted so the stored value is not reversible to an address by anyone holding
// the table. BETTER_AUTH_SECRET is already required for the app to boot.
function hashIp(ip) {
  if (!ip) return null
  return createHash('sha256').update(`${ip}:${process.env.BETTER_AUTH_SECRET || ''}`).digest('hex')
}

function hashEmail(email) {
  return createHash('sha256').update(`${email.toLowerCase()}:${process.env.BETTER_AUTH_SECRET || ''}`).digest('hex')
}

// Per-IP first, then global, so one noisy address can't burn the global budget
// once it is over its own. Requests with no resolvable IP share one bucket.
async function admit(ipHash) {
  const own = await consumeBudget(`feedback:ip:${ipHash ?? 'unknown'}`, { limit: RATE_LIMIT, windowMs: HOUR_MS })
  if (!own.allowed) return false
  const global = await consumeBudget('feedback:global', { limit: GLOBAL_DAILY_LIMIT, windowMs: DAY_MS })
  return global.allowed
}

async function mayAutoReply(email) {
  const own = await consumeBudget(`feedback_reply:${hashEmail(email)}`, { limit: REPLIES_PER_RECIPIENT, windowMs: DAY_MS })
  if (!own.allowed) return false
  const global = await consumeBudget('feedback_reply:global', { limit: GLOBAL_DAILY_REPLIES, windowMs: DAY_MS })
  return global.allowed
}

export async function POST(req) {
  const raw = await req.text().catch(() => '')
  if (Buffer.byteLength(raw) > FEEDBACK_MAX_BODY_BYTES) {
    return Response.json({ error: 'report too large' }, { status: 413, headers: NO_STORE })
  }
  let body = null
  try { body = JSON.parse(raw) } catch {}
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
  let admitted
  try {
    admitted = await admit(ipHash)
  } catch (err) {
    console.error('[feedback] admission check failed', err)
    return Response.json(
      { error: 'could not accept reports right now — please try again later' },
      { status: 503, headers: NO_STORE },
    )
  }
  if (!admitted) {
    return Response.json(
      { error: 'too many reports right now — please try again later' },
      { status: 429, headers: NO_STORE },
    )
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
    if (await mayAutoReply(value.email)) {
      const reply = formatFeedbackAutoReply(value, { serviceName })
      await sendEmail({ to: value.email, subject: reply.subject, text: reply.text })
    }
  } catch (err) {
    console.error('[feedback] auto-reply failed', err)
  }

  return Response.json({ ok: true, id }, { status: 201, headers: NO_STORE })
}
