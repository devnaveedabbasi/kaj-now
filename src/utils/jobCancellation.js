import User from '../models/User.model.js';
import Wallet from '../models/wallet.model.js';
import { createStripeRefund } from '../service/stripe.js';

// Job statuses beyond which a job can no longer be cancelled through the
// normal cancellation flow (service already started / already settled).
export const NON_CANCELLABLE_JOB_STATUSES = [
  'in_progress',
  'completed_by_provider',
  'confirmed_by_user',
  'confirmed_by_admin',
  'disputed',
  'cancelled',
  'rejected_by_provider',
];

/**
 * Customer-facing message describing what happens to their money after a
 * cancellation. Call this AFTER attemptAutomaticStripeRefund() has run, so
 * `payment.refundStatus` already reflects the real outcome — UK card
 * payments are usually already 'completed' by then (instant, via Stripe);
 * BD and any failed Stripe attempt are still 'pending' (admin will send it
 * manually). Returns null when there's nothing to refund (COD, never charged).
 * @param {import('mongoose').Document|null} payment
 */
export function buildCustomerRefundMessage(payment) {
  if (!payment) return null;
  const amount = `${payment.currency || ''} ${payment.totalAmount}`.trim();
  if (payment.refundStatus === 'completed') {
    return `Your payment of ${amount} has been refunded to your card.`;
  }
  if (payment.refundStatus === 'pending') {
    return `Your payment of ${amount} will be refunded to you shortly — our team is processing it.`;
  }
  return null;
}

/**
 * Same idea as buildCustomerRefundMessage(), but for the admin-facing
 * notification — tells admin whether they still owe a manual action or not.
 * @param {import('mongoose').Document|null} payment
 */
export function buildAdminRefundMessage(payment) {
  if (!payment) return null;
  if (payment.refundStatus === 'completed') {
    return `A refund of ${payment.totalAmount} was automatically processed via Stripe.`;
  }
  if (payment.refundStatus === 'pending') {
    return `A refund of ${payment.totalAmount} is pending your manual action.`;
  }
  return null;
}

/**
 * Reverses the platform-fee "earnings" credited to the admin wallet at
 * payment time, alongside the balance debit already done by the caller.
 * Without this, a fully-refunded booking's fee stays counted as earned
 * forever — the wallet's balance goes back to zero for that transaction,
 * but totalEarnings/totalPlatformFees never do.
 * @param {import('mongoose').Document} adminWallet
 * @param {import('mongoose').Document} payment
 */
function reverseWalletEarnings(adminWallet, payment) {
  adminWallet.totalEarnings = Math.max(0, (adminWallet.totalEarnings || 0) - payment.platformFee);
  adminWallet.totalPlatformFees = Math.max(0, (adminWallet.totalPlatformFees || 0) - payment.platformFee);
}

/**
 * Stamps unified cancellation metadata onto a Job document (in-memory only —
 * caller is responsible for calling job.save()).
 * @param {import('mongoose').Document} job
 * @param {{ source: 'customer'|'provider'|'admin'|'system', byUserId?: string|null, reason?: string|null }} options
 */
export function applyCancellationMetadata(job, { source, byUserId = null, reason = null }) {
  job.status = 'cancelled';
  job.cancelledAt = new Date();
  job.cancelledBy = source;
  job.cancelledByUserId = byUserId;
  job.cancellationReason = reason || job.cancellationReason || null;
}

/**
 * Releases a payment's escrow hold when its job is cancelled, WITHOUT moving
 * any real money — the platform still holds the cash, but it is no longer
 * earmarked for the provider. Admin must later manually send the refund and
 * call markPaymentRefundCompleted() to reflect that.
 *
 * If no money was ever collected/held for this payment (COD, still pending),
 * marks the payment as not needing a refund at all.
 *
 * @param {import('mongoose').ClientSession} session
 * @param {import('mongoose').Document|null} payment
 */
export async function releaseEscrowForCancellation(session, payment) {
  if (!payment) return;

  if (payment.escrowStatus === 'held_in_admin_wallet') {
    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (adminUser) {
      const adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);
      if (adminWallet) {
        adminWallet.totalHeld = Math.max(0, (adminWallet.totalHeld || 0) - payment.totalAmount);
        await adminWallet.save({ session });
      }
    }

    payment.escrowStatus = 'pending_refund';
    payment.refundStatus = 'pending';
  } else if (!['refunded_to_customer', 'released_to_provider', 'cod_completed'].includes(payment.escrowStatus)) {
    // COD still pending, or payment never actually collected — nothing to refund.
    payment.refundStatus = 'not_applicable';
  }

  await payment.save({ session });
}

