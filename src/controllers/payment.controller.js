import mongoose from 'mongoose';
import Payment from '../models/payment.model.js';
import Job from '../models/job.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import { validateSSLCommerzPayment } from '../service/sslcommerz.js';
import { createNotification } from '../utils/notification.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEEP LINK HELPER
// Mobile app ka URL scheme .env mein set karo:
//   APP_SCHEME=myapp          → myapp://payment/success?jobId=xxx
// Agar nahi diya to fallback HTML page show hoga.
// ─────────────────────────────────────────────────────────────────────────────
function buildDeepLink(path, params = {}) {
  const scheme = process.env.APP_SCHEME; // e.g. "myapp"
  if (!scheme) return null;
  const query = new URLSearchParams(params).toString();
  return `${scheme}://${path}${query ? '?' + query : ''}`;
}

// HTML page jo mobile browser mein khulti hai aur app ko deep link se open karti hai
function sendMobileRedirectPage(res, { status, title, message, deepLink, params = {} }) {
  const scheme = process.env.APP_SCHEME;
  const fallbackDeepLink = scheme
    ? `${scheme}://payment/${status}?${new URLSearchParams(params).toString()}`
    : null;

  const targetLink = deepLink || fallbackDeepLink;

  // Auto-redirect HTML — app install hogi to khulegi, nahi to message dikhega
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: ${status === 'success' ? '#f0fdf4' : status === 'failed' ? '#fef2f2' : '#fffbeb'};
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 360px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon {
      font-size: 56px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #111;
      margin-bottom: 10px;
    }
    p {
      font-size: 15px;
      color: #555;
      line-height: 1.5;
      margin-bottom: 28px;
    }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      background: ${status === 'success' ? '#16a34a' : status === 'failed' ? '#dc2626' : '#d97706'};
      color: white;
      cursor: pointer;
      border: none;
      width: 100%;
    }
    .sub { font-size: 13px; color: #999; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${status === 'success' ? '✅' : status === 'failed' ? '❌' : '⚠️'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${targetLink
      ? `<a href="${targetLink}" class="btn">Return to App</a>
         <p class="sub">Tap the button if app does not open automatically.</p>`
      : `<p class="sub">You can close this window and return to the app.</p>`
    }
  </div>
  ${targetLink
    ? `<script>
        // Auto-open app after 800ms
        setTimeout(function() {
          window.location.href = "${targetLink}";
        }, 800);
      </script>`
    : ''
  }
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(status === 'success' ? 200 : 400).send(html);
}


// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPER: Payment escrow mein daalo + admin wallet update karo
// ─────────────────────────────────────────────────────────────────────────────
async function holdPaymentInEscrow(payment, session) {
  payment.paymentStatus = 'completed';
  payment.escrowStatus = 'held_in_admin_wallet';
  payment.sslCommerzValidation = true;
  await payment.save({ session });

  const job = await Job.findById(payment.jobId).session(session);
  if (job) {
    job.paymentStatus = 'held_in_escrow';
    await job.save({ session });
  }

  const adminUser = await User.findOne({ role: 'admin' }).session(session);
  if (adminUser) {
    let adminWallet = await Wallet.findOne({
      userId: adminUser._id,
      role: 'admin',
    }).session(session);

    if (!adminWallet) {
      [adminWallet] = await Wallet.create(
        [{
          userId: adminUser._id,
          role: 'admin',
          balance: 0,
          totalEarnings: 0,
          totalWithdrawn: 0,
          totalPlatformFees: 0,
          isActive: true,
        }],
        { session }
      );
    }

    adminWallet.balance += payment.totalAmount;
    adminWallet.totalEarnings += payment.platformFee;
    adminWallet.totalPlatformFees += payment.platformFee;
    adminWallet.totalHeld = (adminWallet.totalHeld || 0) + payment.totalAmount;
    adminWallet.transactionHistory.push(payment._id);
    await adminWallet.save({ session });
  }

  return job;
}


// ─────────────────────────────────────────────────────────────────────────────
// CARD CALLBACKS — unchanged, web redirect use karte hain
// ─────────────────────────────────────────────────────────────────────────────

