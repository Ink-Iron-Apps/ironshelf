/**
 * Connection routes: get server connection info, issue relay tokens.
 *
 * Auth relay flow:
 * 1. User authenticates with central service (has central JWT)
 * 2. User requests a server access token for a specific server
 * 3. Central service issues a short-lived token signed with the server's claim_token
 * 4. Client sends this token to the server's POST /api/v1/auth/cloud-login
 * 5. Server verifies the token using its stored claim_token
 * 6. Server creates a local session — all subsequent requests go directly to server
 */

import type { Env, CloudServer } from '../types';
import {
  requireUser,
  jsonResponse,
  createServerAccessToken,
  verifyJwt,
} from '../auth';
import type { ServerAccessTokenPayload } from '../types';

// ---------------------------------------------------------------------------
// GET /servers/connect/:server_id — get connection info
// ---------------------------------------------------------------------------

export async function handleGetConnectionInfo(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Check the user has access to this server
  const accessRow = await env.DB.prepare(
    `SELECT sa.permissions, s.id, s.name, s.url, s.is_verified, s.claim_token
     FROM server_access sa
     JOIN servers s ON s.id = sa.server_id
     WHERE sa.server_id = ? AND sa.user_id = ?`,
  )
    .bind(serverId, user.id)
    .first<{
      permissions: string;
      id: string;
      name: string;
      url: string;
      is_verified: number;
      claim_token: string;
    }>();

  if (!accessRow) {
    return jsonResponse({ error: 'You do not have access to this server' }, 403);
  }

  return jsonResponse({
    ok: true,
    data: {
      server_id: accessRow.id,
      server_name: accessRow.name,
      server_url: accessRow.url,
      is_verified: !!accessRow.is_verified,
      permissions: accessRow.permissions,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /servers/:id/token — issue a short-lived server access token
// ---------------------------------------------------------------------------

export async function handleIssueToken(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Check the user has access and get the server's claim_token
  const accessRow = await env.DB.prepare(
    `SELECT sa.permissions, s.claim_token, s.url, s.name
     FROM server_access sa
     JOIN servers s ON s.id = sa.server_id
     WHERE sa.server_id = ? AND sa.user_id = ?`,
  )
    .bind(serverId, user.id)
    .first<{
      permissions: string;
      claim_token: string;
      url: string;
      name: string;
    }>();

  if (!accessRow) {
    return jsonResponse({ error: 'You do not have access to this server' }, 403);
  }

  // Issue a short-lived token signed with the claim_token as HMAC key
  // The server can verify this independently without calling back to us
  const serverAccessToken = await createServerAccessToken(
    user.id,
    user.username,
    serverId,
    accessRow.permissions,
    accessRow.claim_token,
    env.JWT_SECRET,
  );

  return jsonResponse({
    ok: true,
    data: {
      server_access_token: serverAccessToken,
      server_url: accessRow.url,
      server_name: accessRow.name,
      expires_in: 300, // 5 minutes
    },
  });
}

// ---------------------------------------------------------------------------
// GET /auth/validate-token — server calls this to validate a cloud token
//
// This is the callback endpoint. Servers that do not want to verify tokens
// locally (using claim_token HMAC) can call this endpoint instead.
// ---------------------------------------------------------------------------

export async function handleValidateToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return jsonResponse({ error: 'token query parameter is required' }, 400);
  }

  // The server access token is signed with the claim_token as HMAC key.
  // We need to try to decode the payload first to get the server_id,
  // then look up the claim_token to verify the signature.
  const parts = token.split('.');
  if (parts.length !== 3) {
    return jsonResponse({ error: 'Invalid token format' }, 401);
  }

  // Decode payload without verification first to get server_id
  let rawPayload: ServerAccessTokenPayload;
  try {
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    let padded = payloadBase64;
    while (padded.length % 4) padded += '=';
    rawPayload = JSON.parse(atob(padded)) as ServerAccessTokenPayload;
  } catch {
    return jsonResponse({ error: 'Invalid token payload' }, 401);
  }

  if (!rawPayload.server_id) {
    return jsonResponse({ error: 'Token missing server_id' }, 401);
  }

  // Look up the server to get its claim_token
  const server = await env.DB.prepare(
    'SELECT claim_token FROM servers WHERE id = ?',
  )
    .bind(rawPayload.server_id)
    .first<{ claim_token: string }>();

  if (!server) {
    return jsonResponse({ error: 'Server not found' }, 404);
  }

  // Now verify the full token using the claim_token
  // The token was signed with claim_token as the HMAC key
  const headerPayload = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(server.claim_token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signatureBase64Url = parts[2];
  let signatureBase64 = signatureBase64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (signatureBase64.length % 4) signatureBase64 += '=';
  const signatureBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));

  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(headerPayload),
  );

  if (!isValid) {
    return jsonResponse({ error: 'Invalid token signature' }, 401);
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (rawPayload.exp && rawPayload.exp < now) {
    return jsonResponse({ error: 'Token expired' }, 401);
  }

  // Verify the user still has access
  const access = await env.DB.prepare(
    'SELECT permissions FROM server_access WHERE server_id = ? AND user_id = ?',
  )
    .bind(rawPayload.server_id, rawPayload.sub)
    .first<{ permissions: string }>();

  if (!access) {
    return jsonResponse({ error: 'User access revoked' }, 403);
  }

  return jsonResponse({
    ok: true,
    data: {
      user_id: rawPayload.sub,
      username: rawPayload.username,
      server_id: rawPayload.server_id,
      permissions: access.permissions,
    },
  });
}
