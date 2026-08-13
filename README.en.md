# 🎬 HIGSGEN Studio

[日本語](README.md) · **English** · [Français](README.fr.md)

A multi-agent pipeline — Claude Code + Codex CLI + Higgsfield MCP — that turns a one-line request
into a **story video with a consistent character** (anime, live-action, or 3D).
It ships with a Final Cut-style video editor UI and a panel that visualizes what the AI is doing.

```
"Make a video about a woman in her twenties travelling alone in Okinawa, with dialogue"
        ↓
Brief → Story → Character design → Storyboard → Prompts → Generation → Edit
        ↓
A 30-second short film (same face and outfit in every shot, with spoken dialogue)
```

---

## Highlights

- **Multi-agent division of labour**: Claude directs and writes, Codex designs characters and
  storyboards, Higgsfield generates images and video
- **Character consistency**: an English canonical description block plus a character-sheet image
  passed as a reference keeps the same face and wardrobe across every shot
- **Human approval gates**: video generation is **physically blocked by a hook** until the user
  approves both the characters and the storyboard
- **Credit guard**: every generation is priced first; exceeding the project cap requires explicit
  user confirmation
- **Full audit trail**: job id, model, **complete prompt** and credits spent are recorded for every job
- **Anime and live-action**: pick anime / photorealistic / 3D-stylized in the brief

---

## 🏢 Enterprise edition

On top of everything above, the Enterprise edition ships **Cinema Studio 4-level features and beyond**:

- **Camera control**: precise, per-shot camera-work control
- **Lip sync**: mouth movement synchronized to dialogue
- Plus other directing features at Cinema Studio 4 level and above

---

## Who does what

| Role | Owner | Responsibilities |
|------|-------|------------------|
| Director, screenwriter, animation lead | **Claude Code** | Brief, story, generation prompts, orchestration and verification |
| Character designer, storyboard artist | **Codex CLI** | Character design documents, storyboards (shot breakdown) |
| Generation engine | **Higgsfield MCP** | Character sheets, video clips, music and narration |

---

## Video engines

A video is produced as **one generation covering the full runtime** (single-generation approach).
The engine fixes the runtime; the AI decides how to distribute seconds across cuts.

| Engine | Higgsfield model | Runtime | Resolution | Audio | Approx. cost |
|--------|------------------|---------|------------|-------|--------------|
| **Seedance 2.0** | `seedance_2_0` | 15 s | up to 4K | Native generation | ~67.5 cr |
| **Seedance 2.5** | `seedance_2_5` | 30 s | up to 720p | Native generation | ~195 cr |
| **MiniMax H3** | `minimax_h3` | 15 s | 2K | Recorded separately | ~60 cr |
| **Auto** | resolved automatically | 15 s | — | Dialogue → Seedance 2.0 / none → MiniMax H3 | 60–67.5 cr |

**Auto mode** picks the engine from whether the piece has dialogue: with dialogue it uses
Seedance 2.0 (native audio), without dialogue it uses MiniMax H3 (2K, cheapest). If the story
turns out to need dialogue after all, Claude re-resolves the engine with the same rule.

---

## The UI — HIGSGEN Studio

```bash
node ui/server.mjs   # → http://localhost:4649
```

A Final Cut-style non-linear editing layout.

```
┌──────────────┬─────────────────────┬──────────────────┐
│ Library      │ Preview             │ AI activity      │
│              │                     │                  │
│ Final videos │  ▶ selected asset,  │ · current state  │
│ Clips        │    document or      │ · workflow graph │
│ Char sheets  │    history entry    │   (animated)     │
│ Frames/audio │                     │ · approval gates │
│ Documents    │                     │ · run pipeline   │
│              │                     │ · AI history     │
├──────────────┴─────────────────────┴──────────────────┤
│ Timeline (built automatically from the storyboard)     │
│ [Cut 1·4s][Cut 2·5s][Cut 3·5s][Cut 4·5s][Cut 5·6s]... │
│ V1 video / A1 dialogue / audio bed                     │
└────────────────────────────────────────────────────────┘
```

### Left — Library
Browse final videos, clips, character sheets, frames, audio and every document. Click to preview.

### Centre — Preview
Video player, image viewer, rendered Markdown, and history entries including the full prompt.

### Right — AI activity
- **Current state** (spinner while running, or which phase is waiting for approval)
- **Workflow graph**: done = green check, awaiting approval = amber pulse, in progress = blue pulse
  with a flowing connector
- **Approval gates**: approve or send back characters and storyboards with written feedback
- **Run pipeline**: cost estimate, copy the instruction, headless run, live log
- **AI history**: owner (Claude 🧠 / Codex 🤖 / Higgsfield ⚡), credits spent, click for the full prompt

### Bottom — Timeline (with editing)
Built from the storyboard's shot breakdown. Clicking a clip seeks the preview to that cut, and the
cut currently playing is highlighted.

