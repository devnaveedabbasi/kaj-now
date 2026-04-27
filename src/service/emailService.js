import nodemailer from 'nodemailer';
import config from '../config/index.js';

console.log("Config Check:", config.email);

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
        user: config.email.user,
        pass: config.email.password,
    },
});

// =========================
// 📧 VERIFY EMAIL
// =========================
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


// =========================
// 📧 OTP EMAIL
// =========================
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


// =========================
// 💰 WITHDRAWAL APPROVED EMAIL
// =========================
export const sendWithdrawalApprovedEmail = async (to, data) => {
    const { amount, transactionId, fileName, filePath } = data;

    const mailOptions = {
        from: `"Kaj Now" <${config.email.user}>`,
        to,
        subject: 'Withdrawal Approved',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: green;">Withdrawal Approved </h2>

                <p>Your withdrawal has been successfully processed.</p>

                <p><strong>Amount:</strong> ${amount}</p>
                <p><strong>Transaction ID:</strong> ${transactionId || 'N/A'}</p>

                <p style="margin-top:20px;">
                    Please find your invoice attached.
                </p>

                <hr />
                <p style="font-size: 12px; color: #888;">Thank you for using our platform.</p>
            </div>
        `,
        attachments: [
            {
                filename: fileName,
                path: filePath,
            },
        ],
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Withdrawal approved email failed:', error);
        throw new Error('Could not send email.');
    }
};


// =========================
//  WITHDRAWAL REJECTED EMAIL
// =========================
export const sendWithdrawalRejectedEmail = async (to, data) => {
    const { amount, reason } = data;

    const mailOptions = {
        from: `"Kaj Now" <${config.email.user}>`,
        to,
        subject: 'Withdrawal Rejected',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: red;">Withdrawal Rejected </h2>

                <p>Your withdrawal request has been rejected.</p>

                <p><strong>Amount:</strong> ${amount}</p>
                <p><strong>Reason:</strong> ${reason}</p>

                <p style="margin-top:20px;">
                    Amount has been refunded to your wallet.
                </p>

                <hr />
                <p style="font-size: 12px; color: #888;">Contact support if you need help.</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Withdrawal rejected email failed:', error);
        throw new Error('Could not send email.');
    }
};