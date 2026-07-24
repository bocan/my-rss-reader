import { hash, verify } from '@node-rs/argon2';

// OWASP-aligned argon2id parameters. Tune memoryCost to your host.
const OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

export function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  return verify(digest, plaintext, OPTIONS);
}
