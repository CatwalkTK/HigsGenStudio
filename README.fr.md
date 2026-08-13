# 🎬 HIGSGEN Studio

[日本語](README.md) · [English](README.en.md) · **Français**

Un pipeline multi-agents — Claude Code + Codex CLI + Higgsfield MCP — qui transforme une demande
en une phrase en **vidéo narrative au personnage cohérent** (animé, prise de vue réelle ou 3D).
Il est livré avec une interface de montage vidéo façon Final Cut et un panneau qui visualise
le travail de l'IA en temps réel.

```
« Fais une vidéo sur une femme d'une vingtaine d'années en voyage solo à Okinawa, avec des dialogues »
        ↓
Brief → Récit → Conception du personnage → Storyboard → Prompts → Génération → Montage
        ↓
Un court métrage de 30 secondes (même visage et même tenue dans tous les plans, dialogues parlés)
```

---

## Points forts

- **Répartition multi-agents** : Claude réalise et écrit, Codex conçoit les personnages et les
  storyboards, Higgsfield génère les images et la vidéo
- **Cohérence du personnage** : un bloc de description canonique en anglais et une feuille de
  personnage passée en référence conservent le même visage et la même tenue dans chaque plan
- **Validation humaine obligatoire** : la génération vidéo est **bloquée physiquement par un hook**
  tant que l'utilisateur n'a pas validé les personnages et le storyboard
- **Garde-fou de crédits** : chaque génération est chiffrée au préalable ; tout dépassement du
  plafond du projet exige une confirmation explicite
- **Traçabilité complète** : identifiant de tâche, modèle, **prompt intégral** et crédits consommés
  sont consignés pour chaque génération
- **Animé comme prise de vue réelle** : le brief permet de choisir animé / photoréaliste / 3D stylisé

---

## 🏢 Édition Entreprise

En plus de tout ce qui précède, l'édition Entreprise embarque des **fonctionnalités de niveau Cinema Studio 4 et au-delà** :

- **Contrôle caméra** : pilotage précis des mouvements de caméra plan par plan
- **Synchronisation labiale (lip sync)** : mouvements de bouche synchronisés avec les dialogues
- Ainsi que d'autres fonctions de mise en scène de niveau Cinema Studio 4 et supérieur

---

## Répartition des rôles

| Rôle | Responsable | Missions |
|------|-------------|----------|
| Réalisation, scénario, direction d'animation | **Claude Code** | Brief, récit, prompts de génération, orchestration et vérification |
| Character designer, storyboardeur | **Codex CLI** | Documents de conception des personnages, storyboards (découpage) |
| Moteur de génération | **Higgsfield MCP** | Feuilles de personnage, clips vidéo, musique et narration |

---

## Moteurs vidéo

La vidéo est produite en **une seule génération couvrant toute la durée** (approche mono-génération).
Le moteur fixe la durée ; l'IA répartit librement les secondes entre les plans.

| Moteur | Modèle Higgsfield | Durée | Résolution | Audio | Coût approx. |
|--------|-------------------|-------|------------|-------|--------------|
| **Seedance 2.0** | `seedance_2_0` | 15 s | jusqu'à 4K | Génération native | ~67,5 cr |
| **Seedance 2.5** | `seedance_2_5` | 30 s | jusqu'à 720p | Génération native | ~195 cr |
| **MiniMax H3** | `minimax_h3` | 15 s | 2K | Enregistré séparément | ~60 cr |
| **Automatique** | résolution auto | 15 s | — | Avec dialogues → Seedance 2.0 / sans → MiniMax H3 | 60–67,5 cr |

Le **mode automatique** choisit le moteur selon la présence de dialogues : avec dialogues il retient
Seedance 2.0 (audio natif), sans dialogues MiniMax H3 (2K, le moins cher). Si le récit fait
finalement apparaître des dialogues, Claude réapplique la même règle.

---

## L'interface — HIGSGEN Studio

```bash
node ui/server.mjs   # → http://localhost:4649
```

