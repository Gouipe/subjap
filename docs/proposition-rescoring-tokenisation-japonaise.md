# Proposition : rescoring conservateur de la tokenisation japonaise

> **Statut : proposition remplacée.** Après brainstorming, la solution cible
> est une migration évaluée vers Lindera + UniDic, suivie de corrections
> morphologiques ciblées et de regroupements pédagogiques. Voir
> [`plan-implementation-tokenisation-unidic.md`](plan-implementation-tokenisation-unidic.md).

## Contexte

SubJap utilise Kuromoji/IPADIC pour découper les sous-titres japonais avant de
les afficher comme unités interactives.

Sur la phrase :

```text
こいつらみたいな生徒たちを見捨てないでください
```

Kuromoji produit actuellement :

```text
こい / つら / みたい / な / 生徒 / たち / を / 見捨て / ない / で / ください
```

Alors que l’analyse locale de `こいつら` produit :

```text
こいつ / ら
```

L’analyse complète est donc influencée par le contexte et choisit une
segmentation morphologiquement possible mais pédagogiquement incorrecte :
`こい` est interprété comme l’adjectif « intense » et `つら` comme la forme
conjonctive de `つらい`, au lieu de reconnaître le pronom `こいつ` suivi du
suffixe pluriel `ら`.

Le problème ne doit pas être traité par une liste de corrections codées en dur
pour `こいつら`, `あいつら`, etc. Ces cas sont des symptômes d’un problème plus
général : le meilleur chemin Viterbi de Kuromoji n’est pas toujours le meilleur
chemin pour l’apprentissage.

## Objectif

Ajouter une seconde passe de segmentation, placée au-dessus de Kuromoji, qui :

- conserve Kuromoji comme analyse de base ;
- détecte les frontières localement suspectes ;
- évalue des segmentations alternatives dans des fenêtres courtes ;
- utilise un lexique et des contraintes grammaticales pour choisir une
  alternative seulement lorsqu’elle est nettement plus cohérente ;
- conserve les tokens morphologiques d’origine dans `components` ;
- ne modifie pas silencieusement les flexions verbales ou les particules ;
- reste suffisamment rapide pour être exécutée sur chaque cue de sous-titres.

## Décision recommandée

Mettre en place un **rescoring lexical local conservateur** plutôt qu’un
remplacement complet de Kuromoji.

Le pipeline deviendrait :

```text
cue
  → normalisation
  → segmentation en phrases
  → Kuromoji : analyse de base
  → détection de fenêtres suspectes
  → génération d’analyses alternatives
  → rescoring lexical et grammatical
  → choix de la meilleure analyse
  → regroupements pédagogiques existants
  → rendu overlay
```

Cette solution cible la cause générale sans introduire immédiatement un second
tokenizer japonais dans le bundle.

## Pourquoi une simple règle de fusion ne suffit pas

Une règle du type « fusionner deux noms voisins » serait trop dangereuse :

- `生徒 たち` pourrait être présenté comme `生徒たち`, mais `らしい` ne doit
  pas être traité de la même façon dans tous les contextes ;
- deux mots japonais peuvent être adjacents sans former une seule unité
  lexicale ;
- les noms propres et les mots inconnus peuvent produire des séquences
  arbitraires ;
- la longueur maximale ne garantit pas la bonne analyse ;
- une fusion erronée change le lemme utilisé pour les états connus, la
  définition et le mining.

La fusion doit donc être le résultat d’une comparaison entre plusieurs
analyses, pas une règle de rendu basée uniquement sur les surfaces.

## Architecture proposée

### 1. Analyse de base

Kuromoji continue de produire les tokens actuels. Aucun comportement existant
ne change si aucune alternative n’obtient un score suffisamment supérieur.

Chaque token conserve ses métadonnées actuelles : surface, lemme, lecture,
parties du discours et conjugaison.

### 2. Détection des frontières suspectes

Il est inutile de rescorrer toute la phrase. On ouvre une fenêtre autour des
frontières qui présentent au moins un signal de suspicion, par exemple :

- deux tokens adjacents dont les surfaces forment un candidat lexical connu ;
- une séquence de tokens dont l’analyse contient des catégories improbables
  dans le contexte suivant ;
- un token `形容詞` qui apparaît au milieu d’une chaîne normalement nominale ;
- un token connu dont la lecture ou le lemme est incompatible avec une entrée
  lexicale plus longue ;
- une frontière entre des tokens dont la retokenisation isolée donne une
  analyse structurellement différente.

La fenêtre peut être limitée à 2–8 tokens ou à environ 12 caractères japonais,
avec une marge configurable.

### 3. Génération des alternatives

Pour chaque fenêtre, générer plusieurs candidats :

1. l’analyse Kuromoji originale ;
2. la retokenisation de la sous-chaîne complète en isolation ;
3. les segmentations fournies par les entrées du lexique compact ;
4. les regroupements suffixe + base autorisés par des règles grammaticales
   explicites.

Dans le cas étudié :

```text
analyse globale : こい / つら
retokenisation locale de こいつら : こいつ / ら
unité pédagogique candidate : こいつら
```

