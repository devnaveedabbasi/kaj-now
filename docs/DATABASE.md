# Database Overview

- **Database type**: MongoDB (NoSQL)
- **ORM/ODM used**: Mongoose
- **Connection approach**: Connection is established in `src/config/db.js` using `mongoose.connect(process.env.MONGODB_URI)`. The connection is invoked during server bootstrap in `app.js`.
- **General database pattern**: The project uses Mongoose Schemas with strict type definitions, enums for status control, and `ObjectId` references to link collections. It makes use of Mongoose virtuals (e.g., transforming locations) and schema methods (e.g., `incrementServiceOrderCount`).

---

# Collections / Models

## User
**Purpose**: Manages authentication, roles, and core profile information for all actors on the platform (customers, providers, admins).

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `name` | String | Yes | Full name of the user |
| `email` | String | Yes | Unique email address |
| `phone` | String | Yes | Unique phone number |
| `password` | String | Yes | Hashed password (select: false) |
| `role` | String | Yes | Enum: `['customer', 'provider', 'admin']` |
| `status` | String | No | Enum: `["pending", "approved", "blocked", "suspended"]`. Default: `"pending"` |
| `location` | Object | No | GeoJSON Point for spatial queries |
| `isActive` | Boolean | No | Default: `true` |

## Provider
**Purpose**: Holds detailed, provider-specific information like KYC documents, approved services, and bank details. Linked 1-to-1 with a User.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | ObjectId | Yes | Reference to `User` (Unique) |
| `Category` | ObjectId | No | Reference to `Category` |
| `services` | [ObjectId] | No | Array of `ServiceRequest` references |
| `approvedServices` | [ObjectId] | No | Array of `Service` references |
| `isKycCompleted` | Boolean | No | Default: `false` |
| `kycStatus` | String | No | Enum: `["pending", "approved", "suspended", "rejected"]` |
| `contractStatus` | String | No | Enum: `['not_required', 'pending', 'signed', 'approved', 'rejected']` |

## Job
**Purpose**: Represents a service booking or order between a customer and a provider.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `orderId` | String | No | Unique generated order identifier |
| `provider` | ObjectId | Yes | Reference to `Provider` |
| `customer` | ObjectId | Yes | Reference to `User` |
| `service` | ObjectId | Yes | Reference to `Service` |
| `amount` | Number | Yes | Total amount of the job |
| `status` | String | No | Enum for booking state (default: `'pending'`) |
| `paymentStatus` | String | No | Enum for job payment state (default: `'pending'`) |

## Payment
**Purpose**: Tracks financial transactions, payment gateway data, and escrow statuses for a job.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | ObjectId | Yes | Reference to `Job` |
| `customerId` | ObjectId | Yes | Reference to `User` |
| `providerId` | ObjectId | Yes | Reference to `Provider` |
| `totalAmount` | Number | Yes | Total payment amount |
| `paymentGateway` | String | No | Enum: `['sslcommerz', 'cod', 'bank_transfer']` |
| `paymentStatus` | String | No | Enum: `['pending', 'processing', 'completed', 'failed', 'refunded']` |
| `escrowStatus` | String | No | Enum: `['pending', 'held_in_admin_wallet', 'released_to_provider', ...]` |

## Wallet
**Purpose**: Manages the balance and transaction history for providers (and potentially admins/customers).

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | ObjectId | Yes | Reference to `User` (Unique) |
| `role` | String | Yes | Enum: `['admin', 'provider', 'customer']` |
| `balance` | Number | No | Available withdrawable amount |
| `transactionHistory`| [ObjectId] | No | References to `Payment` documents |

## Withdrawal
**Purpose**: Manages requests from providers to withdraw funds from their wallet to their bank.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `providerId` | ObjectId | Yes | Reference to `Provider` |
| `requestedAmount`| Number | Yes | Amount requested |
| `status` | String | No | Enum: `['pending', 'completed', 'rejected']` |
| `bankDetails` | Object | Yes | Snapshot of bank information |

## Service (Admin)
**Purpose**: Defines a service listing on the platform.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | ObjectId | Yes | Creator (Admin/Provider) Reference to `User` |
| `categoryId` | ObjectId | Yes | Reference to `Category` |
| `name` | String | Yes | Name of the service |
| `region` | String | No | Enum: `['UK', 'BD']` |
| `price` | Number | Conditional| Required if region is not UK |

## ServiceRequest (Admin)
**Purpose**: Represents a provider's request to list or offer a specific service.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `providerId` | ObjectId | Yes | Reference to `Provider` |
| `categoryId` | ObjectId | Yes | Reference to `Category` |
| `status` | String | No | Enum: `['pending', 'approved', 'rejected', 'cancelled', 'admin_deactivated']` |

