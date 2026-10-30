---
name: debug-netflix-live
description: Inspecter en direct l'onglet Netflix de l'utilisateur via Claude in Chrome pour déboguer SubJap (horaires des sous-titres, piste japonaise/traduction, overlay vs rendu natif, navigation Q/S/D). À utiliser quand un bug SubJap se manifeste pendant la lecture Netflix et doit être observé plutôt que deviné.
---

# Déboguer SubJap en direct sur Netflix

Les extraits JS ci-dessous s'exécutent avec `javascript_tool` dans le monde de
la page. Le content script SubJap est isolé : on observe son effet (overlay
DOM, messages `postMessage` du bridge, §5), pas ses variables.

## 1. Accéder à l'onglet de l'utilisateur

Chaque session Claude a son propre groupe d'onglets ; un onglet d'une autre
session ou hors groupe est invisible.

1. `tabs_context_mcp({ createIfEmpty: true })` : crée le groupe avec un onglet vide.
2. Demander à l'utilisateur de glisser son onglet Netflix **à côté de l'onglet
   vide, dans le même groupe**, sans fermer ni sortir l'onglet vide (Chrome
   supprime un groupe qui n'a plus d'onglet ; il faut alors recommencer).
3. Ne pas ouvrir l'épisode dans un second onglet : Netflix interrompt l'autre
   lecture, et l'utilisateur perd son contexte.

Je ne peux pas recharger l'extension (`chrome://extensions` est bloqué) :
après `npm.cmd run build`, demander à l'utilisateur de cliquer **Recharger**
puis F5 sur l'onglet. Je peux naviguer l'onglet moi-même (F5 = `navigate`
vers `https://www.netflix.com/watch/<id>`, la position est conservée).

