/**
 * Server sharing routes: share, revoke, list members.
 */

import type { Env } from '../types';
import { requireUser, jsonResponse } from '../auth';

// ---------------------------------------------------------------------------
// POST /servers/:id/share — share server with another user
// ---------------------------------------------------------------------------

interface ShareBody {
  username_or_email: string;
  permissions?: string;
}

export async function handleShareServer(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Verify the current user owns or has share permission on the server
  const server = await env.DB.prepare(
    'SELECT id, owner_id FROM servers WHERE id = ?',
  )
    .bind(serverId)
    .first<{ id: string; owner_id: string }>();

  if (!server) {
    return jsonResponse({ error: 'Server not found' }, 404);
  }
  if (server.owner_id !== user.id) {
    return jsonResponse({ error: 'Only the server owner can share access' }, 403);
  }

  let body: ShareBody;
  try {
    body = await request.json() as ShareBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { username_or_email, permissions = 'read,download' } = body;
  if (!username_or_email) {
    return jsonResponse({ error: 'username_or_email is required' }, 400);
  }

  // Validate permissions string
  const validPermissions = ['read', 'download', 'stream', 'owner'];
  const requestedPermissions = permissions.split(',').map(p => p.trim());
  for (const perm of requestedPermissions) {
    if (!validPermissions.includes(perm)) {
      return jsonResponse({ error: `Invalid permission: ${perm}. Valid: ${validPermissions.join(', ')}` }, 400);
    }
  }
  // Prevent granting 'owner' via share endpoint
  if (requestedPermissions.includes('owner')) {
    return jsonResponse({ error: 'Cannot grant owner permission via sharing' }, 400);
  }

  const identifier = username_or_email.toLowerCase();

  // Find the target user
  const targetUser = await env.DB.prepare(
    'SELECT id, username, email FROM users WHERE email = ? OR username = ?',
  )
    .bind(identifier, identifier)
    .first<{ id: string; username: string; email: string }>();

  if (!targetUser) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  if (targetUser.id === user.id) {
    return jsonResponse({ error: 'You cannot share a server with yourself' }, 400);
  }

  // Check if already shared
  const existingAccess = await env.DB.prepare(
    'SELECT server_id FROM server_access WHERE server_id = ? AND user_id = ?',
  )
    .bind(serverId, targetUser.id)
    .first();

  if (existingAccess) {
    // Update permissions instead of erroring
    await env.DB.prepare(
      'UPDATE server_access SET permissions = ? WHERE server_id = ? AND user_id = ?',
    )
      .bind(permissions, serverId, targetUser.id)
      .run();

    return jsonResponse({
      ok: true,
      data: {
        user_id: targetUser.id,
        username: targetUser.username,
        permissions,
        updated: true,
      },
    });
  }

  await env.DB.prepare(
    `INSERT INTO server_access (server_id, user_id, permissions, granted_by)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(serverId, targetUser.id, permissions, user.id)
    .run();

  return jsonResponse({
    ok: true,
    data: {
      user_id: targetUser.id,
      username: targetUser.username,
      permissions,
    },
  }, 201);
}

// ---------------------------------------------------------------------------
// DELETE /servers/:id/share/:user_id — revoke access
// ---------------------------------------------------------------------------

export async function handleRevokeAccess(
  request: Request,
  env: Env,
  serverId: string,
  targetUserId: string,
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
    return jsonResponse({ error: 'Only the server owner can revoke access' }, 403);
  }

  // Cannot revoke owner's own access
  if (targetUserId === user.id) {
    return jsonResponse({ error: 'Cannot revoke your own owner access' }, 400);
  }

  const result = await env.DB.prepare(
    'DELETE FROM server_access WHERE server_id = ? AND user_id = ?',
  )
    .bind(serverId, targetUserId)
    .run();

  if (!result.meta.changes) {
    return jsonResponse({ error: 'Access grant not found' }, 404);
  }

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// GET /servers/:id/members — list who has access
// ---------------------------------------------------------------------------

export async function handleListMembers(
  request: Request,
  env: Env,
  serverId: string,
): Promise<Response> {
  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Must be owner or have access themselves
  const server = await env.DB.prepare(
    'SELECT id, owner_id FROM servers WHERE id = ?',
  )
    .bind(serverId)
    .first<{ id: string; owner_id: string }>();

  if (!server) {
    return jsonResponse({ error: 'Server not found' }, 404);
  }

  // Only owner can list all members
  if (server.owner_id !== user.id) {
    return jsonResponse({ error: 'Only the server owner can list members' }, 403);
  }

  const members = await env.DB.prepare(
    `SELECT u.id AS user_id, u.username, u.email, sa.permissions, sa.created_at AS granted_at
     FROM server_access sa
     JOIN users u ON u.id = sa.user_id
     WHERE sa.server_id = ?
     ORDER BY sa.created_at ASC`,
  )
    .bind(serverId)
    .all();

  return jsonResponse({ ok: true, data: members.results });
}
