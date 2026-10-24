# Prompteur

Prompteur pour concerts, mariages et lives qui marche sur **iPhone, iPad** et ordinateur.
C'est une appli web installable (PWA) : on l'ajoute à l'écran d'accueil et elle s'ouvre en plein écran comme une vraie appli, **même sans réseau**.

## Fonctions

- Défilement fluide, vitesse réglable (mémorisée **pour chaque chanson**)
- Toucher l'écran = lecture / pause · glisser = avancer / reculer
- Compte à rebours, ligne de lecture, taille, interligne, marges, alignement
- Thèmes blanc/noir, jaune, noir/blanc · **mode miroir** (vitre de prompteur) · retournement
- **Setlists** : enchaîne les morceaux d'un concert ou d'un mariage (enchaînement automatique possible)
- **Équipes** : l'admin crée, modifie et supprime les textes et setlists, et gère les membres ; les membres (musiciens) lisent, lancent le prompteur et utilisent la télécommande. On rejoint une équipe avec son code d'invitation.
- **Télécommande sans code** : chaque prompteur ouvert apparaît automatiquement chez les membres de l'équipe (Supabase Realtime, canal privé réservé à l'équipe)
- **Pédale / clavier Bluetooth** : Espace, flèches, Page précédente / suivante, + / −
- L'écran reste allumé pendant le défilement
- Mise en forme : `# Refrain` = titre de section, `[Guitare seule]` = indication en couleur
- Compte (email + mot de passe) : textes de l'équipe synchronisés entre tous les appareils via Supabase
- Export / import d'une sauvegarde, import de fichiers .txt

## Mode d'emploi

Une notice complète est intégrée à l'appli (bouton « ? » sur l'accueil) et proposée à la première ouverture.

## Installer sur iPhone / iPad

1. Ouvre l'adresse de l'appli dans **Safari**.
2. Bouton **Partager** ⬆︎ → **Sur l'écran d'accueil**.
3. Lance « Prompteur » depuis l'icône.

## Mise en ligne

Le workflow `.github/workflows/pages.yml` publie l'appli sur GitHub Pages à chaque push sur `main`.
Dans GitHub : **Settings → Pages → Source : GitHub Actions**.

N'importe quel hébergement de fichiers statiques fonctionne aussi (Netlify, Vercel, Cloudflare Pages…) : il n'y a rien à compiler.

## Adresse personnalisée (ex : prompteur.alexjuan.com)

1. Chez ton hébergeur de nom de domaine, ajoute un enregistrement **CNAME** :
   nom `prompteur` → valeur `contactalexjuanofficiel-eng.github.io`
2. GitHub → **Settings → Pages → Custom domain** : `prompteur.alexjuan.com` → **Save**,
   puis coche **Enforce HTTPS** quand GitHub le propose (quelques minutes à quelques heures).
3. Supabase → **Authentication → URL Configuration → Site URL** : `https://prompteur.alexjuan.com/`
4. Chacun réinstalle l'icône depuis la nouvelle adresse et se reconnecte une fois
   (les textes de l'équipe sont en ligne ; seuls les textes jamais synchronisés restent sur l'ancienne adresse).

## Emails

Textes en français et réglage de l'expéditeur : voir `supabase/emails/README.md`.

## Supabase

Schéma : `supabase/schema.sql` puis `supabase/equipes.sql`. Tables `prompteur_equipes`, `prompteur_membres`,
`prompteur_textes` et `prompteur_setlists` avec RLS : seuls les membres d'une équipe voient ses données, seuls ses admins les modifient.
Connexion configurée dans `config.js`. Pour que les liens des emails (confirmation, mot de passe oublié)
reviennent vers l'appli, ajoute son adresse dans Supabase → **Authentication → URL Configuration → Redirect URLs**.
