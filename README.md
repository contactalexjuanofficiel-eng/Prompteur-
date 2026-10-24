# Prompteur

Prompteur pour concerts, mariages et lives qui marche sur **iPhone, iPad** et ordinateur.
C'est une appli web installable (PWA) : on l'ajoute à l'écran d'accueil et elle s'ouvre en plein écran comme une vraie appli, **même sans réseau**.

## Fonctions

- Défilement fluide, vitesse réglable (mémorisée **pour chaque chanson**)
- Toucher l'écran = lecture / pause · glisser = avancer / reculer
- Compte à rebours, ligne de lecture, taille, interligne, marges, alignement
- Thèmes blanc/noir, jaune, noir/blanc · **mode miroir** (vitre de prompteur) · retournement
- **Setlists** : enchaîne les morceaux d'un concert ou d'un mariage (enchaînement automatique possible)
- **Télécommande** : un 2ᵉ téléphone pilote le prompteur (Supabase Realtime, code à 6 caractères)
- **Pédale / clavier Bluetooth** : Espace, flèches, Page précédente / suivante, + / −
- L'écran reste allumé pendant le défilement
- Mise en forme : `# Refrain` = titre de section, `[Guitare seule]` = indication en couleur
- Compte (email + mot de passe) : textes synchronisés entre tous les appareils via Supabase
- Export / import d'une sauvegarde, import de fichiers .txt

## Installer sur iPhone / iPad

1. Ouvre l'adresse de l'appli dans **Safari**.
2. Bouton **Partager** ⬆︎ → **Sur l'écran d'accueil**.
3. Lance « Prompteur » depuis l'icône.

## Mise en ligne

Le workflow `.github/workflows/pages.yml` publie l'appli sur GitHub Pages à chaque push sur `main`.
Dans GitHub : **Settings → Pages → Source : GitHub Actions**.

N'importe quel hébergement de fichiers statiques fonctionne aussi (Netlify, Vercel, Cloudflare Pages…) : il n'y a rien à compiler.

## Supabase

Tables `prompteur_textes` et `prompteur_setlists` avec RLS (chaque utilisateur ne voit que ses données).
Connexion configurée dans `config.js`. Pour que les liens des emails (confirmation, mot de passe oublié)
reviennent vers l'appli, ajoute son adresse dans Supabase → **Authentication → URL Configuration → Redirect URLs**.
