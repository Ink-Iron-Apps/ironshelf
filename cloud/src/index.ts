/**
 * Ironshelf Cloud — Central Authentication & Server Directory
 *
 * Cloudflare Worker that provides:
 * - Central user accounts (sign up / login)
 * - Server claiming (link a self-hosted server to a central account)
 * - Server sharing (invite users by email/username)
 * - Auth relay (issue short-lived tokens that individual servers trust)
 */

import type { Env } from './types';
import { jsonResponse } from './auth';
import { handleRegister, handleLogin, handleMe, handleChangePassword } from './routes/auth';
import {
  handleClaimServer,
  handleListMyServers,
  handleListSharedServers,
  handleUpdateServer,
  handleDeleteServer,
} from './routes/servers';
import {
  handleShareServer,
  handleRevokeAccess,
  handleListMembers,
} from './routes/sharing';
import {
  handleGetConnectionInfo,
  handleIssueToken,
  handleValidateToken,
} from './routes/connect';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return handleCors(request, env);
    }

    let response: Response;
    try {
      response = await routeRequest(method, path, request, env);
    } catch (error: any) {
      console.error('Unhandled error:', error);
      response = jsonResponse(
        { error: 'Internal server error' },
        500,
      );
    }

    // Add CORS headers to all responses
    return addCorsHeaders(response, request, env);
  },
};

async function routeRequest(
  method: string,
  path: string,
  request: Request,
  env: Env,
): Promise<Response> {
  // --- Auth routes ---
  if (method === 'POST' && path === '/auth/register') {
    return handleRegister(request, env);
  }
  if (method === 'POST' && path === '/auth/login') {
    return handleLogin(request, env);
  }
  if (method === 'GET' && path === '/auth/me') {
    return handleMe(request, env);
  }
  if (method === 'PUT' && path === '/auth/password') {
    return handleChangePassword(request, env);
  }

  // --- Token validation (servers call this) ---
  if (method === 'GET' && path === '/auth/validate-token') {
    return handleValidateToken(request, env);
  }

  // --- Server management routes ---
  if (method === 'POST' && path === '/servers/claim') {
    return handleClaimServer(request, env);
  }
  if (method === 'GET' && path === '/servers/mine') {
    return handleListMyServers(request, env);
  }
  if (method === 'GET' && path === '/servers/shared') {
    return handleListSharedServers(request, env);
  }

  // --- Server-specific routes (with :id) ---
  const serverIdMatch = path.match(/^\/servers\/([a-f0-9-]+)$/);
  if (serverIdMatch) {
    const serverId = serverIdMatch[1];
    if (method === 'PATCH') return handleUpdateServer(request, env, serverId);
    if (method === 'DELETE') return handleDeleteServer(request, env, serverId);
  }

  // --- Sharing routes ---
  const shareMatch = path.match(/^\/servers\/([a-f0-9-]+)\/share$/);
  if (shareMatch && method === 'POST') {
    return handleShareServer(request, env, shareMatch[1]);
  }

  const revokeMatch = path.match(/^\/servers\/([a-f0-9-]+)\/share\/([a-f0-9-]+)$/);
  if (revokeMatch && method === 'DELETE') {
    return handleRevokeAccess(request, env, revokeMatch[1], revokeMatch[2]);
  }

  const membersMatch = path.match(/^\/servers\/([a-f0-9-]+)\/members$/);
  if (membersMatch && method === 'GET') {
    return handleListMembers(request, env, membersMatch[1]);
  }

  // --- Connection / token routes ---
  const connectMatch = path.match(/^\/servers\/connect\/([a-f0-9-]+)$/);
  if (connectMatch && method === 'GET') {
    return handleGetConnectionInfo(request, env, connectMatch[1]);
  }

  const tokenMatch = path.match(/^\/servers\/([a-f0-9-]+)\/token$/);
  if (tokenMatch && method === 'POST') {
    return handleIssueToken(request, env, tokenMatch[1]);
  }

  // --- Health check ---
  if (method === 'GET' && path === '/health') {
    return jsonResponse({ status: 'healthy', service: 'ironshelf-cloud' });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

// Self-hosted Ironshelf servers are reached at arbitrary origins (localhost,
// LAN IPs, Cloudflare Tunnel URLs, custom domains), so a single fixed
// CORS_ORIGIN cannot cover them. Reflect the caller's Origin instead. This is
// safe here: cloud auth/claim send credentials in the request body, not via
// cookies, so no credentialed cross-origin state is exposed.
function resolveAllowOrigin(request: Request, env: Env): string {
  return request.headers.get('Origin') || env.CORS_ORIGIN || '*';
}

function handleCors(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': resolveAllowOrigin(request, env),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  });
}

function addCorsHeaders(response: Response, request: Request, env: Env): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', resolveAllowOrigin(request, env));
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  newHeaders.append('Vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
