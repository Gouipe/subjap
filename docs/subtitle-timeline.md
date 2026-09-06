# Sous-titres : segments et chronologie commune

## Contrat utilisateur

Un segment de la piste japonaise est un bloc SubJap. Le texte et les horaires
de ce segment servent à l’affichage, aux raccourcis, au mode écoute et au mining.
Les retours à la ligne ne créent pas de nouvelles positions dans la vidéo.
Une phrase répartie entre plusieurs segments reste répartie entre plusieurs
sous-titres ; SubJap ne reconstruit pas automatiquement une phrase complète.

Les segments qui se chevauchent sont affichés ensemble, chacun avec ses propres
tokens et bornes. Le mot cliqué appartient toujours à son segment pour le
mining. Le mode écoute conserve sa règle : il ne démarre pas automatiquement
sur plusieurs segments simultanés.

`S` reprend le segment visible commencé le plus récemment. `Q` et `D` visent
respectivement le début distinct précédent et suivant dans la même chronologie.
Des segments commençant ensemble partagent donc une seule position de navigation.
Dans un silence, `Q` et `S` reprennent le dernier segment commencé, et `D` le
prochain. La pause ou la lecture sont conservées.

## Sources et identité

`src/subtitles/timeline.ts` contient le catalogue des pistes et les fonctions
communes de sélection des segments actifs et de leur identité. La résolution
des sources appartient à l’adaptateur, jamais aux raccourcis.

Le bridge Netflix relaie l’identité de la piste japonaise active et celle de
la traduction choisie par la sonde. Le contrôle de la piste japonaise continue
après la sonde initiale. Le téléchargement par le service worker conserve
l’identité d’épisode et de piste dans son contexte de requête.

Le catalogue utilise un seul fichier exploitable par piste sélectionnée. Une
représentation déjà sélectionnée reste stable pendant la session. Il ne
concatène pas les variantes japonais/CC ou plusieurs formats, et ne supprime
pas deux locuteurs parce que leurs horaires se chevauchent. Une réponse tardive
sans identité de piste ne peut pas effacer une identité déjà connue pour son URL.

Chaque segment transporte une provenance immuable : type de source, session,
piste, fichier, identifiant du segment source et précision du début. Les
instantanés publiés sont immuables. L’arrivée de meilleures données peut changer
la source active, mais ne modifie pas une phrase déjà figée dans le mining.

## Sélection YouTube

Sur les vidéos classiques YouTube, la piste japonaise du créateur prime sur
la piste automatique. Le bridge et l’adaptateur isolent leurs fichiers par
identifiant vidéo et génération de navigation. Les métadonnées et réponses
de l’ancienne vidéo ne peuvent pas alimenter la nouvelle chronologie.

Le parseur conserve les segments JSON3/XML/VTT. Un événement JSON3 `aAppend`
complète sa fenêtre source ; une nouvelle fenêtre automatique termine
l’ancienne à son début pour éviter la répétition due à l’affichage déroulant.
Les segments du créateur qui se chevauchent restent distincts. Ces horaires
servent aussi à la navigation et à la capture audio, avec la même marge audio
de 300 ms. Les publicités suspendent ce contexte et interrompent l’exercice
ou la capture en cours.

La traduction locale conserve sa priorité sur les pistes FR/EN du créateur
lorsque la piste secondaire est activée. La préférence peut aussi désactiver
complètement cette piste. Sinon, la langue secondaire préférée est recherchée
parmi les pistes non automatiques, puis l’autre langue FR/EN ; les pistes générées
et traduites automatiquement par YouTube sont exclues. La sonde du lecteur pour charger une traduction
manquante restaure le japonais sans changer sa chronologie.
Sans fichier japonais exploitable, YouTube conserve ses sous-titres natifs et
SubJap ne crée pas d’historique à partir d’un texte dont la langue ou les bornes
ne seraient pas confirmées.

## Ordre de repli Netflix

1. Piste officielle correspondant à l’identité japonaise du lecteur.
2. Si cette identité n’est pas disponible, piste dont le texte actif correspond
   sans ambiguïté au texte observé, parmi les ressources disponibles.
