// service/sslcommerz.js
import axios from 'axios';

const SSL_COMMERZ_STORE_ID = process.env.SSL_COMMERZ_STORE_ID;
const SSL_COMMERZ_STORE_PASSWORD = process.env.SSL_COMMERZ_STORE_PASSWORD;
const SSL_COMMERZ_IS_SANDBOX = process.env.SSL_COMMERZ_IS_SANDBOX === 'true';
const SSL_COMMERZ_BASE_URL = SSL_COMMERZ_IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://secure.sslcommerz.com';

// ─────────────────────────────────────────────────────────────
// INITIATE PAYMENT WITH SPECIFIC METHOD
// ─────────────────────────────────────────────────────────────
// service/sslcommerz.js - Ensure payment_option is correct

export async function initiateSSLCommerzPayment(paymentData) {
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
      shipping_method: paymentData.shipping_method || 'NO',
      product_name: paymentData.product_name,
      product_category: paymentData.product_category || 'Service',
      product_profile: paymentData.product_profile || 'general',
      emi_option: 0,
    };

    // Map payment methods to SSLCommerz multi_card_name
    // Setting multi_card_name locks the hosted page to show ONLY that method
    // SSLCommerz expects specific internal gateway names.
    const methodMapping = {
      'bkash': 'bkash',
      'nagad': 'nagad',
      'rocket': 'dbblmobilebanking',
      'bank': 'internetbank',
      'card': 'visa,master,amex,othercards',
    };
    if (paymentData.payment_method) {
      postData.multi_card_name = methodMapping[paymentData.payment_method];
      postData.payment_option = paymentData.payment_method;
    }
    console.log('[SSLCommerz] Post Data:', {
      ...postData,
      store_passwd: '***HIDDEN***'
    });

    const response = await axios.post(
      `${SSL_COMMERZ_BASE_URL}/gwprocess/v4/api.php`,
      new URLSearchParams(postData),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data;
  } catch (error) {
    console.error('SSLCommerz Init Error:', error.response?.data || error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// CARD: Direct payment with card credentials
// ─────────────────────────────────────────────────────────────
export async function processSSLCommerzCardPayment(paymentData, cardDetails) {
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
      card_type: cardDetails.cardType || 'VISA',
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
// VALIDATION: Shared by all payment methods
// ─────────────────────────────────────────────────────────────
// service/sslcommerz.js - Fix validation

export const validateSSLCommerzPayment = async (val_id) => {
  try {
    const store_id = SSL_COMMERZ_STORE_ID;
    const store_passwd = SSL_COMMERZ_STORE_PASSWORD;

    console.log('[SSLCommerz Validation] Request params:', {
      val_id,
      store_id,
      hasPassword: !!store_passwd,
      passwordLength: store_passwd?.length
    });

    if (!val_id || !store_id || !store_passwd) {
      throw new Error('Missing SSLCommerz Store ID or Password in .env');
    }

    const apiUrl = `${SSL_COMMERZ_BASE_URL}/validator/api/validationserverAPI.php`;

    const response = await axios.get(apiUrl, {
      params: {
        val_id,
        store_id,
        store_passwd,
        format: 'json',
        v: 1
      },
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    console.log('[SSLCommerz Validation] Response status:', response.status);
    console.log('[SSLCommerz Validation] Response data:', response.data);

    return response.data;
  } catch (error) {
    // Log the failure but return null — let the CALLER decide whether to
    // fall back to trusting the callback status (sandbox) or fail hard (prod)
    console.error('[SSLCommerz Validation FAILED]', {
      message: error.message,
      httpStatus: error.response?.status,
      val_id,
    });
    // Re-throw so the caller can distinguish network/server errors from
    // a clean 'INVALID' response
    throw error;
  }
};
// ─────────────────────────────────────────────────────────────
// REFUND FUNCTION
// ─────────────────────────────────────────────────────────────
export async function refundSSLCommerzPayment(refundData) {
  try {
    const postData = {
      store_id: SSL_COMMERZ_STORE_ID,
      store_passwd: SSL_COMMERZ_STORE_PASSWORD,
      refund_amount: refundData.amount,
      refund_remarks: refundData.reason || 'Customer refund',
      bank_tran_id: refundData.bank_tran_id,
      refund_opt: 'yes',
    };

    const response = await axios.post(
      `${SSL_COMMERZ_BASE_URL}/validator/api/merchantTransIDvalidationAPI.php`,
      new URLSearchParams(postData),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data;
  } catch (error) {
    console.error('SSLCommerz Refund Error:', error.message);
    throw error;
  }
}