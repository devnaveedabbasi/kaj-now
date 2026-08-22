import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDb from "./config/db.js";
import routes from "./routes/index.js";
import cors from "cors";
import requestLogger from "./middleware/requestLogger.js";
import { ApiError } from "./utils/errorHandler.js";
import errorHandler from "./middleware/errorHandler.js";
import { initSocket } from "./config/socket.js";

const app = express();
const server = createServer(app);

app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    console.log(
      `[API] ${req.method} ${req.originalUrl} → ${res.statusCode} ${duration}ms IP=${req.ip}`
    );
  });

  next();
});

// ── Socket.IO Setup ───────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

initSocket(io);
// ─────────────────────────────────────────────────────────────

// Allowed origins
const allowedOrigins = [
  "https://kaj-now.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5000",
  "http://103.132.96.120:3000",
  "http://192.168.1.46:3000",
  "http://172.30.100.111:3000"
];


const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin || origin === "null") {
      return callback(null, true);
    }    // Allow all Vercel preview deployments too
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app")
    ) {
      return callback(null, true);
    }

    console.log("Blocked origin:", origin);
    return callback(new Error("Not allowed by CORS")); // send actual error
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
// Middlewares
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(requestLogger);

// Health check
app.get("/", (req, res) => {
  res.send("API is working ");
});

// Routes
app.use("/api", routes);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT RESULT PAGES — /api/payment-result/*
// SSLCommerz callbacks redirect here. Returns JSON so Postman / mobile app
// WebView can read the result. When real app is ready, just change FRONTEND_URL
// in .env to the app's deep link (e.g. kajnow://) — these routes stay as
// fallback for server-side testing.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/payment-result/success", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Payment successful! Booking confirmed.",
    job: req.query.job || null,
    method: req.query.method || null,
  });
});

app.get("/api/payment-result/failed", (req, res) => {
  return res.status(200).json({
    success: false,
    message: "Payment failed or booking could not be completed.",
    error: req.query.error || "unknown",
    transaction: req.query.transaction || null,
  });
});

app.get("/api/payment-result/cancelled", (req, res) => {
  return res.status(200).json({
    success: false,
    message: "Payment was cancelled.",
    transaction: req.query.transaction || null,
  });
});

app.get("/api/payment-result/error", (req, res) => {
  return res.status(500).json({
    success: false,
    message: "An unexpected error occurred during payment processing.",
  });
});

// ----------------------
// 404 HANDLER (IMPORTANT)
// ----------------------
app.use((req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
});

// ----------------------
// GLOBAL ERROR HANDLER
// ----------------------
app.use(errorHandler);

// DB connect
connectDb();

export { server };
export default app;
