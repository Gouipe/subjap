---
target: nouvel état Anki
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-09-03T17-42-06Z
slug: src-background-anki-presentation-ts
---
# Critique du nouvel état Anki

## Santé du design

| # | Heuristique | Score | Constat |
|---|---|---:|---|
| 1 | Visibilité de l’état système | 3/4 | La traduction indique « Masquer » ; les états de révision restent natifs Anki. |
| 2 | Correspondance système / monde réel | 4/4 | Le parcours d’une carte de langue est naturel et les audios sont nommés. |
| 3 | Contrôle et liberté | 3/4 | La traduction est réversible ; la notation et la production restent sans annulation visible. |
| 4 | Cohérence et standards | 3/4 | DA cohérente ; les boutons audio gardent une saillance forte. |
| 5 | Prévention des erreurs | 2/4 | Peu d’aide avant la notation ; les étoiles restent ambiguës. |
| 6 | Reconnaissance plutôt que rappel | 3/4 | Les sections sont explicites ; étoiles et critères de notation ne le sont pas. |
| 7 | Flexibilité et efficacité | 2/4 | Les raccourcis Anki ne sont pas exposés par SubJap. |
| 8 | Esthétique et minimalisme | 3/4 | Rendu calme et éditorial ; la seconde moitié est dense et l’image lumineuse. |
| 9 | Diagnostic et récupération | 2/4 | Peu de récupération visible dans la carte elle-même. |
| 10 | Aide et documentation | 2/4 | Les libellés aident, mais les étoiles et la notation restent sans contexte. |
| **Total** |  | **27/40** | **Acceptable — nette amélioration, dernière passe de densité recommandée.** |

## Verdict anti-patterns

Le rendu ne ressemble pas à une production IA générique. La palette, les surfaces plates et le vermillon parcimonieux rendent bien « L’Après-séance ». Les seuls éléments génériques sont l’empilement de panneaux bordés et la ligne d’étoiles, qui introduit une gamification peu expliquée.

Le détecteur Impeccable a trouvé 6 constats advisory `design-system-font-size` dans `src/background/anki-presentation.ts` (lignes 237, 305, 559, 565, 596 et 611) : plusieurs tailles intermédiaires — 15, 18, 19, 23 et 30 px — ne correspondent pas exactement aux tokens de `DESIGN.md`. C’est un signal de gouvernance typographique, pas un défaut bloquant ; visuellement, ces tailles sont raisonnables pour une carte dense.

La capture est native Anki : la barre grise du haut et le footer blanc du bas sont hors du contrôle de SubJap. Aucun overlay navigateur fiable n’a été produit.

## Impression générale

Oui, cet état est nettement meilleur. Les rôles « Mot » / « Phrase » sont compris, la traduction ouverte est élégante et l’image est enfin assez présente pour porter le souvenir de la scène. Je ne referais pas la direction artistique. Je ferais seulement une dernière passe pour que le bas de la carte ne soit pas visuellement sacrifié au footer natif.

## Ce qui fonctionne

- **Hiérarchie d’entrée réussie :** mot, furigana et phrase attirent le regard dans le bon ordre.
- **Audio clarifié :** les libellés textuels suppriment l’ambiguïté précédente.
- **Image mieux intégrée :** elle est entière, lumineuse et devient un vrai artefact mémoriel.
- **Traduction réversible :** « Masquer la traduction » est une excellente amélioration de contrôle.

## Problèmes prioritaires

### [P1] Le footer Anki coupe potentiellement les Notes

Dans cette capture, le panneau Notes descend sous la barre blanche de notation. L’utilisateur peut donc noter avant d’avoir lu toute l’explication. Il faut réserver une petite zone basse ou réduire légèrement la hauteur d’image pour garantir que la fin du bloc reste atteignable sans lutte.

Commande suggérée : `$impeccable layout`.

### [P2] L’image est maintenant peut-être un peu trop dominante

Le compromis est bien meilleur qu’avant, mais l’image lumineuse devient le pic visuel principal après la définition. Une hauteur maximale autour de 320–340 px préserverait sa présence tout en redonnant de l’air aux Notes.

Commande suggérée : `$impeccable layout`.

### [P2] Deux séparateurs encadrent trop fortement la traduction

Le trait supérieur de la traduction révélée et le séparateur qui suit créent une double rupture avant la définition. Une seule séparation suffirait et rendrait le flux plus cinématographique.

Commande suggérée : `$impeccable distill`.

### [P2] Les paliers typographiques restent légèrement ad hoc

Le détecteur relève 6 tailles hors tokens. Elles ne sont pas mauvaises, mais leur accumulation donne une sensation de réglage au cas par cas. Il faut soit les rapprocher de l’échelle documentaire, soit documenter explicitement une échelle « Anki compact ».

Commande suggérée : `$impeccable typeset`.

### [P2] Les étoiles restent ambiguës

`★★★★★` ressemble à une note de difficulté, de fréquence ou de qualité sans libellé. Si elles sont importantes pédagogiquement, leur sens doit être explicite ; sinon elles devraient être visuellement secondaires.

Commande suggérée : `$impeccable clarify`.

## Red flags par persona

**Alex — power user** : peut devoir faire défiler pour finir les Notes ; l’image et les explications allongent la révision rapide.

**Jordan — débutant** : comprend les libellés audio, mais peut hésiter entre « Correct » et « Facile » et ne sait pas lire les étoiles.

**Sam — clavier/basse vision** : contraste global solide, mais aucune preuve de focus dans la capture ; le furigana et les petits labels restent fragiles au zoom.

## Observations mineures

- L’image est plus étroite que les panneaux, ce qui crée une respiration éditoriale intéressante ; il ne faut pas forcément la forcer à pleine largeur.
- La traduction anglaise au milieu d’une interface française peut faire hésiter sur la langue attendue.
- Les coins, bordures et couleurs respectent bien le système.
- Le footer et la navigation natifs d’Anki ne doivent pas être corrigés dans le CSS SubJap.

## Questions à considérer

- Le footer Anki est-il fixe ou le contenu peut-il défiler derrière lui ?
- Les étoiles mesurent-elles quelque chose que l’utilisateur doit réellement savoir pendant la révision ?
- Veux-tu conserver l’image comme pic émotionnel principal, ou faire remonter légèrement le mot avant la notation ?
