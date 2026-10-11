# Repères du projet

Pour installer et utiliser l’extension, commencer par le [README](../README.md).
Le [mode d’emploi](mode-emploi.md) décrit les fonctions destinées aux
utilisateurs. Le contrat des cartes Anki est dans
[`anki-card-formatting.md`](anki-card-formatting.md), et les frontières entre
modules sont décrites dans [`architecture.md`](architecture.md).

## Compiler l’extension

Installer les dépendances verrouillées, puis construire le dossier `dist` :

```powershell
npm.cmd ci
npm.cmd run build
```

Le dossier `dist` est produit localement et n’est pas versionné. Pour le charger
dans Chrome ou Edge, utiliser le bouton **Charger l’extension non empaquetée**
dans la page des extensions et sélectionner `dist`.

## Organisation du code

- `src/core/` : types partagés, messages, options et stockage ;
- `src/background/` : service worker, persistance et intégration AnkiConnect ;
- `src/content/` et `src/adapters/` : orchestration et lecteurs vidéo ;
- `src/tokenizer/` et `src/dictionary/` : segmentation et dictionnaire ;
- `src/overlay/` et `src/mining/` : sous-titres interactifs et création de cartes ;
- `src/popup/`, `src/options/` et `src/onboarding/` : surfaces de configuration.
