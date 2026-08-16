// Admin-only server functions to manage licenses & bundles.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("forbidden");
}

export const listLicenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: licenses }, { data: activations }] = await Promise.all([
      supabaseAdmin
        .from("licenses")
        .select(
          "id, code, license_type, expires_at, max_devices, active, notes, customer_name, created_at",
        )
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("activations")
        .select(
          "id, license_id, machine_fingerprint, device_name, last_seen_at, revoked, activated_at",
        )
        .order("activated_at", { ascending: false }),
    ]);
    return { licenses: licenses ?? [], activations: activations ?? [] };
  });

const createLicenseInput = z.object({
  license_type: z.enum(["permanent", "monthly"]),
  max_devices: z.number().int().min(1).max(50),
  months: z.number().int().min(1).max(120).optional(),
  customer_name: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export const createLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createLicenseInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newLicenseCode } = await import("@/lib/license-crypto.server");
    const code = newLicenseCode();
    let expires_at: string | null = null;
    if (data.license_type === "monthly") {
      const months = data.months ?? 1;
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      expires_at = d.toISOString();
    }
    const { data: row, error } = await supabaseAdmin
      .from("licenses")
      .insert({
        code,
        license_type: data.license_type,
        max_devices: data.max_devices,
        expires_at,
        customer_name: data.customer_name ?? null,
        notes: data.notes ?? null,
        active: true,
      })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const toggleLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("licenses")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const extendLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), months: z.number().int().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lic } = await supabaseAdmin
      .from("licenses")
      .select("expires_at")
      .eq("id", data.id)
      .maybeSingle();
    const base = lic?.expires_at ? new Date(lic.expires_at) : new Date();
    if (base.getTime() < Date.now()) base.setTime(Date.now());
    base.setMonth(base.getMonth() + data.months);
    const { error } = await supabaseAdmin
      .from("licenses")
      .update({ expires_at: base.toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { expires_at: base.toISOString() };
  });

export const revokeActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("activations")
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBundles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_bundles")
      .select("id, version, is_current, size_bytes, notes, created_at")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

const uploadBundleInput = z.object({
  version: z.string().min(1).max(50),
  plaintext_b64: z.string().min(10),
  notes: z.string().max(500).optional(),
  make_current: z.boolean().default(true),
});

export const uploadBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => uploadBundleInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptBundle, signBundle } = await import("@/lib/license-crypto.server");
    const plaintext = Buffer.from(data.plaintext_b64, "base64");
    const encrypted = encryptBundle(plaintext);
    const signature = signBundle(encrypted);

    if (data.make_current) {
      await supabaseAdmin.from("app_bundles").update({ is_current: false }).eq("is_current", true);
    }
    const { data: row, error } = await supabaseAdmin
      .from("app_bundles")
      .insert({
        version: data.version,
        encrypted_blob: encrypted,
        signature,
        size_bytes: plaintext.length,
        is_current: data.make_current,
        notes: data.notes ?? null,
      })
      .select("id, version, is_current, size_bytes, created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const setCurrentBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_bundles").update({ is_current: false }).eq("is_current", true);
    const { error } = await supabaseAdmin
      .from("app_bundles")
      .update({ is_current: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
