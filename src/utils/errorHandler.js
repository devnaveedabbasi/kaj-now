/**
 * Custom API Error class for standardized error responses
 * @class ApiError
 * @extends Error
 */
class ApiError extends Error {
  constructor(
    statusCode = 500,
    message = "Something went wrong",
    errors = [],
    stack = ""
  ) {
    super(message);
    this.statusCode = statusCode; // internal use ke liye
    this.data = null;
    this.message = message;
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.success = false;
    this.timestamp = new Date().toISOString();

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      code: this.statusCode, // ✅ code naam se jayega
      message: this.message,
      success: this.success,
      data: this.data,
      errors: this.errors.length > 0 ? this.errors : undefined,
      timestamp: this.timestamp,
    };
  }
}

export  {ApiError};