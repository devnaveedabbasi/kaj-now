import axios from 'axios';

const SSL_COMMERZ_STORE_ID = process.env.SSL_COMMERZ_STORE_ID;
const SSL_COMMERZ_STORE_PASSWORD = process.env.SSL_COMMERZ_STORE_PASSWORD;
const SSL_COMMERZ_IS_SANDBOX = process.env.SSL_COMMERZ_IS_SANDBOX === 'true';
const SSL_COMMERZ_BASE_URL = SSL_COMMERZ_IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://secure.sslcommerz.com';

// ─────────────────────────────────────────────────────────────
// CARD: Direct payment with card credentials (existing, unchanged)
// ─────────────────────────────────────────────────────────────
export async function processSSLCommerzPayment(paymentData, cardDetails) {
  try {
    const postData = {
      store_id: SSL_COMMERZ_STORE_ID,
      store_passwd: SSL_COMMERZ_STORE_PASSWORD,
      total_amount: paymentData.total_amount,
      currency: paymentData.currency,
      tran_id: paymentData.tran_id,
      success_url: paymentData.success_url,
      fail_url: paymentData.fail_url,
      cancel_url: paymentData.cancel_url,
      ipn_url: paymentData.ipn_url,
      cus_name: paymentData.cus_name,
      cus_email: paymentData.cus_email,
      cus_phone: paymentData.cus_phone,
      cus_add1: paymentData.cus_add1,
      cus_city: paymentData.cus_city || 'Dhaka',
      cus_country: paymentData.cus_country || 'Bangladesh',
      shipping_method: paymentData.shipping_method,
      product_name: paymentData.product_name,
      product_category: paymentData.product_category,
      product_profile: paymentData.product_profile,
      card_number: cardDetails.cardNumber,
      card_expiry: cardDetails.expiryDate,
      card_cvv: cardDetails.cvv,
      card_type: 'VISA',
    };

    const response = await axios.post(
      `${SSL_COMMERZ_BASE_URL}/gwprocess/v4/api.php`,
      new URLSearchParams(postData),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data;
  } catch (error) {
    console.error('SSLCommerz card payment error:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// BKASH: Initiate SSLCommerz session restricted to bKash only
// Returns a GatewayPageURL the frontend redirects to
// ─────────────────────────────────────────────────────────────
export async function initiateBkashSession(paymentData) {
  try {
    const postData = {
      store_id: SSL_COMMERZ_STORE_ID,
      store_passwd: SSL_COMMERZ_STORE_PASSWORD,
      total_amount: paymentData.total_amount,
      currency: paymentData.currency || 'BDT',
      tran_id: paymentData.tran_id,
      success_url: paymentData.success_url,
      fail_url: paymentData.fail_url,
      cancel_url: paymentData.cancel_url,
      ipn_url: paymentData.ipn_url,
      cus_name: paymentData.cus_name,
      cus_email: paymentData.cus_email,
      cus_phone: paymentData.cus_phone,
      cus_add1: paymentData.cus_add1 || 'Dhaka',
      cus_city: paymentData.cus_city || 'Dhaka',
      cus_country: paymentData.cus_country || 'Bangladesh',
      shipping_method: 'NO',
      product_name: paymentData.product_name,
      product_category: paymentData.product_category || 'Service',
      product_profile: 'general',

      // ── bKash-specific SSLCommerz parameters ──────────────────
      // Restrict the gateway page to show only bKash as payment option
      emi_option: 0,
      allowed_bin: 'bKash',        // Whitelists bKash on the hosted page
      payment_option: 'only_bkash', // SSLCommerz flag to filter payment methods
    };

    const response = await axios.post(
      `${SSL_COMMERZ_BASE_URL}/gwprocess/v4/api.php`,
      new URLSearchParams(postData),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data; // Expect { status: 'SUCCESS', GatewayPageURL: '...', sessionkey: '...' }
  } catch (error) {
    console.error('SSLCommerz bKash session error:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// VALIDATION: Shared by both card and bKash callback handlers
// ─────────────────────────────────────────────────────────────
export const validateSSLCommerzPayment = async (val_id) => {
  try {
    const store_id = SSL_COMMERZ_STORE_ID;
    const store_passwd = SSL_COMMERZ_STORE_PASSWORD;   // ← Sirf actual password (no @ssl)

    if (!val_id || !store_id || !store_passwd) {
      throw new Error('Missing SSLCommerz Store ID or Password in .env');
    }

    const response = await axios.get(
      'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php',
      {
        params: {
          val_id,
          store_id,
          store_passwd,
          format: 'json',
          v: 1                          // Important for better response
        },
        timeout: 15000
      }
    );

    console.log('[SSLCommerz Validation Success]', response.data);
    return response.data;

  } catch (error) {
    console.error('[SSLCommerz Validation FAILED]');
    console.error({
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    throw error;
  }
};