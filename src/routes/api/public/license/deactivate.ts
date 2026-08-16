import { createFileRoute } from "@tanstack/react-router";

const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const Route = createFileRoute("/api/public/license/deactivate")({
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
          .select("id, machine_fingerprint")
          .eq("session_token_hash", tokenHash)
          .maybeSingle();
        if (!act || act.machine_fingerprint !== fingerprint) {
          return new Response(JSON.stringify({ ok: false, error: "invalid_session" }), {
            status: 403,
            headers: cors,
          });
        }
        await supabaseAdmin
          .from("activations")
          .update({ revoked: true, revoked_at: new Date().toISOString() })
          .eq("id", act.id);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      },
    },
  },
});
