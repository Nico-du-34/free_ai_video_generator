# 🎞️ Frame Studio – vidéos IA image par image

Génère chaque image d'une vidéo avec une IA gratuite (**Agnes AI** ou **Pollinations AI**), puis assemble le tout en **MP4** (ffmpeg). Les générations tournent **sur le serveur** : tu peux fermer l'onglet, éteindre ton PC, et revenir récupérer la vidéo.

## Démarrage (Docker)
```bash
docker compose up -d --build
# → http://localhost:8080
```
1. Onglet **Réglages** : colle ta clé gratuite ([Agnes](https://platform.agnes-ai.com) et/ou [Pollinations](https://enter.pollinations.ai)).
2. **Studio** : scènes (prompt, mouvement, état final, durée, images de référence), fps (**min 12**), estimation du temps, aperçu d'1 image, puis **Lancer**.
3. **Instances** : chaque lancement est indépendant (pause/reprise, aperçu live, vidéo, images, copie). Plusieurs en parallèle, quota partagé par fournisseur.

Sans Docker : Node ≥ 22 + ffmpeg, puis `npm start`.

## Fonctions
- Fournisseurs : Agnes AI et Pollinations AI (API compatibles OpenAI, modèles et quotas réglables).
- Images de référence globales / par scène + continuité (image précédente) : modes *chaînée*, *ancrée*, *indépendante*.
- Enrichissement de prompt optionnel (bouton ✨ ou automatique au lancement).
- Storyboard multi-scènes + bibliothèque de scènes.
- Estimation (images, appels API, temps) d'après la latence mesurée et le quota.
- Reprise automatique si le serveur redémarre ; notification quand une vidéo est terminée.

## Où sont stockées les données ?
- **localStorage du navigateur** : brouillon et bibliothèque de scènes.
- **Serveur (volume Docker `/data`)** : clés API, instances, images, vidéos. C'est ce qui permet de générer onglet fermé. Les clés ne sont jamais renvoyées au navigateur.

## Mise en ligne
**Toujours définir un mot de passe** avant d'exposer l'app (`APP_PASSWORD`) : sinon n'importe qui consomme tes quotas.

### VPS + nom de domaine (HTTPS automatique)
Un VPS avec Docker, et un enregistrement DNS `A` de ton domaine vers l'IP du serveur :
```bash
git clone <ce-dépôt> && cd free_ai_video_generator
cp .env.example .env     # puis édite : APP_PASSWORD, DOMAIN, BIND=127.0.0.1
docker compose --profile https up -d --build
```
Caddy obtient et renouvelle le certificat Let's Encrypt tout seul (ports 80/443 ouverts). `BIND=127.0.0.1` empêche d'accéder à l'app en HTTP clair en contournant Caddy.

### Plateformes (Render, Railway, Fly.io, Coolify…)
Déploie le `Dockerfile` en service web (port `8080`), avec :
- un **volume persistant** monté sur `/data` (sinon tout est perdu au redéploiement) ;
- les variables `APP_PASSWORD` (et `APP_USER`), éventuellement `AGNES_API_KEY` / `POLLINATIONS_API_KEY` ;
- un seul réplica (les instances sont gardées en mémoire du processus) ;
- health check sur `/healthz`.

### Sauvegarde / mise à jour
```bash
docker compose up -d --build                     # mise à jour (les données restent dans le volume)
docker run --rm -v free_ai_video_generator_frame-data:/d -v $PWD:/b alpine tar czf /b/backup.tgz -C /d .
```

## Variables d'environnement
| Variable | Rôle |
|---|---|
| `APP_PASSWORD` / `APP_USER` | Protège l'accès (HTTP Basic, user `admin` par défaut) |
| `AGNES_API_KEY` / `POLLINATIONS_API_KEY` | Clés par défaut (sinon via Réglages) |
| `PORT`, `BIND` | Port publié et interface d'écoute de l'hôte |
| `DOMAIN` | Domaine pour le profil `https` |
| `DATA_DIR` | Dossier de données (`/data` dans Docker) |

## Notes
- Les modèles Pollinations et leurs noms évoluent : ajuste « Modèle image / avec références / texte » dans Réglages. Les références y passent par `/images/edits`.
- Limites gratuites indicatives : Agnes ≈ 20 images/min (1K) et 4 000/jour ; règle le quota dans Réglages.
- Test sans clé : `node dev/mock-api.js`, puis mets `http://127.0.0.1:9099/v1` comme URL de base (Réglages › Avancé).
