import User from '../models/User.model.js';
import Wallet from '../models/wallet.model.js';

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
