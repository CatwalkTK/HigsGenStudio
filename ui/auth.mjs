import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'higsgen_session';

const equal = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
};

export const sessionToken = (apiKey) =>
  createHmac('sha256', apiKey).update('higsgen-studio-session-v1').digest('base64url');

export const cookieValue = (header, name) => {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
};

export const isAuthorized = (req, apiKey) => {
  const bearer = String(req.headers.authorization ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && equal(bearer, apiKey)) return true;
  return equal(cookieValue(req.headers.cookie, SESSION_COOKIE), sessionToken(apiKey));
};

export const isValidApiKey = (candidate, apiKey) => equal(candidate, apiKey);

export const sessionCookie = (apiKey, secure = false) =>
  `${SESSION_COOKIE}=${encodeURIComponent(sessionToken(apiKey))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure ? '; Secure' : ''}`;

export const clearSessionCookie = (secure = false) =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
