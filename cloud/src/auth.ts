/**
 * Authentication utilities for Ironshelf Cloud.
 *
 * Uses Web Crypto API (available in Workers runtime):
 * - Password hashing: PBKDF2 with SHA-256 (argon2 not available in Workers)
 * - JWT: HMAC-SHA256 sign/verify
 */

import type { Env, JwtPayload, CloudUser } from './types';

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA256)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 310_000; // OWASP 2023 recommendation for SHA-256
const SALT_BYTES = 32;
const KEY_BYTES = 32;

/**
 * Hash a password using PBKDF2 with a random salt.
 * Returns a string in the format: `pbkdf2:sha256:<iterations>$<base64-salt>$<base64-hash>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8,
  );
  const saltBase64 = bufferToBase64(salt);
  const hashBase64 = bufferToBase64(new Uint8Array(derivedBits));
  return `pbkdf2:sha256:${PBKDF2_ITERATIONS}$${saltBase64}$${hashBase64}`;
}

/**
 * Verify a password against a stored hash string.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;

  const header = parts[0]; // "pbkdf2:sha256:<iterations>"
  const saltBase64 = parts[1];
  const expectedHashBase64 = parts[2];

  const iterationsMatch = header.match(/:(\d+)$/);
  if (!iterationsMatch) return false;
  const iterations = parseInt(iterationsMatch[1], 10);

  const salt = base64ToBuffer(saltBase64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8,
  );
  const actualHashBase64 = bufferToBase64(new Uint8Array(derivedBits));
  return timingSafeEqual(actualHashBase64, expectedHashBase64);
}

// ---------------------------------------------------------------------------
// JWT (HMAC-SHA256)
// ---------------------------------------------------------------------------

/**
 * Create a signed JWT with the given payload and secret.
 * Default TTL is 7 days.
 */
export async function createJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number = 7 * 24 * 60 * 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = bufferToBase64Url(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify and decode a JWT. Returns the payload if valid, null otherwise.
 */
export async function verifyJwt<T extends JwtPayload = JwtPayload>(
  token: string,
  secret: string,
): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  try {
    const key = await importHmacKey(secret);
    const signatureBytes = base64UrlToBuffer(encodedSignature);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput),
    );

    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as T;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a short-lived server access token (5 minutes).
 * This token is sent to the individual server which validates it using
 * the claim_token as a shared secret or calls back to the central service.
 */
export async function createServerAccessToken(
  userId: string,
  username: string,
  serverId: string,
  permissions: string,
  claimToken: string,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    username,
    server_id: serverId,
    permissions,
    claim_token: claimToken,
    iat: now,
    exp: now + 300, // 5 minutes
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with claim_token as HMAC key so the server can verify independently
  const key = await importHmacKey(claimToken);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = bufferToBase64Url(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

// ---------------------------------------------------------------------------
// Auth extraction middleware
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated user from the request's Authorization header.
 * Returns the user row from D1 or null if unauthenticated.
 */
export async function extractUser(
  request: Request,
  env: Env,
): Promise<CloudUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;

  const user = await env.DB.prepare(
    'SELECT id, email, username, password_hash, created_at FROM users WHERE id = ?',
  )
    .bind(payload.sub)
    .first<CloudUser>();

  return user;
}

/**
 * Require an authenticated user or return a 401 Response.
 */
export async function requireUser(
  request: Request,
  env: Env,
): Promise<CloudUser | Response> {
  const user = await extractUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }
  return user;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return atob(base64);
}

function bufferToBase64Url(buffer: Uint8Array): string {
  return bufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return base64ToBuffer(base64);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Create a JSON response with proper headers.
 */
export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Generate a cryptographically random UUID v4.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a cryptographically random token (hex string).
 */
export function generateToken(byteLength: number = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