La retokenisation locale ne garantit pas à elle seule l’unité finale. Elle
fournit une alternative morphologique préférable à l’analyse globale, qui peut
ensuite être regroupée selon les règles pédagogiques.

### 4. Scoring

Chaque candidat reçoit un score. L’implémentation exacte pourra évoluer, mais
le score doit prendre en compte au minimum :

- la présence d’un mot ou d’une séquence dans le lexique ;
- la fréquence ou le niveau de confiance de cette entrée ;
- la qualité des parties du discours ;
- la cohérence avec les tokens voisins ;
- la conservation des flexions et des particules ;
- la pénalité liée aux tokens inconnus ;
- une pénalité pour les changements par rapport à Kuromoji afin de rester
  conservateur.

Une forme conceptuelle du score :

```text
score =
    bonus_lexique
  + bonus_frequence
  + bonus_coherence_POS
  + bonus_analyse_locale
  - penalite_inconnu
  - penalite_changement
  - penalite_frontiere_sensible
```

Une alternative ne serait appliquée que si :

```text
score(alternative) >= score(original) + seuil_de_confiance
```

Le seuil doit être réglé pour privilégier les faux négatifs (laisser une
segmentation imparfaite) plutôt que les faux positifs (fusionner de mauvais
mots).

### 5. Choix global dans une fenêtre

Si plusieurs candidats se chevauchent, utiliser une petite programmation
dynamique sur la fenêtre plutôt qu’une succession de fusions gloutonnes.

Cela permet de comparer :

```text
A / B / C
A+B / C
A / B+C
A+B+C
```

et d’éviter qu’une première fusion locale empêche une meilleure segmentation
plus longue.

La programmation dynamique reste locale : il n’est pas nécessaire de
réimplémenter tout le Viterbi de Kuromoji pour la phrase entière.

## Lexique nécessaire

### Étape initiale : lexique compact

Le rescoring a besoin d’un accès rapide à un lexique dans le content script.
Le dictionnaire JMdict complet est actuellement exploité côté service worker,
donc il ne doit pas être interrogé par message pour chaque token.

Options possibles :

1. générer au build un index compact de surfaces/lectures utiles ;
2. embarquer uniquement les entrées fréquentes et les suffixes pertinents ;
3. charger un fichier lexique local une seule fois dans le content script ;
4. partager une version compacte du dictionnaire entre le service worker et le
   tokenizer.

La recommandation initiale est un index compact contenant :

- surface ;
- lemme ;
- lecture ;
- parties du discours ;
- fréquence ou rang ;
- indication de mot composé ou de suffixe.

### Étape ultérieure : JMdict complet

Une version plus ambitieuse pourrait utiliser un index JMdict complet. Elle
améliorerait la couverture, mais augmenterait :

- la taille du bundle ou le coût de chargement ;
- la complexité de synchronisation avec IndexedDB ;
- le nombre de candidats à scorer ;
- le risque de privilégier des entrées rares ou archaïques.

Cette étape ne devrait être envisagée qu’après mesure des erreurs restantes.

## Règles de sûreté

Le correcteur doit appliquer les garde-fous suivants :

- ne jamais fusionner une particule avec le mot précédent uniquement parce que
  la chaîne est connue ;
- ne jamais traverser une frontière de phrase ou de retour à la ligne ;
- ne pas modifier une flexion verbale déjà reconnue par les regroupements
  existants ;
- ne pas fusionner un candidat dont la seule preuve est sa longueur ;
- demander une preuve lexicale ou une analyse locale cohérente ;
- limiter la taille des fenêtres ;
- conserver l’analyse brute dans `components` ;
- désactiver la correction si son score est ambigu ;
- journaliser les corrections en mode développement pour faciliter les audits.

## Modèle de données

Le type `Token` existant peut rester compatible. Une unité corrigée pourrait
être représentée comme un token normal avec ses composants :

```ts
{
  surface: "こいつら",
  lemma: "こいつら", // ou "こいつ" selon la décision dictionnaire
  reading: "こいつら",
  partOfSpeech: ["名詞"],
  components: [
    { surface: "こいつ", lemma: "こいつ", ... },
    { surface: "ら", lemma: "ら", ... }
  ]
}
```

Le choix entre le lemme exact `こいつら` et le lemme `こいつ` + suffixe `ら`
doit être explicite. Il influence la recherche dictionnaire, les états connus,
la fréquence et les cartes de mining.

## Validation et tests

### Tests unitaires

Ajouter des tests pour :

- `こいつらみたいな生徒たちを見捨てないでください` ;
- `あいつら`, `そいつら`, `こいつらしい` ;
- `生徒たち`, `子供たち`, `彼ら` ;
- des séquences qui ne doivent pas être fusionnées ;
- des homographes où l’analyse Kuromoji initiale est correcte ;
- des mots inconnus et des noms propres ;
- des flexions verbales déjà couvertes par `groupTokens` ;
- le comportement lorsque le lexique est absent ou incomplet ;
- la stabilité du cache sur une phrase répétée.

