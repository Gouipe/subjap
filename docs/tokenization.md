# Tokenisation des sous-titres japonais

## Contrat

Le pipeline conserve trois niveaux distincts : tokens morphologiques UniDic,
unités cliquables pédagogiques, puis entrée JMdict sélectionnée. Le moteur reste
Lindera + UniDic embarqué, dans le content script, avec son cache de phrases.

`tokenizeCue()` reçoit le texte déjà normalisé par `normalizeCueText()`. Les
surfaces retournées, concaténées, restituent ce texte avec ses espaces et ses
retours à la ligne. `startOffset` et `endOffset` sont des indices UTF-16 dans
cette cue normalisée, avec une fin exclusive ; ce ne sont pas les offsets
UTF-8 fournis par Lindera. Le convertisseur vérifie les offsets UTF-8 et
l'égalité des surfaces avec l'entrée, pas seulement leur longueur.

La segmentation analytique coupe aux ponctuations finales `。！？!?`, aux lignes
vides et avant les marqueurs explicites de locuteur en début de ligne. Elle ne
coupe ni aux points de suspension ni à une longueur fixe. Un retour visuel
simple est retiré uniquement du texte donné au moteur, puis réintroduit à sa
position d'origine ; les espaces restent des séparateurs. Les objets du cache
ne sont pas modifiés lors de cette restitution. L'ancien `splitIntoSentences()`
reste disponible pour le découpage de présentation.

Un groupe peut traverser un retour visuel. Ses fragments affichés partagent
le même token et le même index d'interaction. Le furigana d'un fragment n'est
affiché que si ses composants complets permettent de lui attribuer une lecture ;
la lecture du mot reste consultable dans la popover. La phrase Anki conserve les
retours via des `<br>` et le surlignage de toute la cible.

## Regroupements et grammaire

`非自立可能` désigne une possibilité d'emploi auxiliaire, pas un rôle syntaxique
déjà décidé par UniDic. Ces verbes peuvent donc démarrer un groupe conjugué.
Le rattachement comme auxiliaire nécessite le contexte de liaison `て` / `で`
et une identité lexicale autorisée, ou une contraction reconnue.

Les familles gérées comprennent les chaînes verbales, les adjectifs en `い`,
les adjectifs `形状詞` avec copule et les copules négatives, polies ou passées.
Les noms précédant un verbe en `する` restent séparés. Les particules intercalées
ne sont pas absorbées arbitrairement. Les pluriels restent conditionnés au POS
de suffixe.

Après le regroupement morphologique, le content script cherche aussi les suites
contiguës de noms, préfixes et suffixes nominaux, jusqu'à quatre morphèmes. Une
recherche groupée dans le JMdict installé ne fusionne que les suites dont
l'écriture combinée est une graphie exacte et dont la lecture concaténée
correspond à une lecture de l'entrée. Une seule alternance de rendaku est admise
au début d'un morphème suivant. En cas de chevauchement, la plus longue suite
est retenue depuis la gauche ; le POS et la lecture départagent les homonymes.
Les composants restent disponibles dans la popover, tandis que l'identité, le
statut connu et le mining utilisent la tête JMdict. Le rang de fréquence est
recherché sous cette tête et reste absent si elle n'existe pas dans la liste.
La popover montre la décomposition, mais le composé fusionné reste l'unique
cible interactive. Sans entrée exacte ou sans pack JMdict installé, les tokens
restent séparés. Les correspondances trouvées sont conservées en cache dans le
content script. Ce cache est invalidé et la cue réaffichée lorsqu'un nouveau
pack est installé.

`components` conserve les morphèmes. `grammar` décrit négation, passé/accompli,
politesse, souhait, causatif, liaison ou auxiliaire. La popover montre ces
informations et la décomposition. Pour les formes fléchies, le statut connu et
le mining restent attachés au mot de base ; pour les composés reconnus, ils
utilisent la tête JMdict. Les expressions grammaticales sans tête lexicale
unique conservent leur propre surface comme identité ; marquées `grammarOnly`,
elles sont ignorées par défaut tant qu'aucun statut n'est enregistré. Toutes les graphies d'un
même lexème (すごい, 凄い, スゴイ) partagent un statut : la recherche réunit
leurs formes, si bien qu'un mot importé d'Anki sous l'une d'elles vaut pour
toutes.

`reading` décrit la surface ; `dictionaryReading` conserve la prononciation de
base fournie par UniDic. Le champ `reading` de Lindera est la lecture du
lexème (じゃ → ダ, 選ん → エラブ) : il ne sert qu'aux termes de recherche. Les
deux lectures sont dérivées des formes phonologiques, qui suivent le morphème
réel (来 → き, 本 → ぽん), en rétablissant l'orthographe kana des voyelles
longues et de ぢ/づ d'après la lecture du lexème. Une surface en kana est sa
propre lecture. Pour un composé, la lecture JMdict qui correspond à la
lecture combinée des morphèmes est préférée. La popover et le mining utilisent
ainsi une lecture de lemme plutôt que celle d'une chaîne conjuguée.

## Sélection dictionnaire

La recherche examine toutes les formes orthographiques candidates avant tout
repli phonétique, y compris lorsque l'index mémoire ne trouve qu'une lecture
et que le dictionnaire persistant possède une écriture exacte. Dans chaque
niveau, le POS du mot de base et sa lecture départagent les entrées ; l'ordre
des formes et l'indicateur de vocabulaire courant servent de critères
supplémentaires. Le classement est partagé entre mémoire et service worker.

Les nouveaux imports JMdict conservent `spellings`, `readings` et les POS de
tous les sens. Les anciens packs fonctionnent sans réinstallation : les alias
kana d'une entrée à headword kanji sont traités comme lectures, faute de
métadonnées permettant de prouver qu'il s'agit d'une écriture. Réinstaller le
pack complète ces métadonnées, sans changer les statuts de vocabulaire.

## Limites

Il s'agit d'une analyse morphologique avec règles contextuelles locales, pas
d'une analyse sémantique complète. Les annotations de `れる` / `られる` laissent
explicite l'ambiguïté passif, potentiel ou honorifique. Les noms propres, formes
orales inhabituelles et changements de locuteur non marqués peuvent rester
ambigus. Le regroupement des composés ne considère que les suites nominales
contiguës de quatre morphèmes au maximum et ne désambiguïse pas le sens de la phrase.
Le classement JMdict n'applique pas non plus les restrictions entre chaque
écriture, lecture et sens. Le tokenizer Lindera reste synchrone ; les éventuels
composés candidats ajoutent une recherche JMdict groupée et asynchrone par cue.
