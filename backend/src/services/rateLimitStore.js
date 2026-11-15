import { pool } from "../config/database.js";

export async function consumeRateLimits(keys, seconds, database = pool) {
  return (
    await database.query(
      `
    WITH cleanup AS (
      DELETE FROM public.auth_rate_limits WHERE key IN (
        SELECT key FROM public.auth_rate_limits
        WHERE expires_at <= NOW() AND NOT (key = ANY($1::text[]))
        ORDER BY expires_at LIMIT 100
      )
    )
    INSERT INTO public.auth_rate_limits AS current (key,attempts,expires_at)
    SELECT key,1,NOW()+($2*INTERVAL '1 second') FROM unnest($1::text[]) AS keys(key) ORDER BY key
    ON CONFLICT (key) DO UPDATE SET
      attempts=CASE WHEN current.expires_at<=NOW() THEN 1 ELSE LEAST(current.attempts+1,1000000) END,
      expires_at=CASE WHEN current.expires_at<=NOW() THEN NOW()+($2*INTERVAL '1 second') ELSE current.expires_at END
    RETURNING key,attempts,CEIL(EXTRACT(EPOCH FROM(expires_at-NOW())))::int AS retry_after
  `,
      [keys, seconds],
    )
  ).rows;
}
