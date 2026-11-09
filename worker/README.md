# Endpoint Gemini de SubJap

Ce Worker relaie uniquement les demandes d’enrichissement vers
`gemini-3.5-flash-lite`. La clé Gemini reste dans le secret Cloudflare et n’est
jamais incluse dans l’extension.

## Déploiement

Depuis la racine du projet :

```bash
npx wrangler login
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

Copier l’URL `workers.dev` affichée dans un fichier `.env.local` à la racine :

```dotenv
VITE_SUBJAP_AI_ENDPOINT=https://subjap-ai.<votre-compte>.workers.dev
```

Puis reconstruire l’extension :

```bash
npm.cmd run build
```

`ALLOWED_ORIGINS` (dans `worker/wrangler.toml`) vaut l’origine de l’extension,
`chrome-extension://cahpadjckhokgbglcanpijmloignnecd` : le Worker répond 403 à
toute autre origine. Un script hors navigateur peut falsifier cet en-tête ;
pour borner la dépense, ajouter une règle de limitation de débit dans le
tableau de bord Cloudflare.

Le Worker limite les prompts à 20 000 caractères, applique une sortie JSON
structurée et renvoie les erreurs Gemini sans exposer la clé.
