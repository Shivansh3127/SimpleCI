/**
 * secretsService.ts — Level 5.4
 *
 * AES-256-GCM encryption/decryption for per-repo secrets.
 * The key is derived from SECRETS_ENCRYPTION_KEY in .env (32-byte hex string).
 * Each secret has its own random IV — same value encrypted twice gives different ciphertext.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.SECRETS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

export interface EncryptedSecret {
  encryptedVal: string; // base64 ciphertext
  iv:           string; // base64 12-byte IV
  tag:          string; // base64 16-byte auth tag
}

/** Encrypt a plaintext secret value. */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getKey();
  const iv  = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encryptedVal: encrypted.toString('base64'),
    iv:           iv.toString('base64'),
    tag:          tag.toString('base64'),
  };
}

/** Decrypt a previously-encrypted secret. Throws if tampered. */
export function decryptSecret(enc: EncryptedSecret): string {
  const key     = getKey();
  const iv      = Buffer.from(enc.iv, 'base64');
  const tag     = Buffer.from(enc.tag, 'base64');
  const data    = Buffer.from(enc.encryptedVal, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}