export async function paymentSuccess(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { tran_id, val_id } = req.query;
    const validation = await validateSSLCommerzPayment(val_id);
    if (validation.status !== 'VALID') {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/failed?transaction=${tran_id}`);
    }
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id }).session(session);
    if (!payment) return res.redirect(`${process.env.FRONTEND_URL}/payment/not-found`);
    if (payment.paymentStatus === 'completed') {
      await session.abortTransaction();
      return res.redirect(`${process.env.FRONTEND_URL}/payment/success?job=${payment.jobId}`);
    }
    const job = await holdPaymentInEscrow(payment, session);
    await session.commitTransaction();
    return res.redirect(`${process.env.FRONTEND_URL}/payment/success?job=${job?._id ?? payment.jobId}`);
  } catch (error) {
    await session.abortTransaction();
    console.error('Card paymentSuccess error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  } finally {
    session.endSession();
  }
}

export async function paymentFailed(req, res) {
  try {
    const { tran_id } = req.query;
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
    if (payment && payment.paymentStatus !== 'failed') {
      payment.paymentStatus = 'failed';
      await payment.save();
      const job = await Job.findById(payment.jobId);
      if (job) { job.status = 'pending'; job.paymentStatus = 'pending'; await job.save(); }
    }
    return res.redirect(`${process.env.FRONTEND_URL}/payment/failed?transaction=${tran_id}`);
  } catch (error) {
    console.error('Card paymentFailed error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  }
}

export async function paymentCancel(req, res) {
  try {
    const { tran_id } = req.query;
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
    if (payment && payment.paymentStatus === 'pending') {
      payment.paymentStatus = 'failed';
      await payment.save();
      const job = await Job.findById(payment.jobId);
      if (job) { job.status = 'pending'; job.paymentStatus = 'pending'; await job.save(); }
    }
    return res.redirect(`${process.env.FRONTEND_URL}/payment/cancelled?transaction=${tran_id}`);
  } catch (error) {
    console.error('Card paymentCancel error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// BKASH CALLBACKS — Mobile App ke liye HTML + Deep Link
//
// Flow:
//  1. User SSLCommerz hosted page pe bKash se payment karta hai
//  2. SSLCommerz backend ko POST karta hai (success/fail/cancel URL)
//  3. Backend payment validate + update karta hai
//  4. HTML page return hoti hai jisme deep link hota hai
//  5. Deep link mobile app ko open karta hai correct screen pe
//
// .env mein add karo:
//   APP_SCHEME=yourappscheme   (e.g. "helperapp")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET|POST /api/payments/bkash/success
 * SSLCommerz yahan redirect karta hai successful bKash payment ke baad.
 */
export async function bkashPaymentSuccess(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tran_id, val_id } = { ...req.query, ...req.body };

    if (!tran_id || !val_id) {
      console.error('[bKash Success] Missing tran_id or val_id');
      return sendMobileRedirectPage(res, {
        status: 'failed',
        title: 'Payment Error',
        message: 'Invalid payment callback. Please contact support.',
        params: { error: 'missing_params' },
      });
    }

    // ── Step 1: SSLCommerz se validate karo ──────────────────────────────
    const validation = await validateSSLCommerzPayment(val_id);

    if (!validation || validation.status !== 'VALID') {
      console.error('[bKash Success] Validation failed:', validation?.status);
      await session.abortTransaction();
      return sendMobileRedirectPage(res, {
        status: 'failed',
        title: 'Payment Validation Failed',
        message: 'We could not verify your bKash payment. If money was deducted, it will be refunded within 3-5 business days.',
        params: { tran_id, method: 'bkash' },
      });
    }

    // ── Step 2: Payment record dhundo ────────────────────────────────────
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id }).session(session);

    if (!payment) {
      console.error('[bKash Success] Payment not found for tran_id:', tran_id);
      await session.abortTransaction();
      return sendMobileRedirectPage(res, {
        status: 'failed',
        title: 'Payment Not Found',
        message: 'Payment record not found. Please contact support with your transaction ID.',
        params: { tran_id },
      });
    }

    // ── Idempotency: already processed? ──────────────────────────────────
    if (payment.paymentStatus === 'completed') {
      await session.abortTransaction();
      return sendMobileRedirectPage(res, {
        status: 'success',
        title: 'Payment Already Confirmed',
        message: 'Your bKash payment was already confirmed. Your booking is active.',
        params: { jobId: payment.jobId.toString(), method: 'bkash' },
      });
    }

    if (payment.paymentMethod !== 'bkash') {
      console.error('[bKash Success] Wrong payment method for tran_id:', tran_id);
      await session.abortTransaction();
      return sendMobileRedirectPage(res, {
        status: 'failed',
        title: 'Payment Error',
        message: 'Payment method mismatch. Please contact support.',
        params: { tran_id },
      });
    }

    // ── Step 3: bKash transaction details store karo ──────────────────────
    if (validation.bank_tran_id) payment.bkashTransactionId = validation.bank_tran_id;
    if (validation.card_no) payment.bkashNumber = validation.card_no;

    // ── Step 4: Escrow mein daalo ─────────────────────────────────────────
    const job = await holdPaymentInEscrow(payment, session);
    await session.commitTransaction();

    // ── Step 5: Notifications ─────────────────────────────────────────────
    try {
      await createNotification({
        userId: payment.customerId,
        title: 'bKash Payment Successful',
        message: `Your bKash payment for Order #${job?.orderId} has been confirmed. Your booking is active.`,
        type: 'payment',
        referenceId: payment.jobId,
      });

      const jobDoc = job || await Job.findById(payment.jobId).populate('provider');
      if (jobDoc?.provider) {
        const { default: Provider } = await import('../models/provider/Provider.model.js');
        const provider = await Provider.findById(jobDoc.provider);
        if (provider) {
          await createNotification({
            userId: provider.userId,
            title: 'New Job Request',
            message: `New bKash booking for Order #${jobDoc.orderId}. Please accept or reject.`,
            type: 'job',
            referenceId: payment.jobId,
          });
        }
      }
    } catch (notifErr) {
      console.error('[bKash Success] Notification error:', notifErr.message);
    }

    // ── Step 6: Mobile app ko deep link se wapas bhejo ────────────────────
    const jobId = (job?._id ?? payment.jobId).toString();
    return sendMobileRedirectPage(res, {
      status: 'success',
      title: 'Payment Successful! 🎉',
      message: `Your bKash payment of BDT ${payment.totalAmount} was successful. Your booking has been confirmed.`,
      params: { jobId, method: 'bkash', tran_id },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('[bKash Success] Error:', error);
    return sendMobileRedirectPage(res, {
      status: 'failed',
      title: 'Payment Error',
      message: 'An unexpected error occurred. Please contact support if money was deducted.',
      params: { error: 'server_error' },
    });
  } finally {
    session.endSession();
  }
}


