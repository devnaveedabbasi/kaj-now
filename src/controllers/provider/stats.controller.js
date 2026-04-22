import Provider from '../../models/provider/Provider.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import {ApiResponse} from '../../utils/ApiResponse.js';
import {ApiError} from '../../utils/errorHandler.js';
import Job from '../../models/job.model.js';
export const getProviderDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider not found');
    }

    // 2. Services
    const services = await ServiceRequest.find({
      userId: provider.userId,
    });

    const serviceIds = services.map(s => s._id);

    // 3. Jobs (REAL DATA SOURCE)
    const jobs = await Job.find({
      provider: provider._id
    });

    // 4. Completed Jobs
    const completedJobs = jobs.filter(
      j => j.status === 'confirmed_by_user' || j.status === 'completed_by_provider'
    );

    // 5. Total Services
    const totalServices = services.length;

    // 6. Active Services
    const activeServices = services.filter(s => s.isActive).length;

    // 7. Total Jobs Completed
    const totalJobsCompleted = completedJobs.length;

    // 8. Total Earnings
    const totalEarnings = completedJobs.reduce((sum, job) => {
      return sum + (job.amount || 0);
    }, 0);

    // 9. Recent Jobs
    const recentJobs = await Job.find({
      provider: provider._id
    })
      .populate('service', 'name price icon')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const formattedRecentJobs = recentJobs.map(job => ({
      _id: job._id,
      serviceName: job.service?.name || 'N/A',
      price: job.amount || 0,
      status: job.status,
      createdAt: job.createdAt
    }));

    // 10. Response
    return res.status(200).json(
      new ApiResponse(200, {
        stats: {
          totalServices,
          activeServices,
          totalJobsCompleted,
          totalEarnings
        },
        recentJobs: formattedRecentJobs
      }, 'Dashboard stats fetched successfully')
    );

  } catch (error) {
    console.error(error);

    return res.status(500).json(
      new ApiResponse(500, null, error.message)
    );
  }
};
export const getProviderEarningsChart = async (req, res) => {
    try {
        const userId=req.user._id;
        const { filter = 'monthly' } = req.query; // Options: weekly, monthly, yearly
        
        // Verify provider exists
        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider not found');
        }
        
        // Get provider's services
        const providerServices = await ServiceRequest.find({ 
            providerId: provider._id,
            status: 'approved'
        }).select('serviceId');
        
        const serviceIds = providerServices.flatMap(sr => sr.serviceId);
        
        // Date range calculations
        const now = new Date();
        let startDate, endDate, groupBy;
        
        switch(filter) {
            case 'weekly':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
                endDate = now;
                groupBy = 'day';
                break;
            case 'monthly':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                endDate = now;
                groupBy = 'day';
                break;
            case 'yearly':
                startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
                endDate = now;
                groupBy = 'month';
                break;
            default:
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                endDate = now;
                groupBy = 'day';
        }
        
        // Aggregate earnings by period
        let earningsData = [];
        
        if (groupBy === 'month') {
            // Monthly aggregation for yearly view
            earningsData = await ServiceRequest.aggregate([
                {
                    $match: {
                        serviceId: { $in: serviceIds },
                        createdAt: { $gte: startDate, $lte: endDate },
                        status: { $in: ['completed', 'approved'] }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        totalEarnings: { $sum: '$totalPrice' },
                        totalJobs: { $sum: 1 }
                    }
                },
                {
                    $sort: { '_id.year': 1, '_id.month': 1 }
                }
            ]);
            
            // Format monthly data
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            earningsData = earningsData.map(item => ({
                period: `${monthNames[item._id.month - 1]} ${item._id.year}`,
                earnings: item.totalEarnings,
                jobs: item.totalJobs
            }));
        } else {
            // Daily aggregation for weekly/monthly view
            earningsData = await ServiceRequest.aggregate([
                {
                    $match: {
                        serviceId: { $in: serviceIds },
                        createdAt: { $gte: startDate, $lte: endDate },
                        status: { $in: ['completed', 'approved'] }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                            day: { $dayOfMonth: '$createdAt' }
                        },
                        totalEarnings: { $sum: '$totalPrice' },
                        totalJobs: { $sum: 1 }
                    }
                },
                {
                    $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
                }
            ]);
            
            // Format daily data
            earningsData = earningsData.map(item => {
                const date = new Date(item._id.year, item._id.month - 1, item._id.day);
                return {
                    period: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    earnings: item.totalEarnings,
                    jobs: item.totalJobs
                };
            });
        }
        
        // Calculate summary stats
        const totalEarnings = earningsData.reduce((sum, item) => sum + item.earnings, 0);
        const totalJobs = earningsData.reduce((sum, item) => sum + item.jobs, 0);
        const averageEarningsPerJob = totalJobs > 0 ? totalEarnings / totalJobs : 0;
        
        res.status(200).json(
            new ApiResponse(200, {
                filterApplied: filter,
                summary: {
                    totalEarnings,
                    totalJobs,
                    averageEarningsPerJob
                },
                chartData: earningsData,
                dateRange: {
                    startDate,
                    endDate
                }
            }, 'Provider earnings chart retrieved successfully')
        );
        
    } catch (error) {
        console.error('Error getting provider earnings chart:', error);
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};