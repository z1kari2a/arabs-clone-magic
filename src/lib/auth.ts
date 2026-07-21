import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User as AuthUser } from "@supabase/supabase-js";
import type { Role } from "./erp-types";

type AuthState = {
  session: Session | null;
  user: AuthUser | null;
  role: Role | null;
  fullName: string | null;
  loading: boolean;
};

let state: AuthState = { session: null, user: null, role: null, fullName: null, loading: true };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function loadProfile(userId: string) {
  const [{ data: role }, { data: prof }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  state = { ...state, role: (role?.role as Role) ?? "viewer", fullName: prof?.full_name ?? null };
  emit();
}

let initialized = false;
function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  supabase.auth.onAuthStateChange((_ev, session) => {
    state = { ...state, session, user: session?.user ?? null, loading: false };
    emit();
    if (session?.user) loadProfile(session.user.id);
    else state = { ...state, role: null, fullName: null };
  });
  supabase.auth.getSession().then(({ data }) => {
    state = { ...state, session: data.session, user: data.session?.user ?? null, loading: false };
    emit();
    if (data.session?.user) loadProfile(data.session.user.id);
  });
}

export function useAuth() {
  const [, setTick] = useState(0);
  useEffect(() => {
    init();
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  const signOut = useCallback(() => supabase.auth.signOut(), []);
  return { ...state, signOut };
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
