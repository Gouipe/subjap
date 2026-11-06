# Nouveautés de SubJap

La popup de l'extension lit ce fichier : chaque ligne commençant par « - » sous
une catégorie est une nouveauté. Une ligne par changement, écrite pour la
personne qui utilise l'extension. Ne pas reformuler une ligne déjà publiée :
elle serait annoncée à nouveau.

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
