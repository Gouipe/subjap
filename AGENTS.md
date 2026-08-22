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