/**
 * Har incoming request ko log karta hai (method, path, status, time, IP).
 * POST body log hoti hai lekin password/otp/token wale fields [REDACTED].
 */
const SENSITIVE_KEYS = /password|otp|token|secret|authorization|refreshtoken/i;

function redactBody(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

export default function requestLogger(req, res, next) {
  const started = Date.now();
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    '-';

  const hasBody =
    req.body &&
    typeof req.body === 'object' &&
    Object.keys(req.body).length > 0 &&
    !['GET', 'HEAD'].includes(req.method);

  const bodyLine = hasBody
    ? ` body=${JSON.stringify(redactBody(req.body))}`
    : '';

  const queryLine =
    req.query && Object.keys(req.query).length > 0
      ? ` query=${JSON.stringify(req.query)}`
      : '';

  res.on('finish', () => {
    const ms = Date.now() - started;
    const line = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl || req.url} → ${res.statusCode} ${ms}ms ip=${ip}${queryLine}${bodyLine}`;
    console.log(line);
  });

  next();
}