## Complaint
**Purpose**: Stores dispute tickets raised by users.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | ObjectId | Yes | Reference to `User` |
| `complaintType`| ObjectId | Yes | Reference to `ComplaintType` |
| `status` | String | No | Enum: `['pending', 'seen']` |

## Message
**Purpose**: Real-time chat messages linked to a specific job.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | ObjectId | Yes | Reference to `Job` |
| `senderId` | ObjectId | Yes | Reference to `User` |
| `receiverId` | ObjectId | Yes | Reference to `User` |
| `message` | String | Yes | Text content |

---

# Relationships

- **User** has one **Provider** (`Provider.userId` → `User`)
- **User** has one **Wallet** (`Wallet.userId` → `User`)
- **Job** references:
  - `customer` → `User`
  - `provider` → `Provider`
  - `service` → `Service`
- **Payment** references:
  - `jobId` → `Job`
  - `customerId` → `User`
  - `providerId` → `Provider`
- **Service** references:
  - `categoryId` → `Category`
- **Withdrawal** references:
  - `providerId` → `Provider`

---

# Important Business Data

These fields dictate the flow of business logic in controllers:

- **`User.status`**: `["pending", "approved", "blocked", "suspended"]`. Determines if a user can log in and use the platform.
- **`Provider.kycStatus`**: `["pending", "approved", "suspended", "rejected"]`. Determines if a provider is verified to receive jobs.
- **`Job.status`**: Controls the booking lifecycle. 
  - Starts as `pending`.
  - Provider can move to `accepted`.
  - Then `in_progress` -> `completed_by_provider`.
  - Finally `confirmed_by_user` or `confirmed_by_admin` closes the job.
- **`Payment.escrowStatus`**: Manages fund safety.
  - `held_in_admin_wallet`: Money is safe while job is active.
  - `released_to_provider`: Job is confirmed, funds added to Provider's wallet.
- **`Withdrawal.status`**: `pending` (waiting for admin action) -> `completed` (money sent, receipt uploaded) or `rejected`.
- **Timestamps**: All models use Mongoose `timestamps: true` to auto-manage `createdAt` and `updatedAt`. Custom dates like `completedByProviderAt`, `refundedAt` are used for specific lifecycle events.

---

# Database Flow

1. **Service Registration**: Provider creates a `ServiceRequest` -> Admin approves -> `Service` is linked to `Provider.approvedServices`.
2. **Job Booking**: Customer selects Service -> `Job` created (`status: pending`).
3. **Payment Auth**: `Payment` created (`paymentStatus: pending`, `escrowStatus: pending`) -> Customer pays via SSLCommerz.
4. **Escrow Hold**: Payment gateway callback updates `Payment` to `processing` -> `escrowStatus: held_in_admin_wallet`.
5. **Job Execution**: Provider accepts Job -> executes -> marks `completed_by_provider`.
6. **Confirmation & Settlement**: Customer confirms (`Job` -> `confirmed_by_user`) -> `Payment` (`escrowStatus: released_to_provider`) -> Provider `Wallet` balance increases.
7. **Payout**: Provider requests `Withdrawal` -> Admin reviews -> Wallet balance deducted -> `Withdrawal` marked `completed`.

---

# Indexes and Performance

- **Geospatial Indexes**: `location: '2dsphere'` exists on `User` and `Provider` to allow geographic proximity searches (e.g., finding nearby providers).
- **Compound Indexes**: Frequent queries are heavily indexed.
  - `jobSchema.index({ customer: 1, status: 1 })`
  - `jobSchema.index({ provider: 1, status: 1 })`
  - `paymentSchema.index({ jobId: 1, escrowStatus: 1 })`
- **Sorting Indexes**: `{ createdAt: -1 }` on `Job`, `Payment`, `Wallet`, `Withdrawal`, `Complaint` to speed up pagination of history pages.
- **Unique Constraints**: `User.email`, `User.phone`, `Job.orderId`, `Provider.userId`, `Wallet.userId`, `Category` (`userId` + `name`).

---

# Database Rules for Future Development

- **Always use ObjectId references**: Rely on `mongoose.Schema.Types.ObjectId` with `ref` rather than storing string IDs manually.
- **Always add timestamps**: Pass `{ timestamps: true }` as the second argument to all new Schemas.
- **Enforce Enums**: If a field represents a status, define all allowed states in an `enum` array inside the Schema.
- **Geospatial Data**: Always use GeoJSON Point format (`type: 'Point', coordinates: [lng, lat]`) when storing coordinates to utilize MongoDB's `2dsphere` indexes.
- **Indexing**: Add compound indexes at the bottom of the schema file for fields that will be filtered together frequently (e.g., `userId` + `status`).
