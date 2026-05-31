/**
 * Minimal SMTP client for Cloudflare Workers using raw TCP sockets
 * (`cloudflare:sockets`). Sends mail through an authenticated mailbox such as
 * Hostinger. Tries implicit TLS (465) and STARTTLS (587) so it works whichever
 * submission port the provider accepts from datacenter IPs.
 *
 * Configured via secrets: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD,
 * SMTP_FROM. When any required field is missing, sendMail() returns false.
 */

import { connect } from 'cloudflare:sockets';
import type { Env } from './types';

interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/// Read SMTP replies until a final line (`NNN <text>`), returning its code.
async function readReply(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: { buffer: string },
): Promise<number> {
  while (true) {
    const lines = state.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (/^\d{3} /.test(line)) {
        const code = parseInt(line.slice(0, 3), 10);
        state.buffer = lines.slice(i + 1).join('\r\n');
        return code;
      }
    }
    const { value, done } = await reader.read();
    if (done) throw new Error('SMTP connection closed unexpectedly');
    state.buffer += decoder.decode(value);
  }
}

async function writeLine(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  line: string,
): Promise<void> {
  await writer.write(encoder.encode(line + '\r\n'));
}

function buildMessage(from: string, message: MailMessage): string {
  const headers = [
    `From: Ironshelf <${from}>`,
    `To: <${message.to}>`,
    'Reply-To: support@inknironapps.com',
    `Subject: ${message.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');
  // Dot-stuff lines beginning with '.' so they aren't read as end-of-data.
  const body = message.html.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
  return `${headers}\r\n\r\n${body}\r\n.\r\n`;
}

interface SmtpCreds {
  host: string;
  username: string;
  password: string;
  from: string;
}

/// Attempt a send over a single port/mode. Throws on any failure.
async function attemptSend(
  creds: SmtpCreds,
  port: number,
  mode: 'tls' | 'starttls',
  message: MailMessage,
): Promise<void> {
  let socket = connect(
    { hostname: creds.host, port },
    { secureTransport: mode === 'tls' ? 'on' : 'starttls', allowHalfOpen: false },
  );
  await socket.opened;

  let writer = socket.writable.getWriter();
  let reader = socket.readable.getReader();
  const state = { buffer: '' };
  const expect = async (codes: number[], step: string) => {
    const code = await readReply(reader, state);
    if (!codes.includes(code)) throw new Error(`SMTP ${step} failed: ${code}`);
  };

  try {
    await expect([220], 'greeting');
    await writeLine(writer, `EHLO ${creds.host}`);
    await expect([250], 'EHLO');

    if (mode === 'starttls') {
      await writeLine(writer, 'STARTTLS');
      await expect([220], 'STARTTLS');
      // Upgrade the connection to TLS, then re-handshake at the SMTP layer.
      writer.releaseLock();
      reader.releaseLock();
      socket = socket.startTls();
      writer = socket.writable.getWriter();
      reader = socket.readable.getReader();
      state.buffer = '';
      await writeLine(writer, `EHLO ${creds.host}`);
      await expect([250], 'EHLO (TLS)');
    }

    await writeLine(writer, 'AUTH LOGIN');
    await expect([334], 'AUTH');
    await writeLine(writer, btoa(creds.username));
    await expect([334], 'username');
    await writeLine(writer, btoa(creds.password));
    await expect([235], 'password');

    await writeLine(writer, `MAIL FROM:<${creds.from}>`);
    await expect([250], 'MAIL FROM');
    await writeLine(writer, `RCPT TO:<${message.to}>`);
    await expect([250, 251], 'RCPT TO');
    await writeLine(writer, 'DATA');
    await expect([354], 'DATA');
    await writer.write(encoder.encode(buildMessage(creds.from, message)));
    await expect([250], 'message body');

    await writeLine(writer, 'QUIT');
  } finally {
    try { await socket.close(); } catch { /* ignore */ }
  }
}

/// Send an email via SMTP. Tries the configured port first, then the other
/// submission port/mode. Returns true on success; never throws.
export async function sendMail(env: Env, message: MailMessage): Promise<boolean> {
  const host = env.SMTP_HOST;
  const username = env.SMTP_USERNAME;
  const password = env.SMTP_PASSWORD;
  const from = env.SMTP_FROM || 'noreply@inknironapps.com';
  if (!host || !username || !password) return false;

  const creds: SmtpCreds = { host, username, password, from };
  const configuredPort = parseInt(env.SMTP_PORT || '465', 10);

  // Order attempts so the configured port is tried first.
  const attempts: Array<{ port: number; mode: 'tls' | 'starttls' }> =
    configuredPort === 587
      ? [{ port: 587, mode: 'starttls' }, { port: 465, mode: 'tls' }]
      : [{ port: 465, mode: 'tls' }, { port: 587, mode: 'starttls' }];

  for (const attempt of attempts) {
    try {
      await attemptSend(creds, attempt.port, attempt.mode, message);
      return true;
    } catch (error) {
      console.error(`SMTP send failed on port ${attempt.port} (${attempt.mode}):`, String(error));
    }
  }
  return false;
}
