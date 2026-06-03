import Provider from '../../models/provider/Provider.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/errorHandler.js';
import Payment from '../../models/payment.model.js';
import Job from '../../models/job.model.js';
import Wallet from '../../models/wallet.model.js';
export const getProviderDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider not found');
    }

    const [serviceStats, jobStats, wallet] = await Promise.all([
      ServiceRequest.aggregate([
        { $match: { providerId: provider._id } },
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
                $cond: [{ $eq: ["$status", "approved"] }, "$serviceCount", 0],
              },
            },
          },
        },
      ]),

      Job.aggregate([
        { $match: { provider: provider._id } },
        {
          $group: {
            _id: null,
            totalJobsCompleted: {
              $sum: {
                $cond: [{ $in: ["$status", ["confirmed_by_user", "confirmed_by_admin"]] }, 1, 0],
              },
            },
          },
        },
      ]),

      //  provider._id se query karo — wallet mein yahi save hai
      Wallet.findOne({
        userId: provider._id,
        role: 'provider',
      }),
    ]);

    const totalServices = serviceStats[0]?.totalServices || 0;
    const activeServices = serviceStats[0]?.activeServices || 0;
    const totalJobsCompleted = jobStats[0]?.totalJobsCompleted || 0;
    const totalEarnings = wallet?.totalEarnings || 0;
    const totalBalance = wallet?.balance || 0;

    const recentJobs = await Job.find({ provider: provider._id })
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

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          stats: {
            totalServices,
            activeServices,
            totalJobsCompleted,
            totalEarnings,
            totalBalance,
          },
          recentJobs: formattedRecentJobs,
        },
        'Dashboard stats fetched successfully'
      )
    );
  } catch (error) {
    console.error('Dashboard Error:', error);
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

export const getProviderEarningsChart = async (req, res) => {
  try {
    const userId = req.user._id;
    const { filter = 'monthly' } = req.query;

    const provider = await Provider.findOne({ userId });
    if (!provider) throw new ApiError(404, 'Provider not found');

const wallet = await Wallet.findOne({ userId: provider._id, role: 'provider' })
  .populate('transactionHistory')
      .lean();
    // Date range
    const now = new Date();
    let startDate = new Date();
    if (filter === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (filter === 'yearly') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate.setDate(now.getDate() - 30);
    }

    //  Filter payments from wallet's transactionHistory by date
    const payments = (wallet?.transactionHistory || []).filter((p) => {
      const created = new Date(p.createdAt);
      return (
        p.escrowStatus === 'released_to_provider' &&
        p.paymentStatus === 'completed' &&
        created >= startDate &&
        created <= now
      );
    });

    // Group by period
    const map = new Map();
    payments.forEach((p) => {
      const date = new Date(p.createdAt);
      const key = filter === 'yearly'
        ? `${date.getFullYear()}-${date.getMonth() + 1}`
        : date.toISOString().split('T')[0];

      const amount = p.providerAmount || 0; //  providerAmount - provider ka actual earning
      if (!map.has(key)) map.set(key, { earnings: 0, jobs: 0 });
      const prev = map.get(key);
      map.set(key, { earnings: prev.earnings + amount, jobs: prev.jobs + 1 });
    });

    const chartData = Array.from(map.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([period, value]) => ({ period, ...value }));

    //  Summary directly from wallet - most accurate
    const totalEarnings = wallet?.totalEarnings || 0;
    const totalBalance = wallet?.balance || 0;
    const totalWithdrawn = wallet?.totalWithdrawn || 0;
    const totalJobs = payments.length;
    const averageEarningsPerJob = totalJobs > 0
      ? payments.reduce((sum, p) => sum + (p.providerAmount || 0), 0) / totalJobs
      : 0;

    return res.status(200).json(new ApiResponse(200, {
      filterApplied: filter,
      summary: {
        totalEarnings,   // lifetime earnings from wallet
        totalBalance,    // current balance
        totalWithdrawn,  // total withdrawn
        totalJobs,       // jobs in selected period
        averageEarningsPerJob,
      },
      chartData,
      dateRange: { startDate, endDate: now },
    }, 'Provider earnings chart retrieved successfully'));

  } catch (error) {
    console.error('Earnings Chart Error:', error);
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};