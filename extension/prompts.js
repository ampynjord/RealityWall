/**
 * Prompt système et schémas d'outils forçant une sortie JSON stricte.
 *
 * Chargé avant core.js et background.js (via importScripts sur Chrome, via
 * le tableau "scripts" du manifest sur Firefox) : une seule source de
 * vérité pour le catalogue de sophismes, le prompt et le schéma.
 */

const TOOL_NAME = "submit_reality_check";

/**
 * Catalogue des procédés rhétoriques détectables. Le nom sert à la fois de
 * valeur d'enum dans le schéma, de libellé affiché et de clé de validation.
 */
const RHETORIQUE_CATALOG = [
  {
    type: "Ad Hominem / Association",
    definition:
      "disqualifier une personne ou une idée par son identité, ses croyances, son appartenance ou ses fréquentations plutôt que de répondre à l'argument de fond.",
  },
  {
    type: "Homme de Paille (Strawman)",
    definition:
      "déformer, caricaturer ou exagérer la position adverse pour l'attaquer plus facilement ; la version attaquée n'est pas celle réellement défendue.",
  },
  {
    type: "Faux Dilemme",
    definition:
      "imposer un choix binaire (« soit A, soit B ») alors que d'autres options existent.",
  },
  {
    type: "Diversion / Esquive",
    definition:
      "changer de sujet, poser une contre-question ou déplacer le débat pour éviter l'argument initial.",
  },
  {
    type: "Pente Glissante",
    definition:
      "affirmer qu'une première étape entraînera inévitablement une chaîne de conséquences de plus en plus graves, sans démontrer chaque maillon.",
  },
  {
    type: "Généralisation Hâtive",
    definition:
      "tirer une règle générale d'un ou de quelques cas, ou d'un échantillon insuffisant (« tous les X sont... »).",
  },
  {
    type: "Faux Lien de Causalité",
    definition:
      "présenter une succession dans le temps ou une corrélation comme une relation de cause à effet sans la démontrer.",
  },
  {
    type: "Appel à l'Autorité",
    definition:
      "fonder une affirmation sur le statut d'une personne ou d'un groupe (« des experts disent », « un médecin l'a dit ») plutôt que sur des preuves, ou invoquer une autorité hors de son domaine de compétence.",
  },
  {
    type: "Appel à la Popularité",
    definition:
      "justifier une affirmation par le nombre de personnes qui la croient ou la font (« tout le monde sait que... »).",
  },
  {
    type: "Appel à l'Émotion",
    definition:
      "remplacer l'argument par la peur, la pitié, la colère ou l'indignation pour emporter l'adhésion.",
  },
  {
    type: "Tu Quoque / Whataboutism",
    definition:
      "répondre à une critique en en retournant une autre (« et vous alors ? », « et eux ? ») sans traiter la critique initiale.",
  },
  {
    type: "Pétition de Principe",
    definition:
      "supposer vrai dans les prémisses ce qu'il faut démontrer, ou raisonner en cercle.",
  },
  {
    type: "Question Tendancieuse",
    definition:
      "poser une question qui contient une présupposition non admise (« pourquoi avez-vous arrêté de mentir ? »).",
  },
  {
    type: "Argument Anecdotique",
    definition:
      "utiliser un témoignage ou une expérience personnelle isolée comme preuve contre des données générales.",
  },
  {
    type: "Fausse Équivalence",
    definition:
      "assimiler deux situations ou deux entités sur un point commun superficiel en ignorant des différences déterminantes, pour en tirer une conclusion non démontrée.",
  },
  {
    type: "Empoisonnement du Puits",
    definition:
      "discréditer d'avance une source ou tout contre-argument (« ne les croyez pas, ils mentent toujours ») pour empêcher l'examen des faits.",
  },
  {
    type: "Procès d'Intention",
    definition:
      "attribuer à quelqu'un des motivations ou des intentions cachées, présentées comme certaines et sans preuve, pour réfuter ce qu'il dit.",
  },
  {
    type: "Argument d'Ignorance",
    definition:
      "conclure qu'une affirmation est vraie parce qu'elle n'a pas été réfutée, ou fausse parce qu'elle n'a pas été prouvée.",
  },
];

const RHETORIQUE_TYPES = RHETORIQUE_CATALOG.map((entry) => entry.type);

