const AppError = require('../utils/AppError')
const { getPrismaClient } = require('../config/prisma')
const {
  getPaymentMode,
  getStripeConfig,
  SESSION_LIFETIME_MINUTES,
  HOLD_GRACE_MINUTES,
  MAX_HOLD_MINUTES,
} = require('../config/payments')
const stripeGateway = require('./stripeGateway')
const { releaseExpiredReservations } = require('./reservationService')
const { insertBookingForReservation, priceToCents, centsToPrice } = require('./bookingService')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LIVE_STATUSES = ['creating', 'open']
// States that may still receive a verified payment. A payment is always recorded.
const PAYABLE_STATUSES = ['creating', 'open', 'expired', 'failed']
const SETTLED_STATUSES = ['fulfilled', 'needs_review']
const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 15000 }
const MINUTE_MS = 60 * 1000
// Stripe rejects sessions that live less than 30 minutes from the moment they are
// created, so a `creating` attempt is only resumed while enough lifetime remains. Two minutes of
// margin over Stripe's minimum absorbs clock differences between this server and Stripe.
const MIN_RESUMABLE_LIFETIME_MS = 32 * MINUTE_MS

// Test seam: lets tests force a failure after the booking exists but before the
// payment is recorded, to prove the whole fulfilment transaction rolls back.
const paymentHooks = { beforeRecordPayment: null }

function logPaymentIssue(event, details) {
  if (process.env.NODE_ENV === 'test') return
  // Identifiers only: never payload bodies, URLs, keys, or customer data.
  console.error(JSON.stringify({ event, ...details }))
}

function assertStripeMode() {
  if (getPaymentMode() !== 'stripe') throw new AppError('Not found.', 404)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE_MS)
}

function sumCents(items) {
  return items.reduce((sum, item) => sum + priceToCents(item.unit_price) * BigInt(item.quantity), 0n)
}

function serializePayment(attempt) {
  return {
    id: attempt.id,
    reservation_id: attempt.reservation_id,
    status: attempt.status,
    amount: attempt.amount.toFixed(2),
    currency: attempt.currency,
    review_reason: attempt.review_reason,
    booking_id: attempt.booking_id,
    // The hosted page is only useful while the session can still be paid.
    checkout_url: attempt.status === 'open' ? attempt.checkout_url : null,
    session_expires_at: attempt.session_expires_at.toISOString(),
  }
}

// Line descriptions are snapshotted on the attempt when it is created (name, unit amount,
// quantity), never re-read from live event or ticket rows. A retry therefore sends
// parameters identical to the original request even if an administrator renames the event.
function snapshotCheckoutItems(items) {
  return items.map((item) => ({
    name: `${item.ticket_types.events.title} - ${item.ticket_types.name}`.slice(0, 250),
    unit_amount: Number(priceToCents(item.unit_price)),
    quantity: item.quantity,
  }))
}

function buildSessionParams(attempt) {
  const { frontendOrigin } = getStripeConfig()
  const reservationPath = `/reservations/${attempt.reservation_id}`
  const metadata = { payment_attempt_id: attempt.id, reservation_id: attempt.reservation_id }

  // Amounts come only from saved reservation prices. Everything here is rebuilt
  // identically on a retry so Stripe's idempotency key replays the same session.
  return {
    mode: 'payment',
    // Card payments confirm immediately, so a customer cannot pay after the hold ends
    // through a delayed method such as a bank debit.
    allowed_payment_method_types: ['card'],
    line_items: attempt.checkout_items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: attempt.currency.toLowerCase(),
        unit_amount: item.unit_amount,
        product_data: { name: item.name },
      },
    })),
    client_reference_id: attempt.id,
    metadata,
    payment_intent_data: { metadata },
    expires_at: Math.floor(attempt.session_expires_at.getTime() / 1000),
    success_url: `${frontendOrigin}${reservationPath}/payment/return`,
    cancel_url: `${frontendOrigin}${reservationPath}/checkout?payment=cancelled`,
  }
}

