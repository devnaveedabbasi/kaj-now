# Project Overview
- **What this project does**: A platform that connects customers and service providers for booking jobs/services. It includes comprehensive management features for admins, a robust booking system, wallet & withdrawal management, real-time chat, and automated PDF contract generation.
- **Main business purpose**: Facilitate service bookings, handle payments and provider payouts, manage complaints and support requests, and provide real-time interaction.
- **Project type**: Node.js / Express.js REST API Backend with WebSocket (Socket.io) real-time features.
- **Main features**: Authentication & Authorization (Customer, Provider, Admin), Job Booking & Tracking, Service & Category Management, Wallet & Withdrawal system, Payment Gateway Integration, Real-time Chat, Push Notifications, Complaints & Support ticket system.

# Tech Stack
- **Runtime**: Node.js (uses ES Modules via `"type": "module"`)
- **Framework**: Express.js (v5.2.1)
- **Database**: MongoDB
- **ODM/ORM**: Mongoose (v9.3.3)
- **Authentication**: JWT (`jsonwebtoken`) and password hashing (`bcryptjs`)
- **Email service**: Nodemailer (managed in `src/services/emailService.js`)
- **File storage**: Local storage using `multer` (files saved to `public/uploads` and `public/contracts`)
- **Third-party integrations**: Firebase Admin (Push notifications), SSLCommerz (Payment Gateway), Socket.io (Real-time), Redis/BullMQ (`ioredis`, `bullmq`) for background queues.
- **Other important libraries**: `node-cron` (task scheduling), `pdfkit` (generating contract and invoice PDFs), `cors`, `dotenv`.

# Backend Architecture
The application uses a standard Layered MVC-like architecture (Model-Route-Controller) with localized services for specific tasks.

Describe how a request travels through the application:
1. **Client**: Sends an HTTP request.
2. **Route**: Defined in `src/routes/` (split by actor: `admin`, `customer`, `provider`, `public`).
3. **Middleware**: Executes cross-cutting concerns (e.g., `requestLogger`, `upload` for files, `authMiddleware` for authentication, `authorize` for role-based access).
4. **Controller**: Located in `src/controllers/`, handles business logic, database queries, and structures the response.
5. **Model**: Defines the Mongoose schemas (`src/models/`).
6. **Database**: MongoDB executes operations.
7. **ApiResponse**: Controllers send responses back to the client often wrapping data, while the global Error Handler manages failures.

*Note: While there is a `src/services/` directory, it is primarily used for specific utilities like email, payment (SSLCommerz), and job scheduling, rather than a strict service layer abstracting all business logic from controllers.*

# Authentication
- **JWT**: JSON Web Tokens are used for session management. Tokens are passed in the `Authorization` header as `Bearer <token>`.
- **Admin authentication**: Managed via `adminAuth.controller.js`.
- **Customer authentication**: Managed via `customerAuth.controller.js`.
- **Provider authentication**: Managed via `providerAuth.controller.js`.
- **Existing auth middleware**: `src/middleware/auth.js` exports `authMiddleware` (verifies token, fetches user, checks if user is 'approved' and not blocked/suspended, and for providers, checks their KYC status).
- **Role handling**: The `authorize(...roles)` middleware is used on routes to enforce RBAC (Role-Based Access Control). Existing roles are `admin`, `customer`, and `provider`.

# API Response Format
The project uses custom utility classes to standardize responses (`src/utils/apiResponse.js` and `src/utils/errorHandler.js`).

- **ApiResponse**: Success responses return an object structure:
  ```json
  {
    "code": 200,
    "data": { ... },
    "message": "Success",
    "success": true
  }
  ```
- **ApiError**: Custom Error class that extends the built-in `Error`.
- **Status codes**: Passed explicitly (e.g., 200, 400, 401, 403, 404, 500).
- **Error handling approach**: 
  - Controllers pass errors to the `next()` function or throw them.
  - A Global Error Handler middleware in `app.js` catches them.
  - Errors are formatted as:
    ```json
    {
      "code": 400,
      "message": "Error message",
      "success": false,
      "errors": [],
      "timestamp": "2026-07-17T10:00:00.000Z"
    }
    ```

# Existing Business Modules
- **Authentication**: Registration, login, OTP verification, and JWT issuance (split by roles).
- **Users**: Admin, Customer, and Provider profile management.
- **Jobs / Service Requests**: Booking lifecycle, status tracking, and provider assignment.
- **Services & Categories**: Admin categorization of platform offerings and provider-specific service listings.
- **Payments**: Handling payments via SSLCommerz, processing transaction callbacks, and payment tracking.
- **Wallets**: Managing provider balances.
- **Withdrawals**: Processing provider payout requests and generating withdrawal invoices via PDFKit.
- **Complaints**: Dispute management system for customers and admins.
- **Chat**: Real-time messaging between users via Socket.io.
- **Notifications**: In-app notifications and Firebase push notifications.
- **Reviews**: Customer feedback and rating system for providers.
- **Contracts**: Automated generation of PDF contracts for jobs.
- **Support**: Ticketing system for general inquiries.
- **Notes / Activity Logs**: Internal auditing and user-specific notes.
- **Banners**: Promotional or informational banners managed by the admin.
- **Stats**: Dashboard statistics and analytics.

# Third-party Services
- **Firebase Admin**: Used for sending push notifications (`src/config/firebase`).
- **SSLCommerz**: Payment gateway for processing financial transactions (`src/services/sslcommerz.js`).
- **Socket.io**: WebSockets for real-time chat and event streaming.
- **Redis & BullMQ**: Message broker and queue system for background job processing (`src/services/jobScheduler.service.js`).
- **Nodemailer**: For sending transactional emails (`src/services/emailService.js`).

# Coding Conventions
- **async/await**: Used exclusively for asynchronous operations in controllers and middlewares.
- **ES Modules**: The project uses `import` and `export` rather than CommonJS `require`.
- **Controller pattern**: Most business logic is implemented directly inside controller functions.
- **Middleware pattern**: Extensive use of Express middlewares for cross-cutting concerns (`auth`, `upload`, `requestLogger`, `errorHandler`).
- **Validation approach**: Appears to rely on manual checks within controllers or Mongoose schema validations (no dedicated validation library like Joi or Zod is prominent in the immediate directory structure).
- **Response helper usage**: Responses are typically structured using the `ApiResponse` utility and errors are passed via the `ApiError` class to the global handler.

# Important Notes
- **Provider Context**: The `authMiddleware` treats providers uniquely. If `user.role === 'provider'`, it queries the `Provider` model, verifies the `kycStatus` is not suspended/blocked, and attaches `req.provider` to the request object.
- **Dual User Models**: A `User` model exists for core authentication, but providers have an additional `Provider` model linked via `userId` for specific details (KYC, location, availability).
- **Local File Storage**: Uploaded files (images, PDFs) are stored locally in `public/uploads` and `public/contracts` and served statically via Express (`/uploads` and `/contracts` routes). Future deployments might need to consider cloud storage (like AWS S3) if scaling.
- **Payment Callbacks**: SSLCommerz redirect callbacks (`/api/payment-result/*`) are handled at the root level in `app.js`.
- **Background Jobs**: There is an active Redis/BullMQ background job scheduler running (`jobScheduler.service.js`), meaning Redis must be configured and running in the environment for full functionality.
