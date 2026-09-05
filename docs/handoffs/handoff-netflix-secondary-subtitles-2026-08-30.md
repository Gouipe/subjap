# Handoff — sous-titres secondaires Netflix absents

Date : 2026-08-30

## Demande utilisateur

Le problème initial était l'affichage ponctuel d'une phrase japonaise provenant
manifestement d'un autre épisode (`何その顔` n'était pas prononcé dans la scène).
L'utilisateur veut une isolation fiable par identifiant d'épisode, sans repli
approximatif par langue ou par ordre d'arrivée des requêtes. Le coût en
performance doit rester négligeable.

Après l'ajout du filtrage par épisode, les sous-titres anglais ont disparu. Le
symptôme actuel est donc : japonais SubJap visible, traduction anglaise absente.

L'utilisateur recharge systématiquement l'extension puis fait `Ctrl+R` sur
Netflix avant de répondre « toujours rien ». Ne pas remettre cette étape en
doute et ne pas lui demander de répéter des cycles de diagnostic sans nouvelle
preuve exploitable.

## État Git

- Branche : `master`.
- Commit courant : `23d4435 Filter Netflix subtitle tracks by episode`.
- Ce commit contient l'implémentation actuelle, mais elle **ne rétablit pas** la
  traduction anglaise.
- Le worktree contient une modification non commitée dans
  `src/netflix-bridge.ts` : un log temporaire `Netflix secondary identity` qui
  affiche l'identifiant de la piste sélectionnée et les identifiants candidats.
  Cette version a été compilée mais n'a pas été chargée dans Chrome après sa
  compilation.
- Aucun test n'a été créé ou lancé, conformément aux instructions projet.
- `npm.cmd run build` passe, y compris avec le log temporaire non commité.

## Modifications déjà présentes dans `23d4435`

- `NetflixTimedTextTrack` transporte `episodeId` et, désormais, `trackId`.
- Extraction de l'identité d'épisode autour des `timedtexttracks` :
  `playableId`, `videoId`, `episodeId`, `movieId`, ou `id` uniquement sur un
  objet de lecture.
- Le bridge et l'adaptateur refusent une piste dont `episodeId` ne correspond
  pas exactement au `/watch/<id>` actif.
- Invalidation des pistes, caches et réponses tardives lors d'un changement
  d'épisode SPA.
- Sonde temporaire de la piste secondaire via l'API du lecteur Netflix, puis
  restauration de la piste japonaise.
- La sonde exige désormais que `session.getMovieId()` corresponde à la route.
- Tentative de recoupement du `trackId` de la piste active avec les
  `trackId` / `track_id` / `new_track_id` / `newTrackId` / `id` du manifeste.
- Les requêtes CDN arbitraires `nflxvideo.net/range/...` ne sont plus associées
  automatiquement à la piste secondaire : cette ancienne tentative pouvait
  consommer une requête vidéo comme si c'était un sous-titre.

## Reproduction et preuves observées

Page utilisée : `https://www.netflix.com/watch/81664906`, Blue Box S1:E2.

Après rechargement de l'extension et de Netflix, les logs de la version
commitée montrent :

```text
[SubJap] Netflix timed-text tracks: none, ja, en, en, ko, pt-BR, zh-Hans, zh-Hant, es
[SubJap] Netflix probing secondary track: en
```

Il n'y a ensuite ni :

```text
[SubJap] Netflix scoped secondary track: en
```

ni :

```text
[SubJap] Netflix timed-text track discovered: en
```

Conclusion : la session et la piste anglaise sont trouvées, mais aucune URL de
sous-titre capturée n'est recoupée avec cette piste.

Une lecture directe, en monde page via CDP, de la session Netflix active a donné
les valeurs suivantes :

