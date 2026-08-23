# SubJap — instructions projet

Quand je te demande de modifier/ajouter une fonctionnalité, brainstormons ensemble la spécification fonctionnelle. Une fois que c'est fait tu peux dev.

Aborde une question à la fois. Sinon c'est trop compliqué pour moi. Donne une recommandation pour me faciliter la tâche.

Tu as accès à Chrome via l'extension. Tu as aussi les droits de lancer des commandes. Quand tu peux sois autonome, ne me demande vraiment que ce tu ne peux pas savoir/faire par toi-même ou que c'est des questions fonctionnelles qui dépendent de la préférence de l'utilisateur de l'extension.

Ne pas utiliser les skills `$subjap-light-dev` ou `$subjap-ux-harness` pour les changements de ce projet.

Utiliser git worktree pour les fonctionnalités longues, risquées ou susceptibles
d’être travaillées en parallèle. Pour une modification courte et isolée,
travailler directement dans le worktree courant est acceptable. Si une seconde
tâche parallèle apparaît ensuite, créer à ce moment-là un worktree dédié.
Lorsqu’un worktree est utilisé, une fois l’implémentation terminée et vérifiée,
merger son commit dans `master` avant de rendre la main.

Références du projet :

- [`docs/architecture.md`](docs/architecture.md) — architecture actuelle ;
- [`docs/testing.md`](docs/testing.md) — fixture et scénarios de test ;
- `tests/fixture/` et `tests/e2e/` — harnais exécutable.

Ne pas créer de régression dans la fixture ou les scénarios E2E, même lorsqu’un
comportement absent du harnais est découvert.

Les commandes Node s’exécutent avec `npm.cmd` / `npx.cmd` sous Windows.

Quand je mets un imprim ecran dans la conversation, c'est de l'existant, souvent que je veux modifier. Ce n'est pas la cible que je souhaite.

## Stratégie de vérification

Par défaut, oublier la création et le lancement de tests : ne créer ni test
unitaire, ni scénario E2E, ni fixture de régression, et ne lancer aucune suite
de tests. Cette règle s’applique aussi aux tests ciblés et aux vérifications
automatisées de type navigateur, sauf demande explicite contraire de
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
