"""Jeu de données de commentaires de mauvaise foi typiques des réseaux sociaux.

Chaque échantillon associe un texte d'entrée réaliste à une sortie d'outil
plausible que renverrait le modèle. Ces sorties servent à simuler l'API
Anthropic dans les tests unitaires : elles ne sont pas générées par un
véritable appel réseau, mais valident que le pipeline complet (prompt ->
réponse simulée -> validation Pydantic) fonctionne sans jamais planter,
quel que soit le type de mauvaise foi rencontré.
"""

from __future__ import annotations

from typing import Any, TypedDict


class BadFaithSample(TypedDict):
    id: str
    text: str
    tool_output: dict[str, Any]


SAMPLES: list[BadFaithSample] = [
    {
        "id": "ad_hominem_classique",
        "text": (
            "De toute façon tu bosses dans la finance, forcément tu défends "
            "ce chiffre du chômage, ton avis ne vaut rien."
        ),
        "tool_output": {
            "statut": "Hors-sujet",
            "rhetorique": [
                {
                    "type": "Ad Hominem / Association",
                    "explication": (
                        "L'auteur disqualifie l'interlocuteur en invoquant sa "
                        "profession supposée plutôt que de discuter le chiffre "
                        "du chômage évoqué."
                    ),
                }
            ],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "INSEE taux de chômage France trimestriel",
        },
    },
    {
        "id": "strawman_ecologie",
        "text": (
            "Donc toi tu veux qu'on retourne vivre dans des grottes sans "
            "électricité juste parce que tu proposes de réduire les vols "
            "intérieurs quand un train existe."
        ),
        "tool_output": {
            "statut": "Hors-sujet",
            "rhetorique": [
                {
                    "type": "Homme de Paille (Strawman)",
                    "explication": (
                        "La proposition initiale, limitée à la réduction des "
                        "vols intérieurs disposant d'une alternative "
                        "ferroviaire, est déformée en un rejet total de "
                        "l'électricité et du confort moderne."
                    ),
                }
            ],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "loi climat résilience interdiction vols intérieurs Légifrance",
        },
    },
    {
        "id": "faux_dilemme_securite",
        "text": (
            "Soit on met des caméras partout, soit on accepte que la "
            "délinquance explose, il n'y a pas d'autre option."
        ),
        "tool_output": {
            "statut": "Hors-sujet",
            "rhetorique": [
                {
                    "type": "Faux Dilemme",
                    "explication": (
                        "Le texte réduit la politique de sécurité publique à "
                        "deux options extrêmes (vidéosurveillance généralisée "
                        "ou explosion de la délinquance), en excluant toute "
                        "mesure intermédiaire comme la prévention ou "
                        "l'îlotage."
                    ),
                }
            ],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "Cour des comptes évaluation vidéoprotection efficacité",
        },
    },
    {
        "id": "diversion_debat",
        "text": (
            "— Le budget de l'hôpital a baissé de 3 % cette année.\n"
            "— Ah oui et toi t'as vu le salaire des footballeurs pendant ce "
            "temps ?"
        ),
        "tool_output": {
            "statut": "Hors-sujet",
            "rhetorique": [
                {
                    "type": "Diversion / Esquive",
                    "explication": (
                        "Plutôt que de répondre sur le budget hospitalier "
                        "évoqué, l'auteur déplace la discussion vers un sujet "
                        "distinct, les salaires des footballeurs, sans "
                        "apporter de réponse à l'affirmation initiale."
                    ),
                }
            ],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "PLFSS budget hôpitaux évolution ONDAM",
        },
    },
    {
        "id": "cherry_picking_inflation",
        "text": (
            "Les salaires ont augmenté de 20 % en 10 ans, arrêtez de vous "
            "plaindre."
        ),
        "tool_output": {
            "statut": "Raccourci",
            "rhetorique": [],
            "contexte": {
                "probleme_detecte": True,
                "explication": (
                    "Le chiffre de 20 % correspond à une évolution en euros "
                    "courants, sans ajustement à l'inflation cumulée sur la "
                    "période, ce qui modifie substantiellement l'évolution du "
                    "pouvoir d'achat réel."
                ),
            },
            "verification": "INSEE évolution salaire net moyen euros constants",
        },
    },
    {
        "id": "fait_verifie_vrai",
        "text": "Le salaire minimum en France est fixé par décret chaque année.",
        "tool_output": {
            "statut": "Vrai",
            "rhetorique": [],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "Légifrance revalorisation SMIC décret annuel",
        },
    },
    {
        "id": "opinion_pure",
        "text": "Ce film est vraiment magnifique, j'ai adoré chaque minute.",
        "tool_output": {
            "statut": "Hors-sujet",
            "rhetorique": [],
            "contexte": {"probleme_detecte": False, "explication": ""},
            "verification": "",
        },
    },
]
