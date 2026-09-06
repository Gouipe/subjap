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

`ALLOWED_ORIGINS` vaut `*` pour permettre le premier démarrage. Une fois l’ID
stable de l’extension connu, remplacer cette valeur dans
`worker/wrangler.toml` par `chrome-extension://<extension-id>` puis redéployer.

Le Worker limite les prompts à 20 000 caractères, applique une sortie JSON
structurée et renvoie les erreurs Gemini sans exposer la clé.
