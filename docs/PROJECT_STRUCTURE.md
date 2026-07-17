# Backend Folder Structure

The project follows an organized, role-based, modular structure inside the `src` directory.

```text
kaj-now/
 ├── docs/
 ├── public/
 │    ├── contracts/
 │    └── uploads/
 ├── src/
 │    ├── config/
 │    ├── controllers/
 │    │    ├── admin/
 │    │    ├── customer/
 │    │    └── provider/
 │    ├── middleware/
 │    ├── models/
 │    │    ├── admin/
 │    │    └── provider/
 │    ├── routes/
 │    │    ├── admin/
 │    │    ├── customer/
 │    │    ├── provider/
 │    │    └── public/
 │    ├── service/
 │    ├── services/
 │    └── utils/
 ├── .env
 ├── package.json
 └── server.js
```

---

# Folder Responsibilities

### `src/config/`
- **Purpose**: Configuration files for databases and third-party tools.
- **What it contains**: `db.js` (Mongoose connection), `socket.js` (Socket.IO setup), and Firebase admin setup.
- **How it is used**: Imported in `server.js` or `app.js` during server initialization to set up external services.

### `src/controllers/`
- **Purpose**: Contains the core business logic of the application.
- **What it contains**: Controller functions separated by user roles (`admin`, `customer`, `provider`) and core modules (e.g., `chat`, `payment`, `support`).
- **How it is used**: Exported methods are attached to routes. They receive the Express `req` and `res`, interact with models, perform business logic, and send responses.

### `src/middleware/`
- **Purpose**: Express middlewares for intercepting and modifying requests before they reach the controller.
- **What it contains**: `auth.js` (Authentication and Role-Based Access Control), `errorHandler.js` (global error handling), `requestLogger.js`, and `upload.js` (Multer for file uploads).
- **How it is used**: Attached at the route level or globally in `app.js`.

### `src/models/`
- **Purpose**: Mongoose schemas defining database collections.
- **What it contains**: Schemas for Users, Providers, Jobs, Payments, Wallets, etc. Grouped partly by domain (e.g., `admin/`, `provider/`).
- **How it is used**: Imported by controllers to read and write data to MongoDB.

### `src/routes/`
- **Purpose**: Defines API endpoints and maps them to controllers.
- **What it contains**: Role-based routing folders (`admin`, `customer`, `provider`, `public`) and module-specific routes. `index.js` serves as the main router aggregating all endpoints.
- **How it is used**: `src/routes/index.js` is imported into `app.js` and prefixed with `/api`.

### `src/services/` & `src/service/`
- **Purpose**: Contains third-party integration logic and background tasks.
- **What it contains**: `sslcommerz.js` (Payment Gateway), `emailService.js`, and `jobScheduler.service.js` (BullMQ/Redis cron jobs).
- **How it is used**: Controllers call these services when they need to send an email, process a payment, or queue a background task.

### `src/utils/`
- **Purpose**: Reusable helper functions and formatters.
- **What it contains**: `apiResponse.js`, `errorHandler.js` (ApiError class), `generateContract.js` (PDF creation), `notification.js`, etc.
- **How it is used**: Imported wherever utility logic is needed (mostly in controllers and middlewares).

### `public/`
- **Purpose**: Stores static files accessible via HTTP.
- **What it contains**: Uploaded images/files (`uploads/`) and generated PDFs (`contracts/`).
- **How it is used**: Served as static directories in `app.js` (`/uploads` and `/contracts`).

---

# Important Files

### `server.js`
- **What it does**: The entry point of the Node application. It imports `app.js` and starts the HTTP server on the designated port.
- **Why it is important**: It is the bootstrap file used by `nodemon` or `node` to launch the API.

### `src/app.js`
- **What it does**: Sets up the Express application. Configures CORS, sets up Socket.io, mounts static folders, registers the main API router (`/api`), handles SSLCommerz payment webhooks, and registers the global error handler.
- **Why it is important**: It glues all the middleware, routes, and core Express configurations together.

