// Spam prevention: hidden honeypot field + optional Cloudflare Turnstile CAPTCHA.

export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  return !!body.website2;
}

export async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  if (!secret) return true;

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });

  const result = await res.json<{ success: boolean }>();
  return result.success;
}
