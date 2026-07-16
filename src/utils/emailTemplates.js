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

// 🔹 4. Complaint Reply
export const complaintReplyTemplate = ({ userName, complaintType, complaintDescription, adminReply }) => {
  const typeLabels = {
    provider_behavior: 'Provider Behavior',
    provider_issue: 'Provider Issue',
    technical_issue: 'Technical Issue',
    other: 'Other',
  };

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 30px;">
      <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
        KajNow Support — Response to Your Complaint
      </h2>

      <p>Dear <strong>${userName}</strong>,</p>

      <p>Thank you for contacting KajNow Support. We have reviewed your complaint and are happy to assist you.</p>

      <div style="background: #f9f9f9; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 6px;"><strong>Complaint Type:</strong> ${typeLabels[complaintType] || complaintType}</p>
        <p style="margin: 0;"><strong>Your Description:</strong> ${complaintDescription}</p>
      </div>

      <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 6px;"><strong>Our Response:</strong></p>
        <p style="margin: 0; line-height: 1.7;">${adminReply}</p>
      </div>

      <p>We hope this resolves your concern. If you have any further questions, please don't hesitate to reach out to us again.</p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
      <p style="font-size: 12px; color: #888;">
        Best regards,<br/>
        <strong>KajNow Support Team</strong>
      </p>
    </div>
  `;
};

// 🔹 5. Note Reply
export const noteReplyTemplate = ({ userName, noteText, adminReply }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 30px;">
      <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
        KajNow Support — Response to Your Note
      </h2>

      <p>Dear <strong>${userName}</strong>,</p>

      <p>Thank you for reaching out. We have reviewed your note and here is our response.</p>

      <div style="background: #f9f9f9; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 6px;"><strong>Your Note:</strong></p>
        <p style="margin: 0; line-height: 1.7;">${noteText}</p>
      </div>

      <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 6px;"><strong>Our Response:</strong></p>
        <p style="margin: 0; line-height: 1.7;">${adminReply}</p>
      </div>

      <p>We hope this helps. Feel free to send us another note if you need further assistance.</p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
      <p style="font-size: 12px; color: #888;">
        Best regards,<br/>
        <strong>KajNow Support Team</strong>
      </p>
    </div>
  `;
};

// 🔹 5b. User Note Reply (UK support-note feature)
export const userNoteReplyTemplate = ({ userName, note, reply, repliedAt }) => {
  const repliedAtStr = repliedAt ? new Date(repliedAt).toLocaleString('en-GB') : '';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 30px;">
      <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
        Your Support Note Has Been Answered
      </h2>

      <p>Dear <strong>${userName}</strong>,</p>

      <p>Thank you for reaching out. We have reviewed your note and here is our response.</p>

      <div style="background: #f9f9f9; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 6px;"><strong>Your Note:</strong></p>
        <p style="margin: 0; line-height: 1.7;">${note}</p>
      </div>

      <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0 0 6px;"><strong>Our Response:</strong></p>
        <p style="margin: 0; line-height: 1.7;">${reply}</p>
        ${repliedAtStr ? `<p style="margin: 10px 0 0; font-size: 12px; color: #777;">Replied on ${repliedAtStr}</p>` : ''}
      </div>

      <p>We hope this helps. Feel free to send us another note if you need further assistance.</p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
      <p style="font-size: 12px; color: #888;">
        Best regards,<br/>
        <strong>KajNow Support Team</strong>
      </p>
    </div>
  `;
};

// 🔹 6. Withdrawal Rejected
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

// 🔹 Contract Pending (UK Providers)
export const contractPendingTemplate = ({ userName }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 30px;">
    <h2 style="color: #1a1a2e; border-bottom: 2px solid #f5a623; padding-bottom: 10px;">
      KajNow — Action Required: Sign Your Contract
    </h2>
    <p>Dear <strong>${userName}</strong>,</p>
    <p>Great news! Your KYC documents have been <strong style="color: green;">approved</strong>.</p>
    <p>To complete your onboarding as a KajNow provider, you need to <strong>review and sign the Provider Agreement</strong> in your app.</p>
    <div style="background: #fff8e1; border-left: 4px solid #f5a623; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold;">Next Steps:</p>
      <ol style="margin: 10px 0 0; padding-left: 20px;">
        <li>Open the KajNow app</li>
        <li>Download and read the Provider Agreement</li>
        <li>Sign the contract digitally</li>
        <li>Submit for final approval</li>
      </ol>
    </div>
    <p>Once your contract is approved, you will be able to start offering services on our platform.</p>
    <hr />
    <p style="font-size: 12px; color: #777;">If you have any questions, please contact our support team.</p>
  </div>
`;

// 🔹 Contract Approved
export const contractApprovedTemplate = ({ userName }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 30px;">
    <h2 style="color: #1a1a2e; border-bottom: 2px solid #28a745; padding-bottom: 10px;">
      KajNow — Contract Approved!
    </h2>
    <p>Dear <strong>${userName}</strong>,</p>
    <p>Your Provider Agreement has been <strong style="color: green;">approved</strong>.</p>
    <p>You are now fully onboarded and can start accepting service requests on the KajNow platform.</p>
    <p>Welcome to the KajNow provider family!</p>
    <hr />
    <p style="font-size: 12px; color: #777;">If you have any questions, please contact our support team.</p>
  </div>
`;

// 🔹 Contract Rejected
export const contractRejectedTemplate = ({ userName, reason }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 30px;">
    <h2 style="color: #1a1a2e; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">
      KajNow — Contract Rejected
    </h2>
    <p>Dear <strong>${userName}</strong>,</p>
    <p>Your Provider Agreement has been <strong style="color: #dc3545;">rejected</strong>.</p>
    <div style="background: #fdecea; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold;">Reason:</p>
      <p style="margin: 5px 0 0;">${reason}</p>
    </div>
    <p>Please complete your KYC verification again. Once your KYC is re-approved, a new contract will be issued to you.</p>
    <hr />
    <p style="font-size: 12px; color: #777;">If you have any questions, please contact our support team.</p>
  </div>
`;