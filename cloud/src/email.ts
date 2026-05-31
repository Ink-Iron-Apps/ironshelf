/**
 * Email sending via the Resend HTTP API. Cloudflare Workers block outbound SMTP
 * (ports 25/465/587), so transactional mail must go over HTTP.
 *
 * Configured via secrets: RESEND_API_KEY (required) and MAIL_FROM (optional,
 * defaults to "Ironshelf <noreply@inknironapps.com>"). When RESEND_API_KEY is
 * unset, sendMail() returns false and no mail is sent.
 */

import type { Env } from './types';

interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

/// Send an email via Resend. Returns true on success; never throws.
export async function sendMail(env: Env, message: MailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.error('sendMail: RESEND_API_KEY is not set');
    return false;
  }
  const from = env.MAIL_FROM || 'Ironshelf <noreply@inknironapps.com>';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        reply_to: 'support@inknironapps.com',
        to: [message.to],
        subject: message.subject,
        html: message.html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`Resend send failed: ${response.status} ${detail}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Resend send error:', String(error));
    return false;
  }
}
