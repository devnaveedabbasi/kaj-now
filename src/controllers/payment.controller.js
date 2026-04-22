// controllers/payment.controller.js
import mongoose from 'mongoose';
import Payment from '../models/payment.model.js';
import Job from '../models/job.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';
import { validateSSLCommerzPayment } from '../service/sslcommerz.js';
 
export async function paymentSuccess(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tran_id, val_id } = req.query;

    // Validate payment with SSLCommerz
    const validation = await validateSSLCommerzPayment(val_id, null);
    
    if (validation.status !== 'VALID') {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/failed?transaction=${tran_id}`);
    }

    // Find payment record
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id }).session(session);
    if (!payment) {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/not-found`);
    }

    // Update payment status to completed
    payment.paymentStatus = 'completed';
    payment.escrowStatus = 'held_in_admin_wallet';
    payment.sslCommerzValidation = true;
    await payment.save({ session });

    // Update job to show payment is held in escrow
    const job = await Job.findById(payment.jobId).session(session);
    if (job) {
      job.paymentStatus = 'held_in_escrow';
      await job.save({ session });
    }

    await session.commitTransaction();

    // Redirect to success page
    return res.redirect(`${process.env.FRONTEND_URL}/payment/success?job=${job._id}`);

  } catch (error) {
    await session.abortTransaction();
    console.error('Payment success error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  } finally {
    session.endSession();
  }
}

// ====================================================
// PAYMENT FAILED (From SSLCommerz)
// ====================================================
export async function paymentFailed(req, res) {
  try {
    const { tran_id } = req.query;

    // Find and mark payment as failed
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
    if (payment) {
      payment.paymentStatus = 'failed';
      await payment.save();

      // Update job status
      const job = await Job.findById(payment.jobId);
      if (job) {
        job.status = 'pending'; // Keep pending for retry
        job.paymentStatus = 'pending';
        await job.save();
      }
    }

    return res.redirect(`${process.env.FRONTEND_URL}/payment/failed?transaction=${tran_id}`);
  } catch (error) {
    console.error('Payment failed error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  }
}

