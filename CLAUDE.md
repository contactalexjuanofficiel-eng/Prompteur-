# Prompteur — consignes

- Appli web statique (PWA) sans étape de build : `index.html`, `app.css`, `app.js`, `sw.js`. Interface en français.
- **Jamais de `alert()`, `confirm()` ni `prompt()`** : toujours utiliser les fenêtres modales de l'appli
  (`modal()`, `confirmModal()`, `promptModal()` dans `app.js`).
- **Pas d'émojis dans l'interface** : utiliser les icônes SVG du sprite de `index.html` (`ic('nom')` en JS, `<svg class="ic"><use href="#i-nom"/></svg>` en HTML).
- Après chaque modification des fichiers de l'appli, incrémenter `CACHE` dans `sw.js` (et `APP_VERSION` dans `app.js`, même numéro) pour que les iPhone récupèrent la nouvelle version.
- Supabase : schéma dans `supabase/` ; accès protégé par RLS (membres en lecture, admins en écriture).