### Tests d’intégration Kuromoji

Utiliser le dictionnaire IPADIC fourni avec Kuromoji pour vérifier les sorties
réelles, pas seulement des tokens fabriqués à la main.

Chaque test doit vérifier au minimum :

- les surfaces finales ;
- les lemmes utilisés pour le dictionnaire ;
- la lecture ;
- la présence correcte des `components`.

### Tests UX / fixture

Ajouter une phrase de fixture reproduisant le cas et vérifier que :

- l’overlay affiche `こいつら` comme unité interactive ;
- le clic/hover cible l’unité complète ;
- la popover utilise la clé dictionnaire attendue ;
- les autres tokens de la phrase restent séparés ;
- le re-render et le remplacement SPA ne perdent pas la correction.

Le scénario doit être couvert par Playwright conformément au skill
`subjap-ux-harness`.

### Mesure avant généralisation

Avant d’élargir le lexique, constituer un petit corpus de sous-titres japonais
et comparer :

- la sortie Kuromoji actuelle ;
- la sortie corrigée ;
- les corrections acceptées par un annotateur ;
- les fusions incorrectes ;
- le temps moyen de tokenisation ;
- le taux de cache.

Le critère principal ne doit pas être « plus de fusions », mais une baisse des
erreurs pédagogiquement gênantes sans hausse significative des faux positifs.

## Déploiement progressif

### Phase 1 — abstraction et observation

- introduire l’interface de correction ;
- produire les candidats sans les appliquer ;
- ajouter des logs de développement ;
- mesurer les cas détectés.

### Phase 2 — règles très conservatrices

- appliquer uniquement les alternatives avec preuve lexicale forte ;
- couvrir `こいつら` et les familles effectivement observées par le moteur ;
- ajouter les tests unitaires, d’intégration et fixture.

### Phase 3 — rescoring élargi

- ajouter les candidats JMdict fréquents ;
- calibrer les scores sur un corpus ;
- surveiller les faux positifs et la performance.

### Phase 4 — réévaluation du tokenizer

Si la couverture reste insuffisante, comparer la solution avec Sudachi/WASM ou
un tokenizer UniDic. Ce serait alors une décision séparée, car elle implique
une taille de bundle, un temps de chargement et une compatibilité navigateur
différents.

## Risques et mitigations

| Risque | Impact | Mitigation |
| --- | --- | --- |
| Fusion abusive de mots adjacents | Élevé pour le dictionnaire et le mining | Seuil de confiance, preuve lexicale, fenêtres courtes |
| Lemme incorrect | Élevé pour les états connus | Décision explicite sur le lemme, tests de lookup |
| Lexique trop lourd | Performance / taille du bundle | Index compact, chargement paresseux, entrées fréquentes |
| Ralentissement sur les cues | UX de lecture | Retokenisation locale, cache par sous-chaîne |
| Régression des verbes | Élevé | Ne pas traverser les zones de flexion, tests existants obligatoires |
| Variantes rares ou noms propres | Faux positifs | Favoriser fréquence et analyse Kuromoji locale |
| Désaccord sur l’unité pédagogique | Décisions incohérentes | Séparer token morphologique, unité affichée et clé dictionnaire |

## Alternatives écartées pour le moment

### Table de corrections codées en dur

Simple et peu risquée à court terme, mais mauvaise couverture et dette
permanente. Elle ne doit servir qu’à confirmer un diagnostic, pas d’architecture
finale.

### Fusion gloutonne par longueur maximale

Facile à coder, mais trop sujette aux faux positifs et aux entrées rares de
JMdict.

### Remplacement immédiat par Sudachi/WASM

Potentiellement plus cohérent pour le japonais moderne, mais changement lourd :
bundle, dictionnaire, chargement, performances, API et comportement à
réévaluer. À conserver comme piste si le rescoring ne suffit pas.

### Rescoring complet de la phrase

Théoriquement élégant, mais disproportionné pour le problème actuel. Une
réévaluation locale avec programmation dynamique fournit un meilleur rapport
couverture/complexité.

## Questions à trancher avant implémentation

1. Une unité comme `こいつら` doit-elle avoir le lemme exact `こいつら`, ou le
   lemme lexical `こいつ` avec `ら` comme suffixe ?
2. Le lexique compact doit-il être généré à partir de JMdict au build, ou
   chargé depuis un fichier local dans le content script ?
3. Quelle priorité donner aux unités pédagogiques par rapport aux frontières
   morphologiques de Kuromoji ?
4. Quel taux maximal de corrections ambiguës accepte-t-on sur le corpus de
   validation ?

## Conclusion

Le problème de `こいつら` est un bon cas de test, mais pas une bonne unité
d’architecture. La solution recommandée est une couche de rescoring lexical
local, conservatrice et réversible, qui laisse Kuromoji faire l’analyse
initiale tout en corrigeant les frontières manifestement défavorables à
l’apprentissage.

Cette approche a une complexité moyenne, un risque maîtrisable et permet de
mesurer progressivement la valeur réelle avant d’introduire un nouveau
tokenizer.
