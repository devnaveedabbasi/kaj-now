import Provider from '../../models/provider/Provider.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import {ApiResponse} from '../../utils/apiResponse.js';
import {ApiError} from '../../utils/errorHandler.js';
import Payment from '../../models/payment.model.js';
import Job from '../../models/job.model.js';
export const getProviderDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider not found');
    }

    // 2. Services Stats (ARRAY LENGTH COUNT)
    const serviceStats = await ServiceRequest.aggregate([
      {
        $match: { providerId: provider._id },
      },
      {
        $project: {
          serviceCount: { $size: "$serviceId" },
          status: 1,
        },
      },
      {
        $group: {
          _id: null,
          totalServices: { $sum: "$serviceCount" },
          activeServices: {
            $sum: {
              $cond: [
                { $eq: ["$status", "approved"] },
                "$serviceCount",
                0,
              ],
            },
          },
        },
      },
    ]);

    const totalServices = serviceStats[0]?.totalServices || 0;
    const activeServices = serviceStats[0]?.activeServices || 0;

    // 3. Jobs Stats (AGGREGATION)
    const jobStats = await Job.aggregate([
      {
        $match: { provider: provider._id },
      },
      {
        $group: {
          _id: null,
          totalJobsCompleted: {
            $sum: {
              $cond: [
                { $eq: ["$status", "confirmed_by_user"] },
                1,
                0,
              ],
            },
          },
          totalEarnings: {
            $sum: {
              $cond: [
                { $eq: ["$status", "confirmed_by_user"] },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]);

    const totalJobsCompleted = jobStats[0]?.totalJobsCompleted || 0;
    const totalEarnings = jobStats[0]?.totalEarnings || 0;

    // 4. Recent Jobs
    const recentJobs = await Job.find({
      provider: provider._id,
    })
      .populate('service', 'name price icon')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const formattedRecentJobs = recentJobs.map((job) => ({
      _id: job._id,
      serviceName: job.service?.name || 'N/A',
      price: job.amount || 0,
      status: job.status,
      createdAt: job.createdAt,
    }));

    // 5. Final Response
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          stats: {
            totalServices,
            activeServices,
            totalJobsCompleted,
            totalEarnings,
          },
          recentJobs: formattedRecentJobs,
        },
        'Dashboard stats fetched successfully'
      )
    );
  } catch (error) {
    console.error('Dashboard Error:', error);

    return res.status(500).json(
      new ApiResponse(500, null, error.message)
    );
  }
};
export const getProviderEarningsChart = async (req, res) => {
  try {
    const userId = req.user._id;
    const { filter = 'monthly' } = req.query;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider not found');
    }

    // DATE RANGE
    const now = new Date();
    let startDate = new Date();

    if (filter === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (filter === 'yearly') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate.setDate(now.getDate() - 30);
    }

    // GET PAYMENTS (IMPORTANT FIX)
    const payments = await Payment.find({
      providerId: provider._id,
      paymentStatus: 'completed',
      escrowStatus: 'released_to_provider',
      createdAt: { $gte: startDate, $lte: now },
    }).lean();

    // SAFE GROUPING (JS SIDE - MORE RELIABLE)
    const map = new Map();

    payments.forEach((p) => {
      const date = new Date(p.createdAt);

      let key;

      if (filter === 'yearly') {
        key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      } else {
        key = date.toISOString().split('T')[0]; // YYYY-MM-DD
      }

      // Use servicePrice for gross earnings (before platform fee)
      const amount = p.servicePrice || 0;

      if (!map.has(key)) {
        map.set(key, { earnings: 0, jobs: 0 });
      }

      const prev = map.get(key);
      map.set(key, {
        earnings: prev.earnings + amount,
        jobs: prev.jobs + 1,
      });
    });

    // FORMAT FOR CHART
    const earningsData = Array.from(map.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([key, value]) => ({
        period: key,
        earnings: value.earnings,
        jobs: value.jobs,
      }));

    // SUMMARY
    const totalEarnings = payments.reduce(
      (sum, p) => sum + (p.servicePrice || 0),
      0
    );

    const totalJobs = payments.length;
    const averageEarningsPerJob =
      totalJobs > 0 ? totalEarnings / totalJobs : 0;

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          filterApplied: filter,
          summary: {
            totalEarnings,
            totalJobs,
            averageEarningsPerJob,
          },
          chartData: earningsData,
          dateRange: {
            startDate,
            endDate: now,
          },
        },
        'Provider earnings chart retrieved successfully'
      )
    );
  } catch (error) {
    console.error('Earnings Chart Error:', error);

    return res
      .status(500)
      .json(new ApiResponse(500, null, error.message));
  }
};