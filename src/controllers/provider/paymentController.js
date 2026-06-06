import Payment from '../../models/payment.model.js';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import mongoose from 'mongoose';
import User from '../../models/User.model.js';
import Wallet from '../../models/wallet.model.js';
import { createActivityLog } from '../../utils/createActivityLog.js';
import { createNotification } from '../../utils/notification.js';
import { processSSLCommerzCardPayment } from '../../service/sslcommerz.js';
import { validateCardDetails } from '../../utils/validateCardDetails.js';
export const paymentHistory = async (req, res) => {
    try {
        const userId = req.user._id;

        const provider = await Provider.findOne({ userId }).lean();
        if (!provider) {
            return res.status(404).json(new ApiResponse(404, null, 'Provider not found'));
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // ── Filters ─────────────────────────────────────────────────────────────
        const filter = { providerId: provider._id };

        if (req.query.paymentMethod && ['card', 'cod'].includes(req.query.paymentMethod)) {
            filter.paymentMethod = req.query.paymentMethod;
        }

        if (req.query.escrowStatus) {
            filter.escrowStatus = req.query.escrowStatus;
        }

        // ── Summary ──────────────────────────────────────────────────────────────
        const summary = await Payment.aggregate([
            { $match: { providerId: provider._id } },
            {
                $group: {
                    _id: null,
                    totalReturnToAdmin: {
                        $sum: {
                            $cond: [
                                { $eq: ['$escrowStatus', 'cod_completed'] },
                                '$returnToAdmin',
                                0
                            ]
                        }
                    },
                    totalEarnings: {
                        $sum: {
                            $cond: [
                                { $eq: ['$escrowStatus', 'released_to_provider'] },
                                '$providerAmount',
                                0
                            ]
                        }
                    },
                    totalJobs: { $sum: 1 }
                }
            }
        ]);

        const summaryData = summary[0] || {
            totalReturnToAdmin: 0,
            totalEarnings: 0,
            totalJobs: 0
        };

        // ── Payments ─────────────────────────────────────────────────────────────
        const [payments, totalCount] = await Promise.all([
            Payment.find(filter)
                .populate('customerId', 'name email profilePicture')
                .populate({
                    path: 'jobId',
                    select: 'orderId status schedule amount paymentMethod',
                    populate: {
                        path: 'service',
                        select: 'name icon price'
                    }
                })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payment.countDocuments(filter)
        ]);

        // ── Format ───────────────────────────────────────────────────────────────
        const formattedPayments = payments.map(p => ({
            _id: p._id,
            paymentMethod: p.paymentMethod,
            paymentStatus: p.paymentStatus,
            escrowStatus: p.escrowStatus,
            servicePrice: p.servicePrice,
            platformFee: p.platformFee,
            providerAmount: p.providerAmount,
            returnToAdmin: p.returnToAdmin || 0,
            createdAt: p.createdAt,
            releasedAt: p.releasedAt || null,
            job: p.jobId ? {
                _id: p.jobId._id,
                orderId: p.jobId.orderId,
                status: p.jobId.status,
                schedule: p.jobId.schedule,
                service: p.jobId.service ? {
                    name: p.jobId.service.name,
                    icon: p.jobId.service.icon,
                    price: p.jobId.service.price,
                } : null,
            } : null,
            customer: p.customerId ? {
                name: p.customerId.name,
                email: p.customerId.email,
                profilePicture: p.customerId.profilePicture,
            } : null,
        }));

        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json(
            new ApiResponse(200, {
                summary: {
                    totalReturnToAdmin: summaryData.totalReturnToAdmin,
                    totalEarnings: summaryData.totalEarnings,
                    totalJobs: summaryData.totalJobs,
                    codLimit: parseFloat(process.env.COD_DUES_LIMIT || '2000'),
                },
                payments: formattedPayments,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
                currentFilter: {
                    paymentMethod: req.query.paymentMethod || 'all',
                    escrowStatus: req.query.escrowStatus || 'all',
                }
            }, 'Payment history retrieved successfully')
        );

    } catch (error) {
        return res.status(error.statusCode || 500).json(
            new ApiResponse(error.statusCode || 500, null, error.message)
        );
    }
};

export const payToAdmin = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user._id;
        const { cardDetails } = req.body;

        // ── Card validation ──────────────────────────────────────────────────────
        if (
            !cardDetails?.cardNumber ||
            !cardDetails?.expiryDate ||
            !cardDetails?.cvv ||
            !cardDetails?.cardHolderName
        ) {
            throw new ApiError(400, 'Complete card details required');
        }
        validateCardDetails(cardDetails);

        // ── Provider dhundo ──────────────────────────────────────────────────────
        const provider = await Provider.findOne({ userId }).session(session);
        if (!provider) throw new ApiError(404, 'Provider not found');

        const user = await User.findById(userId).session(session);
        if (!user) throw new ApiError(404, 'User not found');

        // ── Pending COD dues calculate karo ─────────────────────────────────────
        const pendingPayments = await Payment.find({
            providerId: provider._id,
            paymentMethod: 'cod',
            returnToAdmin: { $gt: 0 }
        }).session(session);

        if (!pendingPayments.length) {
            throw new ApiError(400, 'No pending COD dues found');
        }

        const totalDues = pendingPayments.reduce((sum, p) => sum + (p.returnToAdmin || 0), 0);

        if (totalDues <= 0) {
            throw new ApiError(400, 'No dues to pay');
        }

        // ── SSLCommerz payment ───────────────────────────────────────────────────
        const tran_id = `COD_DUES_${provider._id}_${Date.now()}`;
    const BASE_URL = process.env.APP_BASE_URL;
console.log(BASE_URL, process.env.APP_BASE_URL, 'BASE_URL for SSLCommerz callbacks');
        const paymentData = {
            total_amount: totalDues,
            currency: 'BDT',
            tran_id,
            success_url: `${process.env.APP_BASE_URL}/api/payments/success`,
            fail_url: `${process.env.APP_BASE_URL}/api/payments/fail`,
            cancel_url: `${process.env.APP_BASE_URL}/api/payments/cancel`,
            ipn_url: `${process.env.APP_BASE_URL}/api/payments/ipn`,
            cus_name: user.name,
            cus_email: user.email,
            cus_phone: user.phone,
            cus_add1: user.location?.locationName || 'Dhaka',
            shipping_method: 'NO',
            product_name: 'COD Platform Fees',
            product_category: 'Fee',
            product_profile: 'general',
        };

        const sslResponse = await processSSLCommerzCardPayment(paymentData, cardDetails);

        if (!sslResponse || sslResponse.status !== 'SUCCESS') {
            throw new ApiError(400, 'Payment failed from gateway');
        }

        // ── Sab pending payments update karo ────────────────────────────────────
        const paymentIds = pendingPayments.map(p => p._id);

        await Payment.updateMany(
            { _id: { $in: paymentIds } },
            {
                $set: {
                    returnToAdmin: 0,
                    paymentStatus: 'completed',
                    releasedAt: new Date(),
                }
            },
            { session }
        );

        // ── Admin wallet mein amount add karo ────────────────────────────────────
        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (!adminUser) throw new ApiError(500, 'Admin not found');

        let adminWallet = await Wallet.findOne({
            userId: adminUser._id,
            role: 'admin'
        }).session(session);

        if (!adminWallet) {
            [adminWallet] = await Wallet.create(
                [{
                    userId: adminUser._id,
                    role: 'admin',
                    balance: 0,
                    totalEarnings: 0,
                    totalPlatformFees: 0,
                    isActive: true,
                }],
                { session }
            );
        }

        adminWallet.balance += totalDues;
        adminWallet.totalEarnings += totalDues;
        adminWallet.totalPlatformFees += totalDues;
        await adminWallet.save({ session });

        await session.commitTransaction();

        // ── Activity log ─────────────────────────────────────────────────────────
        await createActivityLog({
            userId,
            action: 'COD_DUES_PAID',
            entityType: 'Payment',
            entityId: provider._id,
            details: { totalDues, paymentsCleared: paymentIds.length, tran_id },
            req,
        });

        // ── Notifications ─────────────────────────────────────────────────────────
        await createNotification({
            userId,
            title: 'COD Dues Cleared',
            message: `You have successfully paid BDT ${totalDues} in platform fees. Your COD bookings are now active.`,
            type: 'payment',
            referenceId: provider._id,
        });

        await createNotification({
            userId: adminUser._id,
            title: 'COD Dues Received',
            message: `Provider ${user.name} has paid BDT ${totalDues} in COD platform fees.`,
            type: 'payment',
            referenceId: provider._id,
        });

        return res.status(200).json(
            new ApiResponse(200, {
                totalPaid: totalDues,
                paymentsCleared: paymentIds.length,
                transactionId: tran_id,
            }, `BDT ${totalDues} paid successfully to admin. COD bookings are now active.`)
        );

    } catch (error) {
        await session.abortTransaction();
        return res.status(error.statusCode || 500).json(
            new ApiResponse(error.statusCode || 500, null, error.message)
        );
    } finally {
        session.endSession();
    }
};
