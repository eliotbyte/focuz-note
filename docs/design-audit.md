# focuz web: design audit

Date: 2026-10-25. Scope: every screen of `focuz-web` before the redesign that introduced `DESIGN.md`.
Method: read the CSS (`src/index.css`) and every component in `src/components`, then walked the app on the
local stand (Team Alice) in the in-app browser at 800 px and 375 px wide, light and dark.

Severity (from the Better Design method):

- **Blocker**: broken primary scenario, lost data, inaccessible key action, keyboard trap.
- **Error**: contrast or state failures, divergence from a rule, a missing state, inconsistent control sizes.
- **Warning**: taste, excess decoration, density, values off the scale.

Status is the state after the redesign in the same change: **Fixed**, **Partly fixed** or **Open**.

## Summary

| Severity | Found | Fixed | Partly fixed | Open |
|---|---|---|---|---|
| Blocker | 0 | 0 | 0 | 0 |
| Error | 16 | 15 | 1 | 0 |
| Warning | 50 | 45 | 2 | 3 |
| **Total** | **66** | **60** | **3** | **3** |

No blockers: every primary scenario (sign in, write, find, file, share, export) works with mouse and keyboard.
The errors are contrast, invisible focus, theme leaks and colour-only state.

## What already worked (kept)

- A material idea existed: glass panels, recessed wells, raised "water drop" controls (`.status-chip`,
  `.filter-btn`), a glowing selected row. `DESIGN.md` grows the system from these.
- Miiverse green as the only accent; folder label colours tuned per theme.
- Filter bar: two rows, the controls row never moves; chips flip green/red, the label never changes;
  picker items leave the list when added; `scrollbar-gutter: stable` on the main scroller.
- Reduced motion already stops the ambient background and the auth card animation.
- Sync state is shown by icon and label, not by colour alone.

## Global findings

| # | Sev | Where | Finding | Status |
|---|---|---|---|---|
| G1 | Error | `.button`, auth submit, `.filter-chip-select[aria-checked]` | White text on Miiverse green `rgb(82 168 44)` is 3.0:1, below AA 4.5:1. | Fixed: gel buttons use dark ink `--c-on-accent` (6.1:1 light, 8.5:1 dark). |
| G2 | Error | `--text-muted` in light | 55 % text on white is about 3.9:1 (meta, labels, counts, hints). | Fixed: 64 % (5.2:1). Placeholders use `--text-faint`. |
| G3 | Error | `+ New`, `Save as folder`, auth links, note links, `.tile-meta`, `.share-status` | Accent green used as text on light surfaces: 2.9:1. | Fixed: new role `--c-accent-ink` (6.3:1 light, 7.9:1 dark). |
| G4 | Error | focus styles | 15+ separate `:focus-visible` rules, ring in accent green: 1.9:1 on light surfaces (non-text needs 3:1). `.theme-option` has `outline: none` and no replacement; `.look-swatch`, `.look-icon`, `.pill`, tag pills have none. | Fixed: one global ring in `--c-focus`, 2 px, offset 2 px; wells glow instead. |
| G5 | Error | fonts | Only Manrope 400 and 700 are loaded; the CSS asks for 500, 600, 650 and 800, so weights are synthesized or rounded and differ between browsers. | Fixed: 400/600/700/800 self-hosted from `@fontsource/manrope`; the scale uses only these. |
| G6 | Warning | type | 15 font sizes in use (11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 20, 22, 24, 26 px). | Partly fixed: 8-step scale in `DESIGN.md`; text roles use it. Four special sizes stay and are listed as exceptions (logo 22, code entry 26, full-screen editor text 16, badge 10). |
| G7 | Warning | motion | No motion tokens; 9 durations and plain `ease`; no press feedback except a 1 px nudge on the auth button. | Fixed: duration/easing tokens; droplet press squash with spring return. |
| G8 | Error | `NoteEditor`, `ActivitiesInput`, `NoteImages` | Tailwind neutrals (`text-neutral-400`, `bg-neutral-800`, …) ignore the theme: in light the collapsed "Add note…" is 2.5:1 and activity chips are dark grey blobs. | Fixed: theme classes (`.composer-collapsed`, `.pill`, `.thumb-remove`). |
| G9 | Error | `SettingsDialog` token command | `dark:` follows the OS setting, not the app's `data-theme`. | Fixed: `.code-block` uses tokens. |
| G10 | Warning | z-index | Popovers, menus and tooltips at z 50 sit under dialogs (z 100); the full-screen editor works around it with z 210. | Fixed: z-layer tokens; floating layers at `--z-popover` (200). |
| G11 | Warning | page background | Drifting bokeh orbs (catalog: `background-glow`), not tied to any reference. | Fixed: replaced by the XMB ribbon (one ambient element, paused under reduced motion). |
| G12 | Warning | auth brand panel | Indigo glow `rgb(99 102 241)` from outside the palette (`ai-palette`). | Fixed. |
| G13 | Warning | `src/App.css`, `tailwind.config.ts` | Dead styles: the Vite template CSS is not imported; the `brand` sky-blue colours are unused under Tailwind v4. | Fixed: both files deleted. |
| G14 | Warning | status colours | Danger/warning/success are literal `rgb()` values repeated in ~20 rules with per-theme overrides. | Fixed: `--c-danger`, `--c-warn`, `--c-ok` tokens. |
| G15 | Error | filter chips, rule chips | Excluded vs required differs only by red vs green (the aria-label says it, the eye only sees colour). | Fixed: excluded chips and rule chips are struck through; width and label unchanged. |
| G16 | Warning | disabled buttons | Disabled primary is the green gel at 50 % opacity with white text (1.6:1), reads as a broken button. | Fixed: disabled gels and droplets go flat and recessed, label at `--text-faint`. |
| G17 | Warning | text glyphs as icons | `⋮` (note card), `▸` (submenus), `✓ ` (sort), `×` (attachments, activities, tags) are characters, while the rest is MUI Rounded. | Fixed: `⋮`, `▸`, `✓` and every `×` are MUI Rounded icons. |
| G18 | Warning | touch targets | Tag pills ~22 px tall, attachment remove 20 px, toast close 20 px (WCAG 2.5.8 asks 24 px). | Fixed: tag pills 26 px, small controls 24 px. |
| G19 | Error | float glass | `backdrop-filter` never applied in Chrome: the build kept only the `-webkit-` prefixed copy, so menus, dialogs and toasts had no blur. Found while verifying. | Fixed: prefixes left to the build (rule in `DESIGN.md`). |

