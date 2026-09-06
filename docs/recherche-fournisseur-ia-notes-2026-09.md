# Recherche : remplacer Gemini Nano pour l’enrichissement des Notes

**Date : 6 septembre 2026**

## Verdict

Je recommande **Gemini 3.1 Flash-Lite**, appelé depuis un petit endpoint serveur, avec une sortie JSON structurée.

Pour la migration effectivement retenue par SubJap, le modèle configuré dans le
Worker est finalement **Gemini 3.5 Flash-Lite** : il conserve le même contrat
JSON et la même validation locale, avec un compromis qualité/coût choisi pour
l’usage personnel du projet.

C’est actuellement le meilleur compromis pour SubJap :

- palier gratuit annoncé par Google pour les entrées et sorties textuelles ;
- modèle officiellement positionné pour les tâches fréquentes, simples et à faible latence ;
- sortie JSON contrainte compatible avec le schéma déjà utilisé par SubJap ;
- contexte suffisant pour la phrase, les définitions et les candidats connus ;
- coût payant très faible si le quota gratuit est dépassé : **0,25 $ / million de tokens en entrée et 1,50 $ / million en sortie**.

Le choix du modèle seul ne suffira pas à régler la lenteur actuelle : Nano doit aussi télécharger et charger un modèle local. Une API distante bien choisie devrait surtout améliorer le temps de démarrage et la qualité, au prix de l’envoi du texte à un service externe.

## Ce que le prompt de SubJap demande réellement

Le prompt actuel est un cas d’usage relativement léger, mais il demande de la précision :

1. comprendre une phrase japonaise et une définition française ;
2. proposer au maximum deux synonymes pertinents ;
3. sélectionner des exemples parmi une liste locale autorisée ;
4. donner le sens de chaque kanji ;
5. produire une association mnémotechnique qui cite tous les kanjis dans l’ordre ;
6. respecter un JSON strict ;
7. éventuellement effectuer une seconde requête pour réparer l’association.

Il faut donc privilégier un modèle multilingue avec **structured output / JSON Schema**, pas uniquement le nombre de tokens par seconde.

## Comparaison

| Solution | Coût | Rapidité attendue | JSON structuré | Qualité attendue pour SubJap | Avis |
|---|---:|---|---|---|---|
| **Gemini 3.1 Flash-Lite** | Gratuit sur le palier gratuit ; puis 0,25 $ / M tokens entrée et 1,50 $ / M sortie | Très bonne ; Google le décrit comme low-latency | Oui | Très bon compromis japonais/français pour ce prompt court | **Recommandé** |
| Gemini 3.5 Flash-Lite | Gratuit sur le palier gratuit ; puis 0,30 $ / M entrée et 2,50 $ / M sortie | Très bonne | Oui | Potentiellement meilleure qualité, mais plus cher | À tester si 3.1 reste limite |
| **Groq + GPT-OSS 20B** | 0,075 $ / M entrée et 0,30 $ / M sortie | Excellente ; Groq annonce environ 1 000 tokens/s | Oui, en mode strict | Probablement solide ; qualité japonaise à valider sur les associations de kanjis | Meilleur choix si la vitesse prime et qu’un petit coût est acceptable |
| Mistral Ministral 3 8B | 0,15 $ / M entrée et 0,15 $ / M sortie | Bonne selon l’infrastructure | Oui | Intéressant en français et déployable localement ; moins rassurant que Gemini sans essai sur le japonais | Bonne alternative indépendante |
| OpenRouter avec un modèle `:free` | Gratuit | Variable, parfois plus lente aux heures chargées | Oui pour les modèles compatibles | Variable, modèle et fournisseur pouvant changer | Bien pour un prototype, pas comme défaut stable |
| LM Studio/Ollama + Ministral 3 local | Gratuit après téléchargement du modèle | Très variable selon CPU/GPU/RAM ; rapide une fois chargé | Possible via une API locale | Dépend fortement du modèle et du matériel | Meilleure option confidentialité, pas la plus simple |

