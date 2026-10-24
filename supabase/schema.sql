-- Schéma du Prompteur : à exécuter une fois dans le projet Supabase (SQL Editor → New query → Run).
create table public.prompteur_textes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titre text not null default '',
  contenu text not null default '',
  reglages jsonb not null default '{}'::jsonb,
  supprime boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index prompteur_textes_user_idx on public.prompteur_textes(user_id, updated_at);
alter table public.prompteur_textes enable row level security;
create policy "prompteur_textes_select" on public.prompteur_textes for select to authenticated using ((select auth.uid()) = user_id);
create policy "prompteur_textes_insert" on public.prompteur_textes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "prompteur_textes_update" on public.prompteur_textes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "prompteur_textes_delete" on public.prompteur_textes for delete to authenticated using ((select auth.uid()) = user_id);

create table public.prompteur_setlists (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null default '',
  texte_ids uuid[] not null default '{}',
  supprime boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index prompteur_setlists_user_idx on public.prompteur_setlists(user_id, updated_at);
alter table public.prompteur_setlists enable row level security;
create policy "prompteur_setlists_select" on public.prompteur_setlists for select to authenticated using ((select auth.uid()) = user_id);
create policy "prompteur_setlists_insert" on public.prompteur_setlists for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "prompteur_setlists_update" on public.prompteur_setlists for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "prompteur_setlists_delete" on public.prompteur_setlists for delete to authenticated using ((select auth.uid()) = user_id);
