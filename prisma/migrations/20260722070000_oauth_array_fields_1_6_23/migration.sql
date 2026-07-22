-- Better Auth 1.6.23 の @better-auth/oauth-provider は、以下のフィールドを
-- `string[]` / `json` として扱うようになった。旧バージョンは JSON 文字列を
-- TEXT カラムに格納していたため、その値を配列 (TEXT[]) / JSONB へ変換する。
--
-- 注) ALTER COLUMN ... USING 内ではサブクエリを使えないため、
--     JSON 配列文字列 ["a","b"] を Postgres 配列リテラル {"a","b"} に
--     文字列変換してキャストする。

-- oauth_client: 配列フィールドを TEXT -> TEXT[] へ変換
ALTER TABLE "oauth_client"
  ALTER COLUMN "scopes" TYPE TEXT[] USING (
    CASE
      WHEN "scopes" IS NULL OR "scopes" = '' THEN ARRAY[]::TEXT[]
      WHEN left("scopes", 1) = '[' THEN ('{' || substring("scopes" FROM 2 FOR length("scopes") - 2) || '}')::TEXT[]
      ELSE ARRAY["scopes"]
    END
  ),
  ALTER COLUMN "scopes" SET NOT NULL,
  ALTER COLUMN "contacts" TYPE TEXT[] USING (
    CASE
      WHEN "contacts" IS NULL OR "contacts" = '' THEN ARRAY[]::TEXT[]
      WHEN left("contacts", 1) = '[' THEN ('{' || substring("contacts" FROM 2 FOR length("contacts") - 2) || '}')::TEXT[]
      ELSE ARRAY["contacts"]
    END
  ),
  ALTER COLUMN "contacts" SET NOT NULL,
  ALTER COLUMN "redirectUris" TYPE TEXT[] USING (
    CASE
      WHEN "redirectUris" IS NULL OR "redirectUris" = '' THEN ARRAY[]::TEXT[]
      WHEN left("redirectUris", 1) = '[' THEN ('{' || substring("redirectUris" FROM 2 FOR length("redirectUris") - 2) || '}')::TEXT[]
      ELSE ARRAY["redirectUris"]
    END
  ),
  ALTER COLUMN "redirectUris" SET NOT NULL,
  ALTER COLUMN "postLogoutRedirectUris" TYPE TEXT[] USING (
    CASE
      WHEN "postLogoutRedirectUris" IS NULL OR "postLogoutRedirectUris" = '' THEN ARRAY[]::TEXT[]
      WHEN left("postLogoutRedirectUris", 1) = '[' THEN ('{' || substring("postLogoutRedirectUris" FROM 2 FOR length("postLogoutRedirectUris") - 2) || '}')::TEXT[]
      ELSE ARRAY["postLogoutRedirectUris"]
    END
  ),
  ALTER COLUMN "postLogoutRedirectUris" SET NOT NULL,
  ALTER COLUMN "grantTypes" TYPE TEXT[] USING (
    CASE
      WHEN "grantTypes" IS NULL OR "grantTypes" = '' THEN ARRAY[]::TEXT[]
      WHEN left("grantTypes", 1) = '[' THEN ('{' || substring("grantTypes" FROM 2 FOR length("grantTypes") - 2) || '}')::TEXT[]
      ELSE ARRAY["grantTypes"]
    END
  ),
  ALTER COLUMN "grantTypes" SET NOT NULL,
  ALTER COLUMN "responseTypes" TYPE TEXT[] USING (
    CASE
      WHEN "responseTypes" IS NULL OR "responseTypes" = '' THEN ARRAY[]::TEXT[]
      WHEN left("responseTypes", 1) = '[' THEN ('{' || substring("responseTypes" FROM 2 FOR length("responseTypes") - 2) || '}')::TEXT[]
      ELSE ARRAY["responseTypes"]
    END
  ),
  ALTER COLUMN "responseTypes" SET NOT NULL,
  ALTER COLUMN "metadata" TYPE JSONB USING (
    CASE WHEN "metadata" IS NULL OR "metadata" = '' THEN NULL ELSE "metadata"::jsonb END
  );

-- oauth_refresh_token: scopes を TEXT -> TEXT[] へ
ALTER TABLE "oauth_refresh_token"
  ALTER COLUMN "scopes" TYPE TEXT[] USING (
    CASE
      WHEN "scopes" IS NULL OR "scopes" = '' THEN ARRAY[]::TEXT[]
      WHEN left("scopes", 1) = '[' THEN ('{' || substring("scopes" FROM 2 FOR length("scopes") - 2) || '}')::TEXT[]
      ELSE ARRAY["scopes"]
    END
  ),
  ALTER COLUMN "scopes" SET NOT NULL;

-- oauth_access_token: scopes を TEXT -> TEXT[] へ
ALTER TABLE "oauth_access_token"
  ALTER COLUMN "scopes" TYPE TEXT[] USING (
    CASE
      WHEN "scopes" IS NULL OR "scopes" = '' THEN ARRAY[]::TEXT[]
      WHEN left("scopes", 1) = '[' THEN ('{' || substring("scopes" FROM 2 FOR length("scopes") - 2) || '}')::TEXT[]
      ELSE ARRAY["scopes"]
    END
  ),
  ALTER COLUMN "scopes" SET NOT NULL;

-- oauth_consent: scopes を TEXT -> TEXT[] へ
ALTER TABLE "oauth_consent"
  ALTER COLUMN "scopes" TYPE TEXT[] USING (
    CASE
      WHEN "scopes" IS NULL OR "scopes" = '' THEN ARRAY[]::TEXT[]
      WHEN left("scopes", 1) = '[' THEN ('{' || substring("scopes" FROM 2 FOR length("scopes") - 2) || '}')::TEXT[]
      ELSE ARRAY["scopes"]
    END
  ),
  ALTER COLUMN "scopes" SET NOT NULL;
