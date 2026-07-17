# RealityWall

[![CI et publication de l'extension](https://github.com/ampynjord/RealityWall/actions/workflows/ci.yml/badge.svg)](https://github.com/ampynjord/RealityWall/actions/workflows/ci.yml)
[![Dernière release](https://img.shields.io/github/v/release/ampynjord/RealityWall?label=extension)](https://github.com/ampynjord/RealityWall/releases/latest)

Un mur de faits infranchissable face à la mauvaise foi numérique.

RealityWall est une extension de navigateur (Chrome et Firefox, desktop et
Android, Manifest V3) qui permet de sélectionner n'importe quel texte sur
le web (commentaire de réseau social, article, message de chat), de faire
un clic droit sur **« Débunker avec RealityWall »** (ou de toucher l'icône
de l'extension sur mobile), et d'obtenir instantanément une analyse
factuelle et rhétorique neutre, affichée dans une pop-up sobre.

Le système ne juge jamais moralement, politiquement ou idéologiquement un
propos. Il agit comme un compilateur logique froid : il détecte des erreurs
factuelles et des sophismes de mauvaise foi, et pointe vers les sources
primaires officielles permettant de vérifier par soi-même.

**RealityWall n'a pas de serveur central et ne fonctionne pas sur une clé
API partagée.** L'extension appelle directement l'API Anthropic depuis
votre navigateur, avec **votre propre clé API** renseignée dans ses
réglages (BYOK — *Bring Your Own Key*). Personne d'autre que vous et
Anthropic ne voit votre texte ou votre clé : il n'y a aucun intermédiaire.
Installez l'extension, collez votre clé, c'est prêt (voir
[Démarrage rapide](#démarrage-rapide-moins-de-2-minutes)).

Un backend Python auto-hébergeable existe toujours dans ce dépôt
(`backend/`) pour qui voudrait faire tourner une instance partagée
derrière sa propre clé — voir
[Backend optionnel](#backend-optionnel-auto-hébergement-partagé) — mais ce
n'est **pas** le chemin par défaut et l'extension ne s'y connecte plus
automatiquement.

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Architecture](#architecture)
- [Démarrage rapide (moins de 2 minutes)](#démarrage-rapide-moins-de-2-minutes)
- [Télécharger l'extension déjà empaquetée](#télécharger-lextension-déjà-empaquetée)
- [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)
- [Le moteur de qualification des faits](#le-moteur-de-qualification-des-faits)
- [Sécurité](#sécurité)
- [Dépannage](#dépannage)
- [Backend optionnel (auto-hébergement partagé)](#backend-optionnel-auto-hébergement-partagé)
- [Lancer les tests du backend](#lancer-les-tests-du-backend)

## Fonctionnement

Deux façons d'analyser un texte, et deux déclencheurs selon ce que votre
navigateur permet :

- **Analyser une sélection** — **Desktop (Chrome, Firefox)** : sélectionnez
  un texte, clic droit → **Débunker avec RealityWall**. **Partout, y compris
  Firefox pour Android** (qui ne supporte pas les menus contextuels) :
  sélectionnez un texte puis touchez/cliquez l'icône RealityWall de la barre
  d'outils.
- **Analyser toute la page** — clic droit n'importe où (sans sélection) →
  **Débunker toute la page avec RealityWall** ; ou cliquez l'icône de la
  barre d'outils sans rien sélectionner au préalable.

Dans tous les cas, la suite est identique :

1. L'extension envoie le texte (sélection ou page entière, tronqué à 4000
   caractères) **directement** à l'API Claude (Anthropic,
   `api.anthropic.com`), authentifiée avec la clé API que vous avez
   renseignée dans les réglages de l'extension.
2. Un premier appel laisse le modèle chercher de vraies sources via l'outil
   `web_search` intégré à l'API (une seule recherche, pour garder l'analyse
   rapide). Un second appel
   force l'utilisation d'un outil (`tool_choice`) sur un schéma JSON strict,
   garantissant une sortie structurée et jamais du texte libre — le champ
   `sources` ne peut alors contenir que des URLs réellement trouvées lors de
   la recherche, jamais inventées.
3. Une pop-up apparaît au niveau du curseur (ou en position par défaut sur
   mobile) avec le verdict : **statut** factuel, **sophismes rhétoriques**
   détectés, **contexte** manquant, et les **sources** trouvées, avec un
   lien direct vers chacune.

Le passage par deux appels et une recherche web réelle rend l'analyse un peu
plus lente qu'un simple appel (comptez quelques secondes de plus) et peut
entraîner un coût par recherche en plus du coût habituel par token — voir la
tarification de l'outil `web_search` sur [platform.claude.com](https://platform.claude.com).

**Plateformes prises en charge** : Chrome/Edge/Brave desktop, Firefox
desktop, Firefox pour Android. Chrome pour Android et iOS, ainsi que tous
les navigateurs basés sur WebKit/Blink mobile, ne supportent aucune
extension tierce (limite des navigateurs eux-mêmes, pas de contournement
possible côté extension).

## Architecture

```
RealityWall/
├── extension/              Extension navigateur Manifest V3 (Chrome + Firefox)
│   ├── manifest.json
│   ├── prompts.js            Prompt système + schéma d'outil JSON strict
│   ├── background.js         Menu contextuel + icône barre d'outils + appel API Anthropic direct
│   ├── content.js             Overlay injecté sur la page (pop-up)
│   ├── content.css
│   ├── options/                Page de réglages (clé API Anthropic, BYOK)
│   └── icons/
├── backend/                Backend Python optionnel (FastAPI + SDK Anthropic) — non utilisé par défaut
│   ├── config.py
│   ├── prompts.py             Même prompt/schéma que extension/prompts.js, version Python
│   ├── schemas.py
│   ├── engine.py
│   ├── main.py                 Endpoints FastAPI /analyze et /health
│   └── requirements*.txt
├── tests/                  Suite de tests pytest (backend optionnel)
├── scripts/generate_icons.py  Génération des icônes PNG (sans dépendance)
├── .github/workflows/ci.yml  Tests + empaquetage extension + déploiement VPS (backend optionnel)
├── backend/Dockerfile
├── docker-compose.yml      Déploiement backend derrière Traefik (VPS, optionnel)
└── Makefile
```

L'extension ne connaît que votre clé API Anthropic, stockée localement sur
votre appareil (`chrome.storage.local`, jamais synchronisée entre
appareils) et envoyée uniquement à `api.anthropic.com`. Il n'y a pas de
serveur RealityWall entre vous et Anthropic.

## Démarrage rapide (moins de 2 minutes)

1. **Installez l'extension** — téléchargez le paquet correspondant à votre
   navigateur depuis les [releases](#télécharger-lextension-déjà-empaquetée)
   et chargez-le (voir
   [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)).
2. **Obtenez une clé API Anthropic** sur
   [platform.claude.com](https://platform.claude.com) (créez un compte si
   besoin, puis générez une clé dans les réglages).
3. **Ouvrez les réglages de l'extension** (clic sur son icône sans texte
   sélectionné, ou via le gestionnaire d'extensions de votre navigateur),
   collez la clé, cliquez sur **Enregistrer**.
4. Sélectionnez n'importe quel texte sur une page web, clic droit →
   **Débunker avec RealityWall**. C'est prêt.

Aucune installation locale, aucun serveur, aucun clonage de dépôt
nécessaire pour un usage normal.

## Télécharger l'extension déjà empaquetée

Chaque push sur `main` publie automatiquement trois paquets prêts à l'emploi
sur la page des releases — même contenu, un nom par plateforme :

**[github.com/ampynjord/RealityWall/releases/latest](https://github.com/ampynjord/RealityWall/releases/latest)**

| Plateforme | Fichier | Suite |
| --- | --- | --- |
| Chrome / Edge / Brave (desktop) | `realitywall-extension-chrome-vX.Y.Z.zip` | Décompressez, puis « Charger l'extension non empaquetée » |
| Firefox (desktop) | `realitywall-extension-firefox-desktop-vX.Y.Z.xpi` | Chargez directement via `about:debugging` |
| Firefox pour Android | `realitywall-extension-firefox-android-vX.Y.Z.xpi` | Contenu identique au paquet Firefox desktop, via le pont de débogage distant |

Voir la section [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)
ci-dessous pour le détail de chaque étape.

Chaque exécution du pipeline CI (`.github/workflows/ci.yml`) publie aussi
les trois paquets en tant qu'*artifacts* du run, téléchargeables depuis
l'onglet **Actions** du dépôt — pratique pour tester une pull request avant
fusion.

## Charger l'extension dans le navigateur

### Chrome / Edge / Brave (Chromium, desktop)

1. Ouvrez `chrome://extensions`.
2. Activez le **Mode développeur** (coin supérieur droit).
3. Cliquez sur **Charger l'extension non empaquetée**.
4. Sélectionnez le dossier `extension/` de ce dépôt, ou le dossier obtenu
   en décompressant `realitywall-extension-chrome-vX.Y.Z.zip` (voir
   [Télécharger l'extension déjà empaquetée](#télécharger-lextension-déjà-empaquetée)).
5. Cliquez sur l'icône RealityWall de la barre d'outils (sans sélection de
   texte) pour ouvrir la page de réglages et renseigner votre clé API.

### Firefox (desktop)

1. Ouvrez `about:debugging#/runtime/this-firefox`.
2. Cliquez sur **Charger un module complémentaire temporaire**.
3. Sélectionnez soit le fichier `extension/manifest.json` de ce dépôt,
   soit directement `realitywall-extension-firefox-desktop-vX.Y.Z.xpi`
   téléchargé depuis les releases.

Le chargement temporaire disparaît à la fermeture de Firefox ; à répéter à
chaque session de développement.

### Firefox pour Android

Firefox Android ne dispose pas de menu contextuel : l'analyse se déclenche
en touchant l'icône de l'extension après avoir sélectionné du texte (voir
[Fonctionnement](#fonctionnement)). Le chargement d'une extension non
publiée sur addons.mozilla.org nécessite un pont de débogage à distance :

1. Installez **Firefox Nightly pour Android** sur votre appareil (seul
   canal autorisant le débogage à distance des extensions).
2. Sur cet appareil, activez le débogage USB dans les réglages de Firefox
   Nightly (`about:config` → `devtools.debugger.remote-enabled` à `true`).
3. Connectez l'appareil à un ordinateur exécutant Firefox desktop, ouvrez
   `about:debugging#/setup`, activez la connexion USB et sélectionnez
   l'appareil.
4. Dans l'onglet de l'appareil connecté, chargez `extension/manifest.json`
   (ou `realitywall-extension-firefox-android-vX.Y.Z.xpi`) comme module
   temporaire, exactement comme sur desktop.
5. Ouvrez les réglages de l'extension sur l'appareil et renseignez votre
   clé API Anthropic — l'appareil a simplement besoin d'un accès internet
   vers `api.anthropic.com`, aucun serveur intermédiaire à joindre.

Chrome pour Android et iOS ne supportent aucune extension tierce : ce
chemin n'existe pas sur ces plateformes, quelle que soit l'extension.

## Le moteur de qualification des faits

Pour chaque texte analysé, un premier appel à Claude laisse le modèle
chercher via l'outil `web_search`, puis un second appel force l'utilisation
de l'outil `submit_reality_check` (défini dans `extension/prompts.js`), ce
qui renvoie un JSON structuré sur quatre axes, sans aucun risque de sortie
mal formée :

```json
{
  "statut": "Raccourci",
  "rhetorique": [
    {
      "type": "Ad Hominem / Association",
      "explication": "Attaque la source plutôt que l'argument."
    }
  ],
  "contexte": {
    "probleme_detecte": true,
    "explication": "Chiffre brut non ajusté à l'inflation."
  },
  "sources": [
    {
      "url": "https://www.insee.fr/fr/statistiques/2381375",
      "description": "Indice des prix à la consommation, série longue."
    }
  ]
}
```

- **`statut`** : `Vrai` · `Faux` · `Incomplet` · `Raccourci` · `Hors-sujet`.
- **`rhetorique`** : liste des sophismes détectés parmi `Ad Hominem /
  Association`, `Homme de Paille (Strawman)`, `Faux Dilemme`, `Diversion /
  Esquive`. Liste vide si aucun n'est présent.
- **`contexte`** : détection du cherry-picking et des variables omises
  (inflation, période, population...).
- **`sources`** : 0 à 3 sources réelles (URL + description), trouvées par
  le modèle via `web_search` parmi des sources primaires officielles
  (INSEE, Légifrance, Cour des comptes, Eurostat, rapports académiques...).
  Jamais une URL inventée : liste vide si aucune recherche n'aboutit.

Dans la pop-up, le code couleur est strict : **rouge** pour un sophisme
rhétorique flagrant, **jaune** pour un manque de contexte, **vert** pour un
fait validé.

## Sécurité

- Votre clé API Anthropic est stockée exclusivement dans
  `chrome.storage.local` (stockage local du navigateur, jamais synchronisé
  entre appareils ni envoyé à un serveur RealityWall — il n'y en a pas).
  Elle ne transite que vers `api.anthropic.com`, en HTTPS, depuis le
  service worker de l'extension.
- L'extension ne demande que la permission d'hôte `api.anthropic.com` (voir
  `host_permissions` dans `manifest.json`) : elle ne peut pas contacter
  d'autre domaine.
- Chaque utilisateur consomme son propre quota et paie son propre usage sur
  son compte Anthropic — il n'y a pas de clé partagée à protéger ni de
  facturation centralisée.
- Si vous quittez l'extension ou changez de clé, effacez l'ancienne depuis
  la page de réglages ou désinstallez l'extension : rien n'est conservé
  ailleurs.

## Dépannage

- **« Aucune clé API Anthropic configurée »** dans la pop-up : ouvrez la
  page de réglages de l'extension (clic sur son icône sans sélection de
  texte) et renseignez votre clé.
- **« Clé API Anthropic invalide ou manquante »** : vérifiez que la clé
  collée dans les réglages est correcte et toujours active sur
  [platform.claude.com](https://platform.claude.com).
- **« Limite de débit de l'API Anthropic atteinte »** : votre compte a
  atteint sa limite de requêtes ; réessayez dans quelques instants ou
  consultez vos limites sur la console Anthropic.
- **Le menu contextuel n'apparaît pas** : rechargez l'extension depuis
  `chrome://extensions` (ou `about:debugging` sur Firefox) après toute
  modification du code.

## Backend optionnel (auto-hébergement partagé)

Ce dépôt contient toujours un backend Python (`backend/`) implémentant la
même logique que `extension/prompts.js`, pensé pour qui voudrait exposer
une instance partagée (équipe, communauté) derrière sa propre clé API
plutôt que de demander à chaque utilisateur d'en fournir une. **Ce n'est
pas le chemin par défaut** : l'extension publiée dans les releases parle
directement à Anthropic (voir [Fonctionnement](#fonctionnement)) et ne
pointe vers aucun backend.

Pour l'utiliser, il faut faire tourner ce backend vous-même et adapter
`extension/background.js` pour qu'il appelle votre instance au lieu de
l'API Anthropic directement (le code n'inclut plus de champ d'URL de
backend configurable dans les réglages depuis ce pivot BYOK).

### Lancer le backend en local

Prérequis : Python 3.11+ et une clé API Anthropic.

```bash
git clone <url-du-dépôt> RealityWall
cd RealityWall

# 1. Installe l'environnement virtuel et les dépendances, crée .env
make install

# 2. Renseignez votre clé API dans .env
$EDITOR .env   # ANTHROPIC_API_KEY=sk-ant-...

# 3. Lancez la suite de tests (aucun appel réseau réel)
make test

# 4. Démarrez le backend
make run
```

Le backend écoute par défaut sur `http://localhost:8000` et expose
`POST /analyze` et `GET /health`.

### Configuration

| Variable             | Défaut                                  | Description                                    |
| --------------------- | ---------------------------------------- | ---------------------------------------------- |
| `ANTHROPIC_API_KEY`   | *(vide)*                                 | Clé API Anthropic, obligatoire.                |
| `ANTHROPIC_MODEL`     | `claude-sonnet-5`                       | Modèle Claude utilisé pour l'analyse.          |
| `ANTHROPIC_TEMPERATURE` | *(omis)*                               | Optionnel : certains modèles rejettent ce paramètre (déprécié côté API). Le déterminisme vient du `tool_choice` forcé, pas de la température. |
| `HOST`                | `0.0.0.0`                                | Interface d'écoute d'uvicorn.                  |
| `PORT`                | `8000`                                   | Port d'écoute d'uvicorn.                       |
| `CORS_ORIGIN_REGEX`   | origines `chrome-extension://` / `moz-extension://` / `localhost` | Regex des origines HTTP autorisées. |
| `MAX_INPUT_CHARS`     | `4000`                                   | Troncature du texte envoyé au modèle.          |

### Déploiement en production (VPS + Docker + Traefik)

Le job `deploy` de la CI (`.github/workflows/ci.yml`) reste disponible pour
qui veut automatiser le déploiement de ce backend optionnel sur un VPS,
derrière Traefik, à chaque push sur `main`.

1. **DNS** : créez un enregistrement (A ou AAAA) pointant votre domaine
   vers l'IP du VPS.
2. **Sur le VPS**, clonez le dépôt et préparez `.env` :
   ```bash
   git clone https://github.com/ampynjord/RealityWall.git
   cd RealityWall
   cp .env.example .env
   $EDITOR .env   # ANTHROPIC_API_KEY=sk-ant-...
   ```
3. **Premier démarrage manuel**, pour vérifier que Traefik route correctement
   avant d'activer le déploiement automatique :
   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```
   Le réseau Docker externe utilisé par Traefik doit s'appeler `traefik` et
   le certresolver `letsencrypt` par défaut ; sinon, adaptez `TRAEFIK_NETWORK`
   et `TRAEFIK_CERTRESOLVER` dans `.env` (voir `docker-compose.yml`, valeurs
   interpolées depuis l'environnement, avec ces deux noms comme défauts).
4. Vérifiez `https://votre-domaine/health` → `{"status":"ok"}`.

Pour activer le déploiement automatique, ajoutez ces secrets dans les
réglages du dépôt GitHub (**Settings → Secrets and variables → Actions**) :

| Secret            | Valeur                                              |
| ------------------ | ---------------------------------------------------- |
| `DEPLOY_SSH_HOST`  | Adresse du VPS                                       |
| `DEPLOY_SSH_PORT`  | Port SSH du VPS                                      |
| `DEPLOY_SSH_USER`  | Utilisateur SSH                                      |
| `DEPLOY_SSH_KEY`   | Clé privée SSH (format PEM) autorisée sur le VPS pour cet utilisateur |
| `DEPLOY_SSH_KNOWN_HOSTS` | Empreinte(s) de l'hôte, générée **depuis une machine de confiance** (pas la CI) via `ssh-keyscan -p <port> <host>`, pour éviter tout risque de MITM |
| `DEPLOY_PATH`      | Chemin absolu du clone sur le VPS |

Le job `deploy` se connecte en SSH et exécute `git fetch && git reset
--hard origin/main && docker compose up -d --build` dans ce dossier — ce
dossier ne doit jamais être modifié à la main sur le VPS, il est écrasé à
chaque déploiement. La clé API Anthropic ne transite jamais par GitHub
Actions : elle reste uniquement dans le `.env` local au VPS.

Sans ces secrets configurés, le job `deploy` se contente d'afficher un
message et de s'arrêter proprement (aucune tentative de connexion, aucun
échec affiché) — cela n'affecte ni les tests, ni l'empaquetage et la
publication de l'extension, qui restent indépendants.

## Lancer les tests du backend

```bash
make test
```

La suite de tests (`pytest`) mocke intégralement le SDK Anthropic : elle
valide que le pipeline complet du backend optionnel (prompt → réponse
simulée → validation Pydantic → réponse HTTP) fonctionne sans jamais
planter, y compris sur des cas concrets de mauvaise foi (attaque ad
hominem, homme de paille, faux dilemme, diversion, cherry-picking
statistique — voir `tests/fixtures/bad_faith_samples.py`).

Un test d'intégration optionnel (`tests/test_live_integration.py`) effectue
un véritable appel à l'API Anthropic. Il est désactivé par défaut :

```bash
REALITYWALL_RUN_LIVE_TESTS=1 .venv/bin/pytest -m integration
```
