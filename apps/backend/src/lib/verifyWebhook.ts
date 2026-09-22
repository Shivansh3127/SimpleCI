import crypto from 'crypto';
import { Request } from 'express';

/**
 * Verifies that a GitHub webhook request is authentic.
 *
 * How it works:
 * - GitHub signs the raw request body using HMAC-SHA256 with your shared secret
 * - It puts the result in the `X-Hub-Signature-256` header
 * - We recompute the same signature on our end and compare
 * - If they match → the request truly came from GitHub
 * - If they don't → reject it (could be someone faking a webhook)
 *
 * Why timingSafeEqual?
 * - Regular string comparison (===) is vulnerable to timing attacks
 * - An attacker can guess your secret character-by-character by measuring
 *   how long the comparison takes. timingSafeEqual always takes the same time.
 */
export function verifyGithubWebhook(req: Request, secret: string): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;

  if (!signature) return false;

  // Recompute the expected signature using our secret
  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(req.body as Buffer) // req.body must be the raw buffer here
      .digest('hex');

  // Safe comparison — prevents timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // Buffers of different lengths throw — means signatures differ
    return false;
  }
}
