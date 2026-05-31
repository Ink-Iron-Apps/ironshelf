/**
 * Minimal SMTP client for Cloudflare Workers using raw TCP sockets
 * (`cloudflare:sockets`). Sends mail through an authenticated mailbox such as
 * Hostinger over implicit TLS (port 465).
 *
 * Configured via secrets: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD,
 * SMTP_FROM. When any required field is missing, send() returns false.
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

/// Read SMTP replies until a final line (`NNN <text>`, space after the code)
/// is seen, returning its numeric status code. Multiline replies (`NNN-...`)
/// are consumed until the terminating line.
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

/// Send an email via SMTP. Returns true on success; never throws.
export async function sendMail(env: Env, message: MailMessage): Promise<boolean> {
  const host = env.SMTP_HOST;
  const port = parseInt(env.SMTP_PORT || '465', 10);
  const username = env.SMTP_USERNAME;
  const password = env.SMTP_PASSWORD;
  const from = env.SMTP_FROM || 'noreply@inknironapps.com';

  if (!host || !username || !password) {
    return false;
  }

  let socket;
  try {
    socket = connect(
      { hostname: host, port },
      { secureTransport: 'on', allowHalfOpen: false },
    );
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const state = { buffer: '' };

    const expect = async (codes: number[], step: string) => {
      const code = await readReply(reader, state);
      if (!codes.includes(code)) {
        throw new Error(`SMTP ${step} failed: ${code}`);
      }
    };

    await expect([220], 'greeting');

    await writeLine(writer, `EHLO ${host}`);
    await expect([250], 'EHLO');

    await writeLine(writer, 'AUTH LOGIN');
    await expect([334], 'AUTH');
    await writeLine(writer, btoa(username));
    await expect([334], 'username');
    await writeLine(writer, btoa(password));
    await expect([235], 'password');

    await writeLine(writer, `MAIL FROM:<${from}>`);
    await expect([250], 'MAIL FROM');
    await writeLine(writer, `RCPT TO:<${message.to}>`);
    await expect([250, 251], 'RCPT TO');

    await writeLine(writer, 'DATA');
    await expect([354], 'DATA');

    const headers = [
      `From: Ironshelf <${from}>`,
      `To: <${message.to}>`,
      `Reply-To: support@inknironapps.com`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
    ].join('\r\n');

    // Dot-stuff any line beginning with '.' so it isn't read as end-of-data.
    const body = message.html.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
    await writer.write(encoder.encode(`${headers}\r\n\r\n${body}\r\n.\r\n`));
    await expect([250], 'message body');

    await writeLine(writer, 'QUIT');
    try {
      await writer.close();
    } catch {
      // QUIT close races the server hangup — ignore.
    }
    return true;
  } catch (error) {
    console.error('SMTP send failed:', error);
    try {
      await socket?.close();
    } catch {
      // ignore
    }
    return false;
  }
}
