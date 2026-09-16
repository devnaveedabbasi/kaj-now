import cron from 'node-cron';
import mongoose from 'mongoose';
import Job from '../models/job.model.js';
import Payment from '../models/payment.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import Notification from '../models/notification.model.js';
import { createNotification } from '../utils/notification.js';
import { markPaymentRefundAutoCompleted } from '../utils/jobCancellation.js';

/**
 * Service to handle background tasks previously handled by BullMQ/Redis
 */
class JobSchedulerService {
  constructor() {
    this.isProcessing = false;
  }

  init() {
    console.log('Initializing Job Scheduler Service (Node-Cron)...');
    // Run every minute
    cron.schedule('* * * * *', () => {
      this.processJobs();
    });
    console.log('Cron Job scheduled: Run every minute');
  }

  async processJobs() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      await this.handlePendingJobs();
      await this.handleAcceptedJobs();
    } catch (error) {
      console.error('Error in JobSchedulerService.processJobs:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle jobs that are still 'pending' (not accepted by provider)
   * 8-hour timeout for auto-cancellation
   */
  async handlePendingJobs() {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);

    // 1. AUTO-CANCEL: Pending for more than 8 hours
    const jobsToCancel = await Job.find({
      status: 'pending',
      createdAt: { $lte: eightHoursAgo }
    });

    for (const job of jobsToCancel) {
      await this.autoCancelPendingJob(job._id);
    }

    // 2. WARNING: Pending for more than 7 hours (but less than 8)
    const jobsToWarn = await Job.find({
      status: 'pending',
      createdAt: { $lte: sevenHoursAgo, $gt: eightHoursAgo }
    });

    for (const job of jobsToWarn) {
      await this.sendWarningIfNeeded(job, 'auto-cancel-warning');
    }
  }

  async sendWarningIfNeeded(job, warningType) {
    // Check if notification already sent in the last 2 hours to avoid spamming
    const existingNotification = await Notification.findOne({
      referenceId: job._id,
      'metadata.warningType': warningType,
      createdAt: { $gt: new Date(Date.now() - 2 * 60 * 60 * 1000) }
    });

    if (existingNotification) return;

    try {
      const jobDoc = await Job.findById(job._id)
        .populate('service', 'name')
        .populate('serviceRequestId', 'ukService.title')
        .populate('provider', 'userId');

      if (!jobDoc || jobDoc.status !== 'pending') return;

      // A custom UK service (no backing Service doc) has `service` unset by
      // design — its real title lives on serviceRequestId.ukService instead.
      // `service` can also fail to populate if the Service doc was since
      // deleted (orphaned reference) — fall back rather than literally
      // printing "undefined" in a message the provider actually reads.
      const serviceName = jobDoc.service?.name || jobDoc.serviceRequestId?.ukService?.title || 'the service';

      await createNotification({
        userId: jobDoc.provider?.userId,
        title: 'Accept Job Request',
        message: `You have 1 hour to accept Order #${jobDoc.orderId} for "${serviceName}" or it will be automatically cancelled and customer will be refunded.`,
        type: 'job',
        referenceId: jobDoc._id,
        metadata: { orderId: jobDoc.orderId, warning: true, warningType },
      });
      console.log(`Provider warned - 1 hour left to accept for job ${jobDoc.orderId}`);
    } catch (error) {
      console.error(`Error sending warning for job ${job._id}:`, error.message);
    }
  }

  async autoCancelPendingJob(jobId) {
    console.log(`\nAUTO-CANCEL TRIGGERED - 8 HOURS TIMEOUT for Job: ${jobId}`);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const jobDoc = await Job.findById(jobId)
        .populate('service', 'name price')
        .populate('provider', 'userId')
        .populate('customer', 'name email')
        .session(session);

      if (!jobDoc || jobDoc.status !== 'pending') {
        await session.abortTransaction();
        return;
      }

      const payment = await Payment.findOne({ jobId }).session(session);
      if (!payment) {
        throw new Error('Payment record not found');
      }

      const refundAmount = payment.totalAmount;

      jobDoc.status = 'cancelled';
      jobDoc.cancelledAt = new Date();
      jobDoc.rejectionReason = 'Auto-cancelled: Provider did not accept within 8 hours';
      jobDoc.cancelledBy = 'system';
      jobDoc.cancelledByUserId = null;
      jobDoc.cancellationReason = jobDoc.rejectionReason;
      await jobDoc.save({ session });

      // Same refund flow as when an admin cancels a job: UK card payments
      // get auto-refunded via Stripe below; BD stays on the manual admin queue.
      const { releaseEscrowForCancellation, attemptAutomaticStripeRefund, buildCustomerRefundMessage, buildAdminRefundMessage } = await import('../utils/jobCancellation.js');
      await releaseEscrowForCancellation(session, payment);

      const customerUser = jobDoc.customer;
      const adminUser = await User.findOne({ role: 'admin' }).session(session);

      await session.commitTransaction();
      console.log(`Job cancelled (8h timeout): ${jobId}`);

      // Real external side effect — must run after commit, never inside
      // the DB transaction. payment.refundStatus reflects the real outcome
      // (auto-refunded via Stripe for UK card, or still pending) once this returns.
      await attemptAutomaticStripeRefund(payment);
      const refundMsg = buildCustomerRefundMessage(payment);

      await createNotification({
        userId: customerUser._id,
        title: 'Job Cancelled',
        message: `Your booking (Order #${jobDoc.orderId}) was automatically cancelled because the provider did not accept it within 8 hours.${refundMsg ? ` ${refundMsg}` : ''}`,
        type: 'job',
        referenceId: jobDoc._id,
        metadata: { orderId: jobDoc.orderId, reason: 'provider_timeout_8hours', refundStatus: payment?.refundStatus },
      });

      if (adminUser) {
        const adminRefundMsg = buildAdminRefundMessage(payment);
        await createNotification({
          userId: adminUser._id,
          title: 'Job Cancelled',
          message: `Order #${jobDoc.orderId} from customer "${customerUser.name}" was auto-cancelled (provider timeout 8 hours).${adminRefundMsg ? ` ${adminRefundMsg}` : ''}`,
          type: 'admin',
          referenceId: jobDoc._id,
          metadata: {
            orderId: jobDoc.orderId,
            customerId: customerUser._id,
            customerName: customerUser.name,
            reason: 'provider_timeout_8hours',
            jobId: jobDoc._id,
            refundStatus: payment?.refundStatus
          },
        });
      }

      const providerUser = await User.findById(jobDoc.provider?.userId);
      if (providerUser) {
        await createNotification({
          userId: providerUser._id,
          title: 'Job Cancelled - Timeout',
          message: `Order #${jobDoc.orderId} has been automatically cancelled because it was not accepted within 8 hours.`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId },
        });
      }
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      console.error(`ERROR auto-cancelling job ${jobId}:`, error.message);
    } finally {
      session.endSession();
    }
  }

  /**
   * Handle jobs that are 'accepted' but need reminders or have started timeout
   */
  async handleAcceptedJobs() {
    // We need to check reminders for both 'pending' and 'accepted' jobs as per BullMQ code
    // 'pending' jobs might still have reminders if they were scheduled for future
    const activeJobs = await Job.find({
      status: { $in: ['pending', 'accepted'] },
      'schedule.date': { $ne: null }
    }).populate('service').populate('provider').populate('serviceRequestId', 'ukService.title');

    const now = new Date();

    for (const job of activeJobs) {
      const scheduledTime = new Date(job.schedule.date);
      if (isNaN(scheduledTime.getTime())) continue;

      const diffInMinutes = (scheduledTime - now) / (1000 * 60);

      // 1. AUTO-CANCEL FOR NOT STARTING (5 mins after scheduled time)
      if (diffInMinutes <= -5 && job.status === 'accepted') {
        await this.autoCancelStartedTimeoutJob(job._id);
        continue; // Skip reminders if cancelled
      }

      // 2. REMINDERS
      // Check reminders: 120, 60, 30, 15, 10, 5, 0 mins
      const reminders = [
        { label: '2 hours', key: '120min', offset: 120 },
        { label: '60 minutes', key: '60min', offset: 60 },
        { label: '30 minutes', key: '30min', offset: 30 },
        { label: '15 minutes', key: '15min', offset: 15 },
        { label: '10 minutes', key: '10min', offset: 10 },
        { label: '5 minutes', key: '5min', offset: 5 },
        { label: 'Starting Now', key: '0min', offset: 0 },
      ];

      for (const r of reminders) {
        // If current time is within 1 minute of the reminder time
        // or if we just passed it and haven't sent it yet
        if (diffInMinutes <= r.offset && diffInMinutes > (r.offset - 1.1)) {
           await this.sendScheduleReminder(job, r.key, r.label);
        }
      }
    }
  }

  async sendScheduleReminder(job, key, label) {
    const reminderType = `reminder-${key}`;
    
    // Check if notification already sent to avoid duplicates
    const existingNotification = await Notification.findOne({
      referenceId: job._id,
      'metadata.reminderType': reminderType,
    });

    if (existingNotification) return;

    console.log(`Sending ${label} reminder for job ${job.orderId}`);

    // A custom UK service (no backing Service doc) has `service` unset by
    // design — its real title lives on serviceRequestId.ukService instead.
    // `service` can also fail to populate if the Service doc was since
    // deleted (orphaned reference) — fall back rather than literally
    // printing "undefined" in a message the provider/customer actually reads.
    const serviceName = job.service?.name || job.serviceRequestId?.ukService?.title || 'your service';
    const msg = key === '0min' ? `Job for ${serviceName} starting now!` : `Job starting in ${label}`;

    try {
      // Notify Provider
      await createNotification({
        userId: job.provider?.userId,
        title: msg,
        message: `Service: ${serviceName} (Order #${job.orderId})`,
        type: 'job',
        referenceId: job._id,
        metadata: { orderId: job.orderId, reminderType },
      });

      // Notify Customer
      await createNotification({
        userId: job.customer,
        title: msg,
        message: `Service: ${serviceName} (Order #${job.orderId})`,
        type: 'job',
        referenceId: job._id,
        metadata: { orderId: job.orderId, reminderType },
      });
    } catch (error) {
      console.error(`Error sending reminder ${key} for job ${job._id}:`, error.message);
    }
  }

  async autoCancelStartedTimeoutJob(jobId) {
    console.log(`\nJOB-START TIMEOUT - AUTO-CANCEL TRIGGERED for Job: ${jobId}`);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const jobDoc = await Job.findById(jobId)
        .populate('service', 'name price')
        .populate('provider', 'userId')
        .populate('customer', 'name email')
        .session(session);

      if (!jobDoc || jobDoc.status !== 'accepted') {
        await session.abortTransaction();
        return;
      }

      const payment = await Payment.findOne({ jobId }).session(session);
      if (!payment) {
        throw new Error('Payment record not found');
      }

      const refundAmount = payment.totalAmount;

      jobDoc.status = 'cancelled';
      jobDoc.cancelledAt = new Date();
      jobDoc.rejectionReason = 'Auto-cancelled: Provider did not start within 5 minutes of scheduled time';
      jobDoc.cancelledBy = 'system';
      jobDoc.cancelledByUserId = null;
      jobDoc.cancellationReason = jobDoc.rejectionReason;
      await jobDoc.save({ session });

      // Same refund flow as when an admin cancels a job: UK card payments
      // get auto-refunded via Stripe below; BD stays on the manual admin queue.
      const { releaseEscrowForCancellation, attemptAutomaticStripeRefund, buildCustomerRefundMessage, buildAdminRefundMessage } = await import('../utils/jobCancellation.js');
      await releaseEscrowForCancellation(session, payment);

      await session.commitTransaction();
      console.log(`Job cancelled (timeout): ${jobId}`);

      // Real external side effect — must run after commit, never inside
      // the DB transaction. payment.refundStatus reflects the real outcome
      // (auto-refunded via Stripe for UK card, or still pending) once this returns.
      await attemptAutomaticStripeRefund(payment);
      const refundMsg = buildCustomerRefundMessage(payment);

      // Notifications
      const customerUser = await User.findById(jobDoc.customer._id).session(session);
      await createNotification({
        userId: customerUser._id,
        title: 'Job Cancelled',
        message: `Your booking Order #${jobDoc.orderId} was cancelled. Provider did not start on time.${refundMsg ? ` ${refundMsg}` : ''}`,
        type: 'job',
        referenceId: jobDoc._id,
        metadata: { orderId: jobDoc.orderId, reason: 'provider_no_show_5mins', refundStatus: payment?.refundStatus },
      });

      const adminUser = await User.findOne({ role: 'admin' }).session(session);
      if (adminUser) {
        const adminRefundMsg = buildAdminRefundMessage(payment);
        await createNotification({
          userId: adminUser._id,
          title: 'Job Cancelled',
          message: `Order #${jobDoc.orderId} from customer "${customerUser.name}" was auto-cancelled (provider did not start).${adminRefundMsg ? ` ${adminRefundMsg}` : ''}`,
          type: 'admin',
          referenceId: jobDoc._id,
          metadata: {
            orderId: jobDoc.orderId,
            customerId: customerUser._id,
            customerName: customerUser.name,
            reason: 'provider_no_show_5mins',
            jobId: jobDoc._id,
            refundStatus: payment?.refundStatus
          },
        });
      }

      if (jobDoc.provider?.userId) {
        await createNotification({
          userId: jobDoc.provider.userId,
          title: 'Job Cancelled - Missed Start Time',
          message: `Order #${jobDoc.orderId} was cancelled because you did not start within 5 minutes of scheduled time.`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId },
        });
      }
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      console.error(`ERROR auto-cancelling job (timeout) ${jobId}:`, error.message);
    } finally {
      session.endSession();
    }
  }
}

export default new JobSchedulerService();
