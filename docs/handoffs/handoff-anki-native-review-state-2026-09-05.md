# Handoff — état de connaissance Anki et compteur SubJap

Date : 2026-09-05

## Contexte

L’utilisateur étudie le deck Anki `日本語` et observe que le nombre de mots
connus affiché par SubJap ne semble pas augmenter malgré plusieurs jours de
révisions.

Le besoin exprimé est que SubJap augmente ce nombre lorsqu’Anki considère
qu’un mot comme acquis, avec l’hypothèse que l’état natif Anki `Révision`
corresponde à ce moment.

## Faits établis dans le code SubJap

- Les modèles de notes `Migaku Memory` et `Migaku Memory Import` possèdent un
  champ `Mot`, mais pas de champ d’état de connaissance.
- SubJap reconnaît les tags `KNOWN`, `LEARNING`, `UNKNOWN` et `IGNORED`.
- La synchronisation actuelle recherche les notes possédant `Mot` dans tous les
  decks et importe ces tags.
- Le compteur `Mots connus` compte les états locaux dont le statut est
  `known`.
- Les états natifs des cartes Anki (nouvelle, apprentissage, révision,
  réapprentissage, etc.) ne sont pas utilisés par le compteur actuel.
- Une révision Anki ne modifie donc pas, à elle seule, le tag `KNOWN`.
- La synchronisation automatique est déclenchée depuis le content script d’un
  onglet vidéo SubJap au chargement, au retour sur l’onglet et périodiquement.
  L’ouverture de la popup seule ne déclenche pas cette synchronisation.

Références :

- [`src/background/anki-known.ts`](../../src/background/anki-known.ts)
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts)
- [`src/background/anki-presentation.ts`](../../src/background/anki-presentation.ts)
- [`src/content/index.ts`](../../src/content/index.ts)

## État observé dans AnkiConnect

AnkiConnect est accessible et répond correctement.

Pour `日本語` et ses sous-decks :

- `日本語::Vocabulaire::Compréhension` : 268 notes et 268 cartes ;
- `日本語::Vocabulaire::Production` : 25 cartes ;
- 293 cartes au total dans l’arborescence ;
- 106 cartes ont au moins une répétition enregistrée ;
- 176 cartes sont nouvelles ;
- 11 cartes sont suspendues.

Dans les notes appartenant à cette arborescence :

- 13 tags `KNOWN` ;
- 2 tags `LEARNING` ;
- 127 tags `UNKNOWN` ;
- 2 tags `IGNORED` ;
- 124 notes `Migaku Memory` ne portent aucun de ces quatre tags d’état.

Le deck `Migaku Memory::Status` est distinct du deck `日本語` et ne constitue
pas le deck étudié concerné par la demande.

## Point fonctionnel restant à préciser

Définir précisément la relation souhaitée entre l’état natif Anki `Révision`
et l’état `connu` de SubJap, notamment lorsqu’une note possède plusieurs
cartes ou qu’une carte quitte ensuite l’état `Révision` après une réponse
incorrecte.

Aucune modification de code n’a été effectuée dans le cadre de ce handoff.
