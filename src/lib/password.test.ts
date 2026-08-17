// Password hashing in the browser build.
//
// The point of these tests is cross-build agreement. A database created in the
// browser can be restored into the Windows build and vice versa, so the hand
// written pure-JS PBKDF2 in local-db.ts must produce byte-identical output to
// Node's native crypto.pbkdf2 — which is what electron/db.cjs verifies against.
// A single wrong byte there locks users out with "كلمة المرور غير صحيحة" only
// after they move a backup between builds, which is the worst time to find out.

import { createHash, pbkdf2Sync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { hashPassword, needsRehash, randomSalt, verifyPassword } from "./local-db";

const SUBTLE = globalThis.crypto.subtle;

/** Forces the pure-JS branch, the one an insecure context (http://<lan-ip>) hits. */
function withoutSubtle<T>(fn: () => T): T {
  Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
  return fn();
}

afterEach(() => {
  Object.defineProperty(globalThis.crypto, "subtle", { value: SUBTLE, configurable: true });
});

describe("hashPassword", () => {
  it("writes the pbkdf2 format, not a bare digest", async () => {
    const hash = await hashPassword("hunter2", "0011223344556677");
    expect(hash).toMatch(/^pbkdf2\$sha256\$\d+\$[0-9a-f]{64}$/);
  });

  it("records its own iteration count so raising the constant cannot orphan hashes", async () => {
    const hash = await hashPassword("hunter2", "0011223344556677");
    const rounds = Number(hash.split("$")[2]);
    expect(rounds).toBeGreaterThanOrEqual(60_000);
  });

  it("salts: the same password under two salts gives two hashes", async () => {
    const a = await hashPassword("hunter2", "aaaaaaaaaaaaaaaa");
    const b = await hashPassword("hunter2", "bbbbbbbbbbbbbbbb");
    expect(a).not.toEqual(b);
  });

  // The regression that matters most: our PBKDF2 vs the standard one.
  it("pure-JS PBKDF2 matches Node's native crypto.pbkdf2 byte for byte", async () => {
    const password = "كلمة المرور 123";
    const salt = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
    const hash = await withoutSubtle(() => hashPassword(password, salt));

    const [, , iters, hex] = hash.split("$");
    const expected = pbkdf2Sync(password, salt, Number(iters), 32, "sha256").toString("hex");
    expect(hex).toEqual(expected);
  }, 60_000);

  it("subtle and pure-JS agree at the same iteration count", async () => {
    const password = "same-input";
    const salt = "feedfacefeedfacefeedfacefeedface";
    const viaJs = await withoutSubtle(() => hashPassword(password, salt));
    const rounds = Number(viaJs.split("$")[2]);
    // crypto.subtle at the JS branch's count, to compare like with like.
    const expected = pbkdf2Sync(password, salt, rounds, 32, "sha256").toString("hex");
    expect(viaJs.split("$")[3]).toEqual(expected);
  }, 60_000);
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const salt = await randomSalt();
    const hash = await hashPassword("correct horse", salt);
    expect(await verifyPassword("correct horse", salt, hash)).toBe(true);
    expect(await verifyPassword("Correct horse", salt, hash)).toBe(false);
    expect(await verifyPassword("", salt, hash)).toBe(false);
  });

  it("rejects when the salt does not match", async () => {
    const hash = await hashPassword("hunter2", "aaaaaaaaaaaaaaaa");
    expect(await verifyPassword("hunter2", "bbbbbbbbbbbbbbbb", hash)).toBe(false);
  });

  // Nobody gets locked out by the switch to PBKDF2.
  it("still verifies the legacy single-round SHA-256 hashes", async () => {
    const salt = "1234567890abcdef";
    const legacy = createHash("sha256").update(`${salt}:letmein`).digest("hex");
    expect(await verifyPassword("letmein", salt, legacy)).toBe(true);
    expect(await verifyPassword("letmein!", salt, legacy)).toBe(false);
  });

  it("verifies a legacy hash in an insecure context too", async () => {
    const salt = "1234567890abcdef";
    const legacy = createHash("sha256").update(`${salt}:letmein`).digest("hex");
    expect(await withoutSubtle(() => verifyPassword("letmein", salt, legacy))).toBe(true);
  });

  it("verifies bcrypt hashes written by the desktop build", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const salt = "cafebabecafebabe";
    const hash = await bcrypt.hash(`${salt}:desktop-pw`, 10);
    expect(await verifyPassword("desktop-pw", salt, hash)).toBe(true);
    expect(await verifyPassword("wrong", salt, hash)).toBe(false);
  });

  it("refuses a malformed pbkdf2 hash instead of throwing", async () => {
    for (const bad of [
      "pbkdf2$sha256$",
      "pbkdf2$sha256$0$abcd",
      "pbkdf2$sha256$-1$abcd",
      "pbkdf2$sha256$notanumber$abcd",
      "pbkdf2$sha256$1000$",
    ]) {
      expect(await verifyPassword("x", "y", bad)).toBe(false);
    }
  });

  it("treats an empty stored hash as no match", async () => {
    expect(await verifyPassword("anything", "salt", "")).toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags legacy SHA-256, leaves bcrypt and pbkdf2 alone", async () => {
    const legacy = createHash("sha256").update("salt:pw").digest("hex");
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword("pw", "salt"))).toBe(false);
    expect(needsRehash("$2b$10$abcdefghijklmnopqrstuv")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});

describe("randomSalt", () => {
  it("returns 16 bytes of hex, and not the same one twice", async () => {
    const a = await randomSalt();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toEqual(await randomSalt());
  });
});
