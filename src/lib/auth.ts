import { useEffect, useState, useCallback } from "react";
import type { Role } from "./erp-types";
import { localDb, hashPassword, randomSalt, newId, logAudit, setCurrentScope, type LocalUser } from "./local-db";

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
};

let state: AuthState = {
  user: null,
  role: null,
  fullName: null,
  loading: true,
  needsBootstrap: false,
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
    let users = await localDb.users.list();
    if (users.length === 0) {
      // Seed the built-in admin demo account so the system has an approver
      // out of the box. New self-signups start EMPTY (no seed data) and
      // pending admin approval — see signUp().
      await seedAdminAccount();
      users = await localDb.users.list();
    }
    const current = readSession();
    if (current) setCurrentScope(current.id);
    else setCurrentScope(null);
    state = {
      user: current,
      role: current?.role ?? null,
      fullName: current?.fullName ?? null,
      loading: false,
      needsBootstrap: users.length === 0,
    };
  } catch (err) {
    // Never leave the UI stuck with loading:true (e.g. disabled login
    // button) just because seeding/reading local storage failed once.
    console.error("auth init failed", err);
    state = { ...state, loading: false };
  }
  emit();
}

async function seedAdminAccount() {
  // Only the admin account itself is auto-created so a real person can
  // approve pending signups on first launch. No demo suppliers/items/purchase
  // orders are seeded — the account starts completely empty.
  const salt = await randomSalt();
  const passwordHash = await hashPassword("Admin@2026!", salt);
  const admin: LocalUser = {
    id: newId(),
    username: "admin@demo.local",
    fullName: "مدير النظام",
    role: "admin",
    active: true,
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  };
  await localDb.users.upsert(admin);
}

export async function signIn(username: string, password: string): Promise<void> {
  const users = await localDb.users.list();
  const u = users.find(
    (x) => x.username.toLowerCase() === username.toLowerCase() && x.active !== false,
  );
  if (!u) throw new Error("المستخدم غير موجود أو معطّل");
  if (u.pending) throw new Error("حسابك قيد المراجعة من قبل المدير");
  const hash = await hashPassword(password, u.salt);
  if (hash !== u.passwordHash) throw new Error("كلمة المرور غير صحيحة");
  const sess: SessionUser = { id: u.id, username: u.username, fullName: u.fullName, role: u.role };
  writeSession(sess);
  setCurrentScope(u.id);
  state = {
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
  if (users.some((u) => u.username.toLowerCase() === opts.username.toLowerCase())) {
    throw new Error("اسم المستخدم موجود بالفعل");
  }
  const salt = await randomSalt();
  const passwordHash = await hashPassword(opts.password, salt);
  const isFirstUser = users.length === 0;
  // First user becomes admin automatically
  const role: Role = isFirstUser ? "admin" : opts.role ?? "user";
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
  state = { user: null, role: null, fullName: null, loading: false, needsBootstrap: state.needsBootstrap };
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
