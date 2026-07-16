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

Un backend est déployé en production sur `https://realitywall.ampynjord.bzh`
et configuré par défaut dans l'extension : pour un usage normal, **il suffit
d'installer l'extension**, aucune installation locale n'est nécessaire (voir
[Télécharger l'extension déjà empaquetée](#télécharger-lextension-déjà-empaquetée)).
Les sections [Démarrage rapide](#démarrage-rapide-moins-de-2-minutes) et
[Déploiement en production](#déploiement-en-production-vps--docker--traefik)
ne concernent que le développement ou l'auto-hébergement d'une instance
personnelle du backend.

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Architecture](#architecture)
- [Démarrage rapide (moins de 2 minutes)](#démarrage-rapide-moins-de-2-minutes)
- [Configuration du backend](#configuration-du-backend)
- [Déploiement en production (VPS + Docker + Traefik)](#déploiement-en-production-vps--docker--traefik)
- [Télécharger l'extension déjà empaquetée](#télécharger-lextension-déjà-empaquetée)
- [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)
- [Lancer les tests](#lancer-les-tests)
- [Le moteur de qualification des faits](#le-moteur-de-qualification-des-faits)
- [Sécurité](#sécurité)
- [Dépannage](#dépannage)

## Fonctionnement

Deux déclencheurs équivalents, selon ce que votre navigateur permet :

- **Desktop (Chrome, Firefox)** : sélectionnez un texte, clic droit →
  **Débunker avec RealityWall**.
- **Partout, y compris Firefox pour Android** (qui ne supporte pas les
  menus contextuels) : sélectionnez un texte puis touchez/cliquez l'icône
  RealityWall de la barre d'outils — elle analyse la sélection en cours.
  Sans sélection, un clic sur l'icône ouvre simplement la page de réglages.

Dans les deux cas, la suite est identique :

1. L'extension envoie le texte sélectionné au backend configuré dans ses
   réglages (`https://realitywall.ampynjord.bzh` par défaut ; une instance
   locale ou auto-hébergée reste possible, voir plus bas).
2. Le backend interroge l'API Claude (Anthropic) avec un appel d'outil
   forcé (`tool_choice`) sur un schéma JSON strict, garantissant une sortie
   structurée et jamais du texte libre.
3. Une pop-up apparaît au niveau du curseur (ou en position par défaut sur
   mobile) avec le verdict : **statut** factuel, **sophismes rhétoriques**
   détectés, **contexte** manquant, et une **requête de vérification**
   neutre vers les sources officielles.

**Plateformes prises en charge** : Chrome/Edge/Brave desktop, Firefox
desktop, Firefox pour Android. Chrome pour Android et iOS, ainsi que tous
les navigateurs basés sur WebKit/Blink mobile, ne supportent aucune
extension tierce (limite des navigateurs eux-mêmes, pas de contournement
possible côté extension).

## Architecture

```
RealityWall/
├── backend/               API Python (FastAPI + SDK Anthropic)
│   ├── config.py            Paramètres (variables d'environnement)
│   ├── prompts.py           Prompt système + schéma d'outil JSON strict
│   ├── schemas.py           Modèles Pydantic (contrat de données)
│   ├── engine.py            Appel Claude, tool_choice forcé, schéma JSON strict
│   ├── main.py               Endpoints FastAPI /analyze et /health
│   └── requirements*.txt
├── extension/              Extension navigateur Manifest V3 (Chrome + Firefox)
│   ├── manifest.json
│   ├── background.js        Menu contextuel + icône barre d'outils + backend
│   ├── content.js            Overlay injecté sur la page (pop-up)
│   ├── content.css
│   ├── options/               Page de réglages (URL du backend)
│   └── icons/
├── tests/                  Suite de tests pytest
├── scripts/generate_icons.py  Génération des icônes PNG (sans dépendance)
├── .github/workflows/ci.yml  Tests + empaquetage extension + déploiement VPS
├── backend/Dockerfile
├── docker-compose.yml      Déploiement backend derrière Traefik (VPS)
└── Makefile
```

Le backend ne fait jamais confiance au frontend : la clé API Anthropic
reste exclusivement côté serveur. L'extension, elle, ne connaît que l'URL
du backend (configurable via sa page de réglages).

## Démarrage rapide (moins de 2 minutes)

Cette section sert à développer ou faire tourner votre propre instance du
backend en local — **pas nécessaire pour utiliser l'extension au
quotidien**, qui pointe par défaut sur l'instance de production.

Prérequis : Python 3.11+, un navigateur Chrome ou Firefox, et une clé API
Anthropic ([console.anthropic.com](https://console.anthropic.com/)).

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

Le backend écoute par défaut sur `http://localhost:8000`. Chargez ensuite
l'extension dans votre navigateur (voir plus bas) : tout est prêt.

## Configuration du backend

Toute la configuration passe par des variables d'environnement, lues depuis
`.env` à la racine du projet (voir `.env.example`) :

| Variable             | Défaut                                  | Description                                    |
| --------------------- | ---------------------------------------- | ---------------------------------------------- |
| `ANTHROPIC_API_KEY`   | *(vide)*                                 | Clé API Anthropic, obligatoire.                |
| `ANTHROPIC_MODEL`     | `claude-sonnet-5`                       | Modèle Claude utilisé pour l'analyse.          |
| `ANTHROPIC_TEMPERATURE` | *(omis)*                               | Optionnel : certains modèles rejettent ce paramètre (déprécié côté API). Le déterminisme vient du `tool_choice` forcé, pas de la température. |
| `HOST`                | `0.0.0.0`                                | Interface d'écoute d'uvicorn.                  |
| `PORT`                | `8000`                                   | Port d'écoute d'uvicorn.                       |
| `CORS_ORIGIN_REGEX`   | origines `chrome-extension://` / `moz-extension://` / `localhost` | Regex des origines HTTP autorisées. |
| `MAX_INPUT_CHARS`     | `4000`                                   | Troncature du texte envoyé au modèle.          |

## Déploiement en production (VPS + Docker + Traefik)

Le backend de production tourne en conteneur Docker derrière un Traefik déjà
en place sur le VPS, avec HTTPS automatique. Le déploiement est ensuite
automatisé : chaque push sur `main` qui passe les tests met à jour
l'instance en production via le job `deploy` de la CI.

### Mise en place initiale (une seule fois)

1. **DNS** : créez un enregistrement (A ou AAAA) pointant
   `realitywall.ampynjord.bzh` vers l'IP du VPS, chez votre registrar (OVH).
2. **Sur le VPS**, clonez le dépôt à l'endroit de votre choix et préparez `.env` :
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
4. Vérifiez `https://realitywall.ampynjord.bzh/health` → `{"status":"ok"}`.

### Activer le déploiement automatique depuis GitHub Actions

Dans les réglages du dépôt GitHub (**Settings → Secrets and variables →
Actions**), ajoutez ces secrets :

| Secret            | Valeur                                              |
| ------------------ | ---------------------------------------------------- |
| `DEPLOY_SSH_HOST`  | `ampynjord.bzh`                                      |
| `DEPLOY_SSH_PORT`  | `2222`                                               |
| `DEPLOY_SSH_USER`  | `debian`                                             |
| `DEPLOY_SSH_KEY`   | Clé privée SSH (format PEM) autorisée sur le VPS pour cet utilisateur |
| `DEPLOY_PATH`      | Chemin absolu du clone sur le VPS, ex. `/home/debian/RealityWall` |

Le job `deploy` du workflow (`.github/workflows/ci.yml`) se connecte en SSH
et exécute `git fetch && git reset --hard origin/main && docker compose up
-d --build` dans ce dossier — **ce dossier ne doit jamais être modifié à la
main sur le VPS**, il est écrasé à chaque déploiement. La clé API Anthropic,
elle, ne transite jamais par GitHub Actions : elle reste uniquement dans le
`.env` local au VPS.

### Mettre à jour manuellement (sans passer par la CI)

```bash
ssh -p 2222 debian@ampynjord.bzh
cd /chemin/vers/RealityWall
git pull
docker compose up -d --build
```

## Télécharger l'extension déjà empaquetée

Pas envie de cloner le dépôt ni d'installer Python juste pour l'extension ?
Chaque push sur `main` publie automatiquement trois paquets prêts à l'emploi
sur la page des releases — même contenu, un nom par plateforme :

**[github.com/ampynjord/RealityWall/releases/latest](https://github.com/ampynjord/RealityWall/releases/latest)**

| Plateforme | Fichier | Suite |
| --- | --- | --- |
| Chrome / Edge / Brave (desktop) | `realitywall-extension-chrome-vX.Y.Z.zip` | Décompressez, puis « Charger l'extension non empaquetée » |
| Firefox (desktop) | `realitywall-extension-firefox-desktop-vX.Y.Z.xpi` | Chargez directement via `about:debugging` |
| Firefox pour Android | `realitywall-extension-firefox-android-vX.Y.Z.xpi` | Contenu identique au paquet Firefox desktop, via le pont de débogage distant |

Voir la section [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)
ci-dessous pour le détail de chaque étape. Le backend reste à installer
séparément (voir [Démarrage rapide](#démarrage-rapide-moins-de-2-minutes)) :
l'extension seule ne fonctionne pas sans lui.

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
5. Sans sélection de texte, un clic sur l'icône RealityWall de la barre
   d'outils ouvre la page de réglages : vérifiez que l'URL du backend
   correspond bien à votre instance (`http://localhost:8000` par défaut).

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
5. Le backend RealityWall doit être joignable depuis le téléphone : soit
   sur le même réseau (remplacez `localhost` par l'IP de votre machine
   dans la page de réglages de l'extension), soit via un tunnel HTTPS.

Chrome pour Android et iOS ne supportent aucune extension tierce : ce
chemin n'existe pas sur ces plateformes, quelle que soit l'extension.

## Lancer les tests

```bash
make test
```

La suite de tests (`pytest`) mocke intégralement le SDK Anthropic : elle
valide que le pipeline complet (prompt → réponse simulée → validation
Pydantic → réponse HTTP) fonctionne sans jamais planter, y compris sur des
cas concrets de mauvaise foi (attaque ad hominem, homme de paille, faux
dilemme, diversion, cherry-picking statistique — voir
`tests/fixtures/bad_faith_samples.py`).

Un test d'intégration optionnel (`tests/test_live_integration.py`) effectue
un véritable appel à l'API Anthropic. Il est désactivé par défaut :

```bash
REALITYWALL_RUN_LIVE_TESTS=1 .venv/bin/pytest -m integration
```

## Le moteur de qualification des faits

Pour chaque texte analysé, le backend renvoie un JSON structuré sur trois
axes, produit par un appel d'outil Claude forcé (`tool_choice`) qui élimine
tout risque de sortie mal formée :

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
  "verification": "INSEE indice des prix à la consommation"
}
```

- **`statut`** : `Vrai` · `Faux` · `Incomplet` · `Raccourci` · `Hors-sujet`.
- **`rhetorique`** : liste des sophismes détectés parmi `Ad Hominem /
  Association`, `Homme de Paille (Strawman)`, `Faux Dilemme`, `Diversion /
  Esquive`. Liste vide si aucun n'est présent.
- **`contexte`** : détection du cherry-picking et des variables omises
  (inflation, période, population...).
- **`verification`** : requête de recherche neutre par mots-clés vers des
  sources primaires officielles (INSEE, Légifrance, Cour des comptes,
  Eurostat, rapports académiques...).

Dans la pop-up, le code couleur est strict : **rouge** pour un sophisme
rhétorique flagrant, **jaune** pour un manque de contexte, **vert** pour un
fait validé.

## Sécurité

- La clé API Anthropic ne quitte jamais le processus backend. L'extension
  ne la connaît jamais et ne fait que des requêtes HTTP vers l'URL de
  backend que vous configurez.
- Le backend n'accepte en CORS que les origines `chrome-extension://`,
  `moz-extension://` et `localhost` par défaut (voir `CORS_ORIGIN_REGEX`).
- Si vous déployez le backend sur une machine distante, la page de réglages
  de l'extension demande explicitement la permission d'hôte correspondante
  avant d'enregistrer une URL non locale (API `chrome.permissions`) — sauf
  pour `realitywall.ampynjord.bzh`, déjà déclaré en dur dans
  `host_permissions` puisque c'est l'instance de production par défaut.
- Le déploiement automatisé (job `deploy` de la CI) ne connaît que des
  identifiants SSH stockés en secrets GitHub Actions ; la clé API Anthropic
  reste exclusivement dans le `.env` du VPS et ne transite jamais par
  GitHub. La clé privée SSH utilisée doit être dédiée à ce déploiement
  (pas votre clé personnelle) et n'autoriser que les actions nécessaires
  sur le VPS.

## Dépannage

- **« Vérifiez que le backend RealityWall est démarré »** dans la pop-up :
  le backend n'est pas accessible à l'URL configurée. Vérifiez `make run`
  et l'URL dans la page de réglages de l'extension.
- **Erreur 502 avec un message d'API Anthropic** : vérifiez que
  `ANTHROPIC_API_KEY` est valide dans `.env` et que le modèle configuré
  dans `ANTHROPIC_MODEL` est disponible pour votre compte.
- **Le menu contextuel n'apparaît pas** : rechargez l'extension depuis
  `chrome://extensions` après toute modification du code.
- **L'instance de production ne reflète pas le dernier push sur `main`** :
  vérifiez le job `deploy` dans l'onglet Actions du dépôt. Les causes les
  plus fréquentes sont des secrets SSH manquants/expirés ou une erreur
  Traefik (réseau/certresolver) — voir
  [Déploiement en production](#déploiement-en-production-vps--docker--traefik).
