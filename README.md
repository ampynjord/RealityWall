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

### Déclencher une analyse

| Geste | Ce qui est analysé |
| --- | --- |
| Sélectionner un texte, puis cliquer sur le bouton **« Analyser avec RealityWall »** qui apparaît à côté | La sélection (un commentaire, un passage) |
| Clic droit → **Débunker avec RealityWall** (desktop) | La sélection |
| Clic sur l'icône de l'extension, ou raccourci **Alt + Maj + R** | La sélection s'il y en a une, sinon la page entière |
| Clic droit → **Débunker toute la page avec RealityWall** | La publication entière et ses commentaires |
| Clic droit sur une image ou une vidéo → **Débunker ce média** | Le média et le texte autour |

Sur Firefox pour Android (sans menu contextuel) : sélectionnez un texte puis
touchez le bouton flottant ou l'icône de l'extension.

### Le contexte pris en compte

Au-delà du texte, l'extension joint ce qui aide à comprendre le contenu
(réglage « Tenir compte des images, de la vidéo et des sous-titres ») :

- **Texte** de la sélection, ou de la zone principale de la page ; titre et
  description de la page ;
- **Images** de la publication (3 au maximum, hors avatars et icônes) ;
- **Vidéo** : une capture de l'image affichée (qui contient aussi les
  incrustations de texte) et les **sous-titres** quand ils existent
  (pistes `<track>` ; sous-titres YouTube) ;
- **Son** : il n'est **pas** analysé, faute de transcription. Le pop-up
  l'indique (« le son de la vidéo n'a pas été analysé ») ; seuls les
  sous-titres disponibles comptent.

Le pop-up affiche toujours la liste de ce qui a été réellement envoyé
(« Analysé : texte · 1 image · capture vidéo · sous-titres »). Les images
sont envoyées par leur adresse publique ; si l'API ne peut pas les
télécharger, l'analyse est refaite sans elles. L'identification de
personnes d'après leur visage est interdite par le prompt.

### Ce que fait l'analyse

1. L'extension envoie ce contexte **directement** à l'API Claude (Anthropic,
   `api.anthropic.com`), avec la clé API que vous avez renseignée dans les
   réglages (texte tronqué à 4000 caractères).
2. Avec la recherche web activée (par défaut), un seul appel donne au
   modèle l'outil `web_search` (une seule recherche, pour garder l'analyse
   rapide) et l'outil `submit_reality_check` : il cherche puis renvoie sa
   sortie structurée dans la même réponse. Si le modèle s'arrête après la
   recherche sans finaliser, un second appel de secours force l'outil
   (`tool_choice`).
3. Le résultat est **contrôlé** avant affichage : sources conservées
   uniquement si l'URL a réellement été renvoyée par la recherche web
   (3 au maximum, `http(s)` seulement) ; citations de sophismes conservées
   uniquement si elles figurent mot pour mot dans le contenu ; aucune URL
   dans la réponse suggérée ; 3 procédés rhétoriques au plus.
4. Un pop-up affiche, dans cet ordre : le **statut** et un **résumé** en une
   phrase, la **réponse suggérée**, les **procédés rhétoriques** (avec la
   citation exacte), le **contexte** manquant et les **sources**.

### La réponse suggérée

Pour répondre à une publication ou à un commentaire, le pop-up propose un
message prêt à copier : pragmatique, courtois, factuel, dans la langue du
texte analysé, sans sarcasme ni prise de parti. Il s'appuie uniquement sur
les sources vérifiées (le lien vérifié est ajouté à la copie, décochable) et
reste vide quand il n'y a rien de factuel à répondre. Vous pouvez le
modifier avant de le copier. Sélectionner un commentaire prépare une réponse
à ce commentaire ; analyser la page entière prépare une réponse à la
publication. Longueur courte (280 caractères) ou détaillée (700) au choix.

### Ergonomie

- Pop-up **déplaçable**, **repliable**, qui tient dans la fenêtre, avec
  thème clair/sombre automatique ;
- résumé d'abord, détails dans des sections repliables ;
- compteur de secondes pendant l'analyse, bouton **Annuler** (la requête
  est réellement interrompue) et **Réanalyser** ;
- **Échap** ferme le pop-up ; bouton « Tester » pour vérifier la clé API ;
  la page de réglages s'ouvre à la première installation.

