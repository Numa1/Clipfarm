# Clipfarm

Vidéos longues (podcasts, interviews, streams) → shorts verticaux 30–60 s.
V1 : éditeur web local pour un humain. Le modèle de timeline (JSON déclaratif) est conçu pour être piloté par des agents en V3.

## Démarrage

Prérequis : macOS Apple Silicon, Node 24+, pnpm, `ffmpeg`, `uv`, Claude Code (`claude`) connecté à ton abonnement.

```bash
pnpm install
pnpm setup:whisper   # whisper.cpp via Homebrew + modèle large-v3-turbo (~1,6 Go)
claude               # une fois, pour /login si ce n'est pas déjà fait
```

Deux terminaux :

```bash
pnpm dev --port 3100   # l'app → http://localhost:3100
pnpm worker            # le worker local (ingest, transcription, moments, recadrage, rendu)
```

## Pipeline

1. **Upload** (`POST /api/sources`) → fichier stocké dans `library/sources/<id>/`.
2. **ingest** : ffprobe + proxy 540p (scrub fluide) + wav 16 kHz.
3. **transcribe** : whisper.cpp en français, horodatage au mot, puis détection de la langue parlée ligne par ligne
   (modèle `base`) : les voix du contenu (cinématiques de jeu, vidéo regardée) sont marquées `[VO]` pour Claude,
   même quand whisper les a traduites en français.
4. **moments** : `claude -p` (headless, sur l'abonnement) renvoie 5–10 passages de 30–60 s avec hook et score.
5. **Monter** un moment → projet pré-découpé + texte d'accroche, puis **reframe** : détection de visage (OpenCV) → keyframes de recadrage 9:16.
6. **Éditeur** : timeline multi-pistes (couper, trim, déplacer, aimantation, undo/redo), preview Remotion, texte, SFX/musique.
7. **render** : Remotion → MP4 1080×1920 dans `library/exports/`.

Toutes les tâches lourdes passent par la file `jobs` (SQLite) consommée par `worker/`.

## Structure

| Dossier | Rôle |
|---|---|
| `src/timeline/` | **Schéma JSON de timeline** (Zod) + opérations pures (split, trim, move…) — le contrat partagé humain / agents |
| `src/remotion/` | Composition unique, utilisée par la preview (Player) et le rendu |
| `src/components/editor/` | Éditeur : store (historique), timeline, preview, inspecteur, médias |
| `src/app/api/` | Routes : sources, projets, jobs, médias (Range), SFX |
| `src/server/` | DB (Drizzle + SQLite), file de jobs, chemins de la bibliothèque |
| `worker/` | Handlers des jobs (ffmpeg, whisper, claude, OpenCV, Remotion) |
| `scripts/` | `reframe.py` (uv, OpenCV), installation de Whisper |
| `library/` | Données locales (ignorées par git) : sources, exports, sfx, `clipfarm.db` |

## Commandes

```bash
pnpm test         # tests unitaires (timeline, file de jobs, moments…)
pnpm check        # typecheck + lint + tests unitaires (lancé avant chaque commit)
pnpm test:e2e     # chaîne complète sur une vidéo générée, ~40 s (KEEP=1 garde les fichiers)
pnpm typecheck
pnpm db:generate  # après une modif de src/server/db/schema.ts
pnpm studio       # Remotion Studio sur la composition
```

`pnpm install` active le hook `.githooks/pre-commit`, qui lance `pnpm check` avant chaque commit
(`git commit --no-verify` pour passer outre une fois). `pnpm test:e2e` utilise la vraie chaîne locale (ffmpeg,
whisper, OpenCV, Remotion) et un faux Claude (`e2e/fake-claude.mjs`) : il ne consomme pas l'abonnement.

## Variables d'environnement (optionnelles)

`CLIPFARM_LIBRARY` (dossier de données), `WHISPER_BIN`, `WHISPER_MODEL`, `WHISPER_LID_MODEL` (petit modèle de détection
de langue, `models/ggml-base.bin` par défaut), `CLAUDE_BIN`, `REMOTION_LOG_LEVEL`.

`CLIPFARM_TIMEOUT_<TYPE>` (en minutes) remplace la durée max d'un job (`INGEST` 60, `TRANSCRIBE` 90, `MOMENTS` 15, `REFRAME` 30, `RENDER` 30). Au-delà, le worker l'arrête et le marque en erreur. Un job en file ou en cours peut aussi être arrêté depuis l'interface (bouton ■).

## Roadmap

- **V2** : sous-titres animés mot à mot, presets (police, couleurs, zooms, transitions, SFX, rythme).
- **V3** : agents monteur / reviewer qui écrivent la timeline via l'API, export auto, validation humaine.
- **V4** : publication YouTube Shorts / TikTok, full auto, boucle de feedback sur les stats.
