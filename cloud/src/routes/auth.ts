/**
 * Authentication routes: register, login, me, password change.
 */

import type { Env, CloudUser } from '../types';
import {
  hashPassword,
  verifyPassword,
  createJwt,
  verifyJwt,
  requireUser,
  jsonResponse,
  generateId,
} from '../auth';

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

interface RegisterBody {
  email: string;
  username: string;
  password: string;
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: RegisterBody;
  try {
    body = await request.json() as RegisterBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { email, username, password } = body;

  // Validate required fields
  if (!email || !username || !password) {
    return jsonResponse({ error: 'email, username, and password are required' }, 400);
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Invalid email address' }, 400);
  }

  // Validate username: 2-32 chars, alphanumeric + underscores
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(username)) {
    return jsonResponse(
      { error: 'Username must be 2-32 characters, alphanumeric and underscores only' },
      400,
    );
  }

  // Validate password length
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
  }
  if (password.length > 1024) {
    return jsonResponse({ error: 'Password must not exceed 1024 characters' }, 400);
  }

  // Check for existing user with same email or username
  const existingUser = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ?',
  )
    .bind(email.toLowerCase(), username.toLowerCase())
    .first();

  if (existingUser) {
    return jsonResponse({ error: 'An account with that email or username already exists' }, 409);
  }

  const userId = generateId();
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    'INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, email.toLowerCase(), username.toLowerCase(), passwordHash)
    .run();

  const token = await createJwt(
    { sub: userId, username: username.toLowerCase() },
    env.JWT_SECRET,
  );

  return jsonResponse({
    ok: true,
    data: {
      user_id: userId,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      token,
    },
  }, 201);
}

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