Une disposition de montage non linéaire façon Final Cut.

```
┌──────────────┬─────────────────────┬──────────────────┐
│ Bibliothèque │ Prévisualisation    │ Activité de l'IA │
│              │                     │                  │
│ Vidéos       │  ▶ élément, document│ · état courant   │
│ Clips        │    ou entrée        │ · graphe du flux │
│ Feuilles     │    d'historique     │   (animé)        │
│ Images/audio │    sélectionné      │ · validations    │
│ Documents    │                     │ · lancer le flux │
│              │                     │ · historique IA  │
├──────────────┴─────────────────────┴──────────────────┤
│ Timeline (construite depuis le storyboard)             │
│ [Cut 1·4s][Cut 2·5s][Cut 3·5s][Cut 4·5s][Cut 5·6s]... │
│ V1 vidéo / A1 dialogues / lit sonore                   │
└────────────────────────────────────────────────────────┘
```

### À gauche — Bibliothèque
Parcourez les vidéos finales, les clips, les feuilles de personnage, les images, l'audio et tous
les documents. Un clic affiche l'élément en prévisualisation.

### Au centre — Prévisualisation
Lecteur vidéo, visionneuse d'images, rendu Markdown et entrées d'historique avec le prompt intégral.

### À droite — Activité de l'IA
- **État courant** (indicateur d'activité pendant l'exécution, ou phase en attente de validation)
- **Graphe du flux** : terminé = coche verte, en attente de validation = pulsation ambre,
  en cours = pulsation bleue avec connecteur animé
- **Portes de validation** : valider ou renvoyer personnages et storyboard avec un commentaire
- **Lancement du pipeline** : estimation du coût, copie de la consigne, exécution headless, journal
- **Historique de l'IA** : responsable (Claude 🧠 / Codex 🤖 / Higgsfield ⚡), crédits consommés,
  clic pour afficher le prompt intégral

### En bas — Timeline (avec montage)
Construite à partir du découpage du storyboard. Cliquer sur un clip déplace la lecture sur ce plan,
et le plan en cours de lecture est mis en évidence.

| Fonction | Description |
|----------|-------------|
| **Vitesse** | Retiming de 0,5x à 2x (vidéo et audio ensemble) |
| **Recadrage** | Rognage en pourcentage sur chaque bord, remis à l'échelle d'origine |
| **Rognage temporel** | Ajustement des points IN/OUT par pas de 0,1 seconde |
| **Sourdine** | Coupure du son clip par clip |
| **Séparer l'audio** | Extraction de la piste audio du programme en MP3 |
| **Export** | Application du montage par ffmpeg vers `out/<slug>_edit.mp4` |

Les modifications sont enregistrées dans `edits.json` (une EDL) ; les clips affichent des badges
(✂ ⏩1.5x 🔇) ainsi que la durée obtenue (`5s→3.3s`).

---

## Pipeline

```
Demande de l'utilisateur
   │
Phase 0  Brief (Claude / UI)          → brief.md       moteur (= durée), style, format d'image
Phase 1  Récit (Claude)               → story.md       pitch, synopsis, liste des scènes
Phase 2  Personnages (Codex→HF)       → characters.md  fiche + feuille de personnage ⟹ 【VALIDATION】
Phase 3  Storyboard (Codex)           → storyboard.md  découpage (total = durée du moteur) ⟹ 【VALIDATION】
Phase 4  Prompts de plans (Claude)    → shotlist.md    un prompt maître multi-plans
Phase 5  Génération (Higgsfield MCP)  → assets/clips/  génération unique avec la feuille en référence
Phase 6  Montage (timeline / ffmpeg)  → out/           mixage audio, ajustements, contrôle qualité
```

### Dispositifs de sécurité

