CREATE TABLE public.rummy_rooms (
  code text PRIMARY KEY,
  status text NOT NULL DEFAULT 'lobby',
  version integer NOT NULL DEFAULT 0,
  public_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rummy_rooms TO anon, authenticated;
GRANT ALL ON public.rummy_rooms TO service_role;
ALTER TABLE public.rummy_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public room state is readable" ON public.rummy_rooms FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.rummy_secrets (
  code text PRIMARY KEY REFERENCES public.rummy_rooms(code) ON DELETE CASCADE,
  secret_state jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.rummy_secrets TO service_role;
ALTER TABLE public.rummy_secrets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rummy_rooms REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rummy_rooms;