interface LoginBody {
  email_or_username: string;
  password: string;
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: LoginBody;
  try {
    body = await request.json() as LoginBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { email_or_username, password } = body;
  if (!email_or_username || !password) {
    return jsonResponse({ error: 'email_or_username and password are required' }, 400);
  }

  const identifier = email_or_username.toLowerCase();

  // Look up by email or username
  const user = await env.DB.prepare(
    'SELECT id, email, username, password_hash, created_at FROM users WHERE email = ? OR username = ?',
  )
    .bind(identifier, identifier)
    .first<CloudUser>();

  if (!user) {
    return jsonResponse({ error: 'Invalid credentials' }, 401);
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    return jsonResponse({ error: 'Invalid credentials' }, 401);
  }

  const token = await createJwt(
    { sub: user.id, username: user.username },
    env.JWT_SECRET,
  );

  return jsonResponse({
    ok: true,
    data: {
      user_id: user.id,
      username: user.username,
      email: user.email,
      token,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  return jsonResponse({
    ok: true,
    data: {
      user_id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
    },
  });
}

// ---------------------------------------------------------------------------
// PUT /auth/password
// ---------------------------------------------------------------------------

interface ChangePasswordBody {
  current_password: string;
  new_password: string;
}

export async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  let body: ChangePasswordBody;
  try {
    body = await request.json() as ChangePasswordBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { current_password, new_password } = body;
  if (!current_password || !new_password) {
    return jsonResponse({ error: 'current_password and new_password are required' }, 400);
  }

  if (new_password.length < 8) {
    return jsonResponse({ error: 'New password must be at least 8 characters' }, 400);
  }
  if (new_password.length > 1024) {
    return jsonResponse({ error: 'New password must not exceed 1024 characters' }, 400);
  }

  const currentValid = await verifyPassword(current_password, user.password_hash);
  if (!currentValid) {
    return jsonResponse({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await hashPassword(new_password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(newHash, user.id)
    .run();

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// POST /auth/admin/reset-password
// ---------------------------------------------------------------------------

interface AdminResetBody {
  email_or_username: string;
  new_password: string;
}

/// Out-of-band password reset for a forgotten cloud password. Gated by the
/// ADMIN_TOKEN secret (Authorization: Bearer <ADMIN_TOKEN>). Disabled (404)
/// when ADMIN_TOKEN is not configured.
export async function handleAdminResetPassword(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const authorization = request.headers.get('Authorization') || '';
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  // Constant-ish comparison: reject unless it matches the configured token.
  if (!provided || provided !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: AdminResetBody;
  try {
    body = await request.json() as AdminResetBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { email_or_username, new_password } = body;
  if (!email_or_username || !new_password) {
    return jsonResponse({ error: 'email_or_username and new_password are required' }, 400);
  }
  if (new_password.length < 8 || new_password.length > 1024) {
    return jsonResponse({ error: 'New password must be 8-1024 characters' }, 400);
  }

  const identifier = email_or_username.toLowerCase();
  const user = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ?',
  )
    .bind(identifier, identifier)
    .first<{ id: string }>();

  if (!user) {
    return jsonResponse({ error: 'No account found for that email or username' }, 404);
  }

  const newHash = await hashPassword(new_password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(newHash, user.id)
    .run();

  return jsonResponse({ ok: true, data: { user_id: user.id } });
}

// ---------------------------------------------------------------------------
// Self-service password reset (email link)
// ---------------------------------------------------------------------------

const RESET_TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes

/// Send a password-reset email via Resend. Returns true on success. Never
/// throws — failures are logged and reported as false.
async function sendResetEmail(env: Env, toEmail: string, resetLink: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0F1115">
      <h2 style="font-family:'EB Garamond',Georgia,serif">Reset your Ironshelf Cloud password</h2>
      <p>We received a request to reset your password. Click the button below to choose a new one. This link expires in 30 minutes.</p>
      <p><a href="${resetLink}" style="display:inline-block;background:#095F73;color:#E8E4DA;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p>
      <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email. Or paste this link into your browser:<br>${resetLink}</p>
    </div>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Ironshelf <noreply@inknironapps.com>',
        reply_to: 'support@inknironapps.com',
        to: [toEmail],
        subject: 'Reset your Ironshelf Cloud password',
        html,
      }),
    });
    if (!response.ok) {
      console.error('Resend send failed:', response.status, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (error) {
    console.error('Resend send error:', error);
    return false;
  }
}

interface ForgotPasswordBody {
  email: string;
}

/// POST /auth/forgot-password — email a reset link if the account exists.
/// Always returns ok (does not reveal whether the email is registered).
export async function handleForgotPassword(request: Request, env: Env): Promise<Response> {
  let body: ForgotPasswordBody;
  try {
    body = await request.json() as ForgotPasswordBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return jsonResponse({ error: 'email is required' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, username FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{ id: string; username: string }>();

  if (user) {
    const token = await createJwt(
      { sub: user.id, username: user.username, purpose: 'reset' },
      env.JWT_SECRET,
      RESET_TOKEN_TTL_SECONDS,
    );
    const baseUrl = (env.APP_BASE_URL || 'https://ironshelf.inknironapps.com').replace(/\/+$/, '');
    const resetLink = `${baseUrl}/#/cloud-reset?token=${encodeURIComponent(token)}`;
    await sendResetEmail(env, email, resetLink);
  }

  // Uniform response regardless of whether the account exists.
  return jsonResponse({ ok: true });
}

interface ResetPasswordBody {
  token: string;
  new_password: string;
}

/// POST /auth/reset-password — set a new password using a reset token.
export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  let body: ResetPasswordBody;
  try {
    body = await request.json() as ResetPasswordBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { token, new_password } = body;
  if (!token || !new_password) {
    return jsonResponse({ error: 'token and new_password are required' }, 400);
  }
  if (new_password.length < 8 || new_password.length > 1024) {
    return jsonResponse({ error: 'New password must be 8-1024 characters' }, 400);
  }

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || payload.purpose !== 'reset') {
    return jsonResponse({ error: 'Invalid or expired reset link' }, 400);
  }

  const newHash = await hashPassword(new_password);
  const result = await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(newHash, payload.sub)
    .run();

  if (!result.success) {
    return jsonResponse({ error: 'Failed to reset password' }, 500);
  }

  return jsonResponse({ ok: true });
}
