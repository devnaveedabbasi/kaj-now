import { Queue } from 'bullmq';
import redis from '../config/redis.js';

const jobScheduleQueue = new Queue('job-schedule', {
  connection: redis,
});

export async function scheduleJobNotification(jobId, scheduleDateTime) {
  try {
    const now = Date.now();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(` SCHEDULING NOTIFICATIONS FOR JOB: ${jobId}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Input scheduleDateTime:`, scheduleDateTime);
    console.log(`Input type:`, typeof scheduleDateTime);
    
    // Handle both string and Date formats
    let scheduleTime;
    if (scheduleDateTime instanceof Date) {
      scheduleTime = scheduleDateTime.getTime();
      console.log(` Parsed as Date object`);
    } else if (typeof scheduleDateTime === 'string') {
      // If it's just a time string like "15:10", we can't use it directly
      if (scheduleDateTime.includes('T')) {
        scheduleTime = new Date(scheduleDateTime).getTime();
        console.log(` Parsed as ISO datetime string`);
      } else {
        throw new Error('Schedule datetime must include date and time (e.g., "2026-05-06T15:10")');
      }
    } else {
      throw new Error('scheduleDateTime must be a Date or ISO string');
    }

    const scheduleDate = new Date(scheduleTime);
    const currentDate = new Date(now);
    
    console.log(`   Scheduled time: ${scheduleDate.toISOString()}`);
    console.log(`   Current time:   ${currentDate.toISOString()}`);
    console.log(`   Delay:          ${(scheduleTime - now) / 1000 / 60} minutes`);

    if (scheduleTime < now) {
      const pastMinutes = (now - scheduleTime) / 1000 / 60;
      throw new Error(` Schedule time is ${pastMinutes.toFixed(2)} minutes in the past!`);
    }

    const reminders = [
      { key: '60min', offset: 60 },
      { key: '30min', offset: 30 },
      { key: '15min', offset: 15 },
      { key: '10min', offset: 10 },
    ];

    for (const r of reminders) {
      const fireAt = scheduleTime - (r.offset * 60 * 1000);

      if (fireAt > now) {
        await jobScheduleQueue.add(
          'job-reminder',
          {
            jobId: jobId.toString(),
            reminderType: r.key
          },
          {
            delay: fireAt - now,
            jobId: `reminder-${r.key}-${jobId}`,
          }
        );
        const fireDate = new Date(fireAt);
        console.log(`    Scheduled ${r.key} reminder (will fire at ${fireDate.toISOString()})`);
      } else {
        console.log(`     Skipped ${r.key} reminder (already past)`);
      }
    }

    // Exact schedule time notification
    const exactDelay = scheduleTime - now;
    await jobScheduleQueue.add(
      'job-time-reached',
      { jobId: jobId.toString() },
      {
        delay: exactDelay,
        jobId: `notify-${jobId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    console.log(`    Scheduled exact-time notification`);
    console.log(` ALL REMINDERS QUEUED SUCCESSFULLY`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    console.error(`\n ERROR SCHEDULING NOTIFICATIONS FOR JOB ${jobId}:`);
    console.error(`   ${error.message}`);
    console.error(`${'='.repeat(60)}\n`);
    throw error;
  }
}

/**
 * Cancel all scheduled reminders when job is cancelled/rejected
 */
export async function cancelScheduledJob(jobId) {
  const reminderKeys = ['5min', '4min', '3min', '2min', '1min'];

  for (const key of reminderKeys) {
    const job = await jobScheduleQueue.getJob(`reminder-${key}-${jobId}`);
    if (job) {
      await job.remove();
      console.log(`Cancelled reminder [${key}] for job ${jobId}`);
    }
  }

  const exactJob = await jobScheduleQueue.getJob(`notify-${jobId}`);
  if (exactJob) {
    await exactJob.remove();
    console.log(`Cancelled exact-time notification for job ${jobId}`);
  }
}

export default jobScheduleQueue;