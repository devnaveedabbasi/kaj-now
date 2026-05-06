import { Queue } from 'bullmq';
import redis from '../config/redis.js';
import Job from '../models/job.model.js';
import Payment from '../models/payment.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import { createNotification } from '../utils/notification.js';
import { createActivityLog } from '../utils/createActivityLog.js';

const jobAutoCancelQueue = new Queue('job-auto-cancel', {
  connection: redis,
});

/**
 * Schedule auto-cancel for a job if provider doesn't accept within 8 hours
 */
export async function scheduleAutoCancelJob(jobId) {
  try {
    const eightHoursInMs = 8 * 60 * 60 * 1000;
    const oneHourInMs = 60 * 60 * 1000;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`AUTO-CANCEL SCHEDULING FOR JOB: ${jobId}`);
    console.log(`   Provider must accept within 8 hours`);
    console.log(`${'='.repeat(60)}`);

    // Schedule WARNING notification at 1 hour before cancellation
    const warningDelay = eightHoursInMs - oneHourInMs;
    await jobAutoCancelQueue.add(
      'auto-cancel-warning',
      {
        jobId: jobId.toString(),
      },
      {
        delay: warningDelay,
        jobId: `warning-${jobId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    console.log(`   Warning scheduled in 7 hours`);

    // Schedule ACTUAL CANCELLATION at 8 hours
    await jobAutoCancelQueue.add(
      'auto-cancel-pending-job',
      {
        jobId: jobId.toString(),
      },
      {
        delay: eightHoursInMs,
        jobId: `cancel-${jobId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    console.log(`   Auto-cancel scheduled in 8 hours`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    console.error(` Error scheduling auto-cancel for job ${jobId}:`, error.message);
    throw error;
  }
}

/**
 * Cancel auto-cancel if job is accepted or completed
 */
export async function cancelAutoCancelJob(jobId) {
  try {
    // Remove warning notification
    const warningJob = await jobAutoCancelQueue.getJob(`warning-${jobId}`);
    if (warningJob) {
      await warningJob.remove();
      console.log(`   Warning cancelled for job ${jobId}`);
    }

    // Remove auto-cancel
    const cancelJob = await jobAutoCancelQueue.getJob(`cancel-${jobId}`);
    if (cancelJob) {
      await cancelJob.remove();
      console.log(`   Auto-cancel cancelled for job ${jobId}`);
    }
  } catch (error) {
    console.error(`Error cancelling auto-cancel for job ${jobId}:`, error.message);
  }
}

export default jobAutoCancelQueue;

/**
 * Schedule reminders after job is accepted and auto-cancel if not started
 */
export async function schedulePostAcceptanceReminders(jobId, scheduledDateTime) {
  try {
    const now = Date.now();
    const scheduleTime = scheduledDateTime instanceof Date ? scheduledDateTime.getTime() : new Date(scheduledDateTime).getTime();
    
    if (scheduleTime <= now) {
      console.log(`   Scheduled time is in past, skipping reminders`);
      return;
    }

    const timeUntilScheduled = scheduleTime - now;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const oneHourMs = 60 * 60 * 1000;
    const thirtyMinMs = 30 * 60 * 1000;
    const fiveMinMs = 5 * 60 * 1000;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SCHEDULING POST-ACCEPTANCE REMINDERS FOR JOB: ${jobId}`);
    console.log(`   Scheduled time: ${new Date(scheduleTime).toISOString()}`);
    console.log(`   Time until scheduled: ${(timeUntilScheduled / 1000 / 60).toFixed(2)} minutes`);
    console.log(`${'='.repeat(60)}`);

    // Every 2 hours until scheduled date
    let delay = 0;
    let remindersCount = 0;
    while (delay < timeUntilScheduled) {
      remindersCount++;
      const jobKey = `prepare-${jobId}-${remindersCount}`;
      
      await jobAutoCancelQueue.add(
        'job-reminder-prepare',
        { jobId: jobId.toString() },
        {
          delay,
          jobId: jobKey,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      
      delay += twoHoursMs;
    }
    console.log(`   Every 2 hours reminders scheduled: ${remindersCount} reminders`);

    // 2 hours before scheduled time
    if (timeUntilScheduled > twoHoursMs) {
      await jobAutoCancelQueue.add(
        'job-reminder-2hours',
        { jobId: jobId.toString() },
        {
          delay: timeUntilScheduled - twoHoursMs,
          jobId: `remind-2h-${jobId}`,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      console.log(`   2 hours before reminder scheduled`);
    }

    // 1 hour before scheduled time
    if (timeUntilScheduled > oneHourMs) {
      await jobAutoCancelQueue.add(
        'job-reminder-1hour',
        { jobId: jobId.toString() },
        {
          delay: timeUntilScheduled - oneHourMs,
          jobId: `remind-1h-${jobId}`,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      console.log(`   1 hour before reminder scheduled`);
    }

    // 30 minutes before scheduled time
    if (timeUntilScheduled > thirtyMinMs) {
      await jobAutoCancelQueue.add(
        'job-reminder-30min',
        { jobId: jobId.toString() },
        {
          delay: timeUntilScheduled - thirtyMinMs,
          jobId: `remind-30m-${jobId}`,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      console.log(`   30 minutes before reminder scheduled`);
    }

    // 5 minutes before scheduled time (final warning)
    if (timeUntilScheduled > fiveMinMs) {
      await jobAutoCancelQueue.add(
        'job-reminder-5min-final',
        { jobId: jobId.toString() },
        {
          delay: timeUntilScheduled - fiveMinMs,
          jobId: `remind-5m-${jobId}`,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      console.log(`   5 minutes before final warning scheduled`);
    }

    // Auto-cancel if not started (5 minutes after scheduled time)
    await jobAutoCancelQueue.add(
      'job-start-timeout',
      { jobId: jobId.toString() },
      {
        delay: timeUntilScheduled + fiveMinMs,
        jobId: `timeout-${jobId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    console.log(`   Job start timeout auto-cancel scheduled (5 mins after scheduled time)`);
    console.log(`${'='.repeat(60)}\n`);

  } catch (error) {
    console.error(`Error scheduling post-acceptance reminders for job ${jobId}:`, error.message);
    throw error;
  }
}

/**
 * Cancel all post-acceptance reminders
 */
export async function cancelPostAcceptanceReminders(jobId) {
  try {
    const jobIds = await jobAutoCancelQueue.getJobIds();
    
    for (const jId of jobIds) {
      if (jId.includes(jobId)) {
        const job = await jobAutoCancelQueue.getJob(jId);
        if (job) {
          await job.remove();
        }
      }
    }
    
    console.log(`   All post-acceptance reminders cancelled for job ${jobId}`);
  } catch (error) {
    console.error(`Error cancelling post-acceptance reminders for job ${jobId}:`, error.message);
  }
}
