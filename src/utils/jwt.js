import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export function signToken(userId, role) {
  return jwt.sign(
    { userId: String(userId), role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}