const SYSTEM_PROMPT = `Tu es RealityWall, un moteur d'analyse factuelle et rhétorique. \
Tu agis comme un compilateur logique froid : tu détectes des erreurs de \
logique et des écarts factuels, jamais comme un commentateur, un juge \
moral ou un militant.

RÈGLE ABSOLUE — NEUTRALITÉ :
- Tu n'exprimes jamais d'opinion politique, morale, idéologique ou personnelle.
- Tu ne dis jamais qu'une position est "bien" ou "mal", "juste" ou "injuste" \
sur le plan moral.
- Tu qualifies exclusivement des faits vérifiables, des structures logiques \
et des mécanismes rhétoriques, indépendamment du camp, de l'auteur ou du \
sujet concerné.
- Si le texte ne contient qu'une opinion pure (jugement de valeur non \
vérifiable), tu classes son statut "Hors-sujet", sans jamais indiquer si \
cette opinion est bonne ou mauvaise.
- Tu ne prends jamais parti entre deux camps politiques, religieux ou \
identitaires : tu analyses uniquement la structure logique et factuelle \
du texte qui t'est soumis.

MÉTHODE :
Tu reçois un texte extrait d'un contenu web (réseau social, commentaire, \
article, message de chat), parfois accompagné d'images, d'une capture de \
vidéo et de sous-titres. Le processus se déroule en deux temps : d'abord \
tu utilises l'outil \`web_search\` UNE SEULE FOIS au maximum, choisie avec \
soin, pour trouver une vraie source primaire officielle ; ensuite, \
une fois tes recherches terminées, tu produis une analyse structurée en \
appelant l'outil \`submit_reality_check\`, en respectant strictement les \
définitions suivantes.

1. STATUT (axe factuel) — choisis EXACTEMENT une valeur :
   - "Vrai" : l'affirmation factuelle vérifiable est exacte et correctement \
contextualisée.
   - "Faux" : l'affirmation factuelle est contredite par les données \
vérifiables disponibles.
   - "Incomplet" : l'affirmation est vraie mais omet une information \
essentielle à sa compréhension.
   - "Raccourci" : l'affirmation simplifie abusivement une réalité complexe \
au point de déformer la conclusion.
   - "Hors-sujet" : le texte ne contient pas d'affirmation factuelle \
vérifiable (opinion pure, jugement de valeur, question rhétorique, insulte \
sans contenu factuel).

2. RHÉTORIQUE (axe sophismes) — liste (peut être vide) des procédés de \
mauvaise foi détectés, choisis EXCLUSIVEMENT parmi ces catégories :
${RHETORIQUE_CATALOG.map((entry) => `   - "${entry.type}" : ${entry.definition}`).join("\n")}
   RÈGLES DE PRÉCISION (la précision prime sur l'exhaustivité) :
   - Ne signale un procédé que s'il est CLAIREMENT présent dans le texte. \
En cas de doute, ne signale rien : une liste vide est une réponse normale.
   - Une opinion, une critique virulente, une prédiction, une émotion, une \
ironie, une analogie ou comparaison argumentée ne sont PAS des sophismes en \
soi. Une comparaison qui explicite ses points communs n'est pas un homme de \
paille.
   - Au plus 3 procédés, les plus nets ; jamais deux fois la même catégorie.
   - "extrait" : cite MOT POUR MOT le passage du texte analysé où le procédé \
apparaît (120 caractères maximum). Si tu ne peux pas citer le passage, ne \
signale pas le procédé.
   - "explication" : mécanisme précis du procédé dans CE texte, de façon \
neutre et factuelle, sans jugement sur l'auteur.

3. CONTEXTE (axe cherry-picking) :
   - "probleme_detecte" (booléen) : true si le texte cite une donnée, une \
statistique ou un fait de façon tronquée, sortie de son contexte, ou omet \
une variable essentielle (ex : chiffre brut non ajusté à l'inflation, à la \
population, à une période de comparaison ; citation partielle qui inverse \
le sens du propos original).
   - "explication" : si un problème est détecté, décris précisément quelle \
variable, quelle période ou quel élément de contexte manque, de façon \
neutre et factuelle, en deux ou trois phrases au plus. Si aucun problème n'est \
détecté, renvoie une chaîne vide.

4. SOURCES (pièces à conviction) :
   - Une liste de 0 à 3 sources RÉELLES, trouvées via l'outil \`web_search\`, \
chacune avec son URL exacte et une description neutre d'une phrase de ce \
qu'elle confirme ou infirme. N'invente JAMAIS une URL que tu n'as pas \
obtenue par une recherche effective : une URL non vérifiée est pire \
qu'aucune source.
   - Cible en priorité les sources primaires officielles pertinentes selon \
le sujet : INSEE, Légifrance, Cour des comptes, Eurostat, INED, ministères, \
organismes académiques (HAL, CNRS), rapports parlementaires, ou \
équivalents internationaux reconnus (OCDE, ONU, Banque mondiale) si le \
sujet est international.
   - Ne cite jamais de site militant, de média d'opinion ou de source \
secondaire non officielle si une source primaire équivalente existe.
   - Si le texte est une opinion pure sans aucune affirmation factuelle \
rattachable (statut "Hors-sujet" sans donnée chiffrée ni fait vérifiable \
sous-jacent), ou si aucune recherche n'a abouti à une source fiable, \
renvoie une liste vide : il n'y a rien à citer.

5. MÉDIAS (images, capture de vidéo, sous-titres) :
   - Le texte entre balises <texte> est ce qui est analysé. Les images, la \
capture de la vidéo et les sous-titres sont du CONTEXTE pour comprendre de \
quoi il parle : utilise-les pour lever une ambiguïté ou vérifier une \
affirmation, sans les décrire inutilement.
   - Ne nomme jamais une personne d'après son visage. Tu peux la nommer \
uniquement si son nom est écrit dans le texte, la légende, les sous-titres \
ou une incrustation visible.
   - Le son n'est pas analysé : n'invente jamais ce qui aurait été dit \
oralement, appuie-toi uniquement sur le texte et les sous-titres fournis.

6. RÉSUMÉ : "resume" est UNE phrase neutre (160 caractères maximum) qui dit \
l'essentiel du verdict, lisible sans le reste.

7. RÉPONSE SUGGÉRÉE : "reponse_suggeree" est un message prêt à publier pour \
répondre à ce contenu de façon pragmatique, sourcée et factuelle.
   - Même langue que le texte analysé (français par défaut). Ton courtois, \
direct, sans sarcasme, sans insulte, sans moralisation ni prise de parti : \
tu corriges des faits ou pointes un raisonnement, tu ne juges pas la personne.
   - Appuie-toi uniquement sur des faits établis par tes sources : nomme \
l'organisme (« selon l'INSEE... ») mais N'ÉCRIS JAMAIS d'URL, l'extension \
ajoute elle-même le lien vérifié. Sans source fiable, n'affirme aucun chiffre \
ni fait précis : pose plutôt une question ou demande la source.
   - Réponds à ce qui est réellement écrit ; si un point du texte est exact, \
reconnais-le brièvement avant de nuancer.
   - Respecte la longueur demandée dans la consigne utilisateur.
   - S'il n'y a rien de factuel ou de logique à répondre (opinion pure, \
statut "Hors-sujet"), renvoie une chaîne vide.

FORMAT DE SORTIE :
Une fois tes recherches terminées, tu dois OBLIGATOIREMENT appeler l'outil \
\`submit_reality_check\` avec tous les champs : \`statut\`, \`resume\`, \
\`rhetorique\`, \`contexte\`, \`sources\`, \`reponse_suggeree\`. Ne produis \
aucun texte en dehors de l'appel d'outil final. N'ajoute aucune formule de \
politesse, aucun avertissement, aucune méta-explication.`;

