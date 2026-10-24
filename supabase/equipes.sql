-- Étape 2 (après schema.sql) : équipes, rôles et canal temps réel privé de la télécommande.
-- Déjà appliqué sur le projet en ligne ; conservé ici pour recréer la base si besoin.
create schema if not exists prompteur_prive;
grant usage on schema prompteur_prive to authenticated;

create table public.prompteur_equipes (
  id uuid primary key default gen_random_uuid(),
  nom text not null default 'Mon équipe',
  code_invitation text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.prompteur_equipes enable row level security;

create table public.prompteur_membres (
  equipe_id uuid not null references public.prompteur_equipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'membre' check (role in ('admin', 'membre')),
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (equipe_id, user_id)
);
create index prompteur_membres_user_idx on public.prompteur_membres(user_id);
alter table public.prompteur_membres enable row level security;

create function prompteur_prive.est_membre(eq uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.prompteur_membres m where m.equipe_id = eq and m.user_id = (select auth.uid()));
$$;
create function prompteur_prive.est_admin(eq uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.prompteur_membres m where m.equipe_id = eq and m.user_id = (select auth.uid()) and m.role = 'admin');
$$;
create function prompteur_prive.est_membre_canal(topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare eq text := substring(topic from '^prompteur:([0-9a-f-]{36})$');
begin
  if eq is null then return false; end if;
  return prompteur_prive.est_membre(eq::uuid);
end $$;

create policy "equipes_select" on public.prompteur_equipes for select to authenticated using (prompteur_prive.est_membre(id));
create policy "equipes_update" on public.prompteur_equipes for update to authenticated using (prompteur_prive.est_admin(id)) with check (prompteur_prive.est_admin(id));
create policy "equipes_delete" on public.prompteur_equipes for delete to authenticated using (prompteur_prive.est_admin(id));
create policy "membres_select" on public.prompteur_membres for select to authenticated using (prompteur_prive.est_membre(equipe_id));
create policy "membres_update" on public.prompteur_membres for update to authenticated using (prompteur_prive.est_admin(equipe_id)) with check (prompteur_prive.est_admin(equipe_id));
create policy "membres_delete" on public.prompteur_membres for delete to authenticated using (prompteur_prive.est_admin(equipe_id) or user_id = (select auth.uid()));

create function prompteur_prive.garder_un_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.prompteur_equipes e where e.id = old.equipe_id)
     and not exists (select 1 from public.prompteur_membres m where m.equipe_id = old.equipe_id and m.role = 'admin') then
    raise exception 'Une équipe doit garder au moins un admin';
  end if;
  return null;
end $$;
create trigger prompteur_membres_garder_admin after update or delete on public.prompteur_membres
  for each row execute function prompteur_prive.garder_un_admin();

create function public.prompteur_creer_equipe(p_nom text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  insert into public.prompteur_equipes (nom, created_by) values (coalesce(nullif(trim(p_nom), ''), 'Mon équipe'), auth.uid()) returning id into v_id;
  insert into public.prompteur_membres (equipe_id, user_id, role, email) values (v_id, auth.uid(), 'admin', coalesce(auth.jwt() ->> 'email', ''));
  return v_id;
end $$;

create function public.prompteur_rejoindre(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select id into v_id from public.prompteur_equipes where code_invitation = upper(trim(p_code));
  if v_id is null then raise exception 'Code invalide'; end if;
  insert into public.prompteur_membres (equipe_id, user_id, role, email) values (v_id, auth.uid(), 'membre', coalesce(auth.jwt() ->> 'email', ''))
    on conflict (equipe_id, user_id) do nothing;
  return v_id;
end $$;

create function public.prompteur_nouveau_code(p_equipe uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  if not prompteur_prive.est_admin(p_equipe) then raise exception 'Réservé aux admins'; end if;
  update public.prompteur_equipes set code_invitation = v_code where id = p_equipe;
  return v_code;
end $$;

alter table public.prompteur_textes add column equipe_id uuid not null references public.prompteur_equipes(id) on delete cascade;
alter table public.prompteur_setlists add column equipe_id uuid not null references public.prompteur_equipes(id) on delete cascade;
create index prompteur_textes_equipe_idx on public.prompteur_textes(equipe_id);
create index prompteur_setlists_equipe_idx on public.prompteur_setlists(equipe_id);

alter policy "prompteur_textes_select" on public.prompteur_textes using (prompteur_prive.est_membre(equipe_id));
alter policy "prompteur_textes_insert" on public.prompteur_textes with check (prompteur_prive.est_admin(equipe_id));
alter policy "prompteur_textes_update" on public.prompteur_textes using (prompteur_prive.est_admin(equipe_id)) with check (prompteur_prive.est_admin(equipe_id));
alter policy "prompteur_textes_delete" on public.prompteur_textes using (prompteur_prive.est_admin(equipe_id));
alter policy "prompteur_setlists_select" on public.prompteur_setlists using (prompteur_prive.est_membre(equipe_id));
alter policy "prompteur_setlists_insert" on public.prompteur_setlists with check (prompteur_prive.est_admin(equipe_id));
alter policy "prompteur_setlists_update" on public.prompteur_setlists using (prompteur_prive.est_admin(equipe_id)) with check (prompteur_prive.est_admin(equipe_id));
alter policy "prompteur_setlists_delete" on public.prompteur_setlists using (prompteur_prive.est_admin(equipe_id));

create policy "prompteur_canal_lecture" on realtime.messages for select to authenticated using (prompteur_prive.est_membre_canal(realtime.topic()));
create policy "prompteur_canal_ecriture" on realtime.messages for insert to authenticated with check (prompteur_prive.est_membre_canal(realtime.topic()));
