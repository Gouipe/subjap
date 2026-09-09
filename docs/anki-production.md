# Cartes Anki de production orale

Ce document décrit le contrat fonctionnel des cartes de production orale et
leur articulation avec les cartes de compréhension. Les détails de présentation
communs restent décrits dans [`anki-card-formatting.md`](anki-card-formatting.md).

## Objectif pédagogique

La carte de production entraîne le rappel oral indicé d’un mot japonais déjà
maîtrisé en compréhension. Elle demande de retrouver le mot japonais à partir de ses
définitions et de le prononcer à voix haute. Elle ne remplace
ni la carte de compréhension, ni une pratique de conversation libre.

La production est volontairement sélective : l’utilisateur l’active uniquement
pour le vocabulaire qu’il souhaite rendre disponible à l’oral. Un intervalle de
compréhension d’environ trois semaines constitue un bon repère, sans être une
condition bloquante.

## Organisation des decks

Les cartes restent sœurs dans une note unique, mais sont rangées dans deux
sous-decks :

```text
日本語::Vocabulaire
├── Compréhension
└── Production
```

Le parent permet une session unifiée. Le sous-deck `Production` permet une
session dédiée lorsque l’utilisateur peut réellement parler à voix haute.
Chaque sous-deck reçoit un preset distinct. Les deux presets activent
l’enfouissement des nouvelles cartes sœurs, des cartes sœurs en révision et des
cartes sœurs en apprentissage interjour. Le preset Production limite les
nouvelles cartes à cinq par jour et utilise un seuil de sangsue plus tolérant.

## Activation et première révision

Le verso de la carte de compréhension propose **Activer la production orale**.
Cette action :

1. renseigne le champ technique `Production` avec la date d’activation ;
2. génère la carte sœur conditionnelle ;
3. la place dans `日本語::Vocabulaire::Production` ;
4. la suspend pendant deux jours complets ;
5. la libère ensuite comme nouvelle carte, sans court-circuiter ses étapes
   d’apprentissage.

La carte de compréhension reste active et conserve sa propre planification.
Une fois la production libérée, le champ `Production` prend la valeur `active`.
SubJap ne réactive pas automatiquement une production suspendue plus tard comme
sangsue ou par choix de l’utilisateur.

Le bouton dépend d’Anki Desktop et d’AnkiConnect. L’activation ne dépend plus
de la phrase : elle reste disponible si la phrase est vide, si le mot n’y est
pas repéré, si son écriture diffère ou s’il apparaît plusieurs fois.

Pour en faire bénéficier les cartes existantes, recharger l’extension compilée,
puis utiliser **Configurer les decks Anki** et rouvrir la carte dans Anki.
Les personnalisations des modèles gérés, notamment HyperTTS, sont conservées.

## Recto de production

Le recto contient :

1. la consigne **Retrouve le mot japonais et prononce-le à voix haute** ;
2. les définitions du mot, affichées directement.

La phrase d’exemple n’apparaît pas au recto. Il ne contient ni traduction de
phrase, ni image, ni audio, ni champ Mot ou Lecture. Le contenu du champ
Définitions est conservé tel quel, y compris le japonais qu’il peut contenir.

## Verso de production

Le verso reprend exactement la présentation de la carte de compréhension, sans
son bloc d’activation de la production : mot, phrase complète, boutons audio,
traduction repliée, définitions, image et notes disponibles. Il n’affiche aucune
consigne ni règle de notation.

L’accent de hauteur ne fait pas partie de la notation dans cette première
version.

## Règles de notation conseillées

| Réponse | Critère |
| --- | --- |
| À revoir | mot absent ou faux, lecture fausse, réponse obtenue seulement après le verso |
| Difficile | hésitation nette, synonyme valide ou prononciation imparfaite |
| Bon | mot attendu et lecture correcte, retrouvés en quelques secondes à partir des définitions |
| Facile | réponse immédiate et fluide |

La réponse doit être prononcée à voix haute. Une carte de production devenue
sangsue est suspendue sans affecter sa sœur de compréhension ; elle peut être
retravaillée par l’écoute et le shadowing avant une réactivation manuelle.