/** Version avec filtrage dynamique (Sonnet 5, Opus 4.6+). */
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 1,
};

/** Version basique, seule disponible sur les modèles plus petits (Haiku 4.5). */
const WEB_SEARCH_TOOL_BASIC = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 1,
};

const REALITY_CHECK_TOOL = {
  name: TOOL_NAME,
  description:
    "Soumet l'analyse factuelle et rhétorique structurée d'un contenu, " +
    "avec un résumé, les sources vérifiées et une réponse suggérée, " +
    "selon les axes définis dans les instructions système.",
  input_schema: {
    type: "object",
    properties: {
      statut: {
        type: "string",
        enum: ["Vrai", "Faux", "Incomplet", "Raccourci", "Hors-sujet"],
        description: "Qualification factuelle globale du texte analysé.",
      },
      resume: {
        type: "string",
        description:
          "Une phrase neutre (160 caractères maximum) résumant le verdict.",
      },
      rhetorique: {
        type: "array",
        description:
          "Procédés rhétoriques clairement détectés (3 au maximum). " +
          "Liste vide si aucun n'est présent.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: RHETORIQUE_TYPES },
            extrait: {
              type: "string",
              description:
                "Citation exacte du texte analysé (120 caractères maximum) " +
                "où le procédé apparaît.",
            },
            explication: {
              type: "string",
              description:
                "Explication neutre et factuelle du mécanisme " +
                "rhétorique détecté dans le texte.",
            },
          },
          required: ["type", "extrait", "explication"],
        },
      },
      contexte: {
        type: "object",
        description: "Analyse du cherry-picking et des variables omises.",
        properties: {
          probleme_detecte: {
            type: "boolean",
            description: "True si un élément de contexte essentiel manque.",
          },
          explication: {
            type: "string",
            description:
              "Description neutre de l'élément de contexte manquant, " +
              "chaîne vide si aucun problème détecté.",
          },
        },
        required: ["probleme_detecte", "explication"],
      },
      sources: {
        type: "array",
        description:
          "Sources réelles trouvées via web_search (0 à 3). Liste vide " +
          "si le texte ne contient aucune affirmation factuelle " +
          "vérifiable ou si aucune recherche n'a abouti.",
        items: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL exacte de la source, obtenue via web_search.",
            },
            description: {
              type: "string",
              description:
                "Description neutre d'une phrase de ce que la source " +
                "confirme ou infirme.",
            },
          },
          required: ["url", "description"],
        },
      },
      reponse_suggeree: {
        type: "string",
        description:
          "Message prêt à publier pour répondre de façon factuelle et " +
          "courtoise, sans aucune URL. Chaîne vide s'il n'y a rien à répondre.",
      },
    },
    required: [
      "statut",
      "resume",
      "rhetorique",
      "contexte",
      "sources",
      "reponse_suggeree",
    ],
  },
};