3. Piste japonaise HTML5 sélectionnée, avec ses segments horodatés.
4. Historique des blocs japonais observés dans le DOM.

Une identité de piste connue interdit de choisir un fichier d’identité inconnue
ou différente par simple ressemblance textuelle. Tant que la bonne piste manque,
le repli reste actif. La traduction locale conserve sa priorité indépendante.

Avec une piste officielle active, un intervalle sans segment reste vide même
si Netflix conserve brièvement un ancien texte dans le DOM. Les échéances des
segments déclenchent aussi le rendu, pour ne pas dépendre uniquement de la
fréquence des événements `timeupdate`.

Le repli DOM distingue chaque changement de texte. `A → A+B → B` ne devient
pas une accumulation permanente `A+B`. Un début sans attribut temporel est
estimé à la première observation ; il ne reçoit pas de marge audio implicite.
La fin reste provisoire jusqu’à la disparition ou au remplacement du bloc.
Une fin résolue met à jour l’historique par identité, sans modifier les
instantanés déjà remis aux consommateurs.

Une relecture à l'intérieur d'un intervalle DOM confirmé réutilise son identité
si le texte exact correspond. Lorsqu'une relecture complète retrouve le début
plus ancien d'une phrase, elle remplace les observations partielles de ce même
texte contenues dans son intervalle. Les occurrences séparées dans le temps et
les textes différents restent distincts.

## Navigation et capture

`CueNavigator` reçoit les segments publiés et la chronologie de l’adaptateur.
Il ne rapproche pas deux segments parce que leurs débuts sont proches ou que
leurs durées se recouvrent. La cible est déterminée au moment de l’appui : un
déplacement mis en file garde son sens même si l’affichage change entre-temps.
Les appuis rapprochés peuvent partir de la dernière cible demandée ; cet état
est borné dans le temps et disparaît à l’arrivée du segment demandé.

Le contexte de navigation inclut la session et la source de sous-titres. Les
commandes en attente d’un ancien contexte sont ignorées. Les événements
`seeking` / `seeked` et l’attente d’arrivée de l’adaptateur empêchent de traiter
les transitions du lecteur comme une lecture continue. Sans piste officielle,
un retour vers un début historique connu réutilise cette observation et attend
son texte, avec un délai maximal.
Pendant cette attente, la cible historique n'est pas publiée comme sous-titre :
le lecteur doit effectivement réafficher le texte avant de pouvoir déclencher
l'écoute active. Q/S/D ferme l'exercice précédent et annule sa surveillance
avant tout nouveau déplacement. La fin d'écoute dépend de l'horloge vidéo,
afin qu'un chargement ou un seek ne raccourcisse pas la phrase.

Netflix accepte des millisecondes entières : un début plus précis est arrondi
vers le haut, de moins d’une milliseconde, pour éviter de rester juste avant le
segment demandé lorsque la vidéo est en pause.

La capture audio conserve sa session privée, qui ne publie pas les états DOM
intermédiaires. Elle travaille sur le segment figé et ajoute ses marges de
300 ms autour de ses bornes. Ces marges ne changent ni la chronologie de
navigation ni le texte miné. Pour une observation DOM provisoire, la fin est
résolue lorsque ce bloc exact change ou disparaît, sans fusion par texte commun.

## Limites

Les horaires officiels sont ceux du sous-titrage, pas un alignement phonétique
mot par mot. Le découpage linguistique destiné à UniDic ne crée pas d’horaires.
Un début observé au milieu d’un sous-titre sans piste reste une estimation ;
SubJap ne peut pas retrouver son début exact à partir du seul texte présent.
Sans chronologie complète, la navigation ne connaît pas les segments futurs :
`D` utilise un segment déjà observé, ou dépasse une fin connue pour reprendre
la lecture. Les correspondances de repli restent limitées aux pistes capturées.

Le catalogue consomme les fichiers tels que les parseurs actuels les exposent.
Il n’invente pas de règle d’assemblage pour d’éventuels fichiers partiels sans
métadonnées de séquence. Les garanties de sélection et d’identité ne remplacent
pas la vérification du comportement du lecteur Netflix réel.