// Transaction 1: validate under the reservation row lock, extend the hold, record
// a `creating` attempt. No Stripe call happens inside a database transaction.
async function prepareAttempt(prisma, userId, reservationId) {
  return prisma.$transaction(async (tx) => {
    const [reservation] = await tx.$queryRaw`
      SELECT id, status, created_at, expires_at
      FROM reservations
      WHERE id = ${reservationId}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE`
    if (!reservation) throw new AppError('Reservation not found.', 404)

    // The reservation row is locked, and payment recording locks the same row first, so
    // this check cannot interleave with a payment being recorded. Never offer a second
    // payment for a reservation that was already paid or whose payment is under review.
    const settledAttempt = await tx.payment_attempts.findFirst({
      where: { reservation_id: reservationId, status: { in: SETTLED_STATUSES } },
      select: { status: true },
    })
    if (settledAttempt?.status === 'needs_review') {
      throw new AppError('We have already received a payment for this reservation and it is under review. Please do not pay again.', 409)
    }
    if (settledAttempt) throw new AppError('This reservation has already been paid.', 409)

    // Holds are written and compared with application time everywhere else
    // (reserve, expiry, simulated checkout), so payment initiation does the same.
    // Only the event-start cutoff uses database time.
    const now = new Date()
    if (reservation.status !== 'pending' || reservation.expires_at.getTime() <= now.getTime()) {
      throw new AppError('This reservation is no longer available for payment.', 409)
    }

    const liveAttempt = await tx.payment_attempts.findFirst({
      where: { reservation_id: reservationId, status: { in: LIVE_STATUSES } },
    })
    if (liveAttempt) {
      const remainingMs = liveAttempt.session_expires_at.getTime() - now.getTime()
      if (liveAttempt.status === 'open') {
        if (remainingMs > 0) return { attempt: liveAttempt, created: false }
        // This server's clock says the session ended, but only Stripe knows whether it can still be
        // paid. The caller asks Stripe (outside any transaction) before this attempt is closed.
        return { attempt: liveAttempt, created: false, needsRemoteCheck: true }
      }
      if (remainingMs >= MIN_RESUMABLE_LIFETIME_MS) return { attempt: liveAttempt, created: false }
      // A `creating` attempt too old to finish creating. No URL was ever returned for it, so nobody
      // can pay it, and the same rule closes it when the customer cancels.
      await tx.payment_attempts.updateMany({
        where: { id: liveAttempt.id, status: { in: LIVE_STATUSES } },
        data: { status: 'expired', updated_at: now },
      })
    }

    const items = await tx.reservation_items.findMany({
      where: { reservation_id: reservationId },
      orderBy: { ticket_type_id: 'asc' },
      select: {
        quantity: true,
        unit_price: true,
        ticket_types: { select: { name: true, events: { select: { title: true, starts_at: true } } } },
      },
    })
    if (items.length === 0) throw new AppError('This reservation has no tickets to pay for.', 409)
    const totalCents = sumCents(items)

    await tx.$queryRaw`
      SELECT event.id FROM events AS event
      WHERE EXISTS (
        SELECT 1 FROM reservation_items AS item
        JOIN ticket_types AS ticket ON ticket.id = item.ticket_type_id
        WHERE item.reservation_id = ${reservationId}::uuid AND ticket.event_id = event.id
      )
      ORDER BY event.id
      FOR SHARE OF event`

    // The event must begin after the Stripe session would end, or a customer could pay after
    // the event started and only learn about it from a manual review. Both values are
    // application-time instants (starts_at was written by the application), so this
    // comparison does not depend on the database clock or its time zone. It also covers
    // events that already started. The authoritative write-time cutoff at fulfilment
    // still uses database time inside the booking insert.
    const sessionExpiresAt = addMinutes(now, SESSION_LIFETIME_MINUTES)
    const earliestStart = Math.min(...items.map((item) => item.ticket_types.events.starts_at.getTime()))
    if (earliestStart <= now.getTime()) {
      throw new AppError('This event has already started and is no longer available for payment.', 409)
    }
    if (earliestStart <= sessionExpiresAt.getTime()) {
      throw new AppError(`This event starts too soon for online payment. Payment must be completed at least ${SESSION_LIFETIME_MINUTES} minutes before the event begins.`, 409)
    }

    // The hold outlives the Stripe session by a grace period but never grows past
    // the cap, so repeated attempts cannot keep tickets off sale indefinitely.
    const holdUntil = addMinutes(now, SESSION_LIFETIME_MINUTES + HOLD_GRACE_MINUTES)
    if (holdUntil.getTime() > addMinutes(reservation.created_at, MAX_HOLD_MINUTES).getTime()) {
      throw new AppError('The payment window for this reservation has passed. Please make a new reservation.', 409)
    }
    // The reservation row is locked, so this read-compare-write cannot interleave.
    if (holdUntil.getTime() > reservation.expires_at.getTime()) {
      await tx.reservations.update({ where: { id: reservationId }, data: { expires_at: holdUntil } })
    }

    const attempt = await tx.payment_attempts.create({
      data: {
        reservation_id: reservationId,
        user_id: userId,
        amount: centsToPrice(totalCents),
        currency: 'PHP',
        status: 'creating',
        session_expires_at: sessionExpiresAt,
        checkout_items: snapshotCheckoutItems(items),
      },
    })
    return { attempt, created: true }
  }, TRANSACTION_OPTIONS)
}

