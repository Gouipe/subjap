# Plan général d’implémentation : migration de la tokenisation japonaise vers UniDic

## Statut et portée

Ce document décrit le plan recommandé pour remplacer progressivement
Kuromoji/IPADIC par une analyse fondée sur UniDic, puis construire au-dessus
des unités pédagogiques adaptées à SubJap.

Il remplace la recommandation d’architecture de
[`proposition-rescoring-tokenisation-japonaise.md`](proposition-rescoring-tokenisation-japonaise.md).
Le rescoring lexical local de Kuromoji n’est plus la solution cible. Kuromoji
reste temporairement une baseline de comparaison et Sudachi mode B un
challenger de qualité.

Le plan ne constitue pas une autorisation pour implémenter toutes les phases en
une seule fois. Chaque phase doit avoir ses propres tests et un point de sortie
clair. Tout travail doit suivre les règles de `AGENTS.md`, notamment le worktree
isolé et l’utilisation obligatoire du skill `subjap-ux-harness` dès qu’un
changement touche le content script, l’overlay, la popover ou le mining.

## Décisions fonctionnelles déjà prises

- Lindera + UniDic est le candidat principal pour remplacer Kuromoji.
- Kuromoji sert de baseline pendant l’évaluation, puis doit disparaître de la
  version finale si UniDic est retenu.
- Sudachi mode B participe au benchmark, mais n’est pas l’intégration cible à
  ce stade.
- La sortie morphologique et l’unité cliquable sont deux niveaux distincts.
- En cas d’ambiguïté pédagogique, SubJap préfère laisser des unités séparées
  plutôt que de risquer une fusion abusive.
- Les groupes nominaux pluriels sont affichés comme une seule unité cliquable :
  `こいつら`, `生徒たち`, `子供たち`, etc.
- Les suffixes pluriels initialement couverts sont `ら`, `たち`, `ども` et
  `がた`, ainsi que leurs graphies kanji, uniquement quand l’analyse les
  identifie comme suffixes dans ce contexte.
- Le suffixe pluriel apparaît comme indication grammaticale dans la popover,
  sans être cliquable séparément.
- Le mot de base porte l’état connu et la recherche dictionnaire. La surface
  complète rencontrée reste visible et sert de forme de contexte pour le
  mining.
- Les variantes orthographiques d’un même lexème partagent un état connu.
  Ainsi `こいつ`, `コイツ` et `此奴` correspondent à une même identité
  interne.
- Le champ principal Anki conserve la forme de base naturelle correspondant à
  l’écriture rencontrée. Pour `こいつら`, il doit contenir `こいつ`, pas
  imposer `此奴`.
- Une petite couche de corrections anime, générale et testée, reste autorisée
  après UniDic. Elle ne doit pas devenir une collection de correctifs lexicaux
  arbitraires.
- UniDic est retenu si, après les corrections raisonnables, les améliorations
  observées sur le corpus sont plus nombreuses que les régressions. Des
  exceptions rares peuvent être tolérées si elles sont comprises, documentées
  et couvertes par un test.

## Architecture cible

```text
cue de sous-titre
  → normalisation prudente
  → segmentation en phrases
  → analyse morphologique Lindera + UniDic
  → corrections morphologiques anime ciblées
  → regroupements pédagogiques
  → résolution des variantes, du dictionnaire et de la fréquence
  → états connus
  → overlay / popover / mining
```

Les responsabilités doivent rester séparées :

1. **L’analyseur morphologique** détermine les frontières, le POS, la lecture,
   la forme de dictionnaire et l’identité lexicale.
2. **La couche de corrections** traite uniquement des familles d’erreurs
   démontrées par le corpus.
3. **Le regroupement pédagogique** décide ce qui constitue une unité cliquable
   sans effacer les composants morphologiques.
4. **Le résolveur lexical** choisit les termes de lookup et l’identité utilisée
   pour les états connus.
5. **L’UI et le mining** affichent la surface rencontrée tout en travaillant
   avec le mot de base approprié.

## Phase 1 — spike technique et benchmark reproductible

### Objectif