const TARGET_LABELS = {
  selection:
    "un message ou commentaire sélectionné par l'utilisateur (la réponse " +
    "suggérée s'adresse à ce message)",
  page:
    "l'ensemble de la page : la publication principale et, s'il y en a, " +
    "ses commentaires (la réponse suggérée s'adresse à la publication)",
  media:
    "un média précis (image ou vidéo) de la page et son contexte (la " +
    "réponse suggérée s'adresse à la publication qui le contient)",
};

const REPLY_STYLE_LABELS = {
  court: "courte (280 caractères maximum, adaptée à un commentaire)",
  detaille: "détaillée (700 caractères maximum, deux ou trois paragraphes courts)",
};

/**
 * Construit le texte du message utilisateur à partir du contexte collecté
 * par l'extension : { mode, text, pageTitle, pageUrl, description,
 * captions, images, frame, notes }.
 */
function buildUserPrompt(context, webSearch = true, reply = {}) {
  const ctx = context || {};
  const lines = [
    `Cible de l'analyse : ${TARGET_LABELS[ctx.mode] || TARGET_LABELS.selection}.`,
  ];
  if (ctx.pageTitle) {
    lines.push(`Titre de la page : ${ctx.pageTitle}`);
  }
  if (ctx.pageUrl) {
    lines.push(
      `URL de la page (contexte uniquement, ne pas la citer comme preuve factuelle) : ${ctx.pageUrl}`
    );
  }
  if (ctx.description) {
    lines.push(`Description de la page : ${ctx.description}`);
  }
  lines.push(
    "",
    "Texte à analyser (délimité par des balises <texte>) :",
    "<texte>",
    String(ctx.text || "").trim(),
    "</texte>"
  );
  if (ctx.captions) {
    lines.push(
      "",
      "Sous-titres de la vidéo (contexte, délimités par des balises <soustitres>) :",
      "<soustitres>",
      ctx.captions.trim(),
      "</soustitres>"
    );
  }
  const imageCount = (ctx.images ? ctx.images.length : 0) + (ctx.frame ? 1 : 0);
  if (imageCount > 0) {
    lines.push(
      "",
      `Images jointes : ${imageCount}` +
        (ctx.frame ? " (dont une capture de la vidéo au moment de l'analyse)" : "") +
        "."
    );
  }
  if (Array.isArray(ctx.notes) && ctx.notes.length > 0) {
    lines.push("", `Limites du contexte : ${ctx.notes.join(" ")}`);
  }

  const style = REPLY_STYLE_LABELS[reply.style] || REPLY_STYLE_LABELS.court;
  lines.push(
    "",
    reply.enabled === false
      ? "Réponse suggérée : désactivée, renvoie une chaîne vide pour reponse_suggeree."
      : `Réponse suggérée : ${style}.`
  );
  lines.push(
    webSearch
      ? "\nUtilise web_search si besoin, puis appelle l'outil " +
          "submit_reality_check avec ton analyse structurée."
      : "\nLa recherche web est désactivée : n'utilise aucune recherche, " +
          "appelle directement l'outil submit_reality_check avec ton " +
          "analyse structurée, une liste sources vide et une réponse " +
          "suggérée sans fait précis non vérifiable."
  );
  return lines.join("\n");
}

/** Message de relance forçant l'appel final de l'outil après la recherche. */
function buildFinalizePrompt() {
  return (
    "Tes recherches sont terminées. Appelle maintenant l'outil " +
    "submit_reality_check avec ton analyse structurée finale. Le champ " +
    "sources doit contenir uniquement des URLs réelles obtenues via " +
    "web_search ci-dessus, jamais une URL inventée."
  );
}
