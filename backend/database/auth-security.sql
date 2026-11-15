BEGIN;

-- Short-lived counters, shared across application processes and restarts.
-- Keys contain hashes rather than raw email addresses or IP addresses.
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx
    ON public.auth_rate_limits (expires_at);

COMMIT;
