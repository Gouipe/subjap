# Vérification

## Tests unitaires et build

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Les tests Vitest sont à côté des modules (`src/**/*.test.ts`). `npm run build`
vérifie aussi le bundle du bridge Netflix (`scripts/verify-netflix-bridge.mjs`).

## Fixture navigateur

La fixture ([`tests/fixture/`](../tests/fixture/)) utilise les vrais modules
`NetflixAdapter`, `OverlayRenderer` et `WordPopover` avec un lecteur local qui
reproduit les points sensibles de Netflix : conteneur `.player-timedtext`,
barre de contrôle superposée et remplacement du `<video>` lors d’une navigation
SPA. Elle est déterministe et ne dépend ni d’un compte Netflix, ni du DRM, ni
du DOM de production.

```powershell
npm.cmd run test:fixture
```

Puis ouvrir `http://127.0.0.1:5173/tests/fixture/index.html` ; la page propose
des boutons pour chaque scénario (affichage, hover, popover, états, natifs,
remplacement SPA, options live…).

## E2E Playwright

[`tests/e2e/`](../tests/e2e/) démarre la fixture, lance Chromium et vérifie les
scénarios critiques : overlay et positionnement, popover et états de
vocabulaire, couleurs, regroupements UniDic réels, navigation Q/S/D, mining et
bundle du bridge Netflix.

```powershell
npx.cmd playwright install chromium   # une seule fois
npm.cmd run test:e2e
```

## Netflix réel

La fixture reste le test quotidien. Une vérification sur Netflix est un smoke
test complémentaire après une modification de l’adaptateur ou un changement
des sélecteurs Netflix. Le skill
[`debug-netflix-live`](../.claude/skills/debug-netflix-live/SKILL.md) décrit
comment inspecter un onglet Netflix en direct.
