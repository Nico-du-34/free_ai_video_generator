# 🎞️ Frame Studio – vidéos IA image par image

Génère chaque image d'une vidéo avec une IA gratuite (**Agnes AI**, **Pollinations AI**, **Together AI**, **Cloudflare Workers AI**, **Hugging Face** ou n'importe quelle API compatible OpenAI), puis assemble le tout en **MP4** (ffmpeg). Les générations tournent **sur le serveur** : tu peux fermer l'onglet, éteindre ton PC, et revenir récupérer la vidéo.

## Démarrage (Docker)
```bash
docker compose up -d --build
# → http://localhost:8080
```
1. Onglet **Réglages** : colle ta clé gratuite ([Agnes](https://platform.agnes-ai.com) et/ou [Pollinations](https://enter.pollinations.ai)).
2. **Studio, mode Simple** : écris une description (ou clique une idée), choisis la **durée** (3 s → 1 min, ou n'importe quel nombre de secondes), le format, la fluidité (**min 12 img/s**), puis **Lancer**. Pas de clé ? Un champ te permet de la coller directement. Le mode **Avancé** ajoute le storyboard multi-scènes (prompt, mouvement, état final, références par scène) et la durée totale répartie sur les scènes.
3. **Instances** : chaque lancement est indépendant (pause/reprise, aperçu live, vidéo, images, copie). Plusieurs en parallèle, quota partagé par fournisseur.

Sans Docker : Node ≥ 22 + ffmpeg, puis `npm start`.

## Effets & mouvements (génération image par image chorégraphiée)
Un catalogue de **223 effets** en 5 emplacements, combinables par scène (ou globalement) :
- **Mouvement** (94) : combat (kung-fu, karaté, samouraï, ninja, Matrix…), danse (hip-hop, ballet, K-pop…), pouvoirs, catastrophes, sport, véhicules, émotions, fantastique, gaming. Chaque mouvement est une **séquence d'instants clés** (garde → saut → impact → retombée) répartie sur les images de la scène : chaque image reçoit le bon instant (et la transition entre deux instants) dans son prompt, chaînée à l'image précédente.
- **Caméra** (15), appliquée par ffmpeg : push-in, pull-out, travelling, tilt, grue, drone, orbite, whip pan, épaule, POV…
- **Filtre** (16), appliqué par ffmpeg : VHS, glitch, sépia, noir, néons, pixel art, thermique, hologramme, teal & orange…
- **Transition** (15) entre scènes : jump cut, smash cut, flash, glitch, whip pan, zoom, iris, fondus…
- **Style visuel** (83) : animation, genres de cinéma, univers (cyberpunk, steampunk…), époques, mouvements artistiques, illusions, clips musicaux, business.
**Caméra intégrée à la génération (technique Deforum)** : en mode image par image chaîné, l'image précédente est déformée selon la caméra choisie (zoom, travelling, tilt, grue, orbite…, bords en miroir) avant d'être envoyée comme référence, donc l'IA ne fait que retoucher une image déjà en mouvement au lieu d'en inventer une nouvelle. C'est ce qui donne un mouvement continu et cohérent ; sans caméra, chaque image repart de la précédente telle quelle. (Case à décocher dans le mode Avancé.)
En mode image par image, les images sont en plus lissées (anti-scintillement) et la caméra/le filtre sont posés sur la séquence. Pour les types « Vidéo IA » et « Images animées », le mouvement est envoyé comme texte ou devient les images clés.

## Trois types de génération
- **🎬 Vidéo IA (par défaut quand disponible)** : un vrai modèle vidéo génère des clips avec du vrai mouvement (Agnes `agnes-video-v2.0` via `/v1/videos` + suivi asynchrone, Pollinations `/video/…`). Les clips d'une même scène s'enchaînent (dernière image du clip précédent = image de départ du suivant), puis ffmpeg les assemble, recadre et fige si un clip est trop court. Quota gratuit Agnes : 1 clip/minute et 500 s de vidéo/jour (suivi dans *Usage & IA*).
- **🖼 Images animées** : peu d'images clés générées par n'importe quelle IA (Together, Cloudflare, Hugging Face…), animées par zoom, panoramique et fondus enchaînés. Rapide, très fluide, mouvement de caméra uniquement.
- **🎞 Image par image (expérimental)** : une image IA par image vidéo. Peu cohérent, réservé aux essais.

## Fonctions
- **Onglet Usage & IA** : par clé enregistrée, quota de la minute en direct (et ralentissement après un 429), images du jour face à une limite quotidienne réglable (Agnes : 4 000 par défaut, bloque proprement une fois atteinte), compteurs images / texte / voix, erreurs, latence, courbe sur 14 jours, dernière erreur ; bouton *Vérifier la clé et le compte* (validité, modèles disponibles à assigner en un clic, solde/profil quand l'API l'expose), services audio, journal des derniers appels, stockage utilisé. **Valeurs réelles du fournisseur** : en-têtes de quota (`x-ratelimit-*`) lus sur chaque réponse, et API de compte quand elle existe : Pollinations (solde en pollen, budget et permissions de la clé, usage par modèle et par jour), Hugging Face (compte, abonnement, fin de période), Cloudflare (token, expiration) ; pour Agnes et les API personnalisées, essai de chemins de solde courants (non documentés). Rafraîchi toutes les 5 min quand l'onglet est ouvert.
- **Voix et ambiance** (carte *Son* du Studio, bouton *Audio* sur chaque instance) : narration par scène (écrite à la main ou par l'IA, calée sur la durée), voix gratuites (Google Traduction sans clé, voix locale espeak, Cloudflare MeloTTS, ou `/audio/speech` d'une API compatible OpenAI), ambiances générées par ffmpeg (pluie, vent, océan, feu, forêt, ville, espace, nappe musicale), ou recherche sur Freesound / Jamendo (clés gratuites). Mixage avec baisse automatique de l'ambiance quand la voix parle ; on peut changer l'audio après coup sans régénérer les images.
- **Console par instance** (bouton Console) : journal en direct de chaque requête, essais, erreurs, assemblage.
- **Séries** : bouton *Série* sur une instance → l'IA propose les prompts des épisodes suivants, tu les modifies, puis *Lancer N épisodes* crée une instance par épisode (références et dernière image de l'épisode 1 réutilisées pour garder la cohérence).
- **Vitesse** : *Qualité* (chaînée), *Équilibré* (ancrée, 3 en parallèle, ~3× plus rapide), *Turbo* (+ 1 image IA sur 2 interpolée par ffmpeg, ~6×). Résolution *Brouillon* pour tester vite. Enrichissement de tous les prompts en **un seul appel**, quota ralenti automatiquement après un 429, image suivante préparée pendant l'appel en cours.
- Fournisseurs préremplis (gratuits) : Agnes, Pollinations, Together (FLUX schnell), Cloudflare Workers AI, Hugging Face + un slot personnalisé. Seuls Agnes et Pollinations gèrent les images de référence ; les autres produisent des images indépendantes (texte → image).
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
| `PUBLIC_URL` | URL publique de l'app ; permet l'image de départ des clips Pollinations (URL signée, non devinable) |

## Notes
- Les modèles Pollinations et leurs noms évoluent : ajuste « Modèle image / avec références / texte » dans Réglages. Les références y passent par `/images/edits`.
- Limites gratuites indicatives : Agnes ≈ 20 images/min (1K) et 4 000/jour ; règle le quota dans Réglages.
- Test sans clé : `node dev/mock-api.js`, puis mets `http://127.0.0.1:9099/v1` comme URL de base (Réglages › Avancé).
