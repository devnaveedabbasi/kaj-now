import dotenv from 'dotenv';
dotenv.config();

export default {
    port: process.env.PORT ||80,
    database: {
        url: process.env.MONGODB_URI,
        options: {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 20000,
        }
    },
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: '7d'
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
    },

    email: {
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_SECURE === 'true' || false,
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD
    },

    /** SSLCommerz Payment Gateway Configuration */
    sslcommerz: {
        storeId: process.env.SSLCOMMERZ_STORE_ID,
        storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD,
        sandbox: process.env.SSLCOMMERZ_SANDBOX === 'true',
    },

    /** Required for POST /api/auth/admin/register (header X-Admin-Registration-Secret or body registrationSecret) */
    adminRegistrationSecret: process.env.ADMIN_REGISTRATION_SECRET || ''
};