### `src/config/db.js`
- **What it does**: Establishes the connection to MongoDB using Mongoose.
- **Why it is important**: Without this, the app cannot persist or retrieve data.

### `src/middleware/auth.js`
- **What it does**: Contains `authMiddleware` to verify JWTs and load the user/provider context, and `authorize(...roles)` to enforce role restrictions.
- **Why it is important**: It secures the API endpoints and ensures only permitted users access specific resources.

### `.env`
- **What it does**: Stores sensitive environment variables (Port, DB URI, JWT secret, Firebase config, SSLCommerz keys, Redis URI).
- **Why it is important**: Keeps secrets out of the codebase and allows different configurations across environments (dev vs. prod).

### `src/routes/index.js`
- **What it does**: The master route file aggregating all sub-routers (e.g., `/api/admin`, `/api/customer`, `/api/provider`, etc.).
- **Why it is important**: Acts as the central traffic director for all incoming API requests.

---

# Request Lifecycle

The flow of a request in this application typically follows this path:

1. **Client** (Mobile app, Web app, Postman) sends an HTTP Request (e.g., `POST /api/customer/job/book`).
2. **App Entry**: Request hits `app.js`, goes through global middlewares (CORS, body-parser, `requestLogger`).
3. **Route**: Matches the route in `src/routes/index.js` -> `src/routes/customer/job.routes.js`.
4. **Middleware**: Hits route-specific middleware. 
   - `authMiddleware` verifies the JWT.
   - `authorize('customer')` checks if the user is a customer.
5. **Controller**: Reaches a function in `src/controllers/customer/job.controller.js`. The controller extracts data from `req.body`.
6. **Database Operation (via Model)**: The controller calls Mongoose models (e.g., `Job.create()`) to interact with MongoDB.
7. **External Services / Utilities** *(Optional)*: The controller might call `notification.js` to send a push notification or `emailService.js` to send an email.
8. **Response**: The controller returns data using `res.status(200).json(new ApiResponse(...))` back to the client.
9. **Error Handling**: If anything fails (a `throw new ApiError()` is used), the request jumps to the **Global Error Handler** in `app.js` which formats the error response and sends it to the client.

---

# Code Organization Pattern

- **Where business logic exists**: Primarily inside the **Controllers** (`src/controllers/`). The controllers are "fat", handling validation, logic, and database operations.
- **Where database operations happen**: Inside **Controllers**, using Mongoose schemas defined in `src/models/`.
- **Where validations exist**: Validations are usually performed manually at the top of the Controller functions (e.g., checking if required fields exist) and enforced at the database level by Mongoose Schema constraints.
- **Where reusable utilities exist**: In `src/utils/` (formatting responses, generating PDFs, handling dates/locations).
- **Where external integrations are handled**: In `src/services/` (Emails, Payments) and `src/config/` (Firebase, WebSockets, DB connection).

---

# Adding New Features Guide

To add a new feature (e.g., a "Coupons" API for customers):

1. **New Model**: Create `coupon.model.js` in `src/models/` defining the Mongoose schema.
2. **New Controller**: Create `coupon.controller.js` inside `src/controllers/admin/` (for creating coupons) and `src/controllers/customer/` (for applying coupons). Write the async functions handling the business logic and database queries.
3. **New Route**: Create `coupon.routes.js` inside `src/routes/admin/` and `src/routes/customer/`. Map the endpoints to the controller functions. Use `authMiddleware` and `authorize()` middlewares to protect them.
4. **Link Route**: Open `src/routes/admin/index.js` and `src/routes/customer/index.js` and import the new route files to mount them (e.g., `router.use('/coupons', couponRoutes);`).
5. **New Utility/Service** *(if needed)*: If the coupon logic requires a complex generic algorithm, place it in `src/utils/couponHelper.js`. If it integrates with a 3rd party, place it in `src/services/`.
6. **New Middleware** *(if needed)*: If you need to intercept the request uniquely (e.g., validating a coupon code globally), add it to `src/middleware/`.