Vérifier la viabilité réelle de Lindera + UniDic dans l’extension et mesurer sa
qualité avant de migrer le pipeline de production.

### Travaux

- Identifier et épingler une version précise de Lindera/WASM et de son
  dictionnaire UniDic.
- Vérifier les licences, notices et conditions de redistribution des binaires
  et du dictionnaire.
- Réaliser un chargement minimal dans une extension MV3 construite avec Vite :
  import du WASM, chargement de l’asset, CSP `wasm-unsafe-eval`, initialisation
  et première tokenisation.
- Vérifier que le WASM fonctionne depuis le monde isolé du content script. Ne
  pas l’exposer au monde principal de la page.
- Créer un format de sortie de benchmark stable et diffable contenant au
  minimum : surface, forme de dictionnaire, lexème, lecture, POS et
  conjugaison.
- Constituer un corpus de 300 à 500 phrases authentiques de sous-titres
  d’anime : registre familier, contractions, katakana expressif, graphies
  mixtes, noms propres, verbes fléchis, onomatopées et phrases où Kuromoji est
  déjà correct.
- Produire les sorties de Kuromoji, Lindera/UniDic et Sudachi mode B. Sudachi
  peut rester un outil de benchmark hors navigateur ; il ne doit pas devenir
  une dépendance de production à ce stade.
- Faire annoter en priorité les phrases où les moteurs divergent, avec les
  catégories `amélioration`, `régression`, `différence neutre` et `ambigu`.
- Mesurer dans Chrome, pas seulement dans Node : taille installée, délai
  d’initialisation, première cue, temps moyen par phrase et mémoire d’un onglet
  Netflix.

### Porte de décision

Poursuivre la migration vers Lindera/UniDic si :

- les améliorations sont plus nombreuses que les régressions après application
  des corrections générales raisonnables ;
- les régressions systématiques ont une stratégie de correction crédible ;
- l’extension reste fluide pendant la lecture ;
- la mémoire est acceptable sur la machine cible de 16 Go.

Une exception rare ne bloque pas automatiquement la migration. Elle doit être
documentée avec sa phrase, son analyse attendue et la raison de son acceptation.

### Livrables

- script ou commande reproductible de benchmark ;
- corpus versionné lorsque les licences des sous-titres le permettent, sinon
  corpus synthétique minimal et procédure locale documentée ;
- rapport de comparaison synthétique ;
- mesures Chrome ;
- décision explicite de poursuivre ou non.

## Phase 2 — contrat de données indépendant du tokenizer

### Objectif

Éviter de remplacer une dépendance à IPADIC par une dépendance implicite à la
forme brute d’UniDic.

### Travaux

- Introduire un contrat interne d’analyse morphologique et un adaptateur par
  moteur pendant la transition.
- Ne plus faire porter toutes les responsabilités par le seul champ `lemma`.
  Le modèle doit pouvoir distinguer conceptuellement :
  - la surface rencontrée ;
  - la forme de dictionnaire naturelle ;
  - l’identité canonique interne du lexème ;
  - les formes alternatives de lookup ;
  - la lecture ;
  - le POS et la conjugaison ;
  - les composants morphologiques ;
  - les annotations grammaticales destinées à l’UI.
- Définir la conversion exacte des champs UniDic vers ce contrat. Porter une
  attention particulière aux offsets en octets retournés par certains bindings
  WASM et aux index UTF-16 utilisés par JavaScript.
- Garantir que la concaténation des surfaces reproduit exactement la phrase
  normalisée, ponctuation et graphies originales comprises.
- Ajouter des tests de contrat communs afin que les règles pédagogiques ne
  dépendent pas des objets bruts de Lindera.

### Exemple cible

La structure exacte reste à nommer pendant l’implémentation, mais elle doit
permettre de représenter l’intention suivante :

```ts
{
  surface: "こいつら",
  dictionaryForm: "こいつ",
  canonicalKey: "此奴",
  lookupTerms: ["こいつ", "此奴", "コイツ"],
  reading: "こいつら",
  components: [
    { surface: "こいつ", dictionaryForm: "こいつ", canonicalKey: "此奴" },
    { surface: "ら", dictionaryForm: "ら" }
  ],
  grammar: [
    { surface: "ら", kind: "plural-suffix" }
  ]
}
```

