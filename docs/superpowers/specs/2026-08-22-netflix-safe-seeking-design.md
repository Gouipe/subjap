# Netflix safe seeking pour les raccourcis — Design

## Contexte

Les raccourcis `q`, `s` et `d` utilisent actuellement `HTMLVideoElement.currentTime`
depuis le content script. Cette opération fonctionne avec la fixture et les
lecteurs HTML5 génériques, mais Netflix désynchronise son lecteur protégé quand
son élément `<video>` est seeké directement. Le symptôme observé est l’écran
Netflix `M7375` après l’appui sur `s`.

La correction doit conserver la navigation temporelle pour les lecteurs
génériques tout en utilisant le mécanisme interne Netflix lorsque l’adaptateur
Netflix est actif.

## Objectifs et limites

- `q`, `s` et `d` conservent leur sémantique actuelle et préservent l'état de
  lecture capturé au moment de l'appui : pause reste pause, lecture reste lecture.
- Netflix ne reçoit plus d’affectation directe à `video.currentTime`.
- Les lecteurs HTML5 génériques continuent d’utiliser `currentTime` et
  `play()`.
- Une API interne Netflix absente ou modifiée produit un no-op sûr et un
  avertissement diagnostic ; aucun fallback direct à `currentTime` n’est
  autorisé sur Netflix.
- Les cues restent exprimés en secondes côté SubJap ; le bridge convertit en
  millisecondes pour l’API Netflix.
- Le bridge ne collecte ni contenu ni données réseau ; il ne fait que relayer
  une cible temporelle locale.

## Architecture

### Contrat d’adaptateur

`PlatformAdapter` reçoit une opération asynchrone de lecture temporelle :

```ts
seekTo(timeSeconds: number, resume: boolean): Promise<boolean>;
```

Le booléen indique si la commande a été acceptée. Le navigateur de raccourcis
ne manipule plus directement l'élément vidéo : il capture l'état de lecture au
`keydown`, calcule la cible puis appelle
`adapter.seekTo(target, !adapter.isPaused())` avec l'état capturé.

- `generic-html5` : borne la cible à la durée connue si nécessaire, assigne
  `video.currentTime`, puis appelle `video.play()` lorsque `resume` vaut `true`.
- `netflix` : délègue au bridge Netflix et ne touche jamais à
  `video.currentTime`.

### Bridge Netflix en contexte principal

Un script `netflix-bridge.js` sera exposé par l’extension et injecté dans le
document Netflix par le content script. Il s’exécute dans le contexte principal
de la page afin de pouvoir lire `window.netflix.appContext`.

Le content script envoie un `CustomEvent` documenté, par exemple
`subjap:netflix-seek`, avec `{ requestId, timeMs, resume }`. Le bridge :

1. récupère `window.netflix.appContext.state.playerApp.getAPI().videoPlayer` ;
2. sélectionne la session `watch` active ;
3. récupère le player de cette session ;
4. appelle `player.seek(timeMs)` ;
5. appelle l’opération de reprise du player si `resume` est demandé et qu’elle
   est exposée ;
6. émet `subjap:netflix-seek-result` avec `{ requestId, ok, error? }`.

Les appels et les propriétés internes sont vérifiés à chaque étape. Une
exception, une session absente ou une méthode absente renvoie `ok: false`.
Le bridge ignore les événements sans marqueur SubJap et limite les données
acceptées à un nombre fini compris dans une plage temporelle raisonnable.

### Injection et cycle de vie

Le script du bridge est ajouté comme ressource accessible uniquement sur les
pages autorisées. L’injection est idempotente et attend l’événement `load` ou
la présence d’un marqueur d’installation avant d’envoyer une commande. Lors du
remplacement SPA du lecteur, le bridge reste attaché au document et résout la
session active à chaque seek ; aucun état de session n’est conservé dans le
content script.

Le manifeste ajoute `netflix-bridge.js` à `web_accessible_resources`. Le build
produit ce fichier comme entrée stable, sans exposer les autres modules de
l’extension.

## Flux de données

```text
keydown q/s/d + capture pause/lecture
    ↓
CueNavigator → cible en secondes
    ↓
PlatformAdapter.seekTo(cible, true)
    ├─ generic-html5 → video.currentTime + video.play
    └─ netflix → CustomEvent
                  ↓
             netflix-bridge.js
                  ↓
             player.seek(ms) + reprise
                  ↓
             résultat ok/échec
```

Le `keydown` est consommé uniquement lorsqu’une cible existe. Un échec du
bridge est journalisé et ne déclenche aucun seek HTML5 de secours sur Netflix.

## Tests et vérification

- Tests unitaires de l’adaptateur générique : `seekTo` assigne la position,
  appelle éventuellement `play`, et renvoie l’état attendu.
- Tests unitaires du bridge : résolution de session, conversion secondes →
  millisecondes, succès, session absente, méthode manquante et exception.
- Test d’intégration de l’adaptateur Netflix avec un transport de bridge
  injecté : une commande seek est relayée et aucune écriture de
  `video.currentTime` n’est effectuée.
- Fixture UX : le transport Netflix est remplacé par une horloge simulée ; le
  scénario `q/s/d` conserve ses assertions de position et couvre l’échec sans
  crash.
- Vérification du harnais : `npm.cmd test`, `npx.cmd tsc --noEmit`,
  `npm.cmd run lint`, `npm.cmd run build`, puis `npx.cmd playwright test`.
- La validation de la fixture ne sera pas présentée comme un smoke test Netflix
  réel ; celui-ci reste à effectuer dans un navigateur connecté après build de
  l’extension.

## Risques et repli

L’API Netflix est non documentée et peut changer sans préavis. Le bridge est
isolé derrière `seekTo`, de sorte que les sélecteurs et méthodes Netflix
peuvent évoluer sans modifier le navigateur de cues ni le content script.
Lorsque le bridge ne peut pas agir, le comportement volontaire est l’absence
de déplacement plutôt qu’une écriture HTML5 connue pour provoquer `M7375`.
