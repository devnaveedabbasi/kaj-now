# Core Development Rules

- **Do not break existing functionality**: The primary goal is to safely extend the application.
- **Do not modify unrelated modules**: Keep your blast radius small. Touch only the files strictly necessary for the requested feature.
- **Do not refactor without permission**: Do not rewrite existing code to "make it cleaner" or migrate to new design patterns unless explicitly instructed by the user.
- **Keep backward compatibility**: Mobile apps and frontends rely on the existing JSON structures and database schemas.
- **Follow existing architecture**: Adapt your solutions to fit the project's current way of working rather than introducing completely new paradigms.

---

# Project Analysis Requirement

Before implementing any feature, the AI **must**:

1. **Read relevant documentation files** (`docs/PROJECT_CONTEXT.md`, `docs/PROJECT_STRUCTURE.md`, `docs/DATABASE.md`, `docs/BUSINESS_FLOW.md`).
2. **Understand existing flow** for the specific module being modified.
3. **Find related models/controllers/services** before writing code. Look at how similar modules are built.
4. **Check existing implementation patterns** (how errors are thrown, how responses are formatted).
5. **Only then write code**.

---

# Code Structure Rules

- **Where controllers should be created**: Inside `src/controllers/`, usually scoped by role folder (`admin/`, `customer/`, `provider/`).
- **Where business logic should exist**: The project uses "Fat Controllers." Place core business logic directly inside the controller methods. 
- **Where database queries should happen**: Inside the Controllers. Do not create repository layers unless the user asks for it.
- **Where reusable logic should be placed**: Place utility functions in `src/utils/` (e.g., PDF generation, common formatters).

---

# API Rules

- **Response format**: Always use the `ApiResponse` class from `src/utils/apiResponse.js`. 
  `res.status(200).json(new ApiResponse(200, data, "Success Message"));`
- **Error handling**: Always throw or pass `ApiError` objects to the `next()` function. Do NOT manually construct error JSON objects.
  `throw new ApiError(400, "Validation Failed");`
- **Status code usage**: 200/201 for success. 400 for bad input, 401 for unauthenticated, 403 for unauthorized/blocked, 404 for not found, 500 for server error.
- **Validation requirements**: Performed manually inside controllers via `if (!req.body.field)` or relying on Mongoose schema constraints.
- **Authentication requirements**: Use `authMiddleware` on protected routes.

**Rules:**
- **Never change existing response structure**.
- **Always follow existing API patterns**.

---

# Database Rules

- **Model naming conventions**: Singular, PascalCase inside the code (e.g., `User`, `Job`). File names follow `camelCase.model.js` (e.g., `job.model.js`) or PascalCase (e.g., `User.model.js`). Stick to existing styles in the directory.
- **Schema patterns**: Use Mongoose.
- **Relationship handling**: Always use `mongoose.Schema.Types.ObjectId` with a `ref` string.
- **Required fields**: Be explicit about `required: true` and `default` values in schemas.
- **Timestamp usage**: Always set `{ timestamps: true }` in schema options.
- **Migration/update approach**: When adding fields, set a logical `default` to ensure backward compatibility for old documents. Do not remove old fields without careful consideration.

---

# Authentication & Authorization Rules

- **How authentication should be handled**: Using JSON Web Tokens (JWT).
- **Which middleware should be reused**: Import `authMiddleware` and `authorize` from `src/middleware/auth.js`.
- **Role/permission handling**: Use `authorize('admin', 'customer')` on routes to lock down endpoints.

**Rules:**
- **Never bypass authentication**.
- **Never duplicate auth logic**. If a new auth flow is needed, integrate it into `src/middleware/auth.js`.

---

# Service Layer Rules

- **When to create services**: Only create services in `src/services/` for third-party integrations (e.g., a new SMS gateway, a new payment processor, or a complex background cron job suite).
- **How services communicate**: Controllers import the service functions directly.
- **What logic belongs in services**: External API calls, complex queue management (BullMQ), and specialized formatting for third-party APIs. NOT general CRUD business logic.

---

# Validation Rules

- **Existing validation library/pattern**: No external validation library (like Joi or Zod) is currently enforced across the board. 
- **Where validation should happen**: At the top of the Controller functions.
- **How errors should be returned**: If validation fails, `throw new ApiError(400, "Specific validation message")`.

---

# Email / Notification Rules

- **Existing email service usage**: Uses `nodemailer` configured in `src/services/emailService.js` and `src/utils/emailTemplates.js`.
- **Notification patterns**: Uses Firebase Admin (`src/utils/notification.js`) to target device `fcmToken`s.

**Rule:**
- **Never create a new email system if one already exists**. Reuse `emailService.js`.

---

# Third Party Integration Rules

- **Payment gateways**: SSLCommerz is handled in `src/services/sslcommerz.js`. Payment webhooks must hit root-level endpoints in `app.js` or `payment.routes.js`.
- **Storage services**: Currently using local `multer` (`src/middleware/upload.js`). Do not switch to S3/Cloudinary without explicit permission.
- **Firebase**: Push notifications are configured in `src/config/firebase/`.

---

# Naming Conventions

- **File naming**: Use `.controller.js`, `.routes.js`, `.model.js` suffixes. Directories should be `camelCase` or lowercase.
- **Function naming**: Use `camelCase` (e.g., `createJob`, `verifyPayment`).
- **Variable naming**: Use `camelCase`.
- **Model naming**: `PascalCase` for Mongoose models.
- **Route naming**: Use lowercase, kebab-case URL paths (e.g., `/api/admin/service-requests`).

---

# When Adding New Features

The AI **must**:

1. **Analyze existing related modules**. Look at how similar entities are handled.
2. **Reuse existing utilities/services**.
3. **Add minimum required files**. Do not over-engineer.
4. **Avoid unnecessary dependencies**. Do not `npm install` packages unless instructed.
5. **Keep changes isolated**.
6. **Test impact on existing flows** (e.g., if modifying `Job` creation, ensure the payment flow and socket chat remain unaffected).

---

# Forbidden Actions

The AI **must never**:

- Rename existing files without approval.
- Delete existing code without approval.
- Change database fields without checking impact on controllers and mobile apps.
- Change API responses (do not alter JSON keys that frontends expect).
- Create duplicate utilities (e.g., do not create a new random string generator if one exists).
- Install unnecessary packages.
- Rewrite working modules.

---

# Final Rule

**The existing project architecture is the source of truth.**

Future AI agents must adapt to the project instead of changing the project architecture.