Un onglet où l'utilisateur vient de reproduire le bug est précieux : ne
jamais le recharger sans son accord (le F5 efface l'état fautif). Observer
d'abord, puis installer l'enregistreur (§5) et lui demander de reproduire.
Les bugs liés à un scénario (enchaînement d'épisode, seek…) se reproduisent
dans ce scénario exact, pas par un F5.

`performance.getEntriesByType('navigation')[0].name` donne l'URL du dernier
vrai chargement : si elle diffère de `location`, Netflix a changé d'épisode
en SPA. Netflix **réutilise la même session de lecteur** (même ID dans
`getAllPlayerSessionIds()`) d'un épisode enchaîné au suivant.

## 2. Lecteur Netflix

```js
const api = netflix.appContext.state.playerApp.getAPI().videoPlayer;
const p = api.getVideoPlayerBySessionId(api.getAllPlayerSessionIds().at(-1));
p.getTimedTextTrack();       // piste affichée (bcp47, trackId, rawTrackType CC/SUBS)
p.getTimedTextTrackList();   // pistes disponibles
p.seek(1151000); p.play(); p.pause();   // millisecondes
document.querySelector('video').currentTime;
```

Toujours noter la position de départ et remettre la lecture **en pause à cet
endroit** après les mesures.

## 3. Récupérer les fichiers de sous-titres

Les URLs nflxvideo sont masquées dans la sortie de l'outil : les traiter dans
la page et ne jamais les renvoyer. Le tampon Resource Timing (~250 entrées)
est saturé après une navigation SPA depuis `/browse` : faire d'abord un F5 sur
`/watch/<id>`, attendre ~8 s, puis :

```js
window.__sj = [];
for (const e of performance.getEntriesByType('resource')
  .filter(e => /nflxvideo\.net/.test(e.name) && !/range/.test(e.name))) {
  const txt = await (await fetch(e.name)).text();
  if (/<tt\b|WEBVTT/.test(txt.slice(0, 900))) window.__sj.push(txt);
}
window.__sj.map(t => ({ lang: t.match(/xml:lang="([^"]+)"/)?.[1], len: t.length,
  meta: t.match(/<metadata[^>]*>/)?.[0] }));
```

Netflix sert du TTML `ttp:tickRate="10000000"` (`begin="…t"`). Vérifier
`lang` et la longueur : de petits fichiers sont souvent des bandes-annonces.
Analyse rapide :

```js
const parse = t => [...t.matchAll(/<p\b[^>]*begin="(\d+)t"[^>]*end="(\d+)t"[^>]*>([\s\S]*?)<\/p>/g)]
  .map(m => ({ s: +m[1] / 1e7, e: +m[2] / 1e7, x: m[3].replace(/<[^>]+>/g, ' ') }));
```

Pour comparer deux pistes : apparier les débuts proches, puis régression
linéaire (pente ≠ 1 = dérive de cadence, ordonnée ≠ 0 = décalage constant).
Comparer aussi le début et la fin de l'épisode.

## 4. Comparer l'overlay SubJap et le rendu natif

- Overlay : spans `.subjap-token` ; la ligne est leur parent.
- Natif : `.player-timedtext-text-container`. SubJap le masque
  (`html.subjap-hide-native-subs`), donc lire `textContent` (pas
  `innerText`, vide quand masqué) et **re-sélectionner à chaque mesure**
  (Netflix recrée le conteneur après un seek ; un MutationObserver sur
  l'ancien nœud ne voit plus rien).

Mesure des instants d'apparition (la vidéo doit jouer) :

```js
const v = document.querySelector('video');
const ov = {}, na = {}; const t0 = performance.now();
const overlay = () => document.querySelector('.subjap-token')?.parentElement?.textContent.replace(/\s/g, '') ?? '';
const native = () => [...document.querySelectorAll('.player-timedtext-text-container')]
  .map(e => e.textContent).join('').replace(/\s/g, '');
while (performance.now() - t0 < 15000) {
  const t = v.currentTime, o = overlay(), n = native();
  if (o && !(o in ov)) ov[o] = t; if (n && !(n in na)) na[n] = t;
  await new Promise(r => setTimeout(r, 15));
}
Object.keys(na).filter(k => k in ov).map(k => `${k.slice(0, 14)} ${(na[k] - ov[k]).toFixed(2)}s`);
```

Le rendu natif suit les horaires bruts du fichier : il sert de témoin de ce
que Netflix fournit, pas de vérité audio. Je n'entends pas l'audio : la
synchronisation avec la voix se confirme par le ressenti de l'utilisateur ou
par la concordance avec une autre piste officielle.

## 5. Enregistrer les échanges bridge ↔ adaptateur

`read_console_messages` reste souvent vide sur Netflix, même pour les logs
`[SubJap]` : ne pas compter dessus. Le bridge (monde de la page) et
l'adaptateur (content script) communiquent par `window.postMessage` avec
`source: "subjap"` ; ces messages et l'état du lecteur s'enregistrent depuis
la page. L'enregistreur survit aux changements d'épisode SPA, pas à un F5.

```js
if (!window.__sjLog) {
  window.__sjLog = []; const t0 = performance.now();
  const h = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return (x >>> 0).toString(36); };
  const ts = () => ((performance.now() - t0) / 1000).toFixed(1);
  addEventListener('message', e => {
    const d = e.data; if (d?.source !== 'subjap') return; const p = d.payload || {};
    __sjLog.push(`${ts()} ${location.pathname.split('/')[2]} ${d.type.replace('subjap:netflix-', '')} ep ${p.episodeId} lang ${p.language ?? p.preferredSecondaryLanguage ?? ''} track ${p.trackId ?? ''} url ${p.url ? h(p.url) : ''}`);
  });
  let last = '';
  setInterval(() => { try {
    const api = netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const s = api.getAllPlayerSessionIds().map(i => { const p = api.getVideoPlayerBySessionId(i);
      return `${i.slice(6, 14)}:${p?.getMovieId?.()}:${p?.getTimedTextTrack?.()?.bcp47}:[${(p?.getTimedTextTrackList?.() || []).map(t => t.bcp47)}]`; }).join(' ');
    const k = `${location.pathname.split('/')[2]} ${s} tr ${document.querySelectorAll('.subjap-translation-line').length}`;
    if (k !== last) { last = k; __sjLog.push(`${ts()} STATE ${k}`); }
  } catch {} }, 100);
}
```

Lecture : `__sjLog.map(l => l.replace(/[=&?;]/g, ' ')).join('\n')`. Une
sortie contenant `=`, `&` ou `?` est remplacée par
`[BLOCKED: Cookie/query string data]` ; les URLs sont hachées pour la même
raison. Les sorties longues sont tronquées : lire par tranches (`slice`).

Pour tester une hypothèse sur le bridge, lui envoyer le même message que
l'adaptateur, par exemple une nouvelle demande de pistes :
`postMessage({ source: 'subjap', type: 'subjap:netflix-timed-text-request',
payload: { episodeId: '<id>', preferredSecondaryLanguage: 'fr' } }, location.origin)`.
La traduction affichée est `.subjap-translation-line`, la ligne japonaise
`.subjap-cue-line`.
