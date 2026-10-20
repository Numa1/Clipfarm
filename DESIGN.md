# Clipfarm — Design system

Source unique : **HeroUI v3** (`@heroui/react`) + **HeroUI Pro** (`@heroui-pro/react`). Aucun composant maison quand
un composant HeroUI existe. Icônes : **Gravity UI** (`@gravity-ui/icons`, le set utilisé par HeroUI, livré en
composants React — rien n'est chargé depuis le réseau, l'app reste 100 % locale).

## Direction artistique

Sobre, minimaliste, moderne, **dark only**. Un outil de montage : l'image (la preview 9:16) est la seule chose qui
a de la couleur, l'interface s'efface autour.

- **Palette monochrome.** Fond quasi noir neutre, surfaces en paliers de gris, accent = blanc cassé (boutons
  primaires blancs, texte noir). Pas de bleu « SaaS ».
- **La couleur ne porte que du sens** : `success` (prêt / exporté), `warning` (durée hors cible), `danger`
  (erreur, suppression), et trois teintes de pistes dans la timeline (vidéo, texte, audio), désaturées.
- **Profondeur par les surfaces, pas par les bordures** : `background` → `surface` → `surface-secondary`. Bordures
  et séparateurs seulement quand ils structurent (panneaux de l'éditeur, lignes de timeline).
- **Typographie** : **Manrope** (grotesque géométrique, chiffres tabulaires, très lisible en petit corps sur fond
  sombre) pour l'UI ; **JetBrains Mono** pour les timecodes et la règle de la timeline.
  Échelle courte : 24/600 titre de page · 14/600 titres de section · 14 corps · 12 secondaire (`text-muted`).
  Titres de section en casse normale, jamais en capitales. `tabular-nums` sur toute valeur numérique.
- **Rayons** : défaut HeroUI (`--radius: .5rem`), `rounded-2xl` pour les grands conteneurs.
- **Mouvement** : celui des composants HeroUI, rien d'ajouté.

## Tokens (surcharges de `.dark` dans `globals.css`)

| Token | Valeur | Usage |
| --- | --- | --- |
| `--background` | `oklch(0.145 0 0)` | canvas |
| `--surface` / `-secondary` / `-tertiary` | `0.19` / `0.225` / `0.26` | cartes, panneaux, éléments imbriqués |
| `--overlay` | `0.21` | popovers, tooltips, dialogs, toasts |
| `--default` | `0.25` | boutons secondaires, chips neutres |
| `--muted` | `0.68` | texte secondaire |
| `--accent` / `-foreground` | `0.95` / `0.16` | CTA blancs, fill des sliders/progress |
| `--border` / `--separator` | `0.25` / `0.22` | |
| `--track-video` / `-text` / `-audio` | bleu / ambre / vert désaturés | items de timeline |

## Correspondance composants

| Besoin | Composant |
| --- | --- |
| Boutons | `Button` — `primary` (une seule CTA par zone), `secondary`/`tertiary`/`ghost` pour le reste, `danger-soft` pour supprimer. Icon-only ⇒ `isIconOnly` + `Tooltip`. Chargement ⇒ `isPending` + `Spinner` |
| Liens-boutons | `next/link` + `buttonVariants()` |
| Statuts / badges | `Chip` `variant="soft"` + couleur sémantique (+ `Spinner` quand en cours) |
| Import vidéo | Pro `DropZone` |
| Progression (upload, jobs, export) | `ProgressBar size="sm"` |
| Liste des sources | `Accordion variant="surface"` (une source = un item dépliable) |
| Moments | `Card variant="secondary"` en grille |
| Liste des projets | Pro `ListView` (lignes-liens) |
| Listes vides | Pro `EmptyState` |
| Champs | `Input` / `TextArea` `variant="secondary"` (dans une surface) |
| Confirmation destructive | `AlertDialog` |
| Choix exclusifs (cadrage, plan) | Pro `Segment size="sm"` |
| Réglages numériques | `Slider` (`Label` + `Slider.Output`) |
| Couleurs du texte | `ColorSwatchPicker` |
| Raccourcis clavier | `Kbd` |
| Barres d'outils | `Toolbar` + `Separator orientation="vertical"` |
| Notifications | `Toast` (`toast.success / danger / info`) |

## Layouts

- **Bibliothèque** : header fin (wordmark), contenu centré `max-w-4xl`, `pt-12`, sections espacées de `gap-10` :
  Import → Bibliothèque → Projets.
- **Éditeur** : plein écran. Toolbar 48 px (retour · nom · état · annuler/rétablir · export) ; trois colonnes
  (médias 240 px · preview · inspecteur 288 px) séparées par une bordure ; timeline 256 px en bas.
  Panneaux latéraux sur `background`, la preview sur un fond plus profond pour faire ressortir l'image.

## Audit du plan (avant application)

1. **Collision de tokens shadcn ↔ HeroUI** : chez shadcn `muted` est un *fond* et `muted-foreground` un texte ;
   chez HeroUI `muted` est une *couleur de texte*. Il faut retirer `shadcn/tailwind.css`, tout l'ancien bloc de
   variables, et remplacer chaque `text-muted-foreground` → `text-muted`, `bg-muted` → `bg-default`. Sinon des
   fonds deviennent gris clair.
2. **Dark only** : HeroUI lit `.dark` **et** `data-theme` ; on pose les deux sur `<html>` et on supprime
   `next-themes` (ne servait qu'au Toaster sonner).
3. **API différentes** : `onClick` → `onPress`, `disabled` → `isDisabled`, `toast.error` → `toast.danger`,
   Slider à valeur scalaire avec `onChange`/`onChangeEnd` (le `commit` de l'historique doit rester sur la fin du
   geste, sinon une entrée d'historique par pixel).
4. **Accordion & polling** : le contenu d'un panneau ne doit être monté que si l'item est ouvert (chaque
   `SourcePanel` poll toutes les 2 s) ⇒ accordéon contrôlé par `expandedKeys` et rendu conditionnel.
5. **Surfaces imbriquées** : l'accordéon `surface` contient des cartes ⇒ cartes en `secondary` (palier plus
   discret), pas de seconde ombre.
6. **Raccourcis clavier de l'éditeur** : le handler global ignore les `input`/`textarea` ; le pouce du `Slider`
   React Aria est un `input[type=range]`, donc les flèches au clavier ne déclenchent pas de raccourci.
7. **Icônes** : `@iconify/react` télécharge les SVG au runtime → incompatible avec une app locale ;
   `@gravity-ui/icons` à la place.
8. **Remotion Player** : garde ses propres contrôles ; on ne le stylise pas (hors périmètre HeroUI).
9. **Nettoyage** : supprimer `src/components/ui/*` et les dépendances devenues inutiles (`@base-ui/react`,
   `shadcn`, `class-variance-authority`, `sonner`, `tw-animate-css`, `lucide-react`, `next-themes`,
   `components.json`).
10. **Token Pro** : jamais commité — `.env.local` (ignoré par git) contient `HEROUI_AUTH_TOKEN`. pnpm ne lit pas
    `.env.local` : l'exporter avant un `pnpm install` (postinstall de `@heroui-pro/react`) :
    `export $(grep HEROUI_AUTH_TOKEN .env.local) && pnpm install`.
