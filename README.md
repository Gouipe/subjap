# SubJap

Extension Chrome et Edge pour apprendre le japonais à partir des sous-titres
de vidéos. Elle affiche des sous-titres interactifs et permet d’envoyer des
cartes de vocabulaire dans Anki.

## Première installation

### Prérequis

- Chrome ou Edge sur ordinateur ;
- Node.js et npm pour compiler l’extension depuis le dépôt ;
- Anki Desktop et le module [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
  pour envoyer des cartes ;
- [HyperTTS](https://ankiweb.net/shared/info/111623432) dans Anki si tu veux
  entendre les mots japonais sur les cartes.

### Compiler et charger l’extension

Depuis le dossier du dépôt, dans PowerShell :

```powershell
npm.cmd ci
npm.cmd run build
```

Puis dans Chrome ou Edge :

1. Ouvrir `chrome://extensions` ou `edge://extensions`.
2. Activer le **Mode développeur**.
3. Cliquer sur **Charger l’extension non empaquetée** et choisir le dossier
   `dist` du dépôt.

Cette installation utilise le mode développeur. L’extension reste liée au
dossier `dist` : ne pas le déplacer après l’avoir chargée.

Pour passer à un autre dossier, par exemple d’un zip déjà compilé à son propre
build, cliquer à nouveau sur **Charger l’extension non empaquetée** et choisir
le nouveau dossier. L’extension garde le même identifiant, donc les mêmes
données. Ne pas cliquer sur **Supprimer** avant : la suppression efface les
données de SubJap.

### Configurer Anki et l’audio

1. Installer AnkiConnect depuis sa page AnkiWeb, puis redémarrer Anki et le
   laisser ouvert pendant l’utilisation de SubJap. Dans Anki, l’installation se
   fait depuis **Outils > Extensions > Obtenir des extensions**, avec le code
   `2055492159`.
2. Au premier lancement, SubJap ouvre ses options. Installer le dictionnaire,
   puis, à l’étape Anki, vérifier la connexion et laisser SubJap créer ses decks
   et son modèle de note. Le dictionnaire japonais fournit des définitions en
   anglais. Si Anki contient déjà des cartes Migaku, faire une sauvegarde avant
   cette configuration : SubJap peut organiser ces cartes dans ses decks.
3. Pour avoir l’audio du mot, installer HyperTTS dans Anki. Configurer une
   balise realtime sur le modèle `Migaku Memory` en utilisant le champ `Lecture`
   comme source. L’installation se fait aussi depuis **Outils > Extensions >
   Obtenir des extensions**, avec le code `111623432`. SubJap préserve les
   personnalisations HyperTTS du modèle.

AnkiConnect est nécessaire pour envoyer des cartes. HyperTTS est facultatif ;
SubJap crée les cartes sans audio du mot si HyperTTS n’est pas configuré.
L’audio de la phrase, lorsqu’il est disponible, est capturé depuis la vidéo.

## IA facultative

L’enrichissement IA demande un Worker Cloudflare configuré pour SubJap. Pour
compiler une version avec cette fonction, définir
`VITE_SUBJAP_AI_ENDPOINT` dans `.env.local` avec l’URL du Worker. Le modèle
Gemini reste configuré côté Worker ; ne jamais mettre sa clé API dans l’extension
ni dans le dépôt. Sans endpoint, le reste de SubJap fonctionne normalement.
Voir [`worker/README.md`](worker/README.md) pour déployer son propre Worker.

Lorsque l’utilisateur clique sur **Enrichir avec l’IA**, le mot, la phrase et
quelques exemples sont envoyés au Worker pour générer une note. L’enrichissement
est facultatif et ne bloque pas la création de cartes.

Le manifeste demande l’accès à tous les sites pour pouvoir capturer l’onglet ;
les scripts de sous-titres ne s’exécutent que sur les plateformes prises en
charge. La capture de l’image a lieu quand l’utilisateur mine un mot. Les états
de vocabulaire restent dans le navigateur et Anki local ; le texte n’est envoyé
au Worker que si l’utilisateur demande l’enrichissement IA.

## Mettre à jour

Pour récupérer la dernière version et la compiler en une fois, double-cliquer
sur `mettre-a-jour.cmd` à la racine du dépôt, ou lancer `npm.cmd run update`.
Le script fait un `git pull`, réinstalle les dépendances si elles ont changé,
compile, puis liste les nouveautés et les étapes de rechargement. Il s’arrête
sans rien écraser si des fichiers ont été modifiés localement, et signale
quand l’IA n’est pas configurée (pas de `.env.local`).
