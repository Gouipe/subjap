# SubJap — instructions projet

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
