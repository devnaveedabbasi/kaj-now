import { Queue } from 'bullmq';
import redis from './src/config/redis.js';

const jobScheduleQueue = new Queue('job-schedule', {
  connection: redis,
});

async function checkQueue() {
  console.log("Checking job-schedule queue...");
  
  const waiting = await jobScheduleQueue.getWaiting();
  const delayed = await jobScheduleQueue.getDelayed();
  const active = await jobScheduleQueue.getActive();
  const failed = await jobScheduleQueue.getFailed();
  
  console.log(`Waiting: ${waiting.length}`);
  console.log(`Delayed: ${delayed.length}`);
  console.log(`Active: ${active.length}`);
  console.log(`Failed: ${failed.length}`);

  console.log("\n--- Delayed Jobs ---");
  for (const job of delayed) {
    if (job.data.jobId === '69fddbef6e74bd8c3b3fa792') {
      const delayMs = job.timestamp + job.delay - Date.now();
      const fireAt = new Date(job.timestamp + job.delay);
      console.log(`Job: ${job.name}, ID: ${job.id}`);
      console.log(`Data:`, job.data);
      console.log(`Will fire at: ${fireAt.toISOString()} (in ${delayMs/1000/60} minutes)`);
      console.log('-----------------');
    }
  }

  process.exit(0);
}

checkQueue();