## Screens

### Sign in / create account (`AuthScreen.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| A1 | Error | Submit is white on green (see G1). | Fixed. |
| A2 | Warning | Logo mark is a plain rounded square; nothing ties it to the product. | Fixed: green gel diamond (the Sims 2 plumbob) as the brand mark, also in the top bar. |
| A3 | Warning | Brand panel lit by indigo and green halos (see G12). | Fixed: pinstriped glass panel over the XMB ribbon. |
| A4 | Warning | The segmented tab thumb and fields are fine; the "Change" server link and switch links use accent text (G3). | Fixed. |

### Feed, list view (`App.tsx` `NoteList`, `NoteCard.tsx`, `NoteEditor.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| F1 | Warning | Card hover overlay is an inline style (black 15 % gradient + blur): a grey smear on light cards; values not tokenized. | Fixed: `.note-hover` class with per-theme tint. |
| F2 | Warning | The card's ⋮ is a text glyph; the tile's ⋮ is an icon on a black disc: two looks for one action. | Fixed: both are glass droplets with the MUI icon. |
| F3 | Warning | Tags, activities and the reply preview share the secondary-button look; tag pills are below the 24 px target. | Fixed: tags are small droplets (26 px); the reply preview is a quiet well. |
| F4 | Error | Collapsed composer "Add note…" in `text-neutral-400` (G8). | Fixed. |
| F5 | Warning | Composer actions row: "Add" (droplet), "Cancel" (droplet), "Create" (gel) have 34 px height; filter bar controls are 36 px. | Fixed: one control height `--h-md` (36 px). |
| F6 | Warning | Attachment remove "×" is a 20 px black disc with a character (G17/G18). | Fixed: 24 px glass droplet with an icon. |
| F7 | Error | The card's ⋮ button sits in an overlay at opacity 0 that only appears on mouse hover: keyboard focus lands on an invisible button. | Fixed: the strip also shows on `:focus-within`. |

### Feed, tiles view (`NoteGrid.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| T1 | Warning | Tile-size slider is a native range with `accent-color`, unrelated to the rest. | Fixed: well track with a gel thumb (WebKit and Firefox). |
| T2 | Warning | Tile hover lifts 1 px but has no glow; keyboard focus ring is accent on light (G4). | Fixed. |
| T3 | Warning | Tiles of pictures still downloading are blank white squares with no hint. | Open: needs a loading state from `NoteImages`; out of scope for a visual pass. |

### Note editors (`FullscreenNoteEditor.tsx`, `SelectionFormatBar.tsx`, `ImageEditorDialog.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| E1 | Warning | Toolbar groups are recessed wells, so buttons look like text fields; active tool is a green tint. | Fixed: groups are droplet trays; the active tool is a gel. |
| E2 | Warning | Image editor stage `#111` literal; zoom slider native. | Fixed: token `--c-media-bg`; slider styled like the tile slider. |
| E3 | Warning | Compact editor textarea is labelled only by its placeholder. | Fixed: the inline editor has an `aria-label`. |

### Thread view (`App.tsx` `NoteThread`)

| # | Sev | Finding | Status |
|---|---|---|---|
| TH1 | Warning | "Note not found" is plain text in a card with a secondary button. | Fixed: uses the empty-state pattern (`.feed-empty`) look. |