Ce schéma illustre les responsabilités ; il ne doit pas être copié sans vérifier
les conventions actuelles du projet et les besoins de sérialisation.

### Porte de sortie

- Les types partagés n’exposent plus une notion ambiguë de lemme pour les
  nouveaux chemins de code.
- Les adaptateurs Kuromoji et UniDic peuvent produire des données comparables
  pendant la transition.
- Les tests couvrent les variantes orthographiques et les formes fléchies.

## Phase 3 — intégration de Lindera/UniDic dans le pipeline

### Objectif

Faire fonctionner UniDic dans le pipeline réel sans encore supprimer Kuromoji.

### Travaux

- Charger Lindera/UniDic paresseusement lors de la première cue japonaise.
- Conserver une promesse singleton et un cache LRU des phrases, comme pour le
  tokenizer actuel.
- Fournir des erreurs explicites pour l’échec de chargement du WASM ou du
  dictionnaire ; ne jamais laisser l’overlay attendre silencieusement.
- Ajouter les assets nécessaires au manifeste et au build sans les rendre plus
  accessibles à la page que nécessaire.
- Intégrer un sélecteur interne de développement ou un mode de comparaison.
  Ne pas ajouter une option utilisateur permanente pour choisir le tokenizer.
- Journaliser les différences en développement sans télémétrie distante.
- Vérifier le comportement lors d’une navigation SPA, d’un rerender identique
  et de plusieurs cues successives.
- Commencer avec une instance par content script. Ne déplacer le tokenizer vers
  un contexte partagé/offscreen que si les mesures Chrome montrent un problème
  réel de duplication mémoire ou d’initialisation.

### Porte de sortie

- Une fixture peut rendre des cues produites par UniDic.
- Le cache évite les retokenisations répétées.
- Les erreurs de chargement sont visibles et récupérables.
- Les mesures restent compatibles avec une lecture fluide.

## Phase 4 — corrections morphologiques post-UniDic

### Objectif

Traiter les familles d’erreurs propres aux sous-titres sans recréer un moteur
de rescoring général.

### Travaux

- Rejouer les tests de la réparation actuelle des adjectifs en katakana sur
  UniDic. Supprimer ou adapter cette réparation selon les résultats réels.
- Créer une interface de transformation pure : entrée morphologique, sortie
  morphologique et trace de correction en mode développement.
- N’ajouter une correction que si elle :
  - correspond à une famille générale d’erreurs ;
  - possède des exemples positifs et des contre-exemples ;
  - conserve la surface originale ;
  - ne traverse ni phrase, ni retour à la ligne, ni ponctuation forte ;
  - laisse l’analyse choisie inspectable.
- Préférer l’absence de correction lorsque les preuves sont ambiguës.
- Ne pas introduire à cette phase de lexique JMdict compact, de rescoring
  Viterbi maison ou de fusion gloutonne par longueur.

### Porte de sortie

- Chaque correction correspond à une régression observée dans le corpus.
- Les anciennes corrections inutiles ont été retirées ou justifiées.
- La suite contient davantage de contre-exemples que de simples cas heureux.

## Phase 5 — regroupements pédagogiques

### Objectif

Transformer les tokens morphologiques corrects en unités d’apprentissage sans
perdre leurs composants.

### Travaux

- Porter les regroupements verbaux et grammaticaux actuels vers les catégories
  POS et de conjugaison d’UniDic.
- Implémenter une règle spécifique à la classe sémantique des suffixes pluriels,
  et non une règle générique `nom + suffixe`.
- Autoriser initialement :
  - `ら` et `等` quand la lecture et l’analyse correspondent au suffixe `ら` ;
  - `たち` et `達` ;
  - `ども` et `共` ;
  - `がた` et `方`.
- Exiger un composant de base nominal ou pronominal compatible et un composant
  suffixe identifié par UniDic.
- Ne pas englober automatiquement les suffixes honorifiques, dérivationnels ou
  nominaux tels que `さん`, `的`, `化`, `さ` ou `み`.
