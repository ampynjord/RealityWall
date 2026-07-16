# RealityWall

Un mur de faits infranchissable face à la mauvaise foi numérique.

RealityWall est une extension de navigateur (Chrome / Firefox, Manifest V3)
qui permet de sélectionner n'importe quel texte sur le web (commentaire de
réseau social, article, message de chat), de faire un clic droit sur
**« Débunker avec RealityWall »**, et d'obtenir instantanément une analyse
factuelle et rhétorique neutre, affichée dans une pop-up sobre au niveau du
curseur.

Le système ne juge jamais moralement, politiquement ou idéologiquement un
propos. Il agit comme un compilateur logique froid : il détecte des erreurs
factuelles et des sophismes de mauvaise foi, et pointe vers les sources
primaires officielles permettant de vérifier par soi-même.

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Architecture](#architecture)
- [Démarrage rapide (moins de 2 minutes)](#démarrage-rapide-moins-de-2-minutes)
- [Configuration du backend](#configuration-du-backend)
- [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)
- [Lancer les tests](#lancer-les-tests)
- [Le moteur de qualification des faits](#le-moteur-de-qualification-des-faits)
- [Sécurité](#sécurité)
- [Dépannage](#dépannage)

## Fonctionnement

1. Vous sélectionnez un texte sur une page web.
2. Clic droit → **Débunker avec RealityWall**.
3. L'extension envoie le texte sélectionné au backend local que vous avez
   démarré sur votre machine.
4. Le backend interroge l'API Claude (Anthropic) avec un appel d'outil
   forcé (`tool_choice`) sur un schéma JSON strict, garantissant une sortie
   structurée et jamais du texte libre.
5. Une pop-up apparaît au niveau du curseur avec le verdict : **statut**
   factuel, **sophismes rhétoriques** détectés, **contexte** manquant, et
   une **requête de vérification** neutre vers les sources officielles.

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
├── extension/              Extension navigateur Manifest V3
│   ├── manifest.json
│   ├── background.js        Menu contextuel + appel au backend
│   ├── content.js            Overlay injecté sur la page (pop-up)
│   ├── content.css
│   ├── options/               Page de réglages (URL du backend)
│   └── icons/
├── tests/                  Suite de tests pytest
├── scripts/generate_icons.py  Génération des icônes PNG (sans dépendance)
└── Makefile
```

Le backend ne fait jamais confiance au frontend : la clé API Anthropic
reste exclusivement côté serveur. L'extension, elle, ne connaît que l'URL
du backend (configurable via sa page de réglages).

## Démarrage rapide (moins de 2 minutes)

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

## Charger l'extension dans le navigateur

### Chrome / Edge / Brave (Chromium)

1. Ouvrez `chrome://extensions`.
2. Activez le **Mode développeur** (coin supérieur droit).
3. Cliquez sur **Charger l'extension non empaquetée**.
4. Sélectionnez le dossier `extension/` de ce dépôt.
5. Ouvrez la page de réglages de l'extension (clic sur son icône dans la
   barre d'outils) et vérifiez que l'URL du backend correspond bien à votre
   instance (`http://localhost:8000` par défaut).

### Firefox

1. Ouvrez `about:debugging#/runtime/this-firefox`.
2. Cliquez sur **Charger un module complémentaire temporaire**.
3. Sélectionnez le fichier `extension/manifest.json`.

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
  avant d'enregistrer une URL non locale (API `chrome.permissions`).

## Dépannage

- **« Vérifiez que le backend RealityWall est démarré »** dans la pop-up :
  le backend n'est pas accessible à l'URL configurée. Vérifiez `make run`
  et l'URL dans la page de réglages de l'extension.
- **Erreur 502 avec un message d'API Anthropic** : vérifiez que
  `ANTHROPIC_API_KEY` est valide dans `.env` et que le modèle configuré
  dans `ANTHROPIC_MODEL` est disponible pour votre compte.
- **Le menu contextuel n'apparaît pas** : rechargez l'extension depuis
  `chrome://extensions` après toute modification du code.
