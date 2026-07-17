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