async function failCreation(prisma, attempt, status, message, statusCode) {
  await prisma.payment_attempts.updateMany({
    where: { id: attempt.id, status: 'creating' },
    data: { status, updated_at: new Date() },
  })
  return new AppError(message, statusCode)
}

async function translateCreateError(prisma, attempt, error) {
  if (error?.type === 'StripeInvalidRequestError') {
    // Stripe refused the request, so no session exists; free the slot for a new attempt.
    return failCreation(prisma, attempt, 'failed', 'Stripe could not start this payment. Please try again.', 502)
  }
  // The installed SDK maps errors by HTTP status, so a 409 idempotency_key_in_use arrives as a
  // StripeAPIError with that code. Match on the code, not the class.
  if (error?.code === 'idempotency_key_in_use') {
    return new AppError('This payment is already being started. Please try again in a moment.', 409)
  }
  if (error?.type === 'StripeIdempotencyError') {
    // Stripe saw this key with different parameters, so a session may already exist and
    // there is no API to find it by key. Leave the attempt untouched: it is closed by the
    // normal stale-attempt or hold-expiry rules, and the customer never received a URL.
    logPaymentIssue('stripe_idempotency_mismatch', { payment_attempt_id: attempt.id })
    return new AppError('This payment could not be resumed right now. Please try again shortly or contact support.', 409)
  }
  // Network, rate-limit, or server trouble: the attempt stays `creating` and the
  // next request resumes it with the same idempotency key.
  return new AppError('The payment service is unavailable. Please try again.', 502)
}

// Transaction-free Stripe call. The attempt ID is the idempotency key, so a call
// whose response was lost is replayed by Stripe instead of creating a second session.
async function ensureCheckoutSession(prisma, attempt) {
  if (attempt.status !== 'creating') return attempt
  if (!Array.isArray(attempt.checkout_items) || attempt.checkout_items.length === 0) {
    throw new Error('The payment attempt has no saved checkout items.')
  }

  let session
  try {
    session = await stripeGateway.createCheckoutSession(buildSessionParams(attempt), attempt.id)
  } catch (error) {
    throw await translateCreateError(prisma, attempt, error)
  }
  if (!session?.id || !session.url) throw new AppError('Stripe did not return a Checkout Session.', 502)

  // Only one of several concurrent requests performs this transition.
  await prisma.payment_attempts.updateMany({
    where: { id: attempt.id, status: 'creating' },
    data: {
      status: 'open',
      stripe_checkout_session_id: session.id,
      checkout_url: session.url,
      updated_at: new Date(),
    },
  })
  return prisma.payment_attempts.findUnique({ where: { id: attempt.id } })
}

