CREATE TABLE IF NOT EXISTS public.site_allowed_discord_users (
    discord_user_id TEXT PRIMARY KEY
        CHECK (discord_user_id ~ '^[0-9]+$')
);

INSERT INTO public.site_allowed_discord_users (discord_user_id)
VALUES
    ('1230101255045513228'),
    ('1462059321860034593'),
    ('1501946308729245952')
ON CONFLICT (discord_user_id) DO NOTHING;

REVOKE ALL ON public.site_allowed_discord_users FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_site_editor()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM auth.identities AS discord_identity
        JOIN public.site_allowed_discord_users AS allowed
          ON allowed.discord_user_id = discord_identity.provider_id
        WHERE discord_identity.user_id = (SELECT auth.uid())
          AND discord_identity.provider = 'discord'
    );
$$;

REVOKE ALL ON FUNCTION public.is_site_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_site_editor() TO anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.posts (
    slug TEXT PRIMARY KEY
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    category TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 40),
    excerpt TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 300),
    content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 50000),
    status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    author_id UUID NOT NULL,
    author_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.set_post_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
            NEW.published_at := now();
        ELSIF NEW.status = 'draft' THEN
            NEW.published_at := NULL;
        END IF;
    ELSE
        NEW.updated_at := now();
        IF NEW.status = 'published' AND OLD.published_at IS NULL THEN
            NEW.published_at := now();
        ELSIF NEW.status = 'draft' THEN
            NEW.published_at := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_set_timestamps ON public.posts;
CREATE TRIGGER posts_set_timestamps
    BEFORE INSERT OR UPDATE ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.set_post_timestamps();

CREATE INDEX IF NOT EXISTS posts_status_published_at
    ON public.posts (status, published_at DESC);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT, UPDATE ON public.posts TO authenticated;

DROP POLICY IF EXISTS "Anyone can read published posts" ON public.posts;
DROP POLICY IF EXISTS "Editors can read drafts" ON public.posts;
DROP POLICY IF EXISTS "Editors can create posts" ON public.posts;
DROP POLICY IF EXISTS "Editors can update posts" ON public.posts;

CREATE POLICY "Anyone can read published posts"
    ON public.posts FOR SELECT
    USING (status = 'published');

CREATE POLICY "Editors can read drafts"
    ON public.posts FOR SELECT TO authenticated
    USING (public.is_site_editor());

CREATE POLICY "Editors can create posts"
    ON public.posts FOR INSERT TO authenticated
    WITH CHECK (
        public.is_site_editor()
        AND author_id = (SELECT auth.uid())
    );

CREATE POLICY "Editors can update posts"
    ON public.posts FOR UPDATE TO authenticated
    USING (public.is_site_editor())
    WITH CHECK (
        public.is_site_editor()
        AND author_id = (SELECT auth.uid())
    );
