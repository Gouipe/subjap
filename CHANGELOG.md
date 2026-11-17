# Nouveautés de SubJap

La popup de l'extension lit ce fichier : chaque ligne commençant par « - » sous
une catégorie est une nouveauté. Une ligne par changement, écrite pour la
personne qui utilise l'extension. Ne pas reformuler une ligne déjà publiée :
elle serait annoncée à nouveau.

## 2026-11-17

### Fonctionnalités

- Les expressions courantes comme 空気を読む, 気にする ou 手を出す sont reconnues dans les sous-titres, même conjuguées (空気を読めない) ou sans leur particule (空気読めない) : un seul mot cliquable avec sa propre définition, son statut et sa carte Anki, quel que soit le dictionnaire installé.
- Des mots courants que le découpage coupait en deux forment enfin un seul mot avec leur définition : 実は, 要は, 実際は, まずは, 恐らくは, 時には, 今では, いつかは, ちなみに, とっくに, 一気に, ainsi que 申し訳ない, もったいない et とんでもない, même conjugués (申し訳なかった) ou polis (申し訳ありません, とんでもございません).

### Corrections

- Les mots courants écrits en kana gardent leur vraie fréquence : いる, ある, こと, できる ou いい n'apparaissent plus comme des mots rares, et le tri des mots déjà connus ne les propose plus une seconde fois sous leur forme en kanji (居る, 事, 出来る).
- Les ordres en なさい restent attachés à leur verbe : 従いなさい, 休みなさいませ ou la forme orale 食べな forment un seul mot, rattaché à 従う, 休む ou 食べる, avec l'ordre expliqué dans la décomposition.
- 信じる, 感じる et 存じる ont enfin une fréquence : conjugués (信じられない, 感じさせる), ils apparaissaient comme des mots rares.
- La fréquence d'un mot en kanji dépend de sa lecture : 未だ lu いまだ n'est plus classé comme まだ (90ᵉ mot), et 中 dans 世界中 (ちゅう) ou 後 dans その後 (ご) ne prennent plus le rang de なか ou あと.
- Les mots d'emprunt comme テレビ, コーヒー ou バイト, et 君, marqués connus pendant une vidéo ne sont plus proposés à nouveau par le tri des mots connus, ni comptés deux fois parmi les mots connus.
- Un mot écrit en kana a la même fréquence que sous sa forme en kanji : きれい est classé comme 綺麗, et みつける, きづく ou いま ne passent plus pour des mots rares ou moins fréquents que 見つける, 気づく ou 今.

## 2026-11-14

### Fonctionnalités

- AniZone (anizone.to, lecteur Vidstack) fonctionne comme Re:ANIME : japonais et traduction du site chargés tout seuls, sous-titres du lecteur masqués, et japonais installé depuis Jimaku quand le site n'en propose pas.

## 2026-11-13

### Corrections

- La fréquence des mots vient d'une liste fiable (JPDB) : les verbes et adjectifs courants comme 見る, 起こす ou いい sont enfin classés parmi les mots fréquents. Le tri des mots déjà connus repart du début pour les proposer.
- Les messages affichés sur la vidéo disparaissent au bout de 6 secondes au lieu de 12.

## 2026-11-11

### Fonctionnalités

- Sur Netflix, une vidéo japonaise sans sous-titres japonais les installe depuis Jimaku, comme sur Re:ANIME.
- Sur Netflix, une vidéo japonaise sans traduction française ni anglaise en installe une depuis OpenSubtitles, avec une clé gratuite à saisir dans Options › Traductions.
- Sur Re:ANIME, les sous-titres japonais du site se recalent automatiquement sur la traduction, comme ceux de Jimaku, même quand l'épisode est monté différemment.

### Corrections

- Le pointillé sous les mots en cours d'apprentissage reste visible sur une image claire.
- Un japonais Jimaku ou Re:ANIME légèrement en retard sur la traduction est désormais avancé sur elle, au lieu de retarder la traduction ; une traduction OpenSubtitles légèrement en avance est de même recalée sur le japonais.

## 2026-11-10

### Corrections

- Sur Re:ANIME, la touche C copie de nouveau le sous-titre japonais.

## 2026-11-09

### Corrections

- Sécurité renforcée : un site ou un fichier de sous-titres piégé ne peut plus glisser de code dans vos cartes Anki ni déclencher les actions réservées à la popup et aux Options.
- Sur les lecteurs intégrés (Re:ANIME), le plein écran occupe de nouveau tout l'écran quand on change d'épisode après une mise à jour de SubJap.

## 2026-11-06

### Fonctionnalités

- Vos mots Connu/Ignorer, le tri des mots fréquents et l'affichage se synchronisent entre vos PC via votre compte Google ; les mots déjà marqués sont conservés.
- Options › Données : « Réinitialiser ce PC » récupère vos décisions depuis le compte Google, « Tout effacer » les efface aussi sur vos autres PC.
- La popup signale quand une mise à jour est disponible et présente les nouveautés après chaque mise à jour.
- Mise à jour en un double-clic avec `mettre-a-jour.cmd`, à la racine du dossier de SubJap.
- Bouton « Mettre à jour » dans la popup : SubJap se met à jour et se recharge tout seul.
- Installation en une ligne PowerShell, Git et Node.js compris (voir le README).
- Réglage « Pause à la fin » : la vidéo s'arrête à la fin d'une phrase connue masquée ; X la révèle, S la rejoue.
- « Pause à la fin » : choisissez à partir de combien de mots (1 à 10) une phrase masquée s'arrête, dans la popup ou les Options.
- Un petit signe pause dans le coin d'une phrase floutée annonce que la vidéo s'arrêtera à sa fin.
- Les noms de locuteurs et les bruitages entre parenthèses n'apparaissent plus dans les sous-titres japonais.

### Corrections

- La popup repère une nouvelle version en 10 minutes au plus, au lieu d'une heure.
- Le premier mot mis de côté juste après l'activation de l'audio de l'onglet est bien enregistré avec sa phrase.
- La fenêtre de minage et la popover de mot gardent leurs barres de défilement, quel que soit le site.

### Refonte

- Popup réorganisée : les cartes mises de côté en tête, l'interrupteur dans l'en-tête, pistes et décalages regroupés.
- Options en sections classées par usage, avec un sommaire qui suit la lecture.
- Popover de mot : Miner et Plus tard en premier, états Connu et Ignoré plus lisibles.

## 2026-11-05

### Fonctionnalités

- Phrases connues masquées : la couche suivante est floutée sur une bande sombre au lieu d'être effacée.

### Corrections

- Re:ANIME : le japonais ne recouvre plus les sous-titres anglais des épisodes Blu-ray.
