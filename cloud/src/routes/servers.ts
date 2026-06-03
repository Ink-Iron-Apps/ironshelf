/**
 * Server management routes: claim, list, update, delete.
 */

import type { Env, CloudServer } from '../types';
import {
  requireUser,
  jsonResponse,
  generateId,
  generateToken,
} from '../auth';

// ---------------------------------------------------------------------------
// POST /servers/claim — claim a server
// ---------------------------------------------------------------------------

interface ClaimBody {
  server_url: string;
  server_name: string;
}

export async function handleClaimServer(request: Request, env: Env): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  let body: ClaimBody;
  try {
    body = await request.json() as ClaimBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { server_url, server_name } = body;
  if (!server_url || !server_name) {
    return jsonResponse({ error: 'server_url and server_name are required' }, 400);
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(server_url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    return jsonResponse({ error: 'Invalid server URL — must be http:// or https://' }, 400);
  }

  // Normalize URL: strip trailing slash
  const normalizedUrl = parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, '');

  // Idempotent migration: a server's stable instance_id lets us recognize the
  // same physical server across changing (rotating-tunnel) URLs.
  await env.DB.prepare('ALTER TABLE servers ADD COLUMN instance_id TEXT')
    .run()
    .catch(() => {});

  // Verify the server is reachable by hitting its health endpoint
  let isReachable = false;
  let serverVersion: string | null = null;
  let instanceId: string | null = null;
  try {
    const healthResponse = await fetch(`${normalizedUrl}/health`, {
      method: 'GET',
      headers: { 'User-Agent': 'ironshelf-cloud/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (healthResponse.ok) {
      isReachable = true;
      try {
        const healthData = await healthResponse.json() as {
          version?: string;
          instance_id?: string;
        };
        serverVersion = healthData.version ?? null;
        instanceId = healthData.instance_id ?? null;
      } catch {
        // Health endpoint returned non-JSON — still reachable
      }
    }
  } catch {
    // Server not reachable — we still allow claiming but mark as unverified
  }

  // Find an existing entry for this server. Prefer the stable instance_id (so a
  // new tunnel URL updates the same server instead of creating a duplicate);
  // fall back to URL match for servers/older builds without an instance_id.
  let existingServer: { id: string; owner_id: string } | null = null;
  if (instanceId) {
    existingServer = await env.DB.prepare(
      'SELECT id, owner_id FROM servers WHERE instance_id = ?',
    )
      .bind(instanceId)
      .first<{ id: string; owner_id: string }>();
  }
  if (!existingServer) {
    existingServer = await env.DB.prepare(
      'SELECT id, owner_id FROM servers WHERE url = ?',
    )
      .bind(normalizedUrl)
      .first<{ id: string; owner_id: string }>();
  }

  if (existingServer && existingServer.owner_id !== user.id) {
    return jsonResponse({ error: 'This server is already claimed by another user' }, 409);
  }

  const claimToken = generateToken(48);
  const lastSeen = isReachable ? new Date().toISOString() : null;

  let serverId: string;
  if (existingServer) {
    // Re-adopt: refresh URL (it may have changed), token, and metadata.
    serverId = existingServer.id;
    await env.DB.prepare(
      `UPDATE servers SET name = ?, url = ?, claim_token = ?, is_verified = ?, version = ?, last_seen_at = ?, instance_id = COALESCE(?, instance_id)
       WHERE id = ?`,
    )
      .bind(server_name.trim(), normalizedUrl, claimToken, isReachable ? 1 : 0, serverVersion, lastSeen, instanceId, serverId)
      .run();
    // Ensure the owner still has an access row.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO server_access (server_id, user_id, permissions, granted_by)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(serverId, user.id, 'owner', user.id)
      .run();
  } else {
    serverId = generateId();
    await env.DB.prepare(
      `INSERT INTO servers (id, owner_id, name, url, claim_token, is_verified, version, last_seen_at, instance_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(serverId, user.id, server_name.trim(), normalizedUrl, claimToken, isReachable ? 1 : 0, serverVersion, lastSeen, instanceId)
      .run();
    await env.DB.prepare(
      `INSERT INTO server_access (server_id, user_id, permissions, granted_by)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(serverId, user.id, 'owner', user.id)
      .run();
  }

  return jsonResponse({
    ok: true,
    data: {
      server_id: serverId,
      claim_token: claimToken,
      is_verified: isReachable,
      server_version: serverVersion,
      message: isReachable
        ? 'Server claimed and verified. Store the claim_token on your server to complete setup.'
        : 'Server claimed but could not be reached. Store the claim_token on your server and verify later.',
    },
  }, existingServer ? 200 : 201);
}

// ---------------------------------------------------------------------------
// GET /servers/mine — list servers I own
// ---------------------------------------------------------------------------

export async function handleListMyServers(request: Request, env: Env): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const servers = await env.DB.prepare(
    `SELECT id, name, url, is_verified, last_seen_at, version, created_at
     FROM servers WHERE owner_id = ? ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all<Omit<CloudServer, 'owner_id' | 'claim_token' | 'password_hash'>>();

  return jsonResponse({ ok: true, data: servers.results });
}

// ---------------------------------------------------------------------------
// GET /servers/shared — list servers shared with me (not owned)
// ---------------------------------------------------------------------------

export async function handleListSharedServers(request: Request, env: Env): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const servers = await env.DB.prepare(
    `SELECT s.id, s.name, s.url, s.is_verified, s.last_seen_at, s.version, s.created_at,
            sa.permissions
     FROM server_access sa
     JOIN servers s ON s.id = sa.server_id
     WHERE sa.user_id = ? AND s.owner_id != ?
     ORDER BY s.name ASC`,
  )
    .bind(user.id, user.id)
    .all();

  return jsonResponse({ ok: true, data: servers.results });
}

// ---------------------------------------------------------------------------
// PATCH /servers/:id — update server name/url
// ---------------------------------------------------------------------------

interface UpdateServerBody {
  name?: string;
  url?: string;
}

export async function handleUpdateServer(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Verify ownership
  const server = await env.DB.prepare(
    'SELECT id, owner_id FROM servers WHERE id = ?',
  )
    .bind(serverId)
    .first<{ id: string; owner_id: string }>();

  if (!server) {
    return jsonResponse({ error: 'Server not found' }, 404);
  }
  if (server.owner_id !== user.id) {
    return jsonResponse({ error: 'Only the server owner can update it' }, 403);
  }

  let body: UpdateServerBody;
  try {
    body = await request.json() as UpdateServerBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    const trimmedName = body.name.trim();
    if (!trimmedName) {
      return jsonResponse({ error: 'Server name cannot be empty' }, 400);
    }
    updates.push('name = ?');
    values.push(trimmedName);
  }

  if (body.url !== undefined) {
    try {
      const parsedUrl = new URL(body.url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('bad protocol');
      }
      const normalizedUrl = parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, '');
      updates.push('url = ?');
      values.push(normalizedUrl);
    } catch {
      return jsonResponse({ error: 'Invalid server URL' }, 400);
    }
  }

  if (updates.length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }

  values.push(serverId);
  await env.DB.prepare(`UPDATE servers SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// POST /servers/:id/heartbeat — server liveness ping (authed by claim_token)
//
// The self-hosted server calls this on a timer. Unlike the user-facing routes,
// this is authenticated by the server's own claim_token (Bearer), so it can run
// without a logged-in user. Bumps last_seen_at (and version/url if provided).
// ---------------------------------------------------------------------------

interface HeartbeatBody {
  version?: string;
  url?: string;
}

export async function handleHeartbeat(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return jsonResponse({ error: 'Missing claim token' }, 401);
  }

  const server = await env.DB.prepare(
    'SELECT id, claim_token FROM servers WHERE id = ?',
  )
    .bind(serverId)
    .first<{ id: string; claim_token: string }>();

  if (!server) {
    return jsonResponse({ error: 'Server not found' }, 404);
  }
  if (server.claim_token !== token) {
    return jsonResponse({ error: 'Invalid claim token' }, 401);
  }

  let body: HeartbeatBody = {};
  try {
    body = (await request.json()) as HeartbeatBody;
  } catch {
    // Empty/invalid body is fine — heartbeat still bumps last_seen_at.
  }

  const now = new Date().toISOString();
  const updates: string[] = ['last_seen_at = ?', 'is_verified = 1'];
  const values: (string | null)[] = [now];

  if (body.version) {
    updates.push('version = ?');
    values.push(body.version);
  }
  if (body.url) {
    try {
      const parsedUrl = new URL(body.url);
      if (['http:', 'https:'].includes(parsedUrl.protocol)) {
        updates.push('url = ?');
        values.push(parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, ''));
      }
    } catch {
      // ignore bad url
    }
  }

  values.push(serverId);
  await env.DB.prepare(`UPDATE servers SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// DELETE /servers/:id — unclaim a server
// ---------------------------------------------------------------------------

export async function handleDeleteServer(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const server = await env.DB.prepare(
    'SELECT id, owner_id FROM servers WHERE id = ?',
  )
    .bind(serverId)
    .first<{ id: string; owner_id: string }>();

  if (!server) {
    return jsonResponse({ error: 'Server not found' }, 404);
  }
  if (server.owner_id !== user.id) {
    return jsonResponse({ error: 'Only the server owner can delete it' }, 403);
  }

  // CASCADE will clean up server_access
  await env.DB.prepare('DELETE FROM servers WHERE id = ?')
    .bind(serverId)
    .run();

  return jsonResponse({ ok: true });
}
