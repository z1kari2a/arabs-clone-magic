// Periodic heartbeat from the running shell. Verifies session token and
// returns current bundle version so the shell can prompt for an update.
//
// Request:  { session_token, fingerprint }
// Response: { ok: true, bundle_version, expires_at } or { ok: false, error }
import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/license/heartbeat")({
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
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
            status: 400,
            headers: cors,
          });
        }

        const { session_token, fingerprint } = (body ?? {}) as Record<string, unknown>;
        if (typeof session_token !== "string" || typeof fingerprint !== "string") {
          return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), {
            status: 400,
            headers: cors,
          });
        }

        const [{ supabaseAdmin }, crypto] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/license-crypto.server"),
        ]);
        const tokenHash = crypto.sha256Hex(session_token);

        const { data: act } = await supabaseAdmin
          .from("activations")
          .select("id, revoked, license_id, machine_fingerprint")
          .eq("session_token_hash", tokenHash)
          .maybeSingle();

        if (!act || act.revoked || act.machine_fingerprint !== fingerprint) {
          return new Response(JSON.stringify({ ok: false, error: "invalid_session" }), {
            status: 403,
            headers: cors,
          });
        }

        const { data: license } = await supabaseAdmin
          .from("licenses")
          .select("expires_at, active")
          .eq("id", act.license_id)
          .maybeSingle();

        if (!license || !license.active) {
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

        const now = new Date().toISOString();
        await supabaseAdmin.from("activations").update({ last_seen_at: now }).eq("id", act.id);
        await supabaseAdmin.from("heartbeats").insert({
          activation_id: act.id,
          user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
        });

        const { data: bundle } = await supabaseAdmin
          .from("app_bundles")
          .select("version")
          .eq("is_current", true)
          .maybeSingle();

        return new Response(
          JSON.stringify({
            ok: true,
            bundle_version: bundle?.version ?? null,
            expires_at: license.expires_at,
          }),
          { status: 200, headers: cors },
        );
      },
    },
  },
});
