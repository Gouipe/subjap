# SubJap — Browser Extension MV3 (TypeScript + Vite)

Mode d’emploi utilisateur : [`docs/mode-emploi.md`](mode-emploi.md).

Extension navigateur Manifest V3 pour l'apprentissage du japonais via les sous-titres d'anime sur Netflix et autres plateformes de streaming.

## Stack
- TypeScript strict, Vite + @crxjs/vite-plugin, React (popup/options)
- Dexie (IndexedDB), Lindera + UniDic WASM (tokenizer japonais), speechSynthesis (TTS offline)
- Chrome/Edge MV3, AnkiConnect (localhost:8765)

## Build
```bash
npm install
npm run build        # → dist/
npm test             # Vitest
```

## Structure
- `src/core/types.ts` — TOUTES les interfaces (source unique, 186 lignes)
- `src/core/db.ts` — Dexie, 4 tables
- `src/core/messaging.ts` — sendMessage<T>(), onMessage<T>() typés
- `src/background/service-worker.ts` — tous les handlers + AnkiConnect
- `src/content/index.ts` — entry point content script
- `src/adapters/` — Netflix L1 + generic-html5
- `src/overlay/` — DOM vanilla renderer + popover
- `src/mining/` — Anki, TTS, capture, modal
- `src/onboarding/` — logique 3-step
- `src/popup/`, `src/options/` — placeholders React

## Spec
`SPEC.md` — référence complète (v0.2, 471 lignes)
`src/core/types.ts` — MessageMap avec 10 types de messages
