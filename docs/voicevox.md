# VOICEVOX local pour SubJap

SubJap utilise VOICEVOX localement pour remplir le champ Migaku `AudioMot`.
Le son de phrase, lorsqu'il est disponible, vient directement du lecteur vidéo
et remplit `AudioPhrase`.

## Installation initiale Windows

1. Installer VOICEVOX depuis son site officiel et le lancer une première fois.
2. Relever l'identifiant de l'extension dans `chrome://extensions` (mode
   développeur), puis exécuter depuis la racine du dépôt :

```powershell
.\scripts\install-voicevox-host.ps1 -ExtensionId "IDENTIFIANT_EXTENSION"
```

Si VOICEVOX est installé dans un emplacement inhabituel :

```powershell
.\scripts\install-voicevox-host.ps1 `
  -ExtensionId "IDENTIFIANT_EXTENSION" `
  -VoicevoxPath "C:\chemin\vers\VOICEVOX.exe"
```

Après cette installation, l'extension démarre automatiquement VOICEVOX quand
elle doit produire un audio. Aucun service Internet ni clé API n'est utilisé.

