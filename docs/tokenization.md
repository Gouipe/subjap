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

`components` conserve les morphèmes. `grammar` décrit négation, passé/accompli,
politesse, souhait, causatif, liaison ou auxiliaire. La popover montre ces
informations et la décomposition, mais le statut connu et la cible du mining
restent attachés au mot de base. Les expressions grammaticales sans tête
lexicale unique conservent leur propre surface comme identité.

`reading` décrit la surface ; `dictionaryReading` conserve la prononciation de
base fournie par UniDic. La popover et le mining préfèrent une lecture JMdict
compatible avec celle du mot de base, puis utilisent les données disponibles
en repli. Une chaîne conjuguée n'est donc pas utilisée comme lecture du lemme
lorsque sa lecture de base est disponible.

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
ambigus. Le classement JMdict n'effectue pas de désambiguïsation du sens de
toute la phrase, ni des restrictions entre chaque écriture, lecture et sens.
Le traitement reste synchrone ; aucun Worker ni changement de performance
n'est introduit par ces évolutions.
