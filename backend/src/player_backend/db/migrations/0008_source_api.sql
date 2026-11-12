-- ADR 0002, sections 3, 7, 9, 10 and 11: the bodies of the functions that linking a source and
-- the source token need. The other functions of 0003 that are still stubs keep failing closed
-- until their issues.
--
-- As in 0004 and 0006: CREATE OR REPLACE keeps each function's owner (player_auth) and its rights
-- (no EXECUTE for PUBLIC, EXECUTE for player_app); SECURITY DEFINER and the search_path are
-- restated; a parameter is read once, by its qualified name, into a `v_` variable. No grant, no
-- table and no new function: the guard tests read all of it back.
--
-- The numbers are ADR 0002's defaults, written here as constants (principle 7): a source link
-- code lives 60 seconds and works once, at most 5 links per account, a source token ends after
-- 365 days without use, "last used" is written at most once every 5 minutes.

-- For the account already set only: stores a source link code with its bindings (the source,
-- the exact redirect address and the PKCE challenge). Whether the source and the address are
-- known is the backend's setting and is checked by the caller before this; the code is good
-- only for exactly what is stored here. Writes no event: the exchange does, for the account.
CREATE OR REPLACE FUNCTION player.auth_new_link_code(
  code_hash bytea, source text, redirect text, challenge text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_code      bytea := auth_new_link_code.code_hash;
  v_source    text := auth_new_link_code.source;
  v_redirect  text := auth_new_link_code.redirect;
  v_challenge text := auth_new_link_code.challenge;
  v_account   uuid := nullif(current_setting('app.account_id', true), '')::uuid;
BEGIN
  IF v_code IS NULL OR octet_length(v_code) <> 32
     OR v_source IS NULL OR v_source !~ '^[a-z][a-z0-9-]{0,39}$'
     OR v_redirect IS NULL OR length(v_redirect) NOT BETWEEN 1 AND 2000
     OR v_challenge IS NULL OR v_challenge !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'auth_new_link_code: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_account IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO player.source_link_codes
    (code_hash, account_id, source_id, redirect_uri, code_challenge, expires_at)
  VALUES (v_code, v_account, v_source, v_redirect, v_challenge, now() + interval '60 seconds');
END
$$;

-- The source's server exchanges the code for a source token. The code is used up by the first
-- exchange that finds it, whatever follows: a code presented with a wrong binding cannot be tried
-- again. All four bindings are checked: the account (the code's own), the source id, the redirect
-- address and the PKCE verifier (S256). Above 5 active links the exchange is refused. Every
-- outcome for a code that was found writes the account's event here. True only when the link
-- was made with the hash of the token the caller holds.
CREATE OR REPLACE FUNCTION player.auth_exchange_link_code(
  code_hash bytea, source text, redirect text, verifier text, token_hash bytea,
  client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_code      bytea := auth_exchange_link_code.code_hash;
  v_source    text := auth_exchange_link_code.source;
  v_redirect  text := auth_exchange_link_code.redirect;
  v_verifier  text := auth_exchange_link_code.verifier;
  v_token     bytea := auth_exchange_link_code.token_hash;
  v_client    player.client_info := auth_exchange_link_code.client;
  v_family    text := coalesce(left((v_client).family, 40), '');
  v_account   uuid;
  v_stored    text;
  v_to        text;
  v_challenge text;
  v_expires   timestamptz;
  v_reason    text;
  v_held      bigint;
  v_link      uuid;
BEGIN
  IF v_code IS NULL OR octet_length(v_code) <> 32
     OR v_token IS NULL OR octet_length(v_token) <> 32 THEN
    RAISE EXCEPTION 'auth_exchange_link_code: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The row lock makes the code single use: a second exchange waits and then finds no row.
  SELECT c.account_id, c.source_id, c.redirect_uri, c.code_challenge, c.expires_at
    INTO v_account, v_stored, v_to, v_challenge, v_expires
  FROM player.source_link_codes c WHERE c.code_hash = v_code FOR UPDATE;
  IF v_account IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM player.source_link_codes c WHERE c.code_hash = v_code;

  IF v_expires <= now() THEN
    v_reason := 'expired';
  ELSIF v_source IS DISTINCT FROM v_stored OR v_redirect IS DISTINCT FROM v_to THEN
    v_reason := 'binding';
  -- RFC 7636: a verifier is 43 to 128 unreserved characters, and the challenge is the
  -- base64url (no padding) of its SHA-256.
  ELSIF v_verifier IS NULL OR v_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
     OR rtrim(translate(encode(sha256(convert_to(v_verifier, 'UTF8')), 'base64'), '+/', '-_'),
              '=') <> v_challenge THEN
    v_reason := 'verifier';
  END IF;

  IF v_reason IS NULL THEN
    -- One exchange at a time per account, so that two exchanges cannot both pass the cap.
    PERFORM pg_advisory_xact_lock(hashtextextended('source.links:' || v_account::text, 0));
    SELECT count(*) INTO v_held FROM player.source_links l
    WHERE l.account_id = v_account
      AND coalesce(l.last_used_at, l.created_at) > now() - interval '365 days';
    IF v_held >= 5 THEN
      v_reason := 'link_limit';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
    VALUES (v_account, 'source.link_refused', 'source', NULL, (v_client).network, v_family,
            jsonb_build_object('source', v_stored, 'reason', v_reason));
    RETURN false;
  END IF;

  INSERT INTO player.source_links (account_id, source_id, token_hash)
  VALUES (v_account, v_stored, v_token)
  RETURNING id INTO v_link;
  INSERT INTO player.audit_events
    (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
  VALUES (v_account, 'source.linked', 'source', v_link, (v_client).network, v_family,
          jsonb_build_object('source', v_stored));
  RETURN true;
END
$$;

-- Finds a source link by its token hash. For a link that exists and has been used within 365
-- days it writes "last used" (at most once every 5 minutes), sets the account for this
-- transaction and returns the link's id and source id. Otherwise it returns nothing and sets no
-- account: a revoked link's row is gone, and an idle one counts as ended.
CREATE OR REPLACE FUNCTION player.auth_enter_source(token_hash bytea)
RETURNS TABLE (link_id uuid, source_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_hash    bytea := auth_enter_source.token_hash;
  v_id      uuid;
  v_account uuid;
  v_source  text;
  v_created timestamptz;
  v_used    timestamptz;
BEGIN
  PERFORM set_config('app.account_id', '', true);
  SELECT l.id, l.account_id, l.source_id, l.created_at, l.last_used_at
    INTO v_id, v_account, v_source, v_created, v_used
  FROM player.source_links l WHERE l.token_hash = v_hash;
  IF v_id IS NULL OR coalesce(v_used, v_created) < now() - interval '365 days' THEN
    RETURN;
  END IF;
  IF v_used IS NULL OR v_used < now() - interval '5 minutes' THEN
    UPDATE player.source_links l SET last_used_at = now() WHERE l.id = v_id;
  END IF;
  PERFORM set_config('app.account_id', v_account::text, true);
  link_id := v_id;
  source_id := v_source;
  RETURN NEXT;
END
$$;
