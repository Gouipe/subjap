---
name: pousser
description: Publier les commits locaux de SubJap sur GitHub (git push) après avoir vérifié CHANGELOG.md et demandé une dernière confirmation à l'utilisateur. À utiliser quand il dit « pousse », « push », « publie », « mets en ligne » ou /pousser.
---

# Pousser SubJap

Pousser sur `origin/master` publie la version : la popup des personnes qui ont
l'extension compare son `CHANGELOG.md` à celui de GitHub et annonce la mise à
jour dans les **10 minutes environ** (cache de raw.githubusercontent.com
≈ 5 min + vérification toutes les 10 min). « Mettre à jour » l'installe.
Seules les **lignes nouvelles** du journal déclenchent l'annonce.

Ne jamais forcer (`--force`), ne jamais pousser une autre branche.

## 1. État du dépôt

```bash
git fetch origin
git status -sb                       # branche master, arbre propre
git log --oneline origin/master..HEAD
```

- Rien en avance : le dire et s'arrêter.
- Arbre non propre ou en retard sur `origin` : le signaler et s'arrêter.
- `npx tsc --noEmit` et `npm run build` doivent passer.

## 2. Vérifier le journal

```bash
git diff origin/master -- CHANGELOG.md
git log --format='%h %s%n%b' origin/master..HEAD
```

Contrôler, et corriger avant de demander (les lignes non poussées se
corrigent librement, voir `AGENTS.md` › Journal des nouveautés) :

- **Aucune ligne publiée modifiée ni retirée** (une ligne `-` du diff sur un
  item) : elle serait annoncée de nouveau. La rétablir.
- **Chaque changement visible des commits a sa ligne**, sous la date du jour
  (`## AAAA-MM-JJ`), dans `### Fonctionnalités`, `### Corrections` ou
  `### Refonte`, courte, en français, écrite pour l'utilisatrice.
- **Les lignes décrivent l'état final** : pas de ligne pour un essai annulé,
  pas deux lignes pour le même changement retouché.
- **Aucune ligne nouvelle** (que des commits `[sans changelog]`) : la mise à
  jour ne sera pas annoncée dans la popup. Le dire.

Toute correction se commite (modifier `CHANGELOG.md` dans une commande
séparée avant `git commit`, le hook lit l'état d'avant la commande).

## 3. Dernière confirmation

Résumer brièvement :
- les commits qui partent ;
- les lignes exactes que la popup annoncera, par catégorie ;
- les avertissements éventuels (pas d'annonce, ligne corrigée…).

Puis demander avec AskUserQuestion, une seule question :

- **Pousser maintenant** — les personnes qui ont l'extension
  verront la mise à jour dans les 10 minutes environ.
- **Je teste encore** — rien n'est poussé ; rappeler : recharger l'extension,
  **puis** rafraîchir la page de la vidéo.

## 4. Pousser

Seulement après « Pousser maintenant » :

```bash
git push origin master
git status -sb    # doit afficher master...origin/master sans « ahead »
```

Annoncer ce qui est parti et ce que la popup affichera.