- Produire une seule unité cliquable dont :
  - la surface est la concaténation complète ;
  - la forme de dictionnaire utilisateur est celle du mot de base ;
  - l’identité canonique est celle du mot de base ;
  - les tokens morphologiques restent dans `components` ;
  - l’annotation `plural-suffix` est attachée à l’unité.
- Pour toute ambiguïté non résolue, conserver les tokens séparés.

### Cas minimums

```text
こいつ + ら → こいつら, dictionnaire こいつ
生徒 + たち → 生徒たち, dictionnaire 生徒
子供 + たち → 子供たち, dictionnaire 子供
彼 + ら → 彼ら, dictionnaire 彼
こいつ + らしい → reste こいつ / らしい
```

Ajouter aussi des exemples pour `ども` et `がた`, ainsi que des homographes qui
ne doivent pas être regroupés.

### Porte de sortie

- Les unités pédagogiques sont stables et explicables.
- Les composants morphologiques restent disponibles.
- Les règles existantes de verbes et de grammaire n’ont pas régressé.

## Phase 6 — dictionnaire, variantes, fréquence et états connus

### Objectif

Découpler l’identité lexicale interne de l’orthographe présentée à l’utilisateur
et préserver les données existantes.

### Travaux

- Construire une liste ordonnée de termes de lookup à partir de la forme de
  dictionnaire naturelle, de l’identité canonique, des variantes de surface et
  de la lecture.
- Résoudre les alias JMdict sans forcer son headword comme forme affichée.
- Faire partager un même état connu aux variantes d’un lexème.
- Définir une migration ou une compatibilité de lecture pour les `WordState`
  existants fondés sur les lemmes IPADIC. Ne pas perdre silencieusement les mots
  connus de l’utilisateur.
- Vérifier la synchronisation Anki : les notes existantes doivent être reconnues
  même si leur champ `Mot` utilise une autre graphie du même lexème.
- Adapter la fréquence afin qu’un lexème UniDic et ses variantes puissent
  retrouver les rangs de la liste de sous-titres disponible.
- Pour une unité plurielle, colorer et compter l’unité selon le mot de base.
- Pour le mining :
  - `targetWord` ou le champ principal Anki reçoit la forme de base naturelle ;
  - `targetSurface` conserve la forme complète rencontrée ;
  - la phrase conserve naturellement `こいつら`.

### Porte de sortie

- Marquer `こいつ` connu couvre aussi `コイツ` et `此奴`.
- Miner `こいつら` crée une carte ciblant `こいつ` et conservant `こいつら`
  dans le contexte.
- Les anciens états connus et la présence Anki restent fonctionnels après la
  migration.
- Les rangs de fréquence ne disparaissent pas à cause d’un changement de
  graphie canonique.

## Phase 7 — popover et UX grammaticale

### Objectif

Expliquer la différence entre la surface cliquée et le mot défini sans ajouter
de clic parasite.

### Travaux

- Afficher la définition du mot de base.
- Ajouter une indication grammaticale concise pour le suffixe pluriel, par
  exemple `ら — suffixe pluriel`.
- Ne pas rendre le suffixe cliquable séparément à l’intérieur de l’unité.
- Vérifier le hover, l’épinglage au clic, le bouton de mining et les changements
  de cue pendant un lookup asynchrone.
- Utiliser le skill `subjap-ux-harness` pour ajouter la fixture et les scénarios
  E2E correspondants.

### Porte de sortie

- La popover explique pourquoi `こいつら` affiche la définition de `こいつ`.
- Le suffixe ne crée pas de cible de clic imbriquée.
- Le mining reçoit les champs décidés à la phase précédente.
- Le re-render et la navigation SPA ne perdent ni groupe ni annotation.

## Phase 8 — validation complète et choix final

### Tests unitaires et d’intégration

