# SubJap — instructions projet

Quand je te demande de modifier/ajouter une fonctionnalité, brainstormons ensemble la spécification fonctionnelle. Une fois que c'est fait tu peux dev.

Aborde une question à la fois. Sinon c'est trop compliqué pour moi. Donne une recommandation pour me faciliter la tâche.

Tu as accès à Chrome via l'extension. Tu as aussi les droits de lancer des commandes. Ne me demande vraiment que ce tu ne peux pas savoir dans le code ou des questions fonctionnelles qui dépendent de la préférence de l'utilisateur de l'extension.

Ne pas utiliser de workflow ou de skill spécialisé imposé par le projet pour
les changements de ce projet.

Utiliser git worktree pour les fonctionnalités longues, risquées ou susceptibles
d’être travaillées en parallèle. Pour une modification courte et isolée,
travailler directement dans le worktree courant est acceptable. Si une seconde
tâche parallèle apparaît ensuite, créer à ce moment-là un worktree dédié.
Lorsqu’un worktree est utilisé, une fois l’implémentation terminée et vérifiée,
merger son commit dans `master` et  lancer un npm run build avant de rendre la main.

Références du projet :

- [`docs/`](docs/) — documentation du projet ; commencer par parcourir ce dossier
  avant toute modification et consulter les documents dont le nom correspond au
  sujet traité ;
- [`docs/anki-card-formatting.md`](docs/anki-card-formatting.md) — contrat,
  architecture et procédure pour la mise en forme des cartes Anki ;
- [`docs/architecture.md`](docs/architecture.md) — architecture actuelle ;
- [`docs/testing.md`](docs/testing.md) — fixture et scénarios de test ;
- `tests/fixture/` et `tests/e2e/` — harnais exécutable.

## Consultation générale de `docs/`

Avant de coder, exécuter `rg --files docs` et ouvrir les documents pertinents
en fonction de leur nom. Les noms donnent une première indication de la
documentation à consulter :

- `anki*`, `card*`, `template*`, `format*`, `style*` : cartes Anki et rendu ;
- `architecture*` : frontières entre modules et flux de données ;
- `testing*`, `fixture*`, `e2e*` : stratégie de vérification et harnais ;
- `mode-emploi*`, `guide*`, `instructions*` : procédure d’utilisation ou de
  développement ;
- `voicevox*`, `audio*`, `tts*` : synthèse, capture et fichiers audio ;
- `benchmark*`, `performance*`, `perf*` : mesures et contraintes de
  performance ;
- `TODO*`, `plan*`, `spec*`, `historique*`, `handoff*` : backlog, décisions ou
  historique, à consulter lorsque le sujet correspond mais à ne pas considérer
  automatiquement comme l’état courant.

Si aucun nom ne correspond exactement, consulter `architecture.md`, puis la
documentation la plus proche par domaine. Les documents de `docs/` sont des
références de contexte ; les instructions normatives de ce fichier et les
besoins explicites de l’utilisateur restent prioritaires.

À la fin d’un développement, mettre à jour la documentation pertinente
seulement si le changement apporte ou modifie une information significative et
durable : comportement utilisateur, architecture, contrat, procédure,
configuration ou limitation connue. Si aucune information de cette nature n’a
changé, ne modifier aucun document ; éviter les mises à jour purement
mécaniques, évidentes, internes ou temporaires.

Ne pas créer de régression dans la fixture ou les scénarios E2E, même lorsqu’un
comportement absent du harnais est découvert.

Les commandes Node s’exécutent avec `npm.cmd` / `npx.cmd` sous Windows.

Quand je mets un imprim ecran dans la conversation, c'est de l'existant, souvent que je veux modifier. Ce n'est pas la cible que je souhaite.

## Stratégie de vérification

Ne crée ni ne lance de tests.
Pas de vérifications automatisées de type navigateur, sauf demande explicite contraire de
l’utilisateur.

Quand une implémentation est terminée et vérifiée, créer un commit avec les
changements concernés avant de rendre la main. Si l’utilisateur demande ensuite
des retours sur cette même implémentation, modifier le commit existant avec
`git commit --amend --no-edit` plutôt que créer un nouveau commit, sauf demande
explicite contraire.

## Correction de bugs

Quand je te demande de corriger un bug, ne cherche pas toujours simplement à corriger
le cas unique remonté.
Essaye de comprendre la vraie source du problème, et cherche une solution qui soit pérenne. 
Si possible cherche des solutions qui vont corriger tous les cas similaires. 
