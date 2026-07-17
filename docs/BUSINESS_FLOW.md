# Project Business Overview

This system solves the business problem of connecting customers who need services (jobs) with verified service providers. It acts as an intermediary handling bookings, real-time communication, secure escrow payments, and provider payouts.

**Main actors involved**:
- **Customer**: Browses services, books jobs, chats with providers, and pays.
- **Provider** (Seller equivalent): Offers services, accepts/rejects jobs, performs services, and withdraws earnings.
- **Admin**: Manages users, verifies provider KYC, approves services, handles disputes, and processes withdrawals.
- **System**: Automatically handles background tasks, scheduled crons, automated contract generation, and push notifications.

---

# Authentication Flow

Registration and login are isolated by role (`adminAuth`, `customerAuth`, `providerAuth`).

**Registration & OTP Flow**:
Client -> API -> Input Validation -> Database (User created, `status: pending`, OTP generated) -> Email sent -> Client inputs OTP -> API -> `isEmailVerified: true`.

**Authentication Flow**:
Client
↓
API (Login Route)
↓
Validation (Email & Password check)
↓
Authentication (Bcrypt comparison, Role validation)
↓
Token Generation (JWT)
↓
Response (Token + User Data)

**Provider KYC Context**:
When a Provider logs in, `authMiddleware` additionally fetches their `Provider` profile and verifies their `kycStatus`. If suspended, access is denied.

---

# User Flow (Customer)

The typical journey of a Customer on the platform:

1. **Account Creation**: Registers and verifies email via OTP.
2. **Browsing**: Views categories and available services (filtered by region).
3. **Ordering (Booking)**: Selects a service, chooses a provider, picks a schedule, and initiates a booking (`Job` creation).
4. **Payment**: Pays via Card/Mobile Banking (SSLCommerz) or selects Cash on Delivery (COD).
5. **Tracking**: Tracks job status (Pending -> Accepted -> In Progress -> Completed by Provider).
6. **Communication**: Uses real-time Socket.io chat to talk to the assigned provider.
7. **Confirmation & Review**: Confirms the job is done (releases funds to provider) and leaves a `Review`.

---

# Admin Flow

Admins control the platform via their dashboard.

- **Dashboard Operations**: View aggregate stats (total users, revenue, active jobs).
- **User Management**: Block/Suspend/Approve customers and providers.
- **Provider KYC**: Review provider documents (ID, right to work, certificates) and approve/reject their `kycStatus`.
- **Service Management**: Create parent `Category` and `Service` templates (for UK/BD regions).
- **Service Request Approvals**: Approve or reject a provider's `ServiceRequest` to offer a specific service.
- **Job Management**: Monitor jobs, handle `disputed` statuses, or manually force-confirm jobs if the customer forgets.
- **Withdrawals**: View pending `Withdrawal` requests, transfer money manually via bank, and upload the `receiptImage` to mark as `completed`.
- **Complaints & Support**: Reply to customer/provider tickets.

---

# Provider Flow (Seller)

1. **Registration & KYC**: Registers as a provider. Uploads required documents (ID, certificates, company details).
2. **Approval**: Waits for admin `kycStatus` approval and contract signing.
3. **Service Application**: Submits a `ServiceRequest` to offer specific admin-defined services.
4. **Order Handling**: Receives a `Job` request. Can `accept` or `reject_by_provider`.
5. **Execution**: Marks job as `in_progress`, and eventually `completed_by_provider`.
6. **Earnings**: Once the customer confirms, funds (minus platform fee) are credited to the provider's `Wallet`.
7. **Withdrawals**: Requests a payout from their `Wallet` balance to their registered bank account.

---

# Service (Product) Flow

How a service goes from creation to being bookable:

Admin Creates Category & Service Template
↓
Provider Submits `ServiceRequest` (wants to offer this service)
↓
Admin Validates & Approves `ServiceRequest`
↓
Service ID added to Provider's `approvedServices` array
↓
Customer Browses & Books Provider for this Service

---

# Order (Job) Flow

The complete lifecycle of a service booking:

Job Created (`pending`)
↓
Payment Initiated
↓
Payment Successful (`escrowStatus: held_in_admin_wallet`)
↓
Provider Accepts (`accepted`)
↓
Provider Starts (`in_progress`)
↓
Provider Finishes (`completed_by_provider`)
↓
Customer Confirms (`confirmed_by_user`) OR Admin Confirms (`confirmed_by_admin`)
↓
Escrow Released (`escrowStatus: released_to_provider`)
↓
Wallet Settlement (Funds added to Provider)

*Alternative paths include:* `rejected_by_provider`, `cancelled`, and `disputed`.

---

# Payment Flow

The platform securely holds funds in escrow until the job is done.

- **Payment Creation**: Job creation triggers a `Payment` record.
- **Gateway Integration**: SSLCommerz is used for cards and mobile banking (bKash, Nagad).
- **Verification**: SSLCommerz callback routes (`/api/payment-result/success`) verify the transaction.
- **Escrow**: On success, the `Payment` is marked `completed` but `escrowStatus` becomes `held_in_admin_wallet`.
- **Wallet Updates**: Upon job confirmation, the system calculates the `platformFee` and `providerAmount`, updating the provider's `Wallet.balance`.

---

# Shipping Flow

*Note: There is no physical product shipping flow in this project. The platform is for localized, in-person services.*

---

# Wallet / Commission Flow

- **Money Movement**: Customer pays Admin -> Admin holds in Escrow -> Admin releases virtual balance to Provider Wallet -> Provider withdraws -> Admin sends real bank transfer.
- **Commission Deduction**: During job confirmation, a platform fee is calculated (logic exists in the controller level). The provider receives: `Total Amount - Platform Fee`.
- **Available Balance**: Stored in `Wallet.balance`.
- **Withdrawal Process**: Provider requests withdrawal -> Balance is locked/deducted -> Admin transfers money -> Admin uploads receipt -> Status becomes `completed`.

---

# Notification Flow

- **Push Notifications**: Handled via Firebase Admin (`src/config/firebase` & `src/utils/notification.js`). Devices are targeted using the `fcmToken` stored on the `User` model.
- **Email Notifications**: Handled via Nodemailer (`src/services/emailService.js`). Used for OTPs, contract deliveries, and withdrawal invoices.
- **Triggers**: State changes (Job accepted, Payment received, Message received, KYC approved).

---

# Important Business Rules

- **Approval Requirements**: Providers cannot receive jobs until `status` is `approved` and `kycStatus` is `approved`.
- **Region-based Rules**: The platform operates in two regions (`UK` and `BD`). Services and Categories are tagged with a `region`. UK flow uses admin templates, while BD flow behaves slightly differently.
- **Escrow Rule**: Funds must never be credited to a provider's wallet until the job is explicitly confirmed by the user or admin.
- **Contract Rule**: Providers (especially UK) may be required to sign a PDF contract before full activation.

---

# Future AI Development Guidelines

Before adding new features, developers and AI agents must understand:
- **Data consistency**: Altering the `Job` status usually requires altering the `Payment` escrow status and triggering a `Notification`. These must be handled in the same controller block.
- **Role separation**: Do not mix provider and customer logic. They have separate auth controllers, routes, and even unique models (`Provider` vs `User`).
- **Wallet immutability**: Direct manipulation of `Wallet.balance` should be avoided outside of the official escrow release or withdrawal processes to prevent financial discrepancies.
