// services/sslcommerz.service.js
import axios from 'axios';
import crypto from 'crypto';

const SSL_COMMERZ_STORE_ID = process.env.SSL_COMMERZ_STORE_ID;
const SSL_COMMERZ_STORE_PASSWORD = process.env.SSL_COMMERZ_STORE_PASSWORD;
const SSL_COMMERZ_IS_SANDBOX = process.env.SSL_COMMERZ_IS_SANDBOX === 'true';
const SSL_COMMERZ_BASE_URL = SSL_COMMERZ_IS_SANDBOX 
  ? 'https://sandbox.sslcommerz.com' 
  : 'https://secure.sslcommerz.com';

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
      cus_city: paymentData.cus_city,
      cus_country: paymentData.cus_country,
      shipping_method: paymentData.shipping_method,
      product_name: paymentData.product_name,
      product_category: paymentData.product_category,
      product_profile: paymentData.product_profile,
      // Card details for direct payment
      card_number: cardDetails.cardNumber,
      card_expiry: cardDetails.expiryDate,
      card_cvv: cardDetails.cvv,
      card_type: 'VISA' // or MASTERCARD, AMEX etc
    };

    const response = await axios.post(
      `${SSL_COMMERZ_BASE_URL}/gwprocess/v4/api.php`,
      new URLSearchParams(postData),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('SSLCommerz error:', error);
    throw error;
  }
}

export async function validateSSLCommerzPayment(transactionId, amount) {
  try {
    const validationUrl = `${SSL_COMMERZ_BASE_URL}/validator/api/validationserverAPI.php`;
    const postData = {
      val_id: transactionId,
      store_id: SSL_COMMERZ_STORE_ID,
      store_passwd: SSL_COMMERZ_STORE_PASSWORD,
      format: 'json'
    };

    const response = await axios.get(validationUrl, { params: postData });
    return response.data;
  } catch (error) {
    console.error('SSLCommerz validation error:', error);
    throw error;
  }
}