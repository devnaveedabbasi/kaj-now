import { Worker } from 'bullmq';
import redis from '../config/redis.js';
import Job from '../models/job.model.js';
import Payment from '../models/payment.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import { createNotification } from '../utils/notification.js';
import { createActivityLog } from '../utils/createActivityLog.js';
import mongoose from 'mongoose';
// import admin from '../config/firebase/firebase.js';

console.log("Job Auto-Cancel & Reminder Worker Started");

const worker = new Worker(
  'job-auto-cancel',
  async (job) => {
    const jobType = job.name;
    const { jobId } = job.data;

    // ════════════════════════════════════════════════════════════════════════
    // PRE-ACCEPTANCE WARNING (1 hour before 8-hour timeout)
    // ════════════════════════════════════════════════════════════════════════
    if (jobType === 'auto-cancel-warning') {
      console.log(`\nAUTO-ACCEPT WARNING - 1 HOUR LEFT`);
      console.log(`Job ID: ${jobId}`);

      try {
        const jobDoc = await Job.findById(jobId)
          .populate('service', 'name')
          .populate('provider', 'userId');

        if (!jobDoc || jobDoc.status !== 'pending') {
          console.log(`Skipped: Job not pending`);
          return;
        }

        await createNotification({
          userId: jobDoc.provider?.userId,
          title: 'Accept Job Request',
          message: `You have 1 hour to accept Order #${jobDoc.orderId} for "${jobDoc.service?.name}" or it will be automatically cancelled and customer will be refunded.`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId, warning: true },
        });
        console.log(`Provider warned - 1 hour left to accept\n`);
      } catch (error) {
        console.error(`ERROR: ${error.message}\n`);
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // AUTO-CANCEL AFTER 8 HOURS (if not accepted)
    // ════════════════════════════════════════════════════════════════════════
    if (jobType === 'auto-cancel-pending-job') {
      console.log(`\nAUTO-CANCEL TRIGGERED - 8 HOURS TIMEOUT`);
      console.log(`Job ID: ${jobId}`);

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const jobDoc = await Job.findById(jobId)
          .populate('service', 'name price')
          .populate('provider', 'userId')
          .populate('customer', 'name email')
          .session(session);

        if (!jobDoc) {
          console.error(`Job not found`);
          await session.abortTransaction();
          return;
        }

        if (jobDoc.status !== 'pending') {
          console.log(`Skipped: Job status is ${jobDoc.status}`);
          await session.abortTransaction();
          return;
        }

        const payment = await Payment.findOne({ jobId }).session(session);
        if (!payment) {
          throw new Error('Payment record not found');
        }

        const refundAmount = payment.totalAmount - payment.platformFee;

        jobDoc.status = 'cancelled';
        jobDoc.cancelledAt = new Date();
        jobDoc.rejectionReason = 'Auto-cancelled: Provider did not accept within 8 hours';
        await jobDoc.save({ session });

        const customerUser = await User.findById(jobDoc.customer._id).session(session);
        let customerWallet = await Wallet.findOne({
          userId: customerUser._id,
          role: 'customer',
        }).session(session);

        if (!customerWallet) {
          [customerWallet] = await Wallet.create(
            [{
              userId: customerUser._id,
              role: 'customer',
              balance: 0,
              totalEarnings: 0,
              totalWithdrawn: 0,
              totalPlatformFees: 0,
              isActive: true,
            }],
            { session }
          );
        }

        customerWallet.balance += refundAmount;
        customerWallet.transactionHistory.push(payment._id);

        await customerWallet.save({ session });

        payment.paymentStatus = 'refunded';
        payment.escrowStatus = 'refunded_to_customer';
        payment.refundedAt = new Date();
        payment.refundReason = 'Auto-cancelled: Provider timeout (8 hours)';
        await payment.save({ session });

        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (adminUser) {
          const adminWallet = await Wallet.findOne({
            userId: adminUser._id,
            role: 'admin',
          }).session(session);

          if (adminWallet) {
            adminWallet.balance -= refundAmount;
            adminWallet.totalHeld = (adminWallet.totalHeld || 0) - refundAmount;
            adminWallet.transactionHistory.push(payment._id);
            adminWallet.totalPlatformFees = (adminWallet.totalPlatformFees || 0) - payment.platformFee;
            adminWallet.totalEarnings = (adminWallet.totalEarnings || 0) - payment.platformFee;
            await adminWallet.save({ session });
          }
        }

        await session.commitTransaction();
        console.log(`Job cancelled and refunded: ${refundAmount} BDT`);

        await createNotification({
          userId: customerUser._id,
          title: 'Job Cancelled - Payment Refunded',
          message: `Your booking (Order #${jobDoc.orderId}) was automatically cancelled. Provider did not accept within 8 hours. Refunded: ${refundAmount} BDT to your wallet.`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId, refundAmount, reason: 'provider_timeout_8hours' },
        });

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

        console.log(`Notifications sent\n`);
      } catch (error) {
        await session.abortTransaction();
        console.error(`ERROR: ${error.message}\n`);
        throw error;
      } finally {
        session.endSession();
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PREPARATION REMINDERS (Every 2 hours after acceptance)
    // ════════════════════════════════════════════════════════════════════════
    if (jobType === 'job-reminder-prepare') {
      console.log(`\nREMINDER - PREPARE FOR JOB`);
      console.log(`Job ID: ${jobId}`);

      try {
        const jobDoc = await Job.findById(jobId)
          .populate('service', 'name')
          .populate('provider', 'userId');

        if (!jobDoc || jobDoc.status !== 'accepted') {
          console.log(`Skipped: Job not accepted`);
          return;
        }

        await createNotification({
          userId: jobDoc.provider?.userId,
          title: 'Prepare for Job',
          message: `Reminder: Your job Order #${jobDoc.orderId} for "${jobDoc.service?.name}" is coming up. Please prepare accordingly.`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId },
        });
        console.log(`Provider preparation reminder sent\n`);
      } catch (error) {
        console.error(`ERROR: ${error.message}\n`);
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // JOB REMINDERS (2 hours, 1 hour, 30 mins, 5 mins before start time)
    // ════════════════════════════════════════════════════════════════════════
    const reminderMap = {
      'job-reminder-2hours': { time: '2 hours', label: 'Job starting in 2 hours' },
      'job-reminder-1hour': { time: '1 hour', label: 'Job starting in 1 hour' },
      'job-reminder-30min': { time: '30 minutes', label: 'Job starting in 30 minutes' },
      'job-reminder-5min-final': { time: '5 minutes', label: 'Job starting in 5 minutes. Please be ready or it will be cancelled' },
    };

    if (reminderMap[jobType]) {
      const reminderInfo = reminderMap[jobType];
      console.log(`\nREMINDER - ${reminderInfo.label.toUpperCase()}`);
      console.log(`Job ID: ${jobId}`);

      try {
        const jobDoc = await Job.findById(jobId)
          .populate('service', 'name')
          .populate('provider', 'userId');

        if (!jobDoc || jobDoc.status !== 'accepted') {
          console.log(`Skipped: Job not accepted`);
          return;
        }

        await createNotification({
          userId: jobDoc.provider?.userId,
          title: `Job Reminder - ${reminderInfo.time}`,
          message: `${reminderInfo.label} for Order #${jobDoc.orderId} ("${jobDoc.service?.name}"). ${jobType === 'job-reminder-5min-final' ? 'Please start now or it will be cancelled.' : ''}`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId, reminderType: jobType },
        });
        console.log(`Provider reminder sent\n`);
      } catch (error) {
        console.error(`ERROR: ${error.message}\n`);
      }
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // JOB-START TIMEOUT (Auto-cancel if job not started 5 mins after scheduled time)
    // ════════════════════════════════════════════════════════════════════════
    if (jobType === 'job-start-timeout') {
      console.log(`\nJOB-START TIMEOUT - AUTO-CANCEL TRIGGERED`);
      console.log(`Job ID: ${jobId}`);

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const jobDoc = await Job.findById(jobId)
          .populate('service', 'name price')
          .populate('provider', 'userId')
          .populate('customer', 'name email')
          .session(session);

        if (!jobDoc) {
          console.error(`Job not found`);
          await session.abortTransaction();
          return;
        }

        // Only cancel if still accepted (not started)
        if (jobDoc.status !== 'accepted') {
          console.log(`Skipped: Job status is ${jobDoc.status}`);
          await session.abortTransaction();
          return;
        }

        const payment = await Payment.findOne({ jobId }).session(session);
        if (!payment) {
          throw new Error('Payment record not found');
        }

        const refundAmount = payment.totalAmount - payment.platformFee;

        jobDoc.status = 'cancelled';
        jobDoc.cancelledAt = new Date();
        jobDoc.rejectionReason = 'Auto-cancelled: Job did not start within 5 minutes of scheduled time';
        await jobDoc.save({ session });

        const customerUser = await User.findById(jobDoc.customer._id).session(session);
        let customerWallet = await Wallet.findOne({
          userId: customerUser._id,
          role: 'customer',
        }).session(session);

        if (!customerWallet) {
          [customerWallet] = await Wallet.create(
            [{
              userId: customerUser._id,
              role: 'customer',
              balance: 0,
              totalEarnings: 0,
              totalWithdrawn: 0,
              totalPlatformFees: 0,
              isActive: true,
            }],
            { session }
          );
        }

        customerWallet.balance += refundAmount;
        customerWallet.transactionHistory.push(payment._id);
        await customerWallet.save({ session });

        payment.paymentStatus = 'refunded';
        payment.escrowStatus = 'refunded_to_customer';
        payment.refundedAt = new Date();
        payment.refundReason = 'Auto-cancelled: Job did not start on time';
        await payment.save({ session });

        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (adminUser) {
          const adminWallet = await Wallet.findOne({
            userId: adminUser._id,
            role: 'admin',
          }).session(session);

          if (adminWallet) {
            adminWallet.balance -= refundAmount;
            adminWallet.totalHeld = (adminWallet.totalHeld || 0) - refundAmount;
            await adminWallet.save({ session });
          }
        }

        await session.commitTransaction();
        console.log(`Job cancelled and refunded: ${refundAmount} BDT`);

        await createNotification({
          userId: customerUser._id,
          title: 'Job Cancelled - Payment Refunded',
          message: `Your booking (Order #${jobDoc.orderId}) was automatically cancelled. Job did not start on time. Refunded: ${refundAmount} BDT to your wallet.`,
          type: 'job',
          referenceId: jobDoc._id,
          metadata: { orderId: jobDoc.orderId, refundAmount, reason: 'job_not_started' },
        });

        const providerUser = await User.findById(jobDoc.provider?.userId);
        if (providerUser) {
          await createNotification({
            userId: providerUser._id,
            title: 'Job Cancelled',
            message: `Order #${jobDoc.orderId} has been automatically cancelled because the job did not start on time.`,
            type: 'job',
            referenceId: jobDoc._id,
            metadata: { orderId: jobDoc.orderId },
          });
        }

        console.log(`Notifications sent\n`);
      } catch (error) {
        await session.abortTransaction();
        console.error(`ERROR: ${error.message}\n`);
        throw error;
      } finally {
        session.endSession();
      }
      return;
    }
  },
  { connection: redis }
);

worker.on('completed', (job) => {
  console.log(`COMPLETED: ${job.name} (${job.id})`);
});

worker.on('failed', (job, err) => {
  console.error(`FAILED: ${job.name} - ${err.message}`);
});

worker.on('error', (err) => {
  console.error(`WORKER ERROR: ${err.message}`);
});

export default worker;