### Réglages

| Réglage | Effet |
| --- | --- |
| Modèle | **Claude Sonnet 5** (plus précis, par défaut) ou **Claude Haiku 4.5** (plus rapide, moins coûteux). |
| Recherche web | Activée : sources vérifiées, quelques secondes de plus et un coût par recherche (voir la tarification de `web_search` sur [platform.claude.com](https://platform.claude.com)). Désactivée : un seul appel direct, nettement plus rapide, sans source. |
| Images, vidéo et sous-titres | Joindre ou non le contexte multimédia (plus de jetons, donc plus lent et plus coûteux). |
| Réponse suggérée | Activer ou non, et choisir sa longueur. |
| Bouton flottant | Afficher ou non le bouton près d'une sélection. |

Un cache en mémoire évite de refaire (et de payer) l'analyse d'un même
contenu avec les mêmes réglages ; « Réanalyser » le contourne.

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
│   ├── prompts.js            Catalogue de sophismes, prompt système, schémas d'outils
│   ├── core.js               Appel API Anthropic, validation, vérification des sources et citations (testé)
│   ├── context.js            Collecte du contexte : texte, images, capture vidéo, sous-titres (partiellement testé)
│   ├── background.js         Menus, icône, raccourci, annulation, réglages
│   ├── content.js             Interface injectée : pop-up, bouton flottant
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
- **`rhetorique`** : au plus 3 procédés, parmi 18 catégories (voir
  ci-dessous), chacun avec la citation exacte du texte et son mécanisme.
  Liste vide si rien n'est clairement présent : la précision prime sur
  l'exhaustivité (une opinion, une ironie ou une comparaison argumentée ne
  sont pas des sophismes).
- **`contexte`** : détection du cherry-picking et des variables omises
  (inflation, période, population...).
- **`sources`** : 0 à 3 sources réelles (URL + description), trouvées par
  le modèle via `web_search` parmi des sources primaires officielles
  (INSEE, Légifrance, Cour des comptes, Eurostat, rapports académiques...).
  Jamais une URL inventée : liste vide si aucune recherche n'aboutit.

### Catalogue des procédés rhétoriques

Ad Hominem / Association · Homme de Paille · Faux Dilemme · Diversion /
Esquive · Pente Glissante · Généralisation Hâtive · Faux Lien de Causalité ·
Appel à l'Autorité · Appel à la Popularité · Appel à l'Émotion · Tu Quoque /
Whataboutism · Pétition de Principe · Question Tendancieuse · Argument
Anecdotique · Fausse Équivalence · Empoisonnement du Puits · Procès
d'Intention · Argument d'Ignorance. Le catalogue (noms et définitions) est
défini une seule fois dans `extension/prompts.js`.

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

La suite (34 tests) couvre, sans appel réseau (`fetch` est simulé) :
cohérence du catalogue de sophismes entre schéma, prompt et validation ;
validation de la sortie du modèle ; vérification des citations et des
sources ; nettoyage de la réponse suggérée ; envoi des images, de la capture
vidéo et des sous-titres ; nouvel essai sans images si l'API ne peut pas les
télécharger ; flux en un appel et appel de secours ; mode sans recherche ;
choix de l'outil de recherche selon le modèle ; cache ; annulation ;
nouvelle tentative sur erreur transitoire (429/5xx/529) ; test de la clé ;
extraction des sous-titres (WebVTT, YouTube) et choix des images ;
cohérence du manifest. Le pipeline CI exécute ces tests, vérifie la syntaxe
des scripts et le manifest, puis empaquette l'extension.

L'interface et la collecte dans le DOM (bouton flottant, pop-up, capture de
vidéo, lecture des sous-titres, déplacement, copie, annulation) ne sont pas
couvertes par la CI : elles se vérifient dans un navigateur réel, en
chargeant le dossier `extension/`.

Pour tester dans un navigateur : chargez le dossier `extension/` (voir
[Charger l'extension dans le navigateur](#charger-lextension-dans-le-navigateur)).

## Licence

Copyright © 2026 ampynjord. **Tous droits réservés.** Ce code est
propriétaire : aucune copie, modification ni redistribution sans
autorisation écrite préalable. Voir [LICENSE](LICENSE).