/**
 * UK card payments only: immediately refunds the customer's card via
 * Stripe instead of leaving it on the manual admin-refund queue that
 * releaseEscrowForCancellation() just parked it on. BD (SSLCommerz) stays
 * fully manual — this is a deliberate region difference, not an oversight.
 *
 * Must be called AFTER the caller's cancellation transaction has committed.
 * A refund is a real external side effect against Stripe — it must never
 * share a DB transaction with the cancellation itself, since a later
 * rollback there could never be reflected back to Stripe, and holding a
 * transaction open across a network call risks long lock contention.
 *
 * If the Stripe call fails for any reason, the payment is simply left at
 * refundStatus 'pending' — exactly the manual-refund state it would have
 * been in before this automation existed, so admin can still handle it by
 * hand as a fallback.
 *
 * @param {import('mongoose').Document|null} payment
 */
export async function attemptAutomaticStripeRefund(payment) {
  if (!payment) return;
  if (payment.paymentGateway !== 'stripe' || !payment.stripePaymentIntentId) return;
  // Only auto-refund what releaseEscrowForCancellation just parked as
  // pending — never re-refund something already completed/not applicable.
  if (payment.refundStatus !== 'pending') return;

  try {
    await createStripeRefund(payment.stripePaymentIntentId, payment.totalAmount, 'requested_by_customer');

    // Mirrors markPaymentRefundCompleted()'s end state — money has now
    // actually left the admin wallet back to the customer, for real.
    const adminUser = await User.findOne({ role: 'admin' });
    if (adminUser) {
      const adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' });
      if (adminWallet) {
        adminWallet.balance = Math.max(0, (adminWallet.balance || 0) - payment.totalAmount);
        reverseWalletEarnings(adminWallet, payment);
        await adminWallet.save();
      }
    }

    payment.refundStatus = 'completed';
    payment.refundMarkedBy = null;
    payment.refundMarkedAt = new Date();
    payment.refundNote = 'Automatically refunded to card via Stripe on cancellation';
    payment.paymentStatus = 'refunded';
    payment.escrowStatus = 'refunded_to_customer';
    payment.refundedAt = new Date();
    payment.refundReason = payment.refundReason || 'Job cancelled — auto-refunded to card';
    await payment.save();
  } catch (error) {
    console.error(`[attemptAutomaticStripeRefund] Failed for payment ${payment._id}:`, error.message);
  }
}

/**
 * Marks a payment's manual refund as completed — the admin has physically
 * sent the money back to the customer outside the system. This is the only
 * place actual money leaves the admin wallet balance for a cancellation.
 *
 * @param {import('mongoose').ClientSession} session
 * @param {import('mongoose').Document} payment
 * @param {{ adminUserId: string, note?: string|null }} options
 */
export async function markPaymentRefundCompleted(session, payment, { adminUserId, note = null }) {
  const adminUser = await User.findOne({ role: 'admin' }).session(session);
  if (adminUser) {
    const adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);
    if (adminWallet) {
      adminWallet.balance = Math.max(0, (adminWallet.balance || 0) - payment.totalAmount);
      reverseWalletEarnings(adminWallet, payment);
      await adminWallet.save({ session });
    }
  }

  payment.refundStatus = 'completed';
  payment.refundMarkedBy = adminUserId;
  payment.refundMarkedAt = new Date();
  payment.refundNote = note;
  payment.paymentStatus = 'refunded';
  payment.escrowStatus = 'refunded_to_customer';
  payment.refundedAt = new Date();
  payment.refundReason = payment.refundReason || note || 'Job cancelled — manual refund processed by admin';
  await payment.save({ session });
}

/**
 * For cancellations where an existing automatic refund mechanism already
 * moved the money into the customer's wallet (provider reject, cron
 * auto-cancel) — marks the SAME refundStatus field as already completed so
 * these flow through the identical admin/customer views without a second
 * refund action being required.
 *
 * @param {import('mongoose').Document} payment
 */
export function markPaymentRefundAutoCompleted(payment) {
  if (!payment) return;
  payment.refundStatus = 'completed';
  payment.refundMarkedAt = payment.refundMarkedAt || new Date();
}
