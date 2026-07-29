// Cloud backup/restore for local ERP data, scoped by license activation.
// POST stores the latest full local snapshot (suppliers/items/purchase_orders/
// users/settings) for the calling device's activation. GET returns the most
// recent snapshot for that same activation. Mirrors heartbeat.ts/bundle.ts's
// session_token + fingerprint validation against `activations`/`licenses`.
import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB — generous for JSON business data
const KEEP_PER_ACTIVATION = 20;

async function resolveActivation(sessionToken: string, fingerprint: string) {
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
    return { supabaseAdmin, error: "invalid_session" as const };
  }

  const { data: license } = await supabaseAdmin
    .from("licenses")
    .select("expires_at, active")
    .eq("id", act.license_id)
    .maybeSingle();

  if (!license || !license.active) {
    return { supabaseAdmin, error: "license_disabled" as const };
  }
  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    return { supabaseAdmin, error: "license_expired" as const };
  }

  return { supabaseAdmin, activationId: act.id as string, error: null as null };
}

export const Route = createFileRoute("/api/public/license/backup")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

        const { session_token, fingerprint, payload } = (body ?? {}) as Record<string, unknown>;
        if (typeof session_token !== "string" || typeof fingerprint !== "string" || payload == null || typeof payload !== "object") {
          return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), {
            status: 400,
            headers: cors,
          });
        }
        if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
          return new Response(JSON.stringify({ ok: false, error: "payload_too_large" }), {
            status: 413,
            headers: cors,
          });
        }

        const { supabaseAdmin, activationId, error } = await resolveActivation(session_token, fingerprint);
        if (error) {
          return new Response(JSON.stringify({ ok: false, error }), { status: 403, headers: cors });
        }

        const { data: row, error: insertError } = await supabaseAdmin
          .from("erp_backups")
          .insert({ activation_id: activationId, payload: payload as any })
          .select("created_at")
          .maybeSingle();
        if (insertError) {
          return new Response(JSON.stringify({ ok: false, error: "insert_failed" }), {
            status: 500,
            headers: cors,
          });
        }

        // Prune old snapshots — keep only the most recent KEEP_PER_ACTIVATION.
        const { data: old } = await supabaseAdmin
          .from("erp_backups")
          .select("id")
          .eq("activation_id", activationId)
          .order("created_at", { ascending: false })
          .range(KEEP_PER_ACTIVATION, KEEP_PER_ACTIVATION + 100);
        if (old && old.length > 0) {
          await supabaseAdmin
            .from("erp_backups")
            .delete()
            .in("id", old.map((r) => r.id));
        }

        return new Response(JSON.stringify({ ok: true, created_at: row?.created_at ?? null }), {
          status: 200,
          headers: cors,
        });
      },

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

        const { supabaseAdmin, activationId, error } = await resolveActivation(sessionToken, fingerprint);
        if (error) {
          return new Response(JSON.stringify({ ok: false, error }), { status: 403, headers: cors });
        }

        const { data: latest } = await supabaseAdmin
          .from("erp_backups")
          .select("payload, created_at")
          .eq("activation_id", activationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return new Response(
          JSON.stringify({ ok: true, payload: latest?.payload ?? null, created_at: latest?.created_at ?? null }),
          { status: 200, headers: cors },
        );
      },
    },
  },
});
