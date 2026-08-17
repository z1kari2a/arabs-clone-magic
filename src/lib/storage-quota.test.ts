// Browser storage running out.
//
// This is the failure that used to be invisible: localStorage is capped around
// 5 MB per origin, setItem throws QuotaExceededError, and nothing caught it —
// so the write silently did not happen while the user kept editing. These tests
// pin the two things that must stay true: the condition is reported to whoever
// subscribed, and it still throws so a caller can stop retrying.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// local-db reads `typeof window` once, at module load, to decide whether it is
// in a browser. vitest.config.ts deliberately runs in the `node` environment
// (it catches accidental `window` use in the calc core), so the stub has to be
// in place BEFORE the import below — which is what vi.hoisted is for. The
// getters let each test swap the backing store without re-importing.
const stores = vi.hoisted(() => {
  const holder: { local: unknown; session: unknown } = { local: null, session: null };
  (globalThis as { window?: unknown }).window = {
    get localStorage() {
      return holder.local;
    },
    get sessionStorage() {
      return holder.session;
    },
  };
  return holder;
});

import { StorageFullError, onStorageFull, writeWebStorage } from "./local-db";

/** A localStorage stand-in that starts throwing once it holds `cap` characters. */
function makeStore(cap = Infinity) {
  const data = new Map<string, string>();
  let used = 0;
  return {
    setItem(key: string, value: string) {
      if (used + value.length > cap) {
        const err = new Error("quota") as Error & { code?: number };
        err.name = "QuotaExceededError";
        throw err;
      }
      used += value.length;
      data.set(key, value);
    },
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    get size() {
      return data.size;
    },
  };
}

let unsubscribers: Array<() => void> = [];

function install(local: unknown, session: unknown = makeStore()) {
  stores.local = local;
  stores.session = session;
}

beforeEach(() => install(makeStore()));
afterEach(() => {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
});

function listen(fn: (e: StorageFullError) => void) {
  const off = onStorageFull(fn);
  unsubscribers.push(off);
  return off;
}

describe("writeWebStorage", () => {
  it("writes JSON on the happy path", () => {
    const store = makeStore();
    install(store);
    writeWebStorage("erp:items", [{ code: "A1" }]);
    expect(store.getItem("erp:items")).toEqual('[{"code":"A1"}]');
  });

  it("throws StorageFullError when the quota is gone", () => {
    install(makeStore(10));
    expect(() => writeWebStorage("erp:items", [{ code: "a-long-value" }])).toThrow(
      StorageFullError,
    );
  });

  it("names the key that failed, so the report is actionable", () => {
    install(makeStore(10));
    try {
      writeWebStorage("erp:purchase_orders", [{ big: "x".repeat(50) }]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StorageFullError);
      expect((err as StorageFullError).key).toBe("erp:purchase_orders");
    }
  });

  it("reports to every subscriber before throwing", () => {
    install(makeStore(5));
    const a = vi.fn();
    const b = vi.fn();
    listen(a);
    listen(b);
    expect(() => writeWebStorage("k", "a value past the cap")).toThrow(StorageFullError);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(a.mock.calls[0][0]).toBeInstanceOf(StorageFullError);
  });

  it("still throws when a listener itself blows up", () => {
    install(makeStore(5));
    const good = vi.fn();
    listen(() => {
      throw new Error("listener is broken");
    });
    listen(good);
    // The autosave path relies on this: a broken toast must not turn a failed
    // write into an apparently successful one.
    expect(() => writeWebStorage("k", "a value past the cap")).toThrow(StorageFullError);
    expect(good).toHaveBeenCalledOnce();
  });

  it("stops reporting after unsubscribe", () => {
    install(makeStore(5));
    const fn = vi.fn();
    const off = onStorageFull(fn);
    off();
    expect(() => writeWebStorage("k", "a value past the cap")).toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  // Each browser signals a full quota differently; missing one means silent
  // loss on that browser only, which is the hardest kind of bug to hear about.
  it.each([
    ["QuotaExceededError", "QuotaExceededError", undefined],
    ["Firefox", "NS_ERROR_DOM_QUOTA_REACHED", undefined],
    ["Safari (code 22)", "SomeOtherName", 22],
    ["Firefox (code 1014)", "SomeOtherName", 1014],
  ])("recognises %s as a full quota", (_label, name, code) => {
    install({
      setItem() {
        const err = new Error("nope") as Error & { code?: number };
        err.name = name;
        if (code !== undefined) err.code = code;
        throw err;
      },
      getItem: () => null,
      removeItem: () => {},
      size: 0,
    } as unknown as ReturnType<typeof makeStore>);
    const fn = vi.fn();
    listen(fn);
    expect(() => writeWebStorage("k", "v")).toThrow(StorageFullError);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("rethrows unrelated errors untouched, and does not report them as full", () => {
    install({
      setItem() {
        throw new TypeError("something else entirely");
      },
      getItem: () => null,
      removeItem: () => {},
      size: 0,
    } as unknown as ReturnType<typeof makeStore>);
    const fn = vi.fn();
    listen(fn);
    expect(() => writeWebStorage("k", "v")).toThrow(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("writes to sessionStorage when asked", () => {
    const local = makeStore();
    const session = makeStore();
    install(local, session);
    writeWebStorage("erp:scope", "u1", "session");
    expect(session.getItem("erp:scope")).toEqual('"u1"');
    expect(local.size).toBe(0);
  });
});