| Feature | Description |
|---------|-------------|
| **Retime** | 0.5x–2x speed (video and audio together) |
| **Crop** | Crop by percentage on each edge, rescaled to the original resolution |
| **Trim** | Adjust clip IN/OUT in 0.1-second steps |
| **Mute** | Silence individual clips |
| **Detach audio** | Extract the programme audio track as MP3 |
| **Export** | Apply the edit with ffmpeg and write `out/<slug>_edit.mp4` |

Edits are stored in `edits.json` (an EDL); clips show badges (✂ ⏩1.5x 🔇) and the resulting
duration (`5s→3.3s`).

---

## Pipeline

```
User request
   │
Phase 0  Brief (Claude / UI)         → brief.md       engine (= runtime), style, aspect ratio
Phase 1  Story (Claude)              → story.md       logline, synopsis, scene list
Phase 2  Characters (Codex→HF)       → characters.md  design doc + character sheet ⟹ 【APPROVAL】
Phase 3  Storyboard (Codex)          → storyboard.md  shot breakdown (sums to engine runtime) ⟹ 【APPROVAL】
Phase 4  Shot prompts (Claude)       → shotlist.md    one multi-shot master prompt
Phase 5  Generation (Higgsfield MCP) → assets/clips/  single generation with sheet as reference
Phase 6  Edit (timeline UI / ffmpeg) → out/           audio mix, cut adjustments, QA
```

### Safety mechanisms

| Mechanism | Description |
|-----------|-------------|
| **Approval gate** | Until every character and the storyboard are approved, a PreToolUse hook blocks `generate_video` with exit 2 (only `get_cost` estimates pass) |
| **Credit guard** | Every generation is priced with `get_cost` first; exceeding the project cap requires user confirmation |
| **Generation ledger** | Every job is recorded in `ledger.md` (human-readable) and `ledger.json` (for the UI, with full prompts) |
| **Character consistency** | The canonical description block is reused verbatim in every prompt and the sheet is passed via `image_references` |
| **Verification first** | Results are checked by opening the URL or file before anything is reported as done |

---

## Setup

### Requirements

- **Node.js 18+** — the UI server (no external dependencies)
- **Claude Code** — runs the pipeline
- **Higgsfield MCP** — connected to Claude Code (credits required)
- **Codex CLI** (`codex`) — optional; the pipeline falls back to Claude if it is unavailable
- **ffmpeg / ffprobe** — timeline editing, export and audio detach

### Getting started

```bash
git clone https://github.com/CatwalkTK/HigsGenSutudio.git
cd HigsGenSutudio
node ui/server.mjs        # → http://localhost:4649
```

---

## Usage

### Option 1 — from the UI (recommended)

1. Run `node ui/server.mjs` and open http://localhost:4649
2. Click "＋New" and fill in the request, engine, style and whether there is dialogue
3. Copy the generated instruction into Claude Code — the pipeline starts at Phase 1
4. When characters and the storyboard appear, **approve** them in the UI (or send them back with notes)
5. Once everything is approved: generate the video, edit on the timeline, export

### Option 2 — ask Claude Code directly

Start Claude Code in this folder and describe the video:

```
Make an anime with Seedance 2.5 about a cat astronaut opening a ramen shop on the moon
```

The `/higsgen` skill takes over and runs brief → story → characters → storyboard → generation → edit.

To scaffold a project only:

```bash
scripts/new-project.sh <slug>
```

---

## Repository layout

```
HigsGenSutudio/
├── README.md / README.en.md / README.fr.md
├── CLAUDE.md                        # project rules for Claude Code
├── AGENTS.md                        # project rules for Codex CLI
├── .claude/
│   ├── skills/higsgen/              # the pipeline itself (a skill)
│   │   ├── SKILL.md                 # phases and hard rules
│   │   ├── references/              # phase detail, Codex delegation, MCP handoff
│   │   └── templates/               # artifact templates, Codex prompts
│   ├── hooks/gate-video.sh          # approval gate (blocks video generation)
│   ├── settings.json                # hook configuration
│   └── launch.json                  # UI launch configuration
├── .agents/ .codex/                 # mirror of the skill and hooks for Codex CLI
├── scripts/
│   ├── new-project.sh               # scaffold a project
│   └── gate-phase5.sh               # verify approvals → issue clearance
├── ui/
│   ├── server.mjs                   # UI server (no dependencies, Node 18+)
│   └── public/                      # SPA (library / preview / AI panel / timeline)
└── projects/<slug>/                 # one folder per video (not tracked by git)
    ├── brief.md story.md characters.md storyboard.md shotlist.md
    ├── ledger.md / ledger.json      # generation ledger (job id, credits, full prompts)
    ├── approvals.json               # approval state (characters, storyboard)
    ├── edits.json                   # timeline edits (EDL)
    ├── meta.json                    # metadata for the UI
    ├── assets/{characters,frames,clips,audio}/
    └── out/                         # finished videos
```

---

## Licence

MIT
