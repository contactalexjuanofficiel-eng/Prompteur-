# Emails de Prompteur

## Textes en français
Dans Supabase → **Authentication → Emails → Templates**, pour chaque modèle :
1. **Subject** : l'objet indiqué en haut du fichier.
2. **Body** : colle le contenu du fichier (sans la ligne de commentaire du haut).

| Modèle Supabase      | Fichier                  |
|----------------------|--------------------------|
| Confirm signup       | `confirmation.html`      |
| Reset password       | `mot-de-passe.html`      |
| Change email address | `changement-email.html`  |

## Nom de l'expéditeur « Prompteur »
Sans réglage, les emails partent de `noreply@mail.app.supabase.io` (nom « Supabase Auth ») et sont limités
à quelques envois par heure. Pour envoyer au nom de Prompteur, depuis ta propre adresse :
1. Crée un compte gratuit chez un service d'envoi (par exemple Resend ou Brevo) et valide ton domaine.
2. Supabase → **Authentication → Emails → SMTP Settings** → active **Custom SMTP** :
   - Sender email : `prompteur@ton-domaine` · Sender name : `Prompteur`
   - Host / Port / Username / Password : fournis par le service d'envoi.
