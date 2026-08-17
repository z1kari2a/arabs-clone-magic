import { useEffect, useState, useCallback } from "react";
import type { Role } from "./erp-types";
import {
  localDb,
  hashPassword,
  verifyPassword,
  needsRehash,
  randomSalt,
  newId,
  logAudit,
  setCurrentScope,
  type LocalUser,
} from "./local-db";

// -------- Local authentication (no cloud) --------
// Session lives in sessionStorage so it survives reloads but not tab close.
const SESSION_KEY = "erp:current-user";

type SessionUser = { id: string; username: string; fullName: string; role: Role };

type AuthState = {
  user: SessionUser | null;
  role: Role | null;
  fullName: string | null;
  loading: boolean;
  needsBootstrap: boolean; // true when no users exist → force create admin
  allowSignup: boolean; // admin-controlled: is the "إنشاء حساب" tab open?
};

let state: AuthState = {
  user: null,
  role: null,
  fullName: null,
  loading: true,
  needsBootstrap: false,
  allowSignup: true,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}
function writeSession(u: SessionUser | null) {
  if (typeof window === "undefined") return;
  if (u) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(u));
  else window.sessionStorage.removeItem(SESSION_KEY);
}

let initialized = false;
async function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    // No account is created for the user. A seeded built-in admin used to be
    // written here, which made `needsBootstrap` false on a freshly installed
    // copy: the login screen then asked for credentials nobody had been given,
    // and anyone who registered instead landed in "قيد المراجعة" with no admin
    // to approve them. First launch must ask for the admin account itself.
    const users = await localDb.users.list();
    const current = readSession();
    if (current) setCurrentScope(current.id);
    else setCurrentScope(null);
    const config = await localDb.systemConfig.get();
    state = {
      user: current,
      role: current?.role ?? null,
      fullName: current?.fullName ?? null,
      loading: false,
      needsBootstrap: users.length === 0,
      allowSignup: config?.allowSignup ?? true,
    };
  } catch (err) {
    // Never leave the UI stuck with loading:true (e.g. disabled login
    // button) just because seeding/reading local storage failed once.
    console.error("auth init failed", err);
    state = { ...state, loading: false };
  }
  emit();
}

export async function signIn(username: string, password: string): Promise<void> {
  const users = await localDb.users.list();
  const u = users.find((x) => x.username.toLowerCase() === username.trim().toLowerCase());
  if (!u) throw new Error("المستخدم غير موجود");
  if (u.active === false) throw new Error("هذا الحساب معطّل — تواصل مع المدير");
  if (u.pending) throw new Error("حسابك قيد المراجعة من قبل المدير");
  if (!(await verifyPassword(password, u.salt, u.passwordHash)))
    throw new Error("كلمة المرور غير صحيحة");

  // Accounts made by older browser builds hold a single-round SHA-256 hash.
  // Login is the only moment the plaintext is available to re-hash it, so take
  // it — otherwise those hashes stay weak until the user happens to change the
  // password, which most never do. A failure here must not block a valid login,
  // so it is logged and swallowed: the account simply stays on the old format.
  if (needsRehash(u.passwordHash)) {
    try {
      const salt = await randomSalt();
      await localDb.users.upsert({ ...u, salt, passwordHash: await hashPassword(password, salt) });
    } catch (err) {
      console.error("password rehash failed", err);
    }
  }

  const sess: SessionUser = { id: u.id, username: u.username, fullName: u.fullName, role: u.role };
  writeSession(sess);
  setCurrentScope(u.id);
  state = {
    ...state,
    user: sess,
    role: sess.role,
    fullName: sess.fullName,
    loading: false,
    needsBootstrap: false,
  };
  emit();
}

export async function signUp(opts: {
  username: string;
  password: string;
  fullName?: string;
  role?: Role;
  /** Set true when called from the admin "add user" screen — the
   *  new user is created active and NOT pending. */
  createdByAdmin?: boolean;
}): Promise<LocalUser> {
  if (opts.password.length < 6) throw new Error("كلمة المرور يجب 6 أحرف على الأقل");
  const users = await localDb.users.list();
  const isFirstUser = users.length === 0;
  // Self-signup can be closed by an admin from /users. Bootstrap (the very
  // first admin account) and admin-created users always go through.
  if (!isFirstUser && !opts.createdByAdmin && !state.allowSignup) {
    throw new Error("إنشاء الحسابات مغلق حالياً — تواصل مع المدير");
  }
  if (users.some((u) => u.username.toLowerCase() === opts.username.toLowerCase())) {
    throw new Error("اسم المستخدم موجود بالفعل");
  }
  const salt = await randomSalt();
  const passwordHash = await hashPassword(opts.password, salt);
  // First user becomes admin automatically
  const role: Role = isFirstUser ? "admin" : (opts.role ?? "user");
  // Self-signups start pending until an admin approves. First user and
  // admin-created users are approved immediately.
  const pending = !isFirstUser && !opts.createdByAdmin;
  const user: LocalUser = {
    id: newId(),
    username: opts.username,
    fullName: opts.fullName || opts.username,
    role,
    active: true,
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
    pending,
  };
  await localDb.users.upsert(user);
  await logAudit({
    user_email: state.user?.username ?? user.username,
    action: "INSERT",
    table_name: "users",
    record_id: user.id,
    before_data: null,
    after_data: { username: user.username, role: user.role, pending },
  });
  state = { ...state, needsBootstrap: false };
  emit();
  return user;
}

export async function signOut(): Promise<void> {
  writeSession(null);
  setCurrentScope(null);
  state = {
    user: null,
    role: null,
    fullName: null,
    loading: false,
    needsBootstrap: state.needsBootstrap,
    allowSignup: state.allowSignup,
  };
  emit();
}

/** Admin approves a pending signup so the user can log in. */
export async function approveUser(userId: string): Promise<void> {
  const users = await localDb.users.list();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("المستخدم غير موجود");
  if (!u.pending) return;
  await localDb.users.upsert({ ...u, pending: false });
  await logAudit({
    user_email: state.user?.username ?? null,
    action: "UPDATE",
    table_name: "users",
    record_id: userId,
    before_data: { pending: true },
    after_data: { pending: false },
  });
  emit();
}

/** Admin toggles whether the login page's "إنشاء حساب" tab accepts new signups. */
export async function setAllowSignup(allow: boolean): Promise<void> {
  if (state.role !== "admin") throw new Error("يتطلب صلاحية مدير");
  await localDb.systemConfig.set({ allowSignup: allow });
  await logAudit({
    user_email: state.user?.username ?? null,
    action: "UPDATE",
    table_name: "system_config",
    record_id: null,
    before_data: { allowSignup: !allow },
    after_data: { allowSignup: allow },
  });
  state = { ...state, allowSignup: allow };
  emit();
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 6) throw new Error("كلمة المرور يجب 6 أحرف على الأقل");
  const users = await localDb.users.list();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("المستخدم غير موجود");
  const salt = await randomSalt();
  u.salt = salt;
  u.passwordHash = await hashPassword(newPassword, salt);
  await localDb.users.upsert(u);
}

export async function refreshAuth(): Promise<void> {
  initialized = false;
  await init();
}

export function useAuth() {
  const [, setTick] = useState(0);
  useEffect(() => {
    void init();
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  const signOutCb = useCallback(() => signOut(), []);
  return { ...state, session: state.user, signOut: signOutCb };
}

export function canWrite(role: Role | null): boolean {
  return role === "admin" || role === "user";
}
export function canDelete(role: Role | null): boolean {
  return role === "admin";
}
export function canApprove(role: Role | null): boolean {
  return role === "admin";
}
