import { Worker } from 'bullmq';
import redis from '../config/redis.js';
import Job from '../models/job.model.js';
import { createNotification } from '../utils/notification.js';

console.log("🚀 Job Schedule Worker Started");
redis.ping().then(console.log);
const worker = new Worker(
  'job-schedule',
  async (job) => {

    console.log(`\n${'='.repeat(60)}`);
    console.log(` JOB TRIGGERED: ${job.name}`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Reminder Type: ${job.data.reminderType || 'N/A'}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}`);

    const { jobId, reminderType } = job.data;

    const jobDoc = await Job.findById(jobId)
      .populate('service', 'name')
      .populate('provider', 'userId');

    if (!jobDoc) {
      console.error(`    Job document not found for ID: ${jobId}`);
      return;
    }

    console.log(`    Job found: ${jobDoc.orderId}`);
    console.log(`   Job Status: ${jobDoc.status}`);
    console.log(`   Service: ${jobDoc.service?.name}`);

    // ───────────── REMINDERS ─────────────
    if (job.name === 'job-reminder') {

      if (!['accepted', 'pending'].includes(jobDoc.status)) {
        console.log(`     Skipped: Job status is ${jobDoc.status} (expected: pending or accepted)`);
        return;
      }

      const messages = {
        '5min': '⏰ Job starting in 5 minutes',
        '4min': '⏰ Job starting in 4 minutes',
        '3min': '⏰ Job starting in 3 minutes',
        '2min': ' Job starting in 2 minutes',
        '1min': ' Job starting in 1 minute',
      };

      const msg = messages[reminderType];
      if (!msg) {
        console.error(`    Unknown reminder type: ${reminderType}`);
        return;
      }

      console.log(`Sending reminder: ${msg}`);

      try {
        await createNotification({
          userId: jobDoc.provider?.userId,
          title: msg,
          message: `Service: ${jobDoc.service?.name}`,
          type: 'job',
          referenceId: jobDoc._id,
        });
        console.log(`Provider notification sent`);
      } catch (err) {
        console.error(` Error sending provider notification:`, err.message);
      }

      try {
        await createNotification({
          userId: jobDoc.customer,
          title: msg,
          message: `Service: ${jobDoc.service?.name}`,
          type: 'job',
          referenceId: jobDoc._id,
        });
        console.log(`Customer notification sent`);
      } catch (err) {
        console.error(` Error sending customer notification:`, err.message);
      }

      console.log(`${'='.repeat(60)}\n`);
      return;
    }

    // ───────────── EXACT TIME ─────────────
    if (job.name === 'job-time-reached') {

      if (!['accepted', 'pending'].includes(jobDoc.status)) {
        console.log(`     Skipped: Job status is ${jobDoc.status}`);
        return;
      }

      console.log(`   🚀 EXACT TIME REACHED - Sending final notification`);

      try {
        await createNotification({
          userId: jobDoc.provider?.userId,
          title: '🚀 Start Job Now',
          message: `Time reached for ${jobDoc.service?.name}`,
          type: 'job',
          referenceId: jobDoc._id,
        });
        console.log(`    Provider notification sent`);
      } catch (err) {
        console.error(`    Error sending provider notification:`, err.message);
      }

      try {
        await createNotification({
          userId: jobDoc.customer,
          title: ' Service Starting Now',
          message: `Your service is starting now`,
          type: 'job',
          referenceId: jobDoc._id,
        });
        console.log(`    Customer notification sent`);
      } catch (err) {
        console.error(`    Error sending customer notification:`, err.message);
      }

      console.log(`${'='.repeat(60)}\n`);
    }

  },
  { connection: redis }
);

worker.on('completed', (job) => {
  console.log(` JOB COMPLETED: ${job.name}`);
  console.log(`   Data: ${JSON.stringify(job.data)}`);
  console.log(`   Time taken: ${job.finishedOn - job.processedOn}ms\n`);
});

worker.on('failed', (job, err) => {
  console.error(` JOB FAILED: ${job.name}`);
  console.error(`   Error: ${err.message}`);
  console.error(`   Data: ${JSON.stringify(job.data)}\n`);
});

worker.on('error', (err) => {
  console.error(` WORKER ERROR: ${err.message}\n`);
});

export default worker;