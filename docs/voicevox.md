# VOICEVOX local pour SubJap

SubJap utilise VOICEVOX localement pour remplir le champ Migaku `AudioMot`.
Le son de phrase, lorsqu'il est disponible, vient directement du lecteur vidéo
et remplit `AudioPhrase`.

## Installation initiale Windows

1. Relever l'identifiant de l'extension dans `chrome://extensions` (mode
   développeur).
2. Exécuter depuis la racine du dépôt :

```powershell
.\scripts\install-voicevox-host.ps1 -ExtensionId "IDENTIFIANT_EXTENSION"
```

Le script télécharge automatiquement la dernière version CPU officielle de
VOICEVOX si elle n'est pas déjà installée, l'installe silencieusement, puis
enregistre le helper Native Messaging. Pour imposer un chemin déjà installé :

```powershell
.\scripts\install-voicevox-host.ps1 `
  -ExtensionId "IDENTIFIANT_EXTENSION" `
  -VoicevoxPath "C:\chemin\vers\VOICEVOX.exe"
```

Après cette installation, l'extension démarre automatiquement VOICEVOX quand
elle doit produire un audio. La synthèse s'exécute localement, sans service
TTS distant ni clé API ; Internet n'est utilisé par le script que pour le
téléchargement initial ou les mises à jour de VOICEVOX.

