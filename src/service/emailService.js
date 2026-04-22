import nodemailer from 'nodemailer';
import config from '../config/index.js';

console.log("Config Check:", config.email);

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure, // false for 587, true for 465
    auth: {
        user: config.email.user,
        pass: config.email.password,
    },
});

/**
 * Verification Email bhejny ka function
 * @param {string} to - User ka email
 * @param {string} token - Verification token
 */
export const sendVerificationEmail = async (to, token) => {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

    const mailOptions = {
        from: `"Support Team" <${config.email.user}>`,
        to: to,
        subject: 'Verify Your Email Address',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: #333;">Welcome to our Platform!</h2>
                <p>Thanks for signing up. Please verify your email to get started.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationUrl}" 
                       style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                       Verify Email Address
                    </a>
                </div>
                <p>This link will expire in 1 hour.</p>
                <hr style="border: none; border-top: 1px solid #eee;" />
                <p style="font-size: 12px; color: #888;">If you didn't create an account, you can safely ignore this email.</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Verification email sent to: ${to}`);
    } catch (error) {
        console.error("Email sending failed:", error);
        throw new Error("Could not send verification email.");
    }
};

/**
 * Email OTP (mobile app — user enters code in app)
 * @param {string} to
 * @param {string} otp
 */
export const sendOtpEmail = async (to, otp) => {
    const mailOptions = {
        from: `"Kaj Now" <${config.email.user}>`,
        to,
        subject: 'Your verification code',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 24px;">
                <h2 style="color: #333; margin-top: 0;">Verify your email</h2>
                <p>Use this code in the app to verify your email address:</p>
                <p style="font-size: 28px; letter-spacing: 6px; font-weight: bold; color: #111; margin: 24px 0;">${otp}</p>
                <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. If you did not sign up, ignore this email.</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('OTP email failed:', error);
        throw new Error('Could not send verification email.');
    }
};