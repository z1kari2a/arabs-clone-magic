
-- =========================================================
-- ERP local-data cloud backups — one JSON snapshot per activation.
-- Independent of the business tables (suppliers/items/purchase_orders/...)
-- defined earlier: those are unscoped/global with UNIQUE(code)/UNIQUE(number)
-- constraints, so writing snapshots from multiple licensed customers into
-- them directly would collide. Backups here are namespaced per activation
-- (one row per licensed device) instead.
-- =========================================================

CREATE TABLE public.erp_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id UUID NOT NULL REFERENCES public.activations(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_erp_backups_activation ON public.erp_backups(activation_id, created_at DESC);

GRANT ALL ON public.erp_backups TO service_role;
ALTER TABLE public.erp_backups ENABLE ROW LEVEL SECURITY;

-- No policies for `authenticated`/`anon` — reads and writes only happen
-- through the trusted server routes (api/public/license/backup) using the
-- service_role client, after they've independently verified the caller's
-- session_token + machine fingerprint against `activations`. This mirrors
-- how app_bundles/licenses/heartbeats are locked down to admins-or-service-role.
