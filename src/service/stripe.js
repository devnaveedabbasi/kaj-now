import Stripe from 'stripe';
import config from '../config/index.js';

// Initialize Stripe only if the secret key is provided
let stripe = null;
if (config.stripe.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
}

/**
 * Creates a Stripe PaymentIntent.
 * @param {number} amount Amount in the smallest currency unit (e.g., pence for GBP).
 * @param {string} currency Currency code (e.g., 'gbp').
 * @param {object} metadata Custom metadata to store in the PaymentIntent.
 * @returns {object} The created PaymentIntent object.
 */
export async function createStripePaymentIntent(amount, currency = 'gbp', metadata = {}) {
  if (!stripe) {
    throw new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // convert to pence/cents
      currency: currency.toLowerCase(),
      metadata,
    });
    return paymentIntent;
  } catch (error) {
    console.error('[Stripe] createPaymentIntent Error:', error.message);
    throw new Error(`Stripe payment intent creation failed: ${error.message}`);
  }
}

/**
 * Retrieves a Stripe PaymentIntent by ID.
 * @param {string} paymentIntentId The Stripe PaymentIntent ID.
 * @returns {object} The retrieved PaymentIntent object.
 */
export async function retrieveStripePaymentIntent(paymentIntentId) {
  if (!stripe) {
    throw new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
  } catch (error) {
    console.error('[Stripe] retrievePaymentIntent Error:', error.message);
    throw new Error(`Failed to retrieve Stripe payment intent: ${error.message}`);
  }
}

/**
 * Refunds a Stripe PaymentIntent back to the customer's original card.
 * @param {string} paymentIntentId The Stripe PaymentIntent ID to refund.
 * @param {number} [amount] Amount to refund in major currency units (e.g. GBP) — omit for a full refund.
 * @param {string} [reason] One of Stripe's refund reasons: 'duplicate' | 'fraudulent' | 'requested_by_customer'.
 * @returns {object} The created Refund object.
 */
export async function createStripeRefund(paymentIntentId, amount = null, reason = null) {
  if (!stripe) {
    throw new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
  }

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amount != null && { amount: Math.round(amount * 100) }),
      ...(reason && { reason }),
    });
    return refund;
  } catch (error) {
    console.error('[Stripe] createRefund Error:', error.message);
    throw new Error(`Stripe refund failed: ${error.message}`);
  }
}