Sources officielles : [modèle Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [tarifs Gemini](https://ai.google.dev/gemini-api/docs/pricing), [sorties structurées Gemini](https://ai.google.dev/gemini-api/docs/structured-output), [modèles Groq](https://console.groq.com/docs/models), [sorties structurées Groq](https://console.groq.com/docs/structured-outputs), [tarifs Mistral](https://docs.mistral.ai/inference/pricing), [Ministral 3 3B](https://docs.mistral.ai/models/ministral-3-3b-25-12).

## Coût concret pour une utilisation personnelle

À titre d’ordre de grandeur, en supposant **1 000 tokens d’entrée et 400 tokens de sortie par requête**, et deux requêtes dans le pire cas — génération puis réparation de l’association — le coût serait environ :

| Modèle | Coût estimé pour une carte avec deux requêtes |
|---|---:|
| Gemini 3.1 Flash-Lite | 0,0017 $ |
| Groq GPT-OSS 20B | 0,00039 $ |
| Mistral Ministral 3 8B | 0,00024 $ |
| Gemini 3.5 Flash-Lite | 0,0026 $ |

Le calcul est indicatif : le nombre réel de tokens dépend de la phrase, des candidats connus et de la longueur de la réponse. Même hors quota gratuit, quelques centaines de cartes par mois coûteraient donc très peu.

## Analyse des options

### 1. Gemini 3.1 Flash-Lite — meilleur choix global

Google le positionne explicitement pour les tâches fréquentes et légères, la traduction, l’extraction structurée et les applications où le coût et la latence sont prioritaires. Il accepte les sorties structurées et le palier gratuit affiche les entrées et sorties comme gratuites.

Le point de vigilance est le quota exact : Google indique que les limites dépendent du projet et de son niveau d’utilisation, qu’elles sont visibles dans AI Studio et que la capacité réelle n’est pas garantie. Le texte du palier gratuit peut également être utilisé pour améliorer les produits Google ; cette politique change sur le palier payant.

### 2. Groq + GPT-OSS 20B — meilleur choix vitesse

Groq publie une vitesse d’environ **1 000 tokens/s** pour GPT-OSS 20B et propose un mode JSON Schema strict. C’est séduisant pour un bouton interactif : la réponse étant courte, le temps de génération devrait être négligeable par rapport au réseau.

En revanche, la documentation publiée ne permet pas de le classer comme solution gratuite durable. Il faut aussi garder en tête que la vitesse affichée est une vitesse de génération et non le temps total perçu : réseau, file d’attente, temps jusqu’au premier token et seconde requête s’ajoutent.

### 3. Mistral Ministral — meilleure piste locale indépendante

Ministral 3 est conçu pour le déploiement sur des appareils variés. La version 3B est disponible avec une licence Apache 2.0 et coûte 0,10 $ / million de tokens en entrée comme en sortie sur l’API Mistral ; la version 8B coûte 0,15 $ / million dans les deux sens.

En local via LM Studio, on peut conserver les phrases et le vocabulaire sur la machine et exposer une API compatible OpenAI avec JSON Schema. Cela supprime les coûts et la dépendance réseau, mais la vitesse dépend directement de la machine de l’utilisateur. La version 3B risque aussi d’être trop limitée pour les nuances japonaises ; je privilégierais 8B si la mémoire le permet.

### 4. OpenRouter gratuit — pratique mais trop instable comme solution principale

OpenRouter donne accès à des modèles gratuits et peut imposer un JSON Schema pour les modèles compatibles. En revanche, son offre gratuite est limitée à **50 requêtes par jour** sans achat de crédits, les modèles et fournisseurs disponibles peuvent varier, et la documentation prévient que la latence peut augmenter aux heures chargées.

Cela convient pour comparer rapidement plusieurs modèles, mais pas pour garantir une expérience régulière dans une extension que l’on utilise tous les jours.

## Attention à la clé API

Une extension Chrome distribuée ne doit pas embarquer une clé Gemini, Groq ou Mistral dans son JavaScript. Google indique explicitement qu’une clé côté client peut être extraite et utilisée par d’autres personnes, avec un risque de consommation de quota ou de facturation.

La bonne architecture serait :

```text
Extension SubJap
        │  phrase + mot + candidats
        ▼
Petit endpoint personnel sécurisé
        │  clé conservée côté serveur
        ▼
Gemini 3.1 Flash-Lite
```

Pour un usage strictement personnel, une clé saisie par l’utilisateur et conservée localement peut servir de prototype, mais ce n’est pas une solution distribuable et la clé reste récupérable dans les requêtes du navigateur.

Source : [recommandations officielles de Google sur la sécurité des clés Gemini](https://ai.google.dev/gemini-api/docs/api-key).

## Recommandation finale

Je recommande cette stratégie en deux temps :

1. **Prototype rapide : Gemini 3.1 Flash-Lite**, avec le schéma JSON actuel et une limite de sortie basse. Mesurer le temps jusqu’à l’affichage et vérifier une vingtaine de mots difficiles, notamment les associations de kanjis.
2. **Version durable : endpoint serveur minimal**, avec la clé protégée, un timeout d’environ 8 à 10 secondes, validation locale conservée et repli éventuel vers Gemini 3.5 Flash-Lite ou Groq.

Si la priorité absolue est de ne rien envoyer à l’extérieur, je choisirais **LM Studio + Ministral 3 8B** plutôt que Nano. Si la priorité absolue est la latence et qu’un coût minuscule est acceptable, je testerais **Groq + GPT-OSS 20B**. Pour l’équilibre demandé — gratuit dans l’idéal, rapide et meilleur que Nano — **Gemini 3.1 Flash-Lite est le candidat le plus convaincant**.

## Sources consultées

- [Google — modèles Gemini](https://ai.google.dev/gemini-api/docs/models)
- [Google — Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Google — tarifs Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing)
- [Google — limites de débit Gemini](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Google — sorties structurées](https://ai.google.dev/gemini-api/docs/structured-output)
- [Google — sécurité des clés API](https://ai.google.dev/gemini-api/docs/api-key)
- [Groq — modèles disponibles et vitesses publiées](https://console.groq.com/docs/models)
- [Groq — sorties structurées JSON Schema](https://console.groq.com/docs/structured-outputs)
- [Mistral — tarifs d’inférence](https://docs.mistral.ai/inference/pricing)
- [Mistral — Ministral 3 3B](https://docs.mistral.ai/models/ministral-3-3b-25-12)
- [OpenRouter — FAQ et limites des modèles gratuits](https://openrouter.ai/docs/faq)
- [LM Studio — sorties structurées locales](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
