import express from "express";
import path from "path";
import { createServer } from "http";
import connectDb from "./config/db.js";
import routes from "./routes/index.js";
import cors from "cors";
import requestLogger from "./middleware/requestLogger.js";
import { ApiError } from "./utils/errorHandler.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();
const server = createServer(app);

// Allowed origins
const allowedOrigins = [
  "https://kaj-now.vercel.app",
  "http://localhost:3000",
  "http://103.132.96.120:3000",
  "http://192.168.1.46:3000",
];

// CORS config (SAFE MODE)
const allowedOrigins = [
  "https://kaj-now.vercel.app",
  "http://localhost:3000",
  "http://103.132.96.120:3000",
  "http://192.168.1.46:3000",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin) return callback(null, true);

    // Allow all Vercel preview deployments too
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "public/uploads")));
app.use(requestLogger);

// Health check
app.get("/", (req, res) => {
  res.send("API is working ");
});

// Routes
app.use("/api", routes);

// ----------------------
// 404 HANDLER (IMPORTANT)
// ----------------------
app.use((req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
});

// ----------------------
// GLOBAL ERROR HANDLER
// ----------------------
app.use((err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    error = new ApiError(statusCode, message, error.errors || []);
  }

  const response = {
    code: error.statusCode,
    message: error.message,
    success: error.success,
    ...(process.env.NODE_ENV === "development" && {
      stack: error.stack,
      errors: error.errors,
    }),
  };

  console.error("Error:", response);

  res.status(error.statusCode).json(response);
});

// DB connect
connectDb();

export { server };
export default app;