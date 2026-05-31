/// Environment bindings for the Worker.
export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  /// Optional admin token for out-of-band password resets. Set via
  /// `wrangler secret put ADMIN_TOKEN`. When unset, the reset endpoint is
  /// disabled (returns 404).
  ADMIN_TOKEN?: string;
  /// Resend API key for sending password-reset emails (Workers can't do SMTP).
  /// Set via `wrangler secret put RESEND_API_KEY`. When unset, forgot-password
  /// returns ok but no email is sent.
  RESEND_API_KEY?: string;
  /// Optional From header, e.g. "Ironshelf <noreply@inknironapps.com>".
  MAIL_FROM?: string;
  /// Base URL of the hosted web UI used to build reset links. Defaults to
  /// https://ironshelf.inknironapps.com when unset.
  APP_BASE_URL?: string;
}

/// Central user account.
export interface CloudUser {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  created_at: string;
}

/// A claimed server.
export interface CloudServer {
  id: string;
  owner_id: string;
  name: string;
  url: string;
  claim_token: string;
  is_verified: number;
  last_seen_at: string | null;
  version: string | null;
  created_at: string;
}

/// Server access grant for a user.
export interface ServerAccess {
  server_id: string;
  user_id: string;
  permissions: string;
  granted_by: string | null;
  created_at: string;
}

/// JWT payload for central auth tokens.
export interface JwtPayload {
  sub: string;          // user id
  username: string;
  iat: number;
  exp: number;
  /// Set to "reset" on short-lived password-reset tokens.
  purpose?: string;
}

/// JWT payload for server access tokens (short-lived relay tokens).
export interface ServerAccessTokenPayload {
  sub: string;          // user id
  username: string;
  server_id: string;
  permissions: string;
  claim_token: string;  // server's claim token for verification
  iat: number;
  exp: number;
}

/// Standard JSON error response.
export interface ErrorResponse {
  error: string;
}

/// Standard JSON success response with optional data.
export interface SuccessResponse<T = unknown> {
  ok: true;
  data?: T;
}
