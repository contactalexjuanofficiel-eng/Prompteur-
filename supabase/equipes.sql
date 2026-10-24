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

-- Aperçu du nom de l'équipe à partir d'un code d'invitation (lien « ?rejoindre=CODE »).
create function public.prompteur_apercu_equipe(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select nom from public.prompteur_equipes where code_invitation = upper(trim(p_code));
$$;
grant execute on function public.prompteur_apercu_equipe(text) to anon, authenticated;

-- Historique des versions des textes (archivé automatiquement à chaque modification).
alter table public.prompteur_textes add column modifie_par uuid default auth.uid();
create table public.prompteur_versions (
  id bigint generated always as identity primary key,
  texte_id uuid not null references public.prompteur_textes(id) on delete cascade,
  equipe_id uuid not null references public.prompteur_equipes(id) on delete cascade,
  titre text not null default '', contenu text not null default '', reglages jsonb not null default '{}'::jsonb,
  supprime boolean not null default false, auteur uuid, auteur_email text not null default '',
  version_du timestamptz not null, created_at timestamptz not null default now()
);
create index prompteur_versions_texte_idx on public.prompteur_versions(texte_id, created_at desc);
create index prompteur_versions_equipe_idx on public.prompteur_versions(equipe_id);
alter table public.prompteur_versions enable row level security;
create policy "versions_select" on public.prompteur_versions for select to authenticated using (prompteur_prive.est_membre(equipe_id));
create function prompteur_prive.archiver_texte() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.modifie_par := coalesce(auth.uid(), new.modifie_par);
  if old.titre is distinct from new.titre or old.contenu is distinct from new.contenu or old.supprime is distinct from new.supprime then
    if not (old.modifie_par is not distinct from new.modifie_par and exists (
      select 1 from public.prompteur_versions v where v.texte_id = old.id and v.created_at > now() - interval '10 minutes')) then
      insert into public.prompteur_versions (texte_id, equipe_id, titre, contenu, reglages, supprime, auteur, auteur_email, version_du)
      values (old.id, old.equipe_id, old.titre, old.contenu, old.reglages, old.supprime, old.modifie_par,
              coalesce((select u.email from auth.users u where u.id = old.modifie_par), ''), old.updated_at);
    end if;
  end if;
  return new;
end $$;
create trigger prompteur_textes_archiver before update on public.prompteur_textes
  for each row execute function prompteur_prive.archiver_texte();
