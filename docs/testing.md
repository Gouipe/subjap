# Vérification autonome de l’interface

Le projet possède maintenant trois niveaux de vérification :

## Tests automatisés

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Les tests Vitest couvrent notamment :

- la capture des sous-titres Netflix depuis `.player-timedtext` ;
- les timestamps et les mutations du DOM Netflix ;
- le masquage robuste des sous-titres natifs ;
- l’affichage du japonais interactif avec une traduction française Netflix ;
- le téléchargement des pistes officielles Netflix par le service worker ;
- le montage de l’overlay sur `document.body` ;
- le rendu des tokens, du furigana et des mots connus ;
- le masquage optionnel de la traduction quand tous les mots affichés sont
  connus ou ignorés ;
- les couleurs de fréquence : seul l’unique inconnu d’une phrase est coloré,
  en vert s’il est pertinent, en bleu dans la tranche suivante de 300 rangs ;
  les autres inconnus et les mots éloignés sont grisés, les mots connus restent
  blancs ;
- le positionnement au-dessus de la vidéo et de sa barre de contrôle.

## Fixture navigateur

La fixture utilise les vrais modules `NetflixAdapter`, `OverlayRenderer` et
`WordPopover` avec un lecteur local qui reproduit les points sensibles de
Netflix : conteneur `.player-timedtext`, barre de contrôle superposée et
remplacement du `<video>` lors d’une navigation SPA.

Lancer le serveur :

```powershell
npm.cmd run test:fixture
```

Puis ouvrir :

```text
http://127.0.0.1:5173/tests/fixture/index.html
```

Scénarios disponibles dans la page :

1. afficher une phrase et vérifier l’overlay ;
2. survoler un token pendant 350 ms ;
3. cliquer un token pour épingler la popover ;
4. basculer l’état connu/inconnu ;
5. masquer puis réafficher les sous-titres natifs ;
6. effacer les cues ;
7. remplacer le lecteur pour simuler une navigation SPA ;
8. désactiver le furigana à chaud.
9. copier avec `C` la phrase japonaise affichée sur une seule ligne.

Cette fixture est volontairement déterministe. Elle vérifie les interactions
et le positionnement sans dépendre d’un compte Netflix, du DRM ou de changements
du DOM de production.

## E2E navigateur automatisé

Le test Playwright démarre automatiquement la fixture, lance Chromium et
vérifie les scénarios UX critiques : positionnement au-dessus des contrôles,
masquage des natifs, hover, popover, changement d’état, options live, effacement
et remplacement SPA. Il charge aussi le WASM UniDic réel et vérifie `こいつら`,
`生徒たち`, `どいつら`, `彼ら`, `生徒達`, `らしい` ainsi que l’annotation du
suffixe pluriel sans cible cliquable imbriquée.

Installation initiale du navigateur :

```powershell
npx.cmd playwright install chromium
```

Exécution :

```powershell
npm.cmd run test:e2e
```

En CI, le serveur Vite est géré par Playwright et les captures, vidéos et traces
des échecs sont conservées par défaut.

## Vérification Netflix réelle

La fixture locale doit rester le test quotidien. Une vérification Netflix réelle
est un smoke test complémentaire, utile après une modification de l’adaptateur
ou lorsque Netflix change ses sélecteurs. Elle nécessite une session navigateur
connectée et vérifie principalement : détection, cues DOM, masquage des natifs,
positionnement au-dessus des contrôles et hover/clic.