```text
getMovieId() = 81664906
current Japanese trackId = T:2:1;1;ja;0;0;0;0;

English CC:
  trackId = T:2:1;1;en;0;0;0;0;
  trackType = ASSISTIVE
  rawTrackType = CLOSEDCAPTIONS

English subtitles:
  trackId = T:2:0;1;en;0;0;0;0;
  trackType = PRIMARY
  rawTrackType = SUBTITLES
```

`selectNetflixSecondaryTrack()` prend actuellement la première piste anglaise,
donc **English CC** (`T:2:1;1;en;...`), pas la piste English PRIMARY.

Les objets retournés par `getTimedTextTrackList()` ne contiennent aucune URL ;
seulement `trackId`, `bcp47`, `displayName`, `trackType`, `rawTrackType`,
`isNoneTrack`, `isForcedNarrative` et `isImageBased`.

Une recherche récursive dans `window.netflix.appContext.state` n'a trouvé aucun
`timedtexttracks`. Ces métadonnées ne restent donc pas disponibles dans l'état
Netflix après la réponse réseau ; le bridge les voit uniquement pendant le
parsing JSON initial.

## Tentatives qui n'ont pas fonctionné

1. Associer la prochaine requête `nflxvideo.net` après le changement temporaire
   de piste : trop large, une requête vidéo pouvait être prise pour un
   sous-titre.
2. Restreindre cette association aux URLs `ttDownloadables` déjà vues : sûr,
   mais l'URL effectivement demandée ne correspond pas littéralement au candidat
   capturé, donc aucune découverte anglaise.
3. Recouper le `trackId` de la session avec les candidats déjà capturés : aucune
   correspondance n'a été trouvée avec les données actuellement extraites.
4. Ouvrir un second onglet Netflix pour inspecter la session : Netflix a affiché
   M7020 (plusieurs onglets). Cet onglet a été fermé ; ne pas répéter.
5. Capturer les événements réseau CDP : `Network.enable` a été appelé puis la
   page rechargée, mais `readEvents()` a été lu sans curseur de départ et a
   renvoyé zéro événement. Ce n'est pas une preuve d'absence de manifeste.

## Prochaine étape recommandée

Capturer **une seule fois** la réponse de manifeste active avec CDP, avant de
modifier à nouveau le code :

1. récupérer la capacité CDP de l'onglet Netflix actif ;
2. appeler `Network.enable` ;
3. appeler `readEvents({ methods: ["Network.responseReceived"] })` et conserver
   son `cursor` comme `afterSequence` ;
4. recharger Netflix une fois ;
5. lire
   `readEvents({ afterSequence, methods: ["Network.responseReceived"], limit: ... })` ;
6. repérer la réponse manifest/playback et appeler
   `Network.getResponseBody({ requestId })` ;
7. inspecter dans ce corps l'entrée correspondant exactement à
   `T:2:1;1;en;0;0;0;0;` et à `movieId=81664906`.

La capacité CDP expose bien :

```text
readEvents({ afterSequence, limit, methods, target, timeoutMs })
```

Avec ce corps réel, déterminer si :

- le manifeste emploie un autre nom de champ d'identité que ceux déjà gérés ;
- la piste English CC n'a pas de `ttDownloadables` mais English PRIMARY en a ;
- l'URL téléchargeable est transformée en requête `range` et nécessite un
  rapprochement par identifiant plutôt que par URL littérale.

Recommandation fonctionnelle si les deux pistes anglaises sont disponibles :
préférer la piste `trackType=PRIMARY` / `rawTrackType=SUBTITLES` pour la
traduction, et n'utiliser English CC qu'en repli. Cette décision doit toutefois
être confirmée par le manifeste capturé avant implémentation.

## État du navigateur à la fin

- Onglet Netflix original conservé, épisode `81664906`.
- DevTools est ouvert et la console est filtrée sur `subjap`.
- Aucun réglage Netflix ou d'une autre extension n'a été modifié.
- Le domaine CDP `Network` a été activé sur cette session de diagnostic ; cet
  état est éphémère et disparaît avec la session/outillage.

