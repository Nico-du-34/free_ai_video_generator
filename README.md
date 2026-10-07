# 🎞️ Frame Studio – vidéos IA image par image (gratuit, API Agnes)

Génère chaque image d'une vidéo via l'API gratuite [Agnes AI](https://platform.agnes-ai.com) (`agnes-image-2.1-flash`), puis les assemble en vidéo directement dans le navigateur.

## Démarrage
```bash
npm start            # http://localhost:8080 (Node ≥ 16, aucune dépendance)
```
1. Crée une clé gratuite sur platform.agnes-ai.com → onglet **Réglages** → colle-la.
2. **Studio** : écris des scènes (prompt, mouvement, état final, durée, images de référence), choisis les fps (**min 12**), regarde l'**estimation** de temps, fais un **aperçu** d'1 image, puis **Lancer**.
3. **Instances** : chaque lancement est indépendant (pause/reprise, aperçu live, vidéo finale, images, copie). Tu peux en lancer autant que tu veux en parallèle ; le quota images/minute est partagé.

## Fonctions
- Images de référence globales et par scène (+ image précédente pour la continuité : mode *chaînée*, *ancrée* ou *indépendantes*).
- Enrichissement de prompt optionnel (bouton ✨ par scène, ou automatique au lancement) via `agnes-2.5-flash`.
- Storyboard multi-scènes + bibliothèque de scènes réutilisables.
- Estimation (images, appels API, temps) basée sur la latence réellement mesurée et le quota.
- Reprise après rechargement de la page (les instances en cours repassent en pause).

## Stockage local
Réglages, clé, brouillon, bibliothèque et instances sont dans le **localStorage**. Les fichiers binaires (images de référence, frames, vidéos) sont dans **IndexedDB** du navigateur, car le localStorage (~5 Mo) ne peut pas les contenir. Rien n'est envoyé ailleurs qu'à l'API Agnes.

## Notes
- Le proxy local (`server.js`) évite les erreurs CORS ; sans lui, décoche l'option dans Réglages (marche seulement si l'API autorise CORS).
- L'assemblage rejoue les images en temps réel sur un canvas : **garde l'onglet visible** pendant cette étape (durée = durée de la vidéo).
- Limites gratuites indicatives : 20 images/min en 1K, 4 000 images/jour. Ajuste le quota dans Réglages.
- Les noms de champs de l'API (`image` pour les références, `response_format`) sont modifiables dans Réglages si la doc Agnes évolue.
- Test sans clé : `node dev/mock-api.js` puis `UPSTREAM=http://127.0.0.1:9099 npm start`.
