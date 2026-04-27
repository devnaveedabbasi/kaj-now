export const verificationTemplate = (verificationUrl) => {
  return `
    <div style="font-family: Arial; max-width:600px; margin:auto; padding:20px;">
      <h2>Welcome to Kaj Now </h2>

      <p>Please verify your email to continue:</p>

      <a href="${verificationUrl}" 
         style="display:inline-block;padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:5px;">
        Verify Email
      </a>

      <p style="margin-top:20px;font-size:12px;color:#777;">
        This link will expire in 1 hour.
      </p>
    </div>
  `;
};

// 🔹 2. OTP Email
export const otpTemplate = (otp) => {
  return `
    <div style="font-family: Arial; max-width:600px; margin:auto; padding:20px;">
      <h2>Your Verification Code </h2>

      <p>Use this OTP to verify your account:</p>

      <h1 style="letter-spacing:6px;">${otp}</h1>

      <p style="font-size:12px;color:#777;">
        This code expires in 10 minutes.
      </p>
    </div>
  `;
};

// 🔹 3. Withdrawal Approved
export const withdrawalApprovedTemplate = ({ amount, transactionId }) => {
  return `
    <div style="font-family: Arial; max-width:600px; margin:auto; padding:20px;border:1px solid #eee;">
      
      <h2 style="color:green;">Withdrawal Approved </h2>

      <p>Your withdrawal request has been processed successfully.</p>

      <table style="width:100%;margin-top:15px;">
        <tr>
          <td><strong>Amount:</strong></td>
          <td>${amount}</td>
        </tr>
        <tr>
          <td><strong>Transaction ID:</strong></td>
          <td>${transactionId || 'N/A'}</td>
        </tr>
      </table>

      <p style="margin-top:20px;">
        Invoice is attached with this email.
      </p>

      <hr />
      <p style="font-size:12px;color:#777;">
        Thank you for using Kaj Now.
      </p>
    </div>
  `;
};

// 🔹 4. Withdrawal Rejected
export const withdrawalRejectedTemplate = ({ amount, reason }) => {
  return `
    <div style="font-family: Arial; max-width:600px; margin:auto; padding:20px;border:1px solid #eee;">
      
      <h2 style="color:red;">Withdrawal Rejected </h2>

      <p>Your withdrawal request was rejected.</p>

      <table style="width:100%;margin-top:15px;">
        <tr>
          <td><strong>Amount:</strong></td>
          <td>${amount}</td>
        </tr>
        <tr>
          <td><strong>Reason:</strong></td>
          <td>${reason}</td>
        </tr>
      </table>

      <p style="margin-top:20px;">
        Amount has been refunded to your wallet.
      </p>

      <hr />
      <p style="font-size:12px;color:#777;">
        Contact support if you need help.
      </p>
    </div>
  `;
};