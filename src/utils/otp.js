import crypto from 'crypto';

export function generateNumericOtp(length = 4) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(crypto.randomInt(min, max + 1));
}