/**
 * GET|POST /api/payments/bkash/fail
 * SSLCommerz yahan redirect karta hai jab bKash payment fail ho.
 */
export async function bkashPaymentFailed(req, res) {
  try {
    const { tran_id } = { ...req.query, ...req.body };

    if (tran_id) {
      const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
      if (payment && payment.paymentStatus !== 'completed') {
        payment.paymentStatus = 'failed';
        await payment.save();

        const job = await Job.findById(payment.jobId);
        if (job) {
          job.status = 'pending';
          job.paymentStatus = 'pending';
          await job.save();
        }

        try {
          await createNotification({
            userId: payment.customerId,
            title: 'bKash Payment Failed',
            message: 'Your bKash payment could not be processed. Please try again.',
            type: 'payment',
            referenceId: payment.jobId,
          });
        } catch (e) { /* non-critical */ }
      }
    }

    return sendMobileRedirectPage(res, {
      status: 'failed',
      title: 'Payment Failed',
      message: 'Your bKash payment could not be completed. No money has been deducted. Please try again.',
      params: { tran_id: tran_id || '', method: 'bkash' },
    });

  } catch (error) {
    console.error('[bKash Fail] Error:', error);
    return sendMobileRedirectPage(res, {
      status: 'failed',
      title: 'Payment Failed',
      message: 'Payment failed. Please try again.',
      params: { error: 'server_error' },
    });
  }
}


/**
 * GET|POST /api/payments/bkash/cancel
 * SSLCommerz yahan redirect karta hai jab user payment cancel kare.
 */
export async function bkashPaymentCancel(req, res) {
  try {
    const { tran_id } = { ...req.query, ...req.body };

    if (tran_id) {
      const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
      if (payment && payment.paymentStatus === 'pending') {
        payment.paymentStatus = 'failed';
        await payment.save();

        const job = await Job.findById(payment.jobId);
        if (job) {
          job.status = 'pending';
          job.paymentStatus = 'pending';
          await job.save();
        }

        try {
          await createNotification({
            userId: payment.customerId,
            title: 'bKash Payment Cancelled',
            message: 'You cancelled the bKash payment. Your booking is on hold.',
            type: 'payment',
            referenceId: payment.jobId,
          });
        } catch (e) { /* non-critical */ }
      }
    }

    return sendMobileRedirectPage(res, {
      status: 'cancelled',
      title: 'Payment Cancelled',
      message: 'You cancelled the bKash payment. Your booking is saved — you can complete payment anytime.',
      params: { tran_id: tran_id || '', method: 'bkash' },
    });

  } catch (error) {
    console.error('[bKash Cancel] Error:', error);
    return sendMobileRedirectPage(res, {
      status: 'cancelled',
      title: 'Payment Cancelled',
      message: 'Payment was cancelled.',
      params: { error: 'server_error' },
    });
  }
}


/**
 * POST /api/payments/bkash/ipn
 * Server-to-server fallback — browser redirect fail ho to yeh kaam aata hai.
 * Hamesha 200 return karo SSLCommerz ko.
 */
export async function bkashIpnHandler(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tran_id, val_id, status } = req.body;

    if ((status !== 'VALID' && status !== 'VALIDATED') || !tran_id || !val_id) {
      await session.abortTransaction();
      return res.status(200).json({ received: true });
    }

    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id }).session(session);

    if (!payment || payment.paymentStatus === 'completed' || payment.paymentMethod !== 'bkash') {
      await session.abortTransaction();
      return res.status(200).json({ received: true });
    }

    const validation = await validateSSLCommerzPayment(val_id);
    if (!validation || validation.status !== 'VALID') {
      await session.abortTransaction();
      return res.status(200).json({ received: true });
    }

    if (validation.bank_tran_id) payment.bkashTransactionId = validation.bank_tran_id;
    if (validation.card_no) payment.bkashNumber = validation.card_no;

    await holdPaymentInEscrow(payment, session);
    await session.commitTransaction();

    console.log(`[bKash IPN] Payment confirmed via IPN for tran_id: ${tran_id}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    await session.abortTransaction();
    console.error('[bKash IPN] Error:', error);
    return res.status(200).json({ received: true });
  } finally {
    session.endSession();
  }
}