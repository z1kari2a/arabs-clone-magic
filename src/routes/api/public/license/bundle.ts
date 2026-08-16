// Delivers the current encrypted+signed app bundle to an authenticated shell.
import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/license/bundle")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sessionToken = url.searchParams.get("session_token") ?? "";
        const fingerprint = url.searchParams.get("fingerprint") ?? "";
        if (sessionToken.length < 8 || fingerprint.length < 8) {
          return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), {
            status: 400,
            headers: cors,
          });
        }

        const [{ supabaseAdmin }, crypto] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/license-crypto.server"),
        ]);

        const tokenHash = crypto.sha256Hex(sessionToken);
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

        const { data: bundle } = await supabaseAdmin
          .from("app_bundles")
          .select("version, encrypted_blob, signature")
          .eq("is_current", true)
          .maybeSingle();
        if (!bundle) {
          return new Response(JSON.stringify({ ok: false, error: "no_bundle_available" }), {
            status: 503,
            headers: cors,
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            version: bundle.version,
            payload_b64: bundle.encrypted_blob,
            signature_b64: bundle.signature,
          }),
          { status: 200, headers: cors },
        );
      },
    },
  },
});
