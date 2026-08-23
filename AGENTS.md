# SubJap — instructions projet

Quand je te demande de modifier/ajouter une fonctionnalité, brainstormons ensemble la spécification fonctionnelle. Une fois que c'est fait tu peux dev.

Aborde une question à la fois. Sinon c'est trop compliqué pour moi. Donne une recommandation pour me faciliter la tâche.

Tu as accès à Chrome via l'extension. Tu as aussi les droits de lancer des commandes. Quand tu peux sois autonome, ne me demande vraiment que ce tu ne peux pas savoir/faire par toi-même ou que c'est des questions fonctionnelles qui dépendent de la préférence de l'utilisateur de l'extension.

Pour tout changement du content script, des adaptateurs, de l’overlay, de la
popover, du mining, du popup ou des Options, utiliser `$subjap-ux-harness`.
Son `SKILL.md` est la source de vérité pour le harnais, les commandes de
vérification et la gestion des régressions ; ne pas recopier ces procédures ici.

Références du projet :

- [`docs/architecture.md`](docs/architecture.md) — architecture actuelle ;
- [`docs/testing.md`](docs/testing.md) — fixture et scénarios de test ;
- `tests/fixture/` et `tests/e2e/` — harnais exécutable.

Lorsqu’un test manuel révèle un comportement absent du harnais, faire évoluer
la fixture et le scénario E2E correspondant selon le skill, puis conserver la
régression dans le dépôt.

Les commandes Node s’exécutent avec `npm.cmd` / `npx.cmd` sous Windows.

Quand je mets un imprim ecran dans la conversation, c'est de l'existant, souvent que je veux modifier. Ce n'est pas la cible que je souhaite.

## Stratégie de vérification

Pour accélérer l’implémentation, ne pas lancer toute la suite E2E après chaque
petite modification. Pendant le développement, privilégier les tests unitaires
et E2E ciblés par la fonctionnalité modifiée, ainsi que TypeScript lorsque le
code concerné est typé.

La suite E2E complète n’est pas obligatoire pour chaque demande. La lancer une
fois avant la remise finale lorsque la modification touche un adaptateur, le
content script, le pipeline de rendu, le bridge ou un autre module partagé,
ainsi que pour les lots de changements transversaux. Pour une modification
isolée et à faible risque, les tests ciblés suffisent.

Les tests ciblés doivent tout de même être passés avant de rendre la main dès
qu’ils existent pour le comportement modifié. Toute régression découverte doit
être conservée dans le harnais conformément aux instructions du skill.

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