| Dispositif | Description |
|------------|-------------|
| **Porte de validation** | Tant que les personnages et le storyboard ne sont pas validés, un hook PreToolUse bloque `generate_video` avec le code de sortie 2 (seules les estimations `get_cost` passent) |
| **Garde-fou de crédits** | Chaque génération est chiffrée via `get_cost` ; tout dépassement du plafond exige une confirmation |
| **Registre de génération** | Chaque tâche est consignée dans `ledger.md` (lisible) et `ledger.json` (pour l'interface, prompts intégraux) |
| **Cohérence du personnage** | Le bloc de description canonique est réutilisé mot pour mot et la feuille est passée via `image_references` |
| **Vérification préalable** | Les résultats sont contrôlés (URL ou fichier ouvert) avant toute annonce d'achèvement |

---

## Installation

### Prérequis

- **Node.js 18+** — serveur de l'interface (aucune dépendance externe)
- **Claude Code** — exécute le pipeline
- **Higgsfield MCP** — connecté à Claude Code (crédits nécessaires)
- **Codex CLI** (`codex`) — facultatif ; Claude prend le relais s'il est indisponible
- **ffmpeg / ffprobe** — montage timeline, export et séparation audio

### Démarrage

```bash
git clone https://github.com/CatwalkTK/HigsGenSutudio.git
cd HigsGenSutudio
node ui/server.mjs        # → http://localhost:4649
```

---

## Utilisation

### Option 1 — depuis l'interface (recommandé)

1. Lancez `node ui/server.mjs` et ouvrez http://localhost:4649
2. Cliquez sur « ＋Nouveau » et renseignez la demande, le moteur, le style et la présence de dialogues
3. Copiez la consigne affichée dans Claude Code — le pipeline démarre à la phase 1
4. Lorsque les personnages et le storyboard apparaissent, **validez-les** dans l'interface
   (ou renvoyez-les avec vos remarques)
5. Une fois tout validé : génération de la vidéo, montage sur la timeline, export

### Option 2 — demander directement à Claude Code

Lancez Claude Code dans ce dossier et décrivez la vidéo :

```
Fais un animé avec Seedance 2.5 sur un chat astronaute qui ouvre un restaurant de ramen sur la Lune
```

La compétence `/higsgen` prend le relais : brief → récit → personnages → storyboard → génération → montage.

Pour créer uniquement la structure d'un projet :

```bash
scripts/new-project.sh <slug>
```

---

## Structure du dépôt

```
HigsGenSutudio/
├── README.md / README.en.md / README.fr.md
├── CLAUDE.md                        # règles du projet pour Claude Code
├── AGENTS.md                        # règles du projet pour Codex CLI
├── .claude/
│   ├── skills/higsgen/              # le pipeline lui-même (une compétence)
│   │   ├── SKILL.md                 # phases et règles impératives
│   │   ├── references/              # détail des phases, délégation Codex, passation MCP
│   │   └── templates/               # modèles de livrables, prompts Codex
│   ├── hooks/gate-video.sh          # porte de validation (blocage de la génération vidéo)
│   ├── settings.json                # configuration des hooks
│   └── launch.json                  # configuration de lancement de l'interface
├── .agents/ .codex/                 # miroir de la compétence et des hooks pour Codex CLI
├── scripts/
│   ├── new-project.sh               # création de la structure d'un projet
│   └── gate-phase5.sh               # vérification des validations → délivrance du laissez-passer
├── ui/
│   ├── server.mjs                   # serveur de l'interface (sans dépendance, Node 18+)
│   └── public/                      # SPA (bibliothèque / prévisualisation / panneau IA / timeline)
└── projects/<slug>/                 # un dossier par vidéo (non suivi par git)
    ├── brief.md story.md characters.md storyboard.md shotlist.md
    ├── ledger.md / ledger.json      # registre de génération (identifiants, crédits, prompts)
    ├── approvals.json               # état des validations (personnages, storyboard)
    ├── edits.json                   # montage de la timeline (EDL)
    ├── meta.json                    # métadonnées pour l'interface
    ├── assets/{characters,frames,clips,audio}/
    └── out/                         # vidéos terminées
```

---

## Licence

MIT
