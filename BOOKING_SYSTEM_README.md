# KajNow Booking System

## Overview
Complete automated job booking, scheduling, and auto-cancellation system with multi-stage notifications.

---

## 🔄 Flow Chart

```
Customer Books Service
    ↓
Payment Processed → Job Created (pending)
    ↓
├─ jobScheduleQueue: Schedule time reminders (60/30/15/10 mins before)
└─ jobAutoCancelQueue: Accept timeout (8 hours)
    ↓
Provider Accepts?
    ├─ YES → Cancels auto-cancel, schedules post-acceptance reminders
    └─ NO → Auto-cancelled at 8 hours, customer refunded
    ↓
Job Time Approaches?
    ├─ Provider starts → in_progress, payment released
    └─ Not started (5 min grace) → Auto-cancelled, refunded
```

---

## 📋 Job Status Lifecycle

| Status | When | Queue Action |
|--------|------|--------------|
| **pending** | Just booked | Auto-cancel in 8 hours |
| **accepted** | Provider accepts | Start reminders (2h, 1h, 30m, 5m) |
| **in_progress** | Provider started | All reminders cancelled |
| **completed** | Work done | Payment released |
| **cancelled** | Timeout/rejected | Refund processed |

---

## 🔔 Queue System

### Queue 1: jobScheduleQueue
**Purpose:** Pre-schedule notifications

| Time Before | Message | Recipient |
|------------|---------|-----------|
| 60 mins | Schedule approaching | Both |
| 30 mins | Schedule approaching | Both |
| 15 mins | Schedule approaching | Both |
| 10 mins | Schedule approaching | Both |

**Worker:** `jobScheduleWorker.js`

---

### Queue 2: jobAutoCancelQueue
**Purpose:** Acceptance timeout + post-acceptance reminders

#### Pre-Acceptance (Provider Must Accept)
```
0 hours → Job created, timer starts
7 hours → Warning: "1 hour left to accept"
8 hours → Auto-cancelled if not accepted
```

#### Post-Acceptance (Provider Must Start)
```
Every 2 hours → "Prepare for job"
2 hours before → "Job in 2 hours"
1 hour before → "Job in 1 hour"
30 mins before → "Job in 30 minutes"
5 mins before → "Final warning - start now or cancel"
5 mins AFTER scheduled → Auto-cancel if not started
```

**Worker:** `jobAutoCancelWorker.js`

---

## 💰 Refund Logic

```
Service Price: 700 BDT
Platform Fee: 10% = 70 BDT

If Cancelled:
├─ Customer gets: 630 BDT (to wallet)
└─ Admin keeps: 70 BDT (platform fee)
```

### When Refund Happens:
1. Provider doesn't accept (8-hour timeout)
2. Job doesn't start (5-minute grace after scheduled time)
3. Customer manually cancels
4. Dispute resolution

---

## 📱 Notifications

### Customer Receives:
1. **Booking Confirmed** → Immediately
2. **Booking Accepted** → When provider accepts
3. **Schedule Reminders** → 60/30/15/10 mins before
4. **Job Started/Cancelled** → Final status

### Provider Receives:
1. **New Job Request** → Immediately
2. **Accept Deadline Warning** → 7 hours in
3. **Preparation Reminders** → Every 2 hours
4. **Job Time Reminders** → 2h/1h/30m/5m before
5. **Start Deadline Warning** → 5 mins before
6. **Auto-Cancel** → If not started on time

---

## 🛡️ Safety Checks

```
twoMInutes Cannot book for today (tomorrow minimum)
twoMInutes Cannot double-book same provider at same time (1hr buffer)
twoMInutes Only pending jobs auto-cancel at 8 hours
twoMInutes Only accepted jobs timeout at start time
twoMInutes Platform fee always deducted from refund
twoMInutes Transaction rollback on any error
```

---

## 📊 Redis Queue Structure

```
Redis Queues:
├─ job-schedule (jobScheduleQueue)
│  └─ Jobs: "job-reminder", "job-time-reached"
│
└─ job-auto-cancel (jobAutoCancelQueue)
   └─ Jobs: "auto-cancel-warning", "auto-cancel-pending-job",
            "job-reminder-prepare", "job-reminder-2hours",
            "job-reminder-1hour", "job-reminder-30min",
            "job-reminder-5min-final", "job-start-timeout"
```

---

## ⚙️ Configuration

### Timeouts
```
Accept Timeout: 8 hours
Start Timeout Grace: 5 minutes after scheduled time
```

### Reminders
```
Before Schedule: 60, 30, 15, 10 minutes
Post-Acceptance: 
  - Every 2 hours (until scheduled)
  - 2 hours before
  - 1 hour before
  - 30 minutes before
  - 5 minutes before
```



## 🔧 Files

| File | Purpose |
|------|---------|
| `jobScheduleQueue.js` | Schedule time reminder scheduler |
| `jobScheduleWorker.js` | Process schedule reminders |
| `jobAutoCancel.js` | Accept timeout + post-acceptance scheduler |
| `jobAutoCancelWorker.js` | Process cancellations + reminders |
| `job.controller.js` | Job API endpoints |
| `payment.model.js` | Payment schema with escrow tracking |
| `wallet.model.js` | User wallet (customer/provider/admin) |

---

## ✅ Testing Checklist

- [ ] Book job with valid card → See pending status
- [ ] Wait 7 hours → Provider gets warning notification
- [ ] Accept job before 8 hours → Auto-cancel cancelled, reminders scheduled
- [ ] Don't start by +5 mins → Job auto-cancelled, customer refunded
- [ ] Check refund: Service price - 10% fee
- [ ] Check admin wallet: Platform fee kept
- [ ] Verify all notifications sent to correct users

---