- Conversion brute Lindera/UniDic vers le contrat interne.
- Lecture, POS, conjugaison, formes de dictionnaire et identité canonique.
- Offsets et conservation exacte des surfaces japonaises.
- Cache, singleton et échec de chargement.
- Corrections katakana et autres familles retenues.
- Regroupements verbaux existants adaptés à UniDic.
- Pluriels `ら`, `たち`, `ども`, `がた` et leurs graphies alternatives.
- Contre-exemples : `こいつらしい`, suffixes non pluriels, noms propres,
  inconnus et ponctuation.
- Lookup JMdict, alias, fréquence, états connus et migration.
- Mining avec mot de base et surface complète.

### Tests UX

Selon `subjap-ux-harness`, ajouter au minimum :

- la phrase `こいつらみたいな生徒たちを見捨てないでください` ;
- une phrase contenant `どいつら` ;
- des exemples `生徒たち`, `彼ら`, `ども` et `がた` ;
- `こいつらしい` comme non-régression ;
- une graphie katakana ;
- un rerender identique et un remplacement SPA.

Vérifier les surfaces rendues, les cibles de clic, la popover grammaticale, la
définition, l’état connu et les champs du mining.

### Mesures finales

- taille du build et de l’archive distribuée ;
- temps d’initialisation à froid et à chaud ;
- temps moyen et percentile élevé par phrase ;
- mémoire Chrome avec un onglet Netflix ;
- absence de saccade lors des changements rapides de cues ;
- bénéfice net sur le corpus après corrections.

### Décision

- **Si les améliorations sont plus nombreuses que les régressions** et que les
  performances sont acceptables, valider UniDic.
- Si Sudachi est nettement meilleur mais Lindera seulement marginalement
  meilleur que Kuromoji, documenter l’écart avant de décider d’investir dans un
  binding Sudachi navigateur.
- Si UniDic régresse sur une famille systématique non corrigeable, ne pas
  supprimer Kuromoji et réexaminer l’architecture.

## Phase 9 — bascule et nettoyage

Cette phase ne commence qu’après validation de la phase 8.

- Activer Lindera/UniDic comme unique tokenizer de production.
- Supprimer le sélecteur interne et le chemin Kuromoji de production.
- Retirer la dépendance `kuromoji`, ses types internes, ses dictionnaires
  `public/dict/` et les ressources manifest devenues inutiles.
- Supprimer les réparations IPADIC qui n’ont plus de raison d’être.
- Mettre à jour les documents d’architecture et de test.
- Conserver les snapshots et le rapport de benchmark comme justification de la
  migration.
- Exécuter l’ensemble des tests unitaires, le build et le harnais UX avant le
  merge final.

La version finale ne doit pas proposer un choix de tokenizer à l’utilisateur et
ne doit pas embarquer Kuromoji comme fallback silencieux. En cas d’échec de
chargement d’UniDic, elle doit échouer explicitement et de manière récupérable
plutôt que produire des états lexicaux incohérents.

## Ordre de livraison recommandé

Pour limiter les risques, privilégier plusieurs commits ou PR logiques dans le
même worktree de fonctionnalité :

1. benchmark et rapport ;
2. contrat indépendant du tokenizer ;
3. intégration Lindera derrière un mode interne ;
4. corrections et regroupements pédagogiques ;
5. identité lexicale, migration des états et mining ;
6. UX et harnais ;
7. bascule finale et suppression de Kuromoji.

Chaque étape doit garder la branche testable. La suppression de Kuromoji ne doit
jamais être mélangée au premier commit d’intégration UniDic.

## Définition de terminé

La migration est terminée lorsque :

- Lindera/UniDic est l’unique tokenizer distribué ;
- le benchmark démontre plus d’améliorations que de régressions ;
- les exceptions acceptées sont documentées et testées ;
- les unités plurielles sont cliquables comme un tout et expliquées dans la
  popover ;
- les variantes partagent leurs états connus sans imposer une orthographe
  inattendue dans Anki ;
- les données existantes de l’utilisateur sont préservées ;
- le dictionnaire, la fréquence et le mining utilisent les bonnes formes ;
- la lecture Netflix reste fluide sur la machine cible ;
- les tests unitaires, le build et les scénarios du harnais UX passent ;
- l’architecture et la documentation de test reflètent le pipeline final.
