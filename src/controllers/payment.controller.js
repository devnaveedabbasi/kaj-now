import mongoose from 'mongoose';
import Payment from '../models/payment.model.js';
import Job from '../models/job.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import Provider from '../models/provider/Provider.model.js';
import Service from '../models/admin/service.model.js';
import BookingIntent from '../models/bookingIntent.model.js';
import { validateSSLCommerzPayment } from '../service/sslcommerz.js';
import { retrieveStripePaymentIntent } from '../service/stripe.js';
import { createNotification } from '../utils/notification.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND_URL — where to redirect after payment callbacks
// For Postman/no-frontend testing: points to backend result routes
// For production app: set FRONTEND_URL=kajnow:// (deep link) in .env
// ─────────────────────────────────────────────────────────────────────────────
const BASE = process.env.APP_BASE_URL;
console.log(BASE, process.env.APP_BASE_URL, 'BASE_URL for SSLCommerz callbacks');

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPER — Create Job + Payment from a BookingIntent
// Used by both paymentSuccess and paymentIPN (idempotent)
// Returns { job, payment } or throws on error
// ─────────────────────────────────────────────────────────────────────────────
async function createJobFromIntent(intent, tran_id, session) {
  // Guard: schedule conflict check — same ±1 hour window as bookJob pre-check
  // If this fires it means a job was created between booking initiation and
  // payment confirmation (race condition / retry scenario).
  const CONFLICT_WINDOW_MS = 60 * 60 * 1000;
  const intentScheduleDate = new Date(intent.schedule.date);

  const dupJob = await Job.findOne({
    customer: intent.userId,
    service: intent.serviceId,
    provider: intent.providerId,
    status: { $in: ['pending', 'accepted', 'in_progress'] },
    'schedule.date': {
      $gte: new Date(intentScheduleDate.getTime() - CONFLICT_WINDOW_MS),
      $lte: new Date(intentScheduleDate.getTime() + CONFLICT_WINDOW_MS),
    },
  }).session(session);

  if (dupJob) {
    // Delete intent immediately — no retry needed
    await BookingIntent.deleteOne({ _id: intent._id }).session(session);
    throw new Error('DUPLICATE_BOOKING');
  }


  // Create Job
  const [job] = await Job.create(
    [
      {
        orderId: intent.orderId,
        provider: intent.providerId,
        customer: intent.userId,
        service: intent.serviceId,
        amount: intent.servicePrice,
        status: 'pending',
        paymentStatus: 'held_in_escrow',
        paymentMethod: intent.paymentMethod,
        schedule: intent.schedule,
      },
    ],
    { session }
  );

  // Create Payment record
  const [payment] = await Payment.create(
    [
      {
        jobId: job._id,
        customerId: intent.userId,
        providerId: intent.providerId,
        servicePrice: intent.servicePrice,
        platformFee: intent.platformFee,
        totalAmount: intent.servicePrice,
        providerAmount: intent.providerAmount,
        paymentMethod: intent.paymentMethod,
        paymentGateway: 'sslcommerz',
        paymentStatus: 'completed',
        escrowStatus: 'held_in_admin_wallet',
        sslCommerzTransactionId: tran_id,
        sslCommerzValidation: true,
      },
    ],
    { session }
  );

  // Escrow funds into admin wallet
  const adminUser = await User.findOne({ role: 'admin' }).session(session);
  if (adminUser) {
    let adminWallet = await Wallet.findOne({
      userId: adminUser._id,
      role: 'admin',
    }).session(session);

    if (!adminWallet) {
      [adminWallet] = await Wallet.create(
        [
          {
            userId: adminUser._id,
            role: 'admin',
            balance: 0,
            totalEarnings: 0,
            totalPlatformFees: 0,
            totalHeld: 0,
            isActive: true,
            transactionHistory: [],
          },
        ],
        { session }
      );
    }

    adminWallet.balance += intent.servicePrice;
    adminWallet.totalEarnings += intent.platformFee;
    adminWallet.totalPlatformFees += intent.platformFee;
    adminWallet.totalHeld = (adminWallet.totalHeld || 0) + intent.servicePrice;
    adminWallet.transactionHistory.push(payment._id);
    await adminWallet.save({ session });
  }

  // Mark intent as completed
  intent.status = 'completed';
  await intent.save({ session });

  return { job, payment };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCCESS CALLBACK — SSLCommerz POSTs here after successful payment
// Handles: bKash, Nagad, Rocket, Internet Banking (bank), Card (3DS)
// ─────────────────────────────────────────────────────────────────────────────
export async function paymentSuccess(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Merge query + body (SSLCommerz can POST or GET)
    const callbackData = { ...req.query, ...req.body };
    const { tran_id, val_id, status: callbackStatus } = callbackData;
    const isSandbox = process.env.SSL_COMMERZ_IS_SANDBOX === 'true';

    if (!tran_id || !val_id) {
      await session.abortTransaction();
      return res.redirect(
        `${BASE}/api/payment-result/failed?error=missing_params`
      );
    }

    // ── Step 1: Validate with SSLCommerz ─────────────────────────────
    // The callback body already contains status='VALID' from SSLCommerz.
    // We also call the validation API for extra security.
    // In sandbox, the validation API often returns 500 — we fall back
    // to trusting the signed callback status in that case.
    let isValidPayment = false;

    try {
      const validation = await validateSSLCommerzPayment(val_id);
      isValidPayment = validation?.status === 'VALID';
      if (!isValidPayment) {
        console.warn(`[paymentSuccess] Validation API rejected: ${JSON.stringify(validation)}`);
      }
    } catch (validationErr) {
      // SSLCommerz sandbox validation API returns 500 frequently.
      // Fall back: trust the signed status from the callback body.
      if (isSandbox && callbackStatus === 'VALID') {
        console.warn(
          `[paymentSuccess] Validation API failed (sandbox 500). ` +
          `Trusting callback status=VALID for tran_id=${tran_id}`
        );
        isValidPayment = true;
      } else {
        // Production: never skip validation on API failure
        console.error(`[paymentSuccess] Validation API failed:`, validationErr.message);
        isValidPayment = false;
      }
    }

    if (!isValidPayment) {
      await session.abortTransaction();
      return res.redirect(
        `${BASE}/api/payment-result/failed?error=invalid_payment&transaction=${tran_id}`
      );
    }

    // ── Step 2: Idempotency — check if already processed ─────────────
    const existingPayment = await Payment.findOne({
      sslCommerzTransactionId: tran_id,
    }).session(session);

    if (existingPayment && existingPayment.paymentStatus === 'completed') {
      await session.abortTransaction();
      return res.redirect(
        `${BASE}/api/payment-result/success?job=${existingPayment.jobId}&method=${existingPayment.paymentMethod}`
      );
    }

    // ── Step 3: Find BookingIntent ────────────────────────────────────
    const intent = await BookingIntent.findOne({ tranId: tran_id }).session(session);

    if (!intent) {
      await session.abortTransaction();
      console.warn(`[paymentSuccess] No BookingIntent found for tranId: ${tran_id}`);
      return res.redirect(
        `${BASE}/api/payment-result/failed?error=session_expired&transaction=${tran_id}`
      );
    }

    // Already completed (race condition safeguard)
    if (intent.status === 'completed') {
      await session.abortTransaction();
      const completedPayment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
      return res.redirect(
        `${BASE}/api/payment-result/success?job=${completedPayment?.jobId || ''}&method=${intent.paymentMethod}`
      );
    }

    // ── Enforce Correct Payment Method ───────────────────────────────
    // Security check: ensure the user actually paid with the method they selected
    const intentMethod = intent.paymentMethod.toLowerCase();
    const paidMethodStr = (callbackData.card_type || callbackData.card_issuer || callbackData.card_brand || '').toLowerCase();

    // MFS methods must strictly match their intended gateway
    let isMethodValid = true;
    if (intentMethod === 'bkash' && !paidMethodStr.includes('bkash')) isMethodValid = false;
    if (intentMethod === 'nagad' && !paidMethodStr.includes('nagad')) isMethodValid = false;
    // Rocket often returns as DBBL or Dutch Bangla Mobile Banking
    if (intentMethod === 'rocket' && !(paidMethodStr.includes('rocket') || paidMethodStr.includes('dbbl') || paidMethodStr.includes('dutch') || paidMethodStr.includes('mobilebanking'))) {
      isMethodValid = false;
    }

    if (!isMethodValid) {
      await session.abortTransaction();
      console.error(`[paymentSuccess] Payment method mismatch! Expected: ${intentMethod}, Paid with: ${paidMethodStr}`);
      
      // Mark intent as failed so the user has to book again correctly
      intent.status = 'failed';
      await BookingIntent.updateOne({ _id: intent._id }, { status: 'failed' });

      return res.redirect(
        `${BASE}/api/payment-result/failed?error=payment_method_mismatch&transaction=${tran_id}`
      );
    }

    // ── Step 4: Create Job + Payment from intent ──────────────────────
    let job, payment;
    try {
      ({ job, payment } = await createJobFromIntent(intent, tran_id, session));
    } catch (err) {
      if (err.message === 'DUPLICATE_BOOKING') {
        await session.commitTransaction();
        return res.redirect(
          `${BASE}/api/payment-result/failed?error=duplicate_booking&transaction=${tran_id}`
        );
      }
      throw err;
    }

    await session.commitTransaction();

    // ── Step 5: Notifications (outside transaction) ───────────────────
    try {
      const service = await Service.findById(intent.serviceId);
      const provider = await Provider.findById(intent.providerId);
      const methodName = intent.paymentMethod.toUpperCase();

      await createNotification({
        userId: intent.userId,
        title: 'Payment Successful & Booking Confirmed',
        message: `Your ${methodName} payment for "${service?.name}" (Order #${intent.orderId}) is confirmed. Your booking is now active.`,
        type: 'payment',
        referenceId: job._id,
        metadata: { orderId: intent.orderId, jobId: job._id, method: intent.paymentMethod },
      });

      if (provider?.userId) {
        await createNotification({
          userId: provider.userId,
          title: 'New Job Confirmed',
          message: `New job for "${service?.name}" (Order #${intent.orderId}) confirmed. Payment received.`,
          type: 'job',
          referenceId: job._id,
          metadata: { orderId: intent.orderId, jobId: job._id },
        });
      }
    } catch (notifErr) {
      console.error('[paymentSuccess] Notification error (non-fatal):', notifErr.message);
    }

    return res.redirect(
      `${BASE}/api/payment-result/success?job=${job._id}&method=${intent.paymentMethod}`
    );
  } catch (error) {
    await session.abortTransaction();
    console.error('[paymentSuccess] Error:', error);
    return res.redirect(`${BASE}/api/payment-result/error`);
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FAILED CALLBACK — SSLCommerz POSTs here on payment failure
// CRITICAL: NO Job or Payment created here
// BookingIntent is DELETED immediately so user can retry
// ─────────────────────────────────────────────────────────────────────────────
export async function paymentFailed(req, res) {
  try {
    const { tran_id } = { ...req.query, ...req.body };

    if (tran_id) {
      // Delete BookingIntent immediately so user can book again
      const deleted = await BookingIntent.deleteOne({ tranId: tran_id });
      if (deleted.deletedCount > 0) {
        console.log(`[paymentFailed] Deleted BookingIntent: ${tran_id}`);
      }
    }

    return res.redirect(
      `${BASE}/api/payment-result/failed?error=payment_declined&transaction=${tran_id || ''}`
    );
  } catch (error) {
    console.error('[paymentFailed] Error:', error);
    return res.redirect(`${BASE}/api/payment-result/error`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL CALLBACK — User cancelled on SSLCommerz hosted page
// CRITICAL: NO Job or Payment created here
// BookingIntent is DELETED immediately so user can retry
// ─────────────────────────────────────────────────────────────────────────────
export async function paymentCancel(req, res) {
  try {
    const { tran_id } = { ...req.query, ...req.body };

    if (tran_id) {
      // Delete BookingIntent immediately so user can book again
      const deleted = await BookingIntent.deleteOne({ tranId: tran_id });
      if (deleted.deletedCount > 0) {
        console.log(`[paymentCancel] Deleted BookingIntent: ${tran_id}`);
      }
    }

    return res.redirect(
      `${BASE}/api/payment-result/cancelled?transaction=${tran_id || ''}`
    );
  } catch (error) {
    console.error('[paymentCancel] Error:', error);
    return res.redirect(`${BASE}/api/payment-result/error`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPN (Instant Payment Notification) — Server-to-server backup
// Fires when the redirect callback may have been missed
// Fully idempotent — safe to receive multiple times
// ─────────────────────────────────────────────────────────────────────────────
export async function paymentIPN(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tran_id, val_id, status } = req.body;

    // SSLCommerz sends IPN for failed payments too — filter them out
    if ((status !== 'VALID' && status !== 'VALIDATED') || !tran_id || !val_id) {
      await session.abortTransaction();
      return res.status(200).json({ received: true });
    }

    // ── Idempotency: already processed? ──────────────────────────────
    const existingPayment = await Payment.findOne({
      sslCommerzTransactionId: tran_id,
    }).session(session);

    if (existingPayment && existingPayment.paymentStatus === 'completed') {
      await session.abortTransaction();
      console.log(`[IPN] Already processed: ${tran_id}`);
      return res.status(200).json({ received: true });
    }

    // ── Find BookingIntent ────────────────────────────────────────────
    const intent = await BookingIntent.findOne({ tranId: tran_id }).session(session);

    if (!intent || intent.status === 'completed') {
      await session.abortTransaction();
      return res.status(200).json({ received: true });
    }

    // ── Enforce Correct Payment Method ───────────────────────────────
    const intentMethod = intent.paymentMethod.toLowerCase();
    const paidMethodStr = (req.body.card_type || req.body.card_issuer || req.body.card_brand || '').toLowerCase();

    let isMethodValid = true;
    if (intentMethod === 'bkash' && !paidMethodStr.includes('bkash')) isMethodValid = false;
    if (intentMethod === 'nagad' && !paidMethodStr.includes('nagad')) isMethodValid = false;
    if (intentMethod === 'rocket' && !(paidMethodStr.includes('rocket') || paidMethodStr.includes('dbbl') || paidMethodStr.includes('dutch') || paidMethodStr.includes('mobilebanking'))) {
      isMethodValid = false;
    }

    if (!isMethodValid) {
      await session.abortTransaction();
      console.error(`[IPN] Payment method mismatch! Expected: ${intentMethod}, Paid with: ${paidMethodStr}`);
      return res.status(200).json({ received: true });
    }

    // ── Validate with SSLCommerz ──────────────────────────────────────
    const validation = await validateSSLCommerzPayment(val_id);
    if (!validation || validation.status !== 'VALID') {
      await session.abortTransaction();
      return res.status(200).json({ received: true });
    }

    // ── Create Job + Payment (same logic as success callback) ─────────
    try {
      await createJobFromIntent(intent, tran_id, session);
    } catch (err) {
      if (err.message === 'DUPLICATE_BOOKING') {
        await session.commitTransaction();
        return res.status(200).json({ received: true });
      }
      throw err;
    }

    await session.commitTransaction();
    console.log(`[IPN] Payment confirmed via IPN: ${tran_id}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    await session.abortTransaction();
    console.error('[IPN] Error:', error);
    // Always return 200 to SSLCommerz — they retry on non-200
    return res.status(200).json({ received: true });
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE SYNCHRONOUS VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────
export async function verifyStripePayment(req, res) {
  const { paymentIntentId } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json(new ApiResponse(400, null, 'paymentIntentId is required.'));
  }

  let paymentIntent;
  try {
    paymentIntent = await retrieveStripePaymentIntent(paymentIntentId);
  } catch (err) {
    console.error(`[verifyStripePayment] Fetch Error: ${err.message}`);
    return res.status(400).json(new ApiResponse(400, null, `Stripe Error: ${err.message}`));
  }

  if (paymentIntent.status !== 'succeeded') {
    return res.status(400).json(
      new ApiResponse(400, { status: paymentIntent.status }, 'Payment has not succeeded yet.')
    );
  }

  const { tranId } = paymentIntent.metadata || {};

  if (!tranId) {
    console.warn('[verifyStripePayment] No tranId in metadata for PaymentIntent:', paymentIntent.id);
    return res.status(400).json(new ApiResponse(400, null, 'Invalid PaymentIntent metadata.'));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const intent = await BookingIntent.findOne({ tranId }).session(session);

    if (!intent) {
      console.warn(`[verifyStripePayment] No BookingIntent found for tranId: ${tranId}`);
      await session.abortTransaction();
      return res.status(400).json(
        new ApiResponse(400, null, 'BookingIntent not found or already processed.')
      );
    }

    if (intent.status === 'completed') {
      console.log(`[verifyStripePayment] BookingIntent already completed: ${tranId}`);
      await session.abortTransaction();
      return res.status(200).json(new ApiResponse(200, null, 'Payment already verified.'));
    }

    const { job, payment } = await createJobFromIntent(intent, tranId, session);
    
    // Update stripe specific fields on the payment
    payment.paymentGateway = 'stripe';
    payment.stripePaymentIntentId = paymentIntent.id;
    payment.currency = (paymentIntent.currency || 'gbp').toUpperCase();
    await payment.save({ session });

    await session.commitTransaction();

    // Notifications after successful commit
    try {
      await createNotification({
        userId: job.customer,
        title: 'Booking Confirmed (Stripe)',
        message: `Your payment was successful and job #${job.orderId} is confirmed.`,
        type: 'JOB_UPDATE',
        data: { jobId: job._id },
      });

      const provider = await Provider.findById(job.provider);
      if (provider) {
        await createNotification({
          userId: provider.userId,
          title: 'New Job Booking (Stripe)',
          message: `A new job #${job.orderId} has been assigned to you.`,
          type: 'NEW_JOB',
          data: { jobId: job._id },
        });
      }
    } catch (notifErr) {
      console.error('[verifyStripePayment] Notification error:', notifErr);
    }

    console.log(`[verifyStripePayment] Successfully processed Stripe payment: ${tranId}`);
    return res.status(200).json(
      new ApiResponse(200, { job, payment }, 'Payment verified successfully and job created.')
    );
  } catch (error) {
    await session.abortTransaction();
    console.error('[verifyStripePayment] Processing error:', error);
    if (error.message === 'DUPLICATE_BOOKING') {
      return res.status(200).json(new ApiResponse(200, null, 'Duplicate booking avoided.'));
    }
    return res.status(500).json(new ApiResponse(500, null, 'Internal Server Error'));
  } finally {
    session.endSession();
  }
}