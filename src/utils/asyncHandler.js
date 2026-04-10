/**
 * Wrapper function for async route handlers to catch errors
 * Eliminates the need for try-catch blocks in every controller
 * @param {Function} fn - The async function to wrap
 * @returns {Function} Wrapped function that catches errors
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export { asyncHandler };
