// Public license activation endpoint. Called by the Electron shell on
// first launch after the user enters their license code + a device name.
//
// Request:  { code: string, fingerprint: string, device_name?: string }
// Response: { ok: true, session_token, wrapped_key, bundle_version, expires_at }
//   or      { ok: false, error: "..." }
//
// Response codes:
//   200 → activated (or re-activated on the same fingerprint)
//   400 → bad input
//   403 → license invalid/inactive/expired
//   409 → device limit reached
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/license/activate")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      POST: async ({ request }) => {
        const cors = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        };

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
            status: 400,
            headers: cors,
          });
        }

        const { code, fingerprint, device_name } = (body ?? {}) as Record<string, unknown>;
        if (
          typeof code !== "string" ||
          typeof fingerprint !== "string" ||
          code.length < 4 ||
          fingerprint.length < 8
        ) {
          return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), {
            status: 400,
            headers: cors,
          });
        }
        const cleanCode = code.trim().toUpperCase();
        const cleanFp = fingerprint.trim();
        const cleanName = typeof device_name === "string" ? device_name.slice(0, 100) : null;

        const [{ supabaseAdmin }, crypto] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/license-crypto.server"),
        ]);

        // 1) Look up the license.
        const { data: license, error: licErr } = await supabaseAdmin
          .from("licenses")
          .select("id, license_type, expires_at, max_devices, active")
          .eq("code", cleanCode)
          .maybeSingle();

        if (licErr) {
          console.error("[license/activate] licenses lookup", licErr);
          return new Response(JSON.stringify({ ok: false, error: "server_error" }), {
            status: 500,
            headers: cors,
          });
        }
        if (!license) {
          return new Response(JSON.stringify({ ok: false, error: "invalid_code" }), {
            status: 403,
            headers: cors,
          });
        }
        if (!license.active) {
          return new Response(JSON.stringify({ ok: false, error: "license_disabled" }), {
            status: 403,
            headers: cors,
          });
        }
        if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
          return new Response(JSON.stringify({ ok: false, error: "license_expired" }), {
            status: 403,
            headers: cors,
          });
        }

        // 2) Check existing activation for this fingerprint (re-activation is OK).
        const { data: existing } = await supabaseAdmin
          .from("activations")
          .select("id, revoked")
          .eq("license_id", license.id)
          .eq("machine_fingerprint", cleanFp)
          .maybeSingle();

        if (existing?.revoked) {
          return new Response(JSON.stringify({ ok: false, error: "device_revoked" }), {
            status: 403,
            headers: cors,
          });
        }

        // 3) Enforce device limit for NEW devices only.
        if (!existing) {
          const { count } = await supabaseAdmin
            .from("activations")
            .select("id", { count: "exact", head: true })
            .eq("license_id", license.id)
            .eq("revoked", false);
          if ((count ?? 0) >= license.max_devices) {
            return new Response(JSON.stringify({ ok: false, error: "device_limit_reached" }), {
              status: 409,
              headers: cors,
            });
          }
        }

        // 4) Mint session token and store hash + upsert activation.
        const sessionToken = crypto.newSessionToken();
        const tokenHash = crypto.sha256Hex(sessionToken);
        const now = new Date().toISOString();

        const activationRow = {
          license_id: license.id,
          machine_fingerprint: cleanFp,
          device_name: cleanName,
          session_token_hash: tokenHash,
          last_seen_at: now,
          revoked: false,
        };

        const { data: act, error: upErr } = await supabaseAdmin
          .from("activations")
          .upsert(activationRow, { onConflict: "license_id,machine_fingerprint" })
          .select("id")
          .maybeSingle();

        if (upErr || !act) {
          console.error("[license/activate] upsert failed", upErr);
          return new Response(JSON.stringify({ ok: false, error: "server_error" }), {
            status: 500,
            headers: cors,
          });
        }

        // 5) Record heartbeat.
        await supabaseAdmin.from("heartbeats").insert({
          activation_id: act.id,
          user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
        });

        // 6) Fetch current bundle version.
        const { data: bundle } = await supabaseAdmin
          .from("app_bundles")
          .select("version")
          .eq("is_current", true)
          .maybeSingle();

        return new Response(
          JSON.stringify({
            ok: true,
            session_token: sessionToken,
            wrapped_key: crypto.wrapKeyForSession(sessionToken),
            bundle_version: bundle?.version ?? null,
            expires_at: license.expires_at,
            license_type: license.license_type,
          }),
          { status: 200, headers: cors },
        );
      },
    },
  },
});