// Reads the session's own status from Stripe. Anything other than a clear open/complete/expired
// answer (network, rate limit, auth, unknown ID, unexpected value) is reported as a retryable 502
// with the supplied message, and callers change nothing locally.
async function fetchRemoteSessionStatus(sessionId, unknownMessage) {
  let session
  try {
    session = await stripeGateway.retrieveCheckoutSession(sessionId)
  } catch {
    throw new AppError(unknownMessage, 502)
  }
  if (['open', 'complete', 'expired'].includes(session?.status)) return session.status
  throw new AppError(unknownMessage, 502)
}

const PREVIOUS_SESSION_UNKNOWN_MESSAGE = 'We could not confirm the state of your earlier payment session with Stripe. Please try again in a moment.'

// An `open` attempt whose time has run out locally. Returns 'still-open' when Stripe says the session
// can still be paid (the existing attempt is reused) and 'closed' once Stripe confirmed it is expired
// and the attempt was closed with a guarded update. A completed session is left to the webhook.
async function resolveElapsedOpenAttempt(prisma, userId, reservationId, attempt) {
  const status = await fetchRemoteSessionStatus(attempt.stripe_checkout_session_id, PREVIOUS_SESSION_UNKNOWN_MESSAGE)
  if (status === 'open') return 'still-open'
  if (status === 'complete') throw paymentInProgressError()
  const closed = await markAttemptExpired(prisma, userId, reservationId, attempt.id)
  if (closed.status !== 'expired') throw paymentInProgressError()
  return 'closed'
}

async function startPayment(userId, reservationId) {
  assertStripeMode()
  const prisma = await getPrismaClient()

  // Expiry cleanup is committed separately so a rejected request cannot roll it back.
  await releaseExpiredReservations()
  const prepared = await prepareAttempt(prisma, userId, reservationId)
  if (prepared.needsRemoteCheck) {
    if (await resolveElapsedOpenAttempt(prisma, userId, reservationId, prepared.attempt) === 'still-open') {
      return { payment: serializePayment(prepared.attempt), created: false }
    }
    // No replacement session is offered. An open session only runs out at least SESSION_LIFETIME_MINUTES
    // after the reservation was made, and a new one would need SESSION_LIFETIME_MINUTES + HOLD_GRACE_MINUTES
    // more hold, which always passes the MAX_HOLD_MINUTES cap (35 + 40 > 60). The paymentConfig unit test
    // fails if these values change so that a replacement could fit.
    throw new AppError('Your Stripe payment session has ended and the payment window for this reservation has passed. Please make a new reservation.', 409)
  }
  const current = await ensureCheckoutSession(prisma, prepared.attempt)
  return { payment: serializePayment(current), created: prepared.created }
}

// Asks Stripe to close an open session. Returns 'expired' only when Stripe confirms the session
// cannot be paid; returns 'complete' when payment already happened or is being processed.
// Anything uncertain (network, rate limit, auth, server error, unexpected state) throws a
// retryable 502 and the caller changes nothing locally.
async function expireRemoteSession(sessionId) {
  const unconfirmed = () => new AppError('We could not confirm with Stripe that the payment session was closed. It may still be payable until it expires. Please try again.', 502)

  try {
    const session = await stripeGateway.expireCheckoutSession(sessionId)
    if (session?.status === 'expired') return 'expired'
    throw unconfirmed()
  } catch (error) {
    if (error instanceof AppError) throw error
    // Stripe answers 400 invalid_request_error when the session is not open. Whether that means
    // "already expired" or "already completed" is read from the session itself, not the message text.
    if (error?.type !== 'StripeInvalidRequestError') throw unconfirmed()
    const status = await fetchRemoteSessionStatus(sessionId, unconfirmed().message)
    if (status === 'expired' || status === 'complete') return status
    throw unconfirmed()
  }
}

function paymentInProgressError() {
  return new AppError('Stripe reports that a payment for this reservation has already been completed or is being processed. Do not pay again; your booking will appear once the payment is confirmed.', 409)
}

