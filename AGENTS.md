# SubJap — instructions projet

Extension Chrome/Edge (Manifest V3) pour apprendre le japonais à partir des
sous-titres vidéo et créer des cartes Anki. Installation et usage : voir le
[README](README.md).

Le cas d’usage principal est désormais Re:ANIME (reanime.to, lecteur
Artplayer, sous-titres japonais souvent installés depuis Jimaku). Netflix et
YouTube restent pris en charge, mais une nouvelle fonctionnalité se conçoit et
se vérifie d’abord sur Re:ANIME.

## Documentation

Avant de coder, lire les documents liés au sujet traité :

- [`PRODUCT.md`](PRODUCT.md) et [`DESIGN.md`](DESIGN.md) — identité et système
  visuel ; à consulter avant toute modification de l'interface, de l'overlay,
  du mining ou des cartes Anki ;
- [`docs/architecture.md`](docs/architecture.md) — modules, flux de données et
  contraintes ; point d'entrée par défaut ;
- [`docs/subtitle-timeline.md`](docs/subtitle-timeline.md) — segments,
  horaires et navigation entre sous-titres ;
- [`docs/tokenization.md`](docs/tokenization.md) — Lindera/UniDic, unités
  cliquables et sélection JMdict ;
- [`docs/anki-card-formatting.md`](docs/anki-card-formatting.md) — contrat et
  procédure de mise en forme des cartes Anki ;
- [`docs/anki-production.md`](docs/anki-production.md) — cartes de production
  orale ;
- [`docs/mode-emploi.md`](docs/mode-emploi.md) — fonctions côté utilisateur ;
- [`docs/testing.md`](docs/testing.md) — tests, fixture et E2E
  (`tests/fixture/`, `tests/e2e/`) ;
- [`docs/benchmark-unidic.md`](docs/benchmark-unidic.md) — benchmark de
  tokenisation.

À la fin d’un développement, mettre à jour la documentation pertinente
seulement si le changement apporte ou modifie une information significative et
durable : comportement utilisateur, architecture, contrat, procédure,
configuration ou limitation connue. Éviter les mises à jour purement
mécaniques, évidentes, internes ou temporaires.

## Règles de développement

- Ne pas créer de régression dans la fixture ou les scénarios E2E, même
  lorsqu’un comportement absent du harnais est découvert.
- Sous Windows, les commandes Node s’exécutent avec `npm.cmd` / `npx.cmd`.
- Utiliser git worktree pour les fonctionnalités longues, risquées ou
  susceptibles d’être travaillées en parallèle ; une modification courte et
  isolée peut se faire dans le worktree courant. Lorsqu’un worktree est
  utilisé, une fois l’implémentation terminée et vérifiée, merger son commit
  dans `master` et lancer `npm run build`.

## Journal des nouveautés

[`CHANGELOG.md`](CHANGELOG.md) alimente la popup : bandeau « Mise à jour
disponible » et encart « Nouveautés » après une mise à jour. Tout commit qui
change ce que voit l’utilisatrice y ajoute une ligne courte en français, sous la
date du jour, dans `### Fonctionnalités`, `### Corrections` ou `### Refonte`. Une
ligne est identifiée par son texte : ne jamais reformuler une ligne publiée, elle
serait annoncée de nouveau. Un hook Claude Code
([`scripts/check-changelog.mjs`](scripts/check-changelog.mjs)) refuse un commit
qui modifie `src/` sans toucher `CHANGELOG.md`, sauf si son message contient
`[sans changelog]` (refactor, lint, tests, documentation).

## Correction de bugs

Ne pas se contenter de corriger le cas remonté : comprendre la vraie source du
problème et chercher une solution pérenne qui corrige aussi les cas similaires.
