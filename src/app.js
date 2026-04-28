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

//  Sabhi allowed origins add kar do
const allowedOrigins = [
  'https://kaj-now.vercel.app',
  'http://localhost:3000',
  'http://103.132.96.120:3000',
  'http://192.168.1.46:3000',
  'http://103.132.96.120:5000',
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(' Blocked origin:', origin);
      callback(null, true); // For testing, allow all - production mein hata dena
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "public/uploads")));
app.use(requestLogger);

app.get('/', (req, res) => {
  res.send('API is working');
});

app.use("/api", routes);
app.use(errorHandler);

app.use((req, res, next) => {
  const error = new ApiError(
    404,
    `Route not found: ${req.originalUrl}`,
    []
  );
  next(error);
});

app.use((err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || "Internal Server Error";

    error = new ApiError(statusCode, message, error.errors || []);
  }

  const errorResponse = {
    code: error.statusCode,
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