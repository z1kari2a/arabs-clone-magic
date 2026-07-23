
-- =========================================================
-- License / Activation / Bundle system
-- =========================================================

-- 1) LICENSES ---------------------------------------------
CREATE TABLE public.licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  license_type TEXT NOT NULL CHECK (license_type IN ('permanent', 'monthly')),
  expires_at TIMESTAMPTZ, -- null for permanent
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  customer_name TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_licenses_code ON public.licenses(code);
CREATE INDEX idx_licenses_active ON public.licenses(active) WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.licenses TO authenticated;
GRANT ALL ON public.licenses TO service_role;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Only admins can manage licenses from the admin dashboard.
CREATE POLICY "admins read licenses"
  ON public.licenses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert licenses"
  ON public.licenses FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update licenses"
  ON public.licenses FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete licenses"
  ON public.licenses FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- 2) ACTIVATIONS ------------------------------------------
CREATE TABLE public.activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  machine_fingerprint TEXT NOT NULL,
  device_name TEXT,
  session_token_hash TEXT NOT NULL, -- store only sha256 of the token
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  UNIQUE (license_id, machine_fingerprint)
);

CREATE INDEX idx_activations_license ON public.activations(license_id);
CREATE INDEX idx_activations_fingerprint ON public.activations(machine_fingerprint);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activations TO authenticated;
GRANT ALL ON public.activations TO service_role;
ALTER TABLE public.activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read activations"
  ON public.activations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update activations"
  ON public.activations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete activations"
  ON public.activations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- 3) APP BUNDLES ------------------------------------------
CREATE TABLE public.app_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  encrypted_blob TEXT NOT NULL, -- base64 AES-256-GCM ciphertext (iv|tag|ct)
  signature TEXT NOT NULL,      -- base64 RSA-4096 signature over blob
  min_shell_version TEXT NOT NULL DEFAULT '1.0.0',
  is_current BOOLEAN NOT NULL DEFAULT false,
  size_bytes INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bundles_current ON public.app_bundles(is_current) WHERE is_current = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_bundles TO authenticated;
GRANT ALL ON public.app_bundles TO service_role;
ALTER TABLE public.app_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read bundles"
  ON public.app_bundles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert bundles"
  ON public.app_bundles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update bundles"
  ON public.app_bundles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete bundles"
  ON public.app_bundles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- 4) HEARTBEATS -------------------------------------------
CREATE TABLE public.heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id UUID NOT NULL REFERENCES public.activations(id) ON DELETE CASCADE,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_heartbeats_activation ON public.heartbeats(activation_id);
CREATE INDEX idx_heartbeats_time ON public.heartbeats(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.heartbeats TO authenticated;
GRANT ALL ON public.heartbeats TO service_role;
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read heartbeats"
  ON public.heartbeats FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- 5) updated_at trigger on licenses -----------------------
CREATE TRIGGER trg_licenses_updated_at
  BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
