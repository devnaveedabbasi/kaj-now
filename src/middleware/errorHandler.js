const errorHandler = (err, req, res, next) => {
  console.error("🔥 Error:", err);

  // ========================
  // 🔴 Mongoose Validation
  // ========================
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map(e => e.message);

    return res.status(400).json({
      success: false,
      code: 400,
      message: "Validation Error",
      errors: errors,
      data: null,
    });
  }

  // ========================
  // 🔴 Cast Error (invalid ID)
  // ========================
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      code: 400,
      message: `Invalid ${err.path}: ${err.value}`,
      data: null,
    });
  }

  // ========================
  // 🔴 Duplicate Key
  // ========================
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];

    return res.status(409).json({
      success: false,
      code: 409,
      message: `${field} already exists`,
      data: null,
    });
  }

  // ========================
  // 🔴 Custom ApiError
  // ========================
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.statusCode,
      message: err.message,
      data: null,
    });
  }

  // ========================
  // 🔴 Final fallback
  // ========================
  return res.status(500).json({
    success: false,
    code: 500,
    message: err.message || "Something went wrong",
    data: null,
  });
};

export default errorHandler;