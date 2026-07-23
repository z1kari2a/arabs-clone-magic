// Server-only crypto helpers for the license system.
// AES-256-GCM for bundle encryption, RSA-4096 for bundle signatures,
// SHA-256 for token/fingerprint hashing.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createSign,
  createVerify,
  randomBytes,
  scryptSync,
} from "node:crypto";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Deterministic sha256 hex — used for fingerprints and session-token hashes. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Generate a fresh session token (opaque random string). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Generate a human-friendly license code: XXXX-XXXX-XXXX-XXXX (Crockford base32). */
export function newLicenseCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += "-";
  }
  return out;
}

// ---------- Bundle encryption (AES-256-GCM) ----------
// Payload layout (base64): iv(12) | tag(16) | ciphertext

function masterKey(): Buffer {
  const raw = requireEnv("LICENSE_AES_MASTER_KEY");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("LICENSE_AES_MASTER_KEY must be 32 bytes (base64)");
  return key;
}

export function encryptBundle(plaintext: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptBundle(payloadB64: string): Buffer {
  const buf = Buffer.from(payloadB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Derive a per-session AES key from the plain session token (returned to
 *  the shell so it can decrypt the delivered bundle). */
export function deriveSessionKey(sessionToken: string): Buffer {
  return scryptSync(sessionToken, "erp-license-v1", 32);
}

/** Wrap the master bundle key with the session key so the shell can unwrap
 *  it after activation. Payload: iv(12)|tag(16)|ct. */
export function wrapKeyForSession(sessionToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSessionKey(sessionToken), iv);
  const ct = Buffer.concat([cipher.update(masterKey()), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

// ---------- RSA signature (bundle integrity) ----------

export function signBundle(payloadB64: string): string {
  const priv = requireEnv("LICENSE_RSA_PRIVATE_KEY");
  const s = createSign("RSA-SHA256");
  s.update(payloadB64);
  return s.sign(priv).toString("base64");
}

export function verifyBundle(payloadB64: string, signatureB64: string): boolean {
  const pub = requireEnv("LICENSE_RSA_PUBLIC_KEY");
  const v = createVerify("RSA-SHA256");
  v.update(payloadB64);
  return v.verify(pub, Buffer.from(signatureB64, "base64"));
}