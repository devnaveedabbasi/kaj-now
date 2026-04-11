import express from "express";
import path from "path";
import { createServer } from "http";
import connectDb from "./config/db.js";
import routes from "./routes/index.js";
import cors from "cors";
import requestLogger from "./middleware/requestLogger.js";
import { ApiError } from "./utils/errorHandler.js";

const app = express();

if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
}
const server = createServer(app);

const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "public/uploads")));
app.use(requestLogger);

app.get('/', (req, res) => {
    res.send('API is working');
});

app.use("/api", routes);

/**
 * 404 Not Found Handler
 */
app.use((req, res, next) => {
  const error = new ApiError(
    404,
    `Route not found: ${req.originalUrl}`,
    []
  );
  next(error);
});

/**
 * Global Error Handling Middleware
 * Catches all errors from controllers and returns standardized response
 */
app.use((err, req, res, next) => {
  let error = err;

  // Handle non-ApiError instances
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || "Internal Server Error";
    
    error = new ApiError(statusCode, message, error.errors || []);
  }

  // Log error for debugging (but don't expose in production)
const errorResponse = {
    code: error.statusCode, // ✅ statusCode ki jagah code
    message: error.message,
    success: error.success,
    ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        errors: error.errors
    }),
};
  if (process.env.NODE_ENV !== 'production') {
    console.error('Error:', {
      statusCode: error.statusCode,
      message: error.message,
      errors: error.errors,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }

  res.status(error.statusCode).json(errorResponse);
});

connectDb();

export { server };
export default app;