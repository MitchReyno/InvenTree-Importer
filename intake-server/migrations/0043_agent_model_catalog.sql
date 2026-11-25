-- Each provider's model list for one sign-in mode, as the session worker last read it. Display data
-- only: nothing here changes a saved setting or decides what a session may run. A failed read
-- updates only the attempt fields, so the last good list and its read time stay.
CREATE TABLE agent_model_catalog (
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('codex','claude')),
  authentication text NOT NULL CHECK (authentication IN ('api_key','subscription')),
  -- Normalised entries, checked by the worker against the contract before they are written.
  models jsonb CHECK (models IS NULL OR (jsonb_typeof(models)='array' AND octet_length(models::text)<=65536)),
  cli_version text CHECK (cli_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  source text CHECK (source IN ('cli','api')),
  read_in text CHECK (read_in IN ('vm','host')),
  -- Where the last finished attempt ran, and where the read now running runs; after a profile
  -- change either may be another route's than the list's.
  attempt_in text CHECK (attempt_in IN ('vm','host')),
  reading_in text CHECK (reading_in IN ('vm','host')),
  read_at timestamptz(3),
  attempted_at timestamptz(3),
  failure text CHECK (failure IN ('timeout','guest_outdated','vm_unreachable','signed_out','malformed','unavailable')),
  -- Set by a refresh request; the worker clears it only when no newer request came during its read.
  refresh_requested_at timestamptz(3),
  refresh_seq bigint NOT NULL DEFAULT 0 CHECK (refresh_seq>=0),
  -- Set while the worker reads, so the API can say a read is running.
  reading_since timestamptz(3),
  -- The sign-in the stored list was read under, and the newest one the worker has seen. Opaque,
  -- non-secret identifiers: a guest store revision or counter, or an HMAC of an API key.
  sign_in_generation text CHECK (length(sign_in_generation) BETWEEN 1 AND 128),
  latest_generation text CHECK (length(latest_generation) BETWEEN 1 AND 128),
  -- The list is from an earlier sign-in; only a list published under the current one clears it.
  stale_sign_in boolean NOT NULL DEFAULT false,
  -- Advanced by each invalidation, so a read that started before one can't publish.
  invalidation_seq bigint NOT NULL DEFAULT 0 CHECK (invalidation_seq>=0),
  -- Advanced whenever the worker observes a different sign-in, so neither can a read that
  -- started before that observation.
  generation_seq bigint NOT NULL DEFAULT 0 CHECK (generation_seq>=0),
  PRIMARY KEY (actor_id,target_id,target_context_id,provider,authentication),
  CHECK ((models IS NULL) = (read_at IS NULL)),
  CHECK ((models IS NULL) = (source IS NULL))
);

-- The only change the API may make: request a read and, once a sign-in change is confirmed, mark
-- the list stale in the same statement. Both wake the worker, which also checks every pass.
CREATE FUNCTION request_model_catalog_refresh(
  p_actor_id uuid, p_target_id uuid, p_target_context_id uuid,
  p_provider text, p_authentication text, p_invalidate boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stale boolean;
BEGIN
  INSERT INTO public.agent_model_catalog AS c
    (actor_id,target_id,target_context_id,provider,authentication,refresh_requested_at,refresh_seq,stale_sign_in,invalidation_seq)
  VALUES (p_actor_id,p_target_id,p_target_context_id,p_provider,p_authentication,now(),1,p_invalidate,
    CASE WHEN p_invalidate THEN 1 ELSE 0 END)
  ON CONFLICT (actor_id,target_id,target_context_id,provider,authentication) DO UPDATE SET
    refresh_requested_at=now(),
    refresh_seq=c.refresh_seq+1,
    stale_sign_in=c.stale_sign_in OR p_invalidate,
    invalidation_seq=c.invalidation_seq + CASE WHEN p_invalidate THEN 1 ELSE 0 END
  RETURNING c.stale_sign_in INTO stale;
  PERFORM pg_notify('bench_model_catalog', '');
  RETURN stale;
END;
$$;
REVOKE ALL ON FUNCTION request_model_catalog_refresh(uuid,uuid,uuid,text,text,boolean) FROM PUBLIC;
