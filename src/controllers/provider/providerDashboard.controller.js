import mongoose from 'mongoose';
import { Provider } from '../../models/Provider.model.js';
import { Service } from '../../models/Service.model.js';
import { Job } from '../../models/Job.model.js';

function utcDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function buildLastNDayKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    keys.push(utcDateKey(d));
  }
  return keys;
}

function buildLastNMonthKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    keys.push(ym);
  }
  return keys;
}

function fillSeries(keys, amountByKey) {
  return keys.map((key) => ({
    period: key,
    amount: amountByKey.get(key) ?? 0,
  }));
}

const servicePopulate = [
  { path: 'serviceCategory', select: 'name slug icon' },
  { path: 'serviceSubcategories', select: 'name icon' },
];

export async function getDashboard(req, res) {
  try {
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const pid = provider._id;
    const pidObj = new mongoose.Types.ObjectId(String(pid));

    const chartDays = Math.min(Math.max(Number(req.query.chartDays) || 30, 7), 90);
    const chartMonths = Math.min(Math.max(Number(req.query.chartMonths) || 6, 3), 24);

    const dayKeys = buildLastNDayKeys(chartDays);
    const monthKeys = buildLastNMonthKeys(chartMonths);
    const firstDay = `${dayKeys[0]}T00:00:00.000Z`;
    const firstMonth = `${monthKeys[0]}-01T00:00:00.000Z`;

    const [
      activeJobsCount,
      completedJobsCount,
      activeServicesCount,
      earningAgg,
      dailyAgg,
      monthlyAgg,
      topByRevenue,
    ] = await Promise.all([
      Job.countDocuments({
        provider: pid,
        status: { $in: ['pending', 'in_progress'] },
      }),
      Job.countDocuments({ provider: pid, status: 'completed' }),
      Service.countDocuments({ provider: pid, isActive: true }),
      Job.aggregate([
        { $match: { provider: pidObj, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Job.aggregate([
        {
          $match: {
            provider: pidObj,
            status: 'completed',
            completedAt: { $gte: new Date(firstDay) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'UTC' },
            },
            amount: { $sum: '$amount' },
          },
        },
      ]),
      Job.aggregate([
        {
          $match: {
            provider: pidObj,
            status: 'completed',
            completedAt: { $gte: new Date(firstMonth) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m', date: '$completedAt', timezone: 'UTC' },
            },
            amount: { $sum: '$amount' },
          },
        },
      ]),
      Job.aggregate([
        {
          $match: {
            provider: pidObj,
            status: 'completed',
            service: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$service',
            revenue: { $sum: '$amount' },
            completedCount: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 6 },
      ]),
    ]);

    const totalEarning = earningAgg[0]?.total ?? 0;

    const dailyMap = new Map(dailyAgg.map((r) => [r._id, r.amount]));
    const monthlyMap = new Map(monthlyAgg.map((r) => [r._id, r.amount]));

    const topServiceIds = topByRevenue.map((r) => r._id).filter(Boolean);
    const servicesFromDb =
      topServiceIds.length > 0
        ? await Service.find({ _id: { $in: topServiceIds } }).populate(servicePopulate)
        : [];
    const svcById = new Map(servicesFromDb.map((s) => [String(s._id), s]));

    const topServices = topByRevenue.map((row) => {
      const s = svcById.get(String(row._id));
      const plain = s ? s.toJSON() : null;
      return {
        serviceId: row._id,
        name: plain?.name ?? null,
        price: plain?.price ?? null,
        time: plain?.durationMinutes ?? plain?.time ?? null,
        description: plain?.description ?? null,
        isActive: plain?.isActive ?? null,
        serviceCategory: plain?.serviceCategory ?? null,
        serviceSubcategories: plain?.serviceSubcategories ?? null,
        revenue: row.revenue,
        completedJobsCount: row.completedCount,
      };
    });

    const needMore = 6 - topServices.length;
    if (needMore > 0) {
      const exclude = new Set(topServiceIds.map(String));
      const fallback = await Service.find({
        provider: pid,
        isActive: true,
        ...(exclude.size ? { _id: { $nin: [...exclude].map((id) => new mongoose.Types.ObjectId(id)) } } : {}),
      })
        .sort({ updatedAt: -1 })
        .limit(needMore)
        .populate(servicePopulate);

      for (const s of fallback) {
        const j = s.toJSON();
        topServices.push({
          serviceId: s._id,
          name: j.name,
          price: j.price,
          time: j.durationMinutes,
          description: j.description,
          isActive: j.isActive,
          serviceCategory: j.serviceCategory,
          serviceSubcategories: j.serviceSubcategories,
          revenue: 0,
          completedJobsCount: 0,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        summary: {
          activeJobsCount,
          activeServicesCount,
          completedJobsCount,
          totalEarning,
          currency: 'PKR',
        },
        earningsOverview: {
          daily: fillSeries(dayKeys, dailyMap),
          monthly: fillSeries(monthKeys, monthlyMap),
        },
        topServices,
      },
    });
  } catch (err) {
    console.error('provider dashboard:', err);
    return res.status(500).json({ success: false, message: err.message || 'Dashboard failed.' });
  }
}

