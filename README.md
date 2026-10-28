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

**Logiciel propriétaire** — voir [Licence](#licence).

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Architecture](#architecture)
- [Démarrage rapide (moins de 2 minutes)](#démarrage-rapide-moins-de-2-minutes)
- [Télécharger l'extension déjà empaquetée](#télécharger-lextension-déjà-empaquetée)
- [Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)
- [Le moteur de qualification des faits](#le-moteur-de-qualification-des-faits)
- [Sécurité](#sécurité)
- [Dépannage](#dépannage)
- [Développement et tests](#développement-et-tests)
- [Licence](#licence)

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
2. Avec la recherche web activée (par défaut), un seul appel donne au
   modèle l'outil `web_search` intégré à l'API (une seule recherche, pour
   garder l'analyse rapide) et l'outil `submit_reality_check` : il cherche
   puis renvoie sa sortie structurée dans la même réponse. Si le modèle
   s'arrête après la recherche sans finaliser, un second appel de secours
   force l'outil (`tool_choice`).
3. Les sources affichées sont **vérifiées** : seules les URLs réellement
   renvoyées par la recherche web sont conservées (jamais une URL inventée
   par le modèle), au maximum 3, et uniquement en `http(s)`.
4. Une pop-up apparaît au niveau du curseur (ou en position par défaut sur
   mobile) avec le verdict : **statut** factuel, **sophismes rhétoriques**
   détectés, **contexte** manquant et **sources**, avec un lien direct vers
   chacune, plus un rappel que l'analyse est automatique.

**Réglages** (page d'options de l'extension) :

| Réglage | Effet |
| --- | --- |
| Modèle | **Claude Sonnet 5** (plus précis, par défaut) ou **Claude Haiku 4.5** (plus rapide, moins coûteux). |
| Recherche web | Activée : sources vérifiées, quelques secondes de plus et un coût par recherche (voir la tarification de `web_search` sur [platform.claude.com](https://platform.claude.com)). Désactivée : un seul appel direct, nettement plus rapide, sans source. |

Un cache en mémoire évite de refaire (et de payer) l'analyse d'un même
texte avec les mêmes réglages.

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
│   ├── prompts.js            Prompt système + schémas d'outils
│   ├── core.js               Appel API Anthropic, validation, vérification des sources (testé)
│   ├── background.js         Menu contextuel + icône barre d'outils + réglages
│   ├── content.js             Overlay injecté sur la page (pop-up)
│   ├── content.css
│   ├── options/                Page de réglages (clé API, modèle, recherche web)
│   └── icons/
├── test/                   Tests Node (node:test), sans réseau
├── scripts/generate_icons.py  Génération des icônes PNG (sans dépendance)
├── .github/workflows/ci.yml  Tests + empaquetage + publication de l'extension
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

Pour chaque texte analysé, Claude reçoit en un seul appel l'outil
`web_search` et l'outil `submit_reality_check` (défini dans
`extension/prompts.js`) : il cherche puis appelle l'outil de sortie dans la
même réponse, ce qui renvoie un JSON structuré sur quatre axes, sans aucun
risque de sortie mal formée :

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
- Les liens de sources n'utilisent que http(s) ; le contenu affiché est échappé avant insertion dans la page.
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

## Développement et tests

Prérequis : Node 20 ou plus récent. Aucune dépendance à installer.

```bash
make test    # ou : node --test test/*.test.js
```

La suite couvre, sans appel réseau (`fetch` est simulé) : la validation de
la sortie du modèle, le retrait des blocs `server_tool_use` tronqués, le
filtrage des sources sur les URLs réellement trouvées, le flux en un appel,
l'appel de secours, le mode sans recherche, le choix de l'outil de recherche
selon le modèle, le cache, les nouvelles tentatives sur erreur transitoire
(429/5xx/529) et les messages d'erreur. Le pipeline CI exécute ces tests,
vérifie la syntaxe des scripts et le manifest, puis empaquette l'extension.

Pour tester dans un navigateur : chargez le dossier `extension/` (voir
[Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)).

## Licence

Copyright © 2026 ampynjord. **Tous droits réservés.** Ce code est
propriétaire : aucune copie, modification ni redistribution sans
autorisation écrite préalable. Voir [LICENSE](LICENSE).