// Transaction 1 of cancellation: read the live attempt under the reservation lock. Nothing is changed.
async function findLiveAttemptForCancel(prisma, userId, reservationId) {
  return prisma.$transaction(async (tx) => {
    const [reservation] = await tx.$queryRaw`
      SELECT id FROM reservations
      WHERE id = ${reservationId}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE`
    if (!reservation) throw new AppError('Reservation not found.', 404)
    return tx.payment_attempts.findFirst({
      where: { reservation_id: reservationId, status: { in: LIVE_STATUSES } },
    })
  }, TRANSACTION_OPTIONS)
}

// Transaction 2: only after Stripe confirmed the session is dead. Locks the reservation first, then
// moves the attempt with a guarded update; a recorded payment is never overwritten.
async function markAttemptExpired(prisma, userId, reservationId, attemptId) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM reservations
      WHERE id = ${reservationId}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE`
    await tx.payment_attempts.updateMany({
      where: { id: attemptId, status: { in: LIVE_STATUSES } },
      data: { status: 'expired', updated_at: new Date() },
    })
    return tx.payment_attempts.findUnique({ where: { id: attemptId } })
  }, TRANSACTION_OPTIONS)
}

// Lets a customer abandon an active Stripe session. Local state only claims the session is gone
// after Stripe has confirmed it. Repeating the request is safe.
async function cancelPayment(userId, reservationId) {
  assertStripeMode()
  const prisma = await getPrismaClient()
  await releaseExpiredReservations()

  let attempt = await findLiveAttemptForCancel(prisma, userId, reservationId)
  if (!attempt) {
    const { payment } = await getLatestPayment(userId, reservationId)
    return { outcome: 'no-live-payment', payment }
  }

  if (attempt.status === 'creating') {
    const remainingMs = attempt.session_expires_at.getTime() - Date.now()
    if (remainingMs < MIN_RESUMABLE_LIFETIME_MS) {
      // Too old to finish creating, and no URL was ever returned for it, so nobody can pay it.
      // This is the same rule payment initiation uses to replace a stale attempt.
      const closed = await markAttemptExpired(prisma, userId, reservationId, attempt.id)
      if (closed.status === 'expired') return { outcome: 'cancelled', payment: serializePayment(closed) }
      throw paymentInProgressError()
    }
    // A session may be created at any moment. Finish creating it with the same idempotency key (or
    // wait for the request that is creating it) so its ID is known, then expire it below. This takes
    // at most the remaining resume window, after which the stale rule above applies.
    try {
      attempt = await ensureCheckoutSession(prisma, attempt)
    } catch (error) {
      const current = await prisma.payment_attempts.findUnique({ where: { id: attempt.id } })
      // Stripe refused creation outright, so no session exists to cancel.
      if (current?.status === 'failed') return { outcome: 'cancelled', payment: serializePayment(current) }
      throw error
    }
  }

  if (attempt.status !== 'open' || !attempt.stripe_checkout_session_id) {
    // Another request or a webhook already moved this attempt on; report what is recorded.
    if (['fulfilled', 'needs_review'].includes(attempt.status)) throw paymentInProgressError()
    // Still being created by another request: its session is not known yet, so do not claim success.
    if (LIVE_STATUSES.includes(attempt.status)) {
      throw new AppError('This payment is still being started. Please try again in a moment.', 409)
    }
    const { payment } = await getLatestPayment(userId, reservationId)
    return { outcome: 'no-live-payment', payment }
  }

  const remote = await expireRemoteSession(attempt.stripe_checkout_session_id)
  // The payment, if any, is recorded by the webhook; this request never touches a paid attempt.
  if (remote === 'complete') throw paymentInProgressError()

  const closed = await markAttemptExpired(prisma, userId, reservationId, attempt.id)
  if (closed.status === 'expired') return { outcome: 'cancelled', payment: serializePayment(closed) }
  // A payment was recorded concurrently; keep it and tell the customer.
  throw paymentInProgressError()
}

async function getLatestPayment(userId, reservationId) {
  assertStripeMode()
  const prisma = await getPrismaClient()
  await releaseExpiredReservations()

  const reservation = await prisma.reservations.findFirst({
    where: { id: reservationId, user_id: userId },
    select: { id: true },
  })
  if (!reservation) return { found: false }

  // A recorded payment outranks newer attempts; otherwise the newest attempt wins.
  const attempt = (await prisma.payment_attempts.findFirst({
    where: { reservation_id: reservationId, status: { in: ['fulfilled', 'needs_review'] } },
    orderBy: { created_at: 'desc' },
  })) || (await prisma.payment_attempts.findFirst({
    where: { reservation_id: reservationId },
    orderBy: { created_at: 'desc' },
  }))
  return { found: true, payment: attempt ? serializePayment(attempt) : null }
}

async function findAttemptForSession(tx, session) {
  const conditions = [{ stripe_checkout_session_id: session.id }]
  if (typeof session.client_reference_id === 'string' && UUID_PATTERN.test(session.client_reference_id)) {
    conditions.push({ id: session.client_reference_id })
  }
  const attempt = await tx.payment_attempts.findFirst({ where: { OR: conditions } })
  // A different stored session means this event is not for the attempt's own session.
  if (attempt?.stripe_checkout_session_id && attempt.stripe_checkout_session_id !== session.id) return null
  return attempt
}

// Records a verified payment. Everything here is one transaction owned by the
// caller; any exception rolls back the booking, the attempt, and the dedup row.
// Lock order: reservation row, then attempt row, then events (inside the booking helper).
// Stripe sends whole numbers of the smallest currency unit. Anything else cannot be compared with the
// saved amount, so the payment is recorded for review instead of failing the webhook forever.
function parseAmountTotal(value) {
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
}

async function applyPaymentSuccess(tx, session) {
  const attempt = await findAttemptForSession(tx, session)
  if (!attempt) return { outcome: 'unmatched' }

  await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${attempt.reservation_id}::uuid FOR UPDATE`
  const [locked] = await tx.$queryRaw`SELECT status FROM payment_attempts WHERE id = ${attempt.id}::uuid FOR UPDATE`
  if (!PAYABLE_STATUSES.includes(locked.status)) return { outcome: 'ignored', attemptId: attempt.id }

  const items = await tx.reservation_items.findMany({
    where: { reservation_id: attempt.reservation_id },
    select: { quantity: true, unit_price: true },
  })
  const totalCents = sumCents(items)
  const attemptCents = priceToCents(attempt.amount)

  let reviewReason = null
  let bookingId = null
  const amountTotal = parseAmountTotal(session.amount_total)
  if (session.mode !== 'payment') {
    // Every Encore session is created in payment mode.
    reviewReason = 'unexpected_session'
  } else if (String(session.currency ?? '').toUpperCase() !== attempt.currency) {
    reviewReason = 'currency_mismatch'
  } else if (amountTotal === null || amountTotal !== attemptCents || totalCents !== attemptCents) {
    reviewReason = 'amount_mismatch'
  } else {
    // Same conditional claim as simulated checkout, judged at processing time.
    const now = new Date()
    const claimed = await tx.$queryRaw`
      UPDATE reservations SET status = 'confirmed'
      WHERE id = ${attempt.reservation_id}::uuid AND status = 'pending' AND expires_at > ${now}
      RETURNING id`
    if (claimed.length === 0) {
      const [current] = await tx.$queryRaw`SELECT status FROM reservations WHERE id = ${attempt.reservation_id}::uuid`
      if (current.status === 'confirmed') reviewReason = 'duplicate_payment'
      else if (current.status === 'cancelled') reviewReason = 'reservation_cancelled'
      else reviewReason = 'reservation_expired'
    } else {
      bookingId = await insertBookingForReservation(tx, {
        reservationId: attempt.reservation_id,
        userId: attempt.user_id,
        totalCents,
      })
      if (!bookingId) {
        // The event started: leave the hold exactly as it was and flag the payment.
        await tx.$executeRaw`
          UPDATE reservations SET status = 'pending'
          WHERE id = ${attempt.reservation_id}::uuid AND status = 'confirmed'`
        reviewReason = 'event_started'
      }
    }
  }

  if (paymentHooks.beforeRecordPayment) await paymentHooks.beforeRecordPayment({ bookingId, reviewReason })

  const status = bookingId ? 'fulfilled' : 'needs_review'
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null
  const recorded = await tx.$executeRaw`
    UPDATE payment_attempts
    SET status = ${status},
        booking_id = ${bookingId}::uuid,
        review_reason = ${reviewReason},
        paid_at = clock_timestamp(),
        stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ${session.id}),
        stripe_payment_intent_id = ${paymentIntentId},
        updated_at = clock_timestamp()
    WHERE id = ${attempt.id}::uuid AND status IN ('creating', 'open', 'expired', 'failed')`
  if (recorded !== 1) throw new Error('The payment attempt changed state while the payment was being recorded.')

  if (bookingId) {
    // A booked reservation cannot have another payable session.
    await tx.payment_attempts.updateMany({
      where: { reservation_id: attempt.reservation_id, id: { not: attempt.id }, status: { in: LIVE_STATUSES } },
      data: { status: 'expired', updated_at: new Date() },
    })
  } else {
    logPaymentIssue('payment_needs_review', { payment_attempt_id: attempt.id, reason: reviewReason })
  }
  return { outcome: bookingId ? 'processed' : 'needs_review', attemptId: attempt.id }
}

