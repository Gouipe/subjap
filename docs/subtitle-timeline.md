# Sous-titres : segments et chronologie commune

## Contrat utilisateur

Un segment de la piste japonaise est un bloc SubJap. Le texte et les horaires
de ce segment servent à l’affichage, aux raccourcis et au mining.
Les retours à la ligne ne créent pas de nouvelles positions dans la vidéo.
Une phrase répartie entre plusieurs segments reste répartie entre plusieurs
sous-titres ; SubJap ne reconstruit pas automatiquement une phrase complète.

Les pistes japonaise et de traduction gardent leurs propres horaires. Chaque
segment japonais est affiché avec sa propre traduction : celle qu’il recouvre
le plus dans le temps. Les traductions commencent souvent un peu avant la voix,
que suit le japonais : une fois par piste japonaise, l’avance de la
traduction du lecteur (au plus 2 s) est mesurée sur l’épisode, tel qu’affiché,
et devient son décalage, visible et modifiable dans le popup. Choisir un autre
fichier japonais (import, autre fichier Jimaku) relance la mesure, depuis les
horaires d’origine de la traduction. Un décalage de traduction
réglé par l’utilisateur n’est jamais remplacé ; une traduction importée garde
ses horaires. La synchronisation d’un fichier japonais importé compare ses
horaires à ceux de la traduction affichée, décalage compris. Une traduction
qui commence vers la fin d’un segment japonais précédent encore affiché (elle
en couvre moins de la moitié), mais qui appartient à un segment à venir,
attend le début de celui-ci ; la traduction précédente reste affichée en
attendant. Une traduction qui couvre au moins la moitié d’un segment le
traduit aussi et apparaît dès son début, sauf si une autre traduction doit
apparaître avant elle pendant ce segment. Une
traduction qui se termine avant le segment japonais qu’elle accompagne reste
affichée jusqu’à la fin de ce segment ou jusqu’à la traduction suivante, pour
que la ligne japonaise ne descende pas brièvement à sa place. De même, une
traduction qui commence au plus 1 s après son segment japonais apparaît dès
ce segment, à la place de la traduction précédente, pour que la paire
apparaisse ensemble. À l’inverse,
lorsque le segment japonais commence après sa traduction ou se termine avant
elle, cette partie de la traduction n’est pas affichée seule : elle
apparaîtrait brièvement, notamment lorsqu’elle est masquée parce que tous les
mots sont connus. Une traduction déjà affichée avec un segment et qui couvre
aussi le segment suivant reste affichée pendant le silence entre les deux. Une
traduction est la contrepartie de segments japonais
lorsque ceux-ci (affichés avec elle ou connus de la timeline) couvrent au
moins la moitié de son intervalle ; un texte incrusté qui ne chevauche que
brièvement un dialogue reste affiché seul en dehors de celui-ci. Lorsque la
timeline japonaise ne provient que de l’historique DOM, qui ne connaît pas les
segments à venir, une traduction seule attend 300 ms avant d’être affichée.

Les segments qui se chevauchent sont affichés ensemble, chacun avec ses propres
tokens et bornes. Le mot cliqué appartient toujours à son segment pour le
mining.

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
après la sonde initiale. Le lecteur télécharge souvent la piste japonaise
active avant que son URL soit connue, et ne la retélécharge pas lorsque la
sonde la restaure : un fichier dont le contenu est japonais est alors attribué
à la piste japonaise sélectionnée (ou à restaurer après la sonde), seulement
s’il a été demandé pour l’épisode affiché. Le téléchargement par le service worker conserve
l’identité d’épisode et de piste dans son contexte de requête.

Au lancement, le lecteur peut exposer ses pistes avant leur identité
d’épisode, ou ignorer la piste de traduction sélectionnée par la sonde. La
sonde attend donc un état complet, puis recommence (quatre essais au plus,
espacés de 5, 10 puis 15 s) tant que la traduction n’a pas été capturée. Une
requête démarrée pendant la sonde lui reste attribuée même si sa réponse
arrive après le retour au japonais. Un échec du téléchargement par le service
worker est retenté trois fois.

Le catalogue utilise un seul fichier exploitable par piste sélectionnée. Une
représentation déjà sélectionnée reste stable pendant la session. Il ne
concatène pas les variantes japonais/CC ou plusieurs formats, et ne supprime
pas deux locuteurs parce que leurs horaires se chevauchent. Une réponse tardive
sans identité de piste ne peut pas effacer une identité déjà connue pour son URL.

Chaque segment transporte une provenance immuable : type de source, session,
piste, fichier, identifiant du segment source et précision du début. Les
instantanés publiés sont immuables. L’arrivée de meilleures données peut changer
la source active, mais ne modifie pas une phrase déjà figée dans le mining.

Certaines pistes japonaises officielles sont minutées pour une autre cadence
que la vidéo (24 ↔ 23,976 ou 25 i/s) : elles dérivent linéairement, d’environ
1 s toutes les 17 min pour le rapport 1,001, et Netflix les affiche lui-même en
retard. La piste de traduction officielle (FR, sinon EN) sert alors de
référence : lorsqu’un de ces rapports aligne nettement plus de débuts de
segments que les horaires d’origine, les segments japonais sont recalés sur
elle, sans indication visible. Sans traduction chargée (préférence **Aucun**),
aucun recalage n’est possible. L’élection de piste par texte visible compare
toujours les horaires d’origine, ceux que le lecteur affiche.

Les fichiers locaux sont indépendants par rôle. La piste principale est
étiquetée japonais et remplace la piste japonaise native lorsqu’elle est
disponible ; son décalage est ajouté aux bornes de chaque cue. La piste
secondaire utilise le même calcul et est désactivée avec la préférence
**Aucun**. Les clés Netflix et YouTube existantes sont conservées pour préserver
les imports secondaires déjà mémorisés. Les autres pages utilisent une clé
dérivée de leur URL sans fragment ni paramètres de suivi.

L’adaptateur HTML5 générique publie les deux pistes locales selon l’horloge d’une
vidéo visible. Il ne capture pas le texte natif du lecteur ; les plateformes qui
ne rendent pas un élément `<video>` accessible nécessitent un adaptateur dédié.

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

Sur Netflix, une traduction active peut aussi être affichée seule lorsqu’aucune
cue japonaise n’est active. Elle garde ses propres horaires et ses réglages de
langue et de visibilité ; elle ne crée pas de cue japonaise pour la navigation
ou le mining. Les autres lecteurs n’affichent une traduction seule que
pendant le silence entre deux segments japonais qu’elle couvre.

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
les transitions du lecteur comme une lecture continue. Le seek Netflix est
asynchrone et atterrit souvent un peu avant la cible demandée : dès la demande,
et jusqu’à ce que le seek ait réellement eu lieu et que l’horloge vidéo ait
atteint la cible, l’adaptateur lit toutes les pistes (japonaise et traduction)
à la destination, pour que sa cue ne disparaisse pas brièvement derrière une
traduction seule. Plus généralement, tant que l’état japonais de la destination
n’est pas connu (seek en cours, attente du texte DOM historique), une
traduction n’est jamais publiée seule.
Sans piste officielle,
un retour vers un début historique connu réutilise cette observation et attend
son texte, avec un délai maximal.
Pendant cette attente, la cible historique n'est pas publiée comme sous-titre :
le lecteur doit effectivement réafficher le texte.

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