### Sidebar (`SpaceRail.tsx`, `SpaceHeader.tsx`, `FolderTree.tsx`, `FolderHeader.tsx`, `FolderDialogs.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| S1 | Warning | Space rail draws its separator above the shared spaces even when there is no personal space, leaving a stray line at the top. | Fixed. |
| S2 | Warning | Selected folder row is shown by background glow only (colour-ish). | Fixed: selected rows also go semibold. |
| S3 | Warning | "FOLDERS" label 11 px, counts 11.5 px (off scale). | Fixed: caption step (12 px). |
| S4 | Warning | Unselected space tiles look the same as the selected one apart from the bezel colour. | Fixed: XMB rule, unselected tiles are a step smaller and dimmer; hover brings them up. |
| S5 | Warning | Folder look dialog: swatches and icon cells have no focus indicator (G4). | Fixed. |

### Filter bar, filter popover, sort menu (`FilterBar.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| FB1 | Error | Chip state by colour alone (G15). | Fixed. |
| FB2 | Warning | Sort menu marks the current option with a "✓ " text prefix inside the item name. | Fixed: check icon and `menuitemradio`/`aria-checked`; the name is just the option. |
| FB3 | Warning | Picker row hover is 4–5 % tint, nearly invisible on light. | Fixed: menu rows use the selection glow on hover. |
| FB4 | Warning | "Clear" (ghost) and "Save as folder" (accent text) sit next to 30 px chips at 36 px. | Fixed: chip-row actions use `--h-sm` (28/30 px). |

### Settings dialog (`SettingsDialog.tsx`, `DataTab.tsx`, `PictureField.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| ST1 | Warning | Password fields have no visible label, only placeholders. | Fixed: visible labels above the fields, the length rule is a hint below. |
| ST2 | Error | Token command block uses the `dark:` variant (G9). | Fixed. |
| ST3 | Warning | `.filter-btn` is used as the general secondary button (Sign out, Revoke, Done) next to `.button-secondary`: two secondary looks, 34 vs 36 px. | Fixed: both are the same droplet at `--h-md`. |
| ST4 | Warning | `DialogTitle` defaults to muted 16 px and every dialog overrides it with `!text-primary !text-[17px] font-semibold`. | Fixed: the default is the h3 role; overrides removed. |
| ST5 | Error | Appearance tab: theme options remove the outline with no replacement (G4). | Fixed. |

### Export (`ExportPanel.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| X1 | Warning | Progress bars are hand-built per place; "Packing" pulses the bar (motion without information). | Fixed: `.meter` component (well + gel fill); packing shows Aqua barber stripes, static under reduced motion. |
| X2 | Error | Progress bars are `aria-hidden` and the details dialog shows `done / total` only as text. | Partly fixed: meters get `role="progressbar"` with values; the banner still relies on its text. |
| X3 | Warning | "Stop" is a secondary button with red text only. | Fixed: danger droplet (`.button-danger-quiet`). |

### Spaces (`CreateSpaceDialog.tsx`, `SpaceSettingsDialog.tsx`, `NoteShareDialog.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| SP1 | Warning | `.button-danger` is a flat red fill with white text on the gel shape; hover is the green glow. | Fixed: red gel (Luna's close button) with its own hover. |
| SP2 | Warning | Role select is a raised droplet but shows the native arrow only on some platforms. | Open: native select kept for accessibility. |

### Notifications bell, status chip, toasts

| # | Sev | Finding | Status |
|---|---|---|---|
| N1 | Warning | Bell list meta at 11.5 px; unread shown by glow and dot (fine). | Fixed (caption step). |
| SC1 | Warning | Status chip icon has a coloured `drop-shadow` glow that bleeds on light. | Fixed: glow only in dark. |
| TO1 | Warning | Toast close is 20 px and the toast has no colour cue besides the icon. | Fixed: 24 px; status toasts get a thin status rim. |

### Public page (`PublicPage.tsx`)

| # | Sev | Finding | Status |
|---|---|---|---|
| P1 | Warning | No brand mark; "Public" badge at 5 % tint is hard to see. | Partly fixed: badge is a small droplet; the page has no logo in markup (left as is). |

### Empty, loading and error states

| # | Sev | Finding | Status |
|---|---|---|---|
| EM1 | Warning | Empty feed is a centred muted line with no visual anchor. | Fixed: empty-state well with the caption text (copy unchanged). |
| EM2 | Warning | Image "Loading…" placeholder uses `text-neutral-400`. | Fixed (G8). |

### Mobile width (375 px)

| # | Sev | Finding | Status |
|---|---|---|---|
| M1 | Warning | Phone drawer appears without a transition (it mounts only when open, so the CSS transition never runs). | Fixed: slide-in keyframe; reduced motion fades. |
| M2 | Warning | Large gap between the top bar and the feed on phones (seen once, while the app was still syncing). | Open: not reproduced on a second load; looks like a race in the top-bar height measurement in `App.tsx` (layout logic, not styling). |

### Light and dark themes

| # | Sev | Finding | Status |
|---|---|---|---|
| DL1 | Warning | Light cards (97 % white) on light silver separate by shadow only; fine on desktop, flat on phones. | Fixed: glass gets a hairline rim and a top highlight in both themes. |
| DL2 | Warning | Many components re-declare dark variants with literal colours (`[data-theme='dark'] .x { color: rgb(…) }`). | Fixed: status colours are tokens that switch with the theme. |