async function applyGuardedTransition(tx, session, toStatus, fromStatuses) {
  const attempt = await findAttemptForSession(tx, session)
  if (!attempt) return { outcome: 'unmatched' }
  const changed = await tx.payment_attempts.updateMany({
    where: { id: attempt.id, status: { in: fromStatuses } },
    data: { status: toStatus, updated_at: new Date() },
  })
  return { outcome: changed.count === 1 ? 'processed' : 'ignored', attemptId: attempt.id }
}

async function handleStripeEvent(tx, event) {
  const session = event.data?.object
  if (!session || typeof session !== 'object') return { outcome: 'ignored' }
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      // Only a session Stripe reports as paid is fulfilled. `unpaid` on completion means a delayed
      // payment method: wait for async_payment_succeeded, which must itself say `paid`.
      return session.payment_status === 'paid' ? applyPaymentSuccess(tx, session) : { outcome: 'ignored' }
    case 'checkout.session.async_payment_failed':
      // A failed delayed payment is final for its session; free the reservation to retry.
      return applyGuardedTransition(tx, session, 'failed', ['open'])
    case 'checkout.session.expired':
      return applyGuardedTransition(tx, session, 'expired', LIVE_STATUSES)
    default:
      return { outcome: 'ignored' }
  }
}

// One transaction per verified event. The dedup row commits only together with
// the result, so a failure leaves nothing behind and Stripe's retry runs again.
async function processStripeEvent(event) {
  const prisma = await getPrismaClient()
  return prisma.$transaction(async (tx) => {
    // A concurrent duplicate waits here for the first transaction to finish.
    const inserted = await tx.$executeRaw`
      INSERT INTO stripe_webhook_events (id, type, outcome, stripe_created_at)
      VALUES (${event.id}, ${event.type}, 'ignored', to_timestamp(${event.created}::double precision))
      ON CONFLICT (id) DO NOTHING`
    if (inserted === 0) return { duplicate: true, outcome: 'duplicate' }

    const result = await handleStripeEvent(tx, event)
    if (result.outcome === 'unmatched') {
      logPaymentIssue('stripe_event_unmatched', { stripe_event_id: event.id, type: event.type })
    }
    await tx.$executeRaw`
      UPDATE stripe_webhook_events
      SET outcome = ${result.outcome}, payment_attempt_id = ${result.attemptId ?? null}::uuid
      WHERE id = ${event.id}`
    return { duplicate: false, ...result }
  }, TRANSACTION_OPTIONS)
}

module.exports = {
  startPayment,
  cancelPayment,
  getLatestPayment,
  processStripeEvent,
  assertStripeMode,
  paymentHooks,
}
