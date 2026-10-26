# DESIGN.md — focuz

This file is the single source of interface values for `focuz-web`. Read it in full before any UI work.
Use values by role or token name; never eyeball a colour, size, radius, shadow or duration. If no role
fits, add the role here **and** as a token in `focuz-web/src/index.css` in the same change, and say so in
your report. A value that is in neither place is a defect.

Updated: 2026-10-25. Audit that led to it: [`docs/design-audit.md`](docs/design-audit.md).

---

## 1. Direction

**Concept.** *Water on a console's glass.* focuz looks like the home screen of a calm 2005–2012 device:
a silver or black XMB canvas with a slow ribbon of light, glass panels laid on it, and every control you
press is a drop of water (clear) or a drop of green gel (the action). Notes are the content; the chrome is
the device.

**Qualities.** Tactile (you can tell what is pressable by its material), calm (one moving thing on the
screen, everything else answers your hand), legible (gloss never costs contrast).

**Avoid.** Pastiche (no fake title bars, Start buttons, XP balloons or Sims fonts); flat "modern minimal"
(controls without material); neon glass (glows that carry no state).

**Motion character.** Liquid: controls squash a little when pressed and spring back with a small
overshoot; panels slide like Aqua sheets; the background ribbon drifts too slowly to notice.

**Signature details.**
1. The droplet: clear water droplets for controls, green gel droplets for the main action.
2. The XMB ribbon behind everything, and XMB selection (the current item glows; unselected space tiles
   are a step smaller).

### What each reference contributes

Principles only; no assets, logos or fonts are copied.

| Reference | Taken | Where in focuz |
|---|---|---|
| **PSP / PS3 XMB** | Smooth silver (light) and black (dark) gradient canvas; the slow wave ribbon; selection by glow, not by a cursor; unselected icons shrink a step. | Page canvas and ribbon (`body::after`); `.filter-row-selected`, `.settings-nav-item[aria-selected]`, menu highlight; space rail scale. |
| **Wii U / Miiverse** | Miiverse green as the one accent; round water-drop buttons with light inside from the top left; thick rounded bezels around tiles; bouncy press. | `--c-accent`; `--shadow-drop` (the seed: `.status-chip`, `.filter-btn`); `.space-rail-btn` bezel; press spring `--ease-drop`. |
| **Mac OS X Aqua** | The gel: a bright specular capsule on the top half and a lighter caustic at the bottom; dark text on a light gel; the default button that draws the eye (pulse) → one gloss sweep when the action becomes available; sheets that slide from the top; pinstripes on chrome; barber-pole indeterminate progress. | `.button` (gel); `.button-default`; dialog entrance; `--pinstripe` on dialog title bands and the sign-in brand panel; `.meter.is-indeterminate`. |
| **Windows 7 Aero** | Glass that blurs what is behind floating layers; a white rim light on glass; hot-track glow on hover; the close button that glows red. | `.glass-float` (`--blur-float`); `--shadow-surface` top rim; `--shadow-drop-hover`; `.icon-btn-close:hover`. |
| **Windows XP Luna** | Friendly, saturated status colours on rounded "plastic" parts: green = go, red = close/danger; bold, round headings. | `--c-danger-gel` red gel (`.button-danger`); 700/800 weights for titles. |
| **The Sims 2** | The plumbob: a green gem marking "this one / alive"; needs bars as rounded meters with a glossy fill. | Brand mark `.brand-mark` (green gel diamond); `.meter` (well + gel fill). |

Why it holds together: all six are the same era's answer to one question (make software feel like a
friendly physical object). We keep one material vocabulary (glass, well, droplet, gel, glow) and one accent,
and borrow each reference's *principle* into that vocabulary, so the result reads as one system.

---

## 2. Code tokens

| Platform | File | Convention |
|---|---|---|
| Web (only platform) | `focuz-web/src/index.css`, `:root` (light) and `[data-theme='dark']` | CSS custom properties. Colours are RGB triplets (`--c-*: 82 168 44`) used as `rgb(var(--c-accent))` or `rgb(var(--c-accent) / 0.2)`. Materials are full `background` / `box-shadow` values. |

The theme is the `data-theme` attribute on `<html>` (`src/lib/theme.ts`). Never use Tailwind's `dark:`
variant: it follows the OS, not the app. Units: CSS px; Tailwind spacing step 1 = 4 px.

Tailwind utilities are fine for layout (flex, grid, gap, padding on the spacing scale). Colours, radii,
shadows, font sizes and durations come from the tokens or from the component classes below, never from
Tailwind palettes (`neutral-400`, `bg-black/60`, …) or arbitrary literals (`text-[17px]`). Type helpers:
`.text-small` (13), `.text-caption` (12); Tailwind `text-sm` (14) and `text-xs` (12) match `--fs-ui` and
`--fs-caption`.

Two build facts to keep in mind:
- The component classes in `index.css` are unlayered, so they win over Tailwind utilities. Never give a
  component class a `display` (or another property) that a Tailwind utility on the same element must
  control (`hidden`, `md:block`); `.brand` has no `display` for this reason.
- Don't hand-write `-webkit-` prefixes (`backdrop-filter`, `mask-image`): the build (Lightning CSS) adds
  them, and when both are written it can keep only the prefixed one, which Chrome ignores.

---

## 3. Fonts

| Role | Family | Fallback | Weights | Loading | Coverage |
|---|---|---|---|---|---|
| UI and text | Manrope | Frutiger, Segoe UI, Lucida Grande, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif | 400, 600, 700, 800 | Self-hosted, `@fontsource/manrope` (OFL), imported in `src/main.tsx` | Latin, Latin Ext, Cyrillic, Greek |
| Code, numbers in tokens | system mono | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (`--font-mono`) | 400 | System | – |

Manrope is round and open like the Wii U and XMB system fonts, and it covers Cyrillic (notes are often in
Russian). The proprietary fonts of the references appear only as fallbacks. Counts and progress use
`font-variant-numeric: tabular-nums`. No other families, no other weights.

## 4. Type scale

| Role | Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| display | `--fs-display` | clamp(30px, 3.1vw, 40px) / 1.1 | 800 | -0.025em | Sign-in tagline only |
| h1 | `--fs-h1` | 24px / 1.2 | 800 | -0.02em | Sign-in heading, public note title |
| h2 | `--fs-h2` | 20px / 1.25 | 700 | -0.01em | Folder title, mobile top-bar view title (17px there) |
| h3 | `--fs-h3` | 17px / 1.3 | 700 | 0 | Dialog titles (`DialogTitle` default), section headings |
| body | `--fs-body` | 15px / 1.5 | 400 | 0 | Note text, inputs |
| ui | `--fs-ui` | 14px / 1.4 | 400; 600 when selected | 0 | Buttons, menus, tree rows, dialogs |
| small | `--fs-small` | 13px / 1.4 | 400 | 0 | Meta, chips, tags, hints, toasts' description |
| caption | `--fs-caption` | 12px / 1.35 | 600 when uppercase label, else 400 | 0.06em for uppercase | Section labels (`.settings-label`), counts, timestamps |

Tiles scale their own type with the tile width (`clamp(11px, 7.2cqi, 14.5px)`); that is the one exception.

---

## 5. Colour

Roles, values per theme, and code tokens. "Ink" means a colour meant for text and icons.

| Role | Token | Light | Dark | Use |
|---|---|---|---|---|
| Canvas | `--page-bg` (`--c-page-top`, `--c-page`) | silver gradient #f4f5f7 → #d3d7dd | black gradient #22252a → #08090a | Page behind everything |
| Surface | `--c-surface` | 250 251 252 | 27 29 34 | Opaque surface colour (option lists, fallbacks) |
| Glass | `--glass` | white 94 % | 28 30 35 at 94 % | Cards, sidebar, tiles |
| Float glass | `--glass-strong` | 250 251 252 at 95 % + blur | 30 32 38 at 94 % + blur | Menus, popovers, dialogs, toasts |
| Text | `--text-primary` | text 94 % | white 94 % | Body and titles |
| Muted text | `--text-muted` | text 64 % | white 62 % | Meta, labels, secondary |
| Faint text | `--text-faint` | text 42 % | white 40 % | Placeholders and disabled labels only |
| Hairline | `--line` / `--line-strong` | text 10 % / 18 % | white 10 % / 18 % | Separators, outlines |
| Accent (fill) | `--c-accent` | 82 168 44 (Miiverse green) | 122 196 80 | Gels, indicators, selection rims, meters |
| Accent ink | `--c-accent-ink` | 40 110 20 | 122 196 80 | Accent-coloured text and icons on surfaces (links, "+ New", required chips) |
| On accent | `--c-on-accent` | 18 22 30 | 18 22 30 | Text on green gel (dark ink, as on Aqua's gel) |
| Focus | `--c-focus` | 40 110 20 | 140 210 96 | Focus ring |
| Danger | `--c-danger` | 200 30 30 | 239 90 90 | Errors, destructive text, excluded chips |
| Danger gel | `--c-danger-gel` | 196 40 40 | 196 40 40 | Destructive confirm buttons, with white text |
| Warning | `--c-warn` | 180 83 9 | 251 191 36 | Offline, pending, caps lock |
| OK | `--c-ok` | 40 110 20 | 122 196 80 | Synced, saved, password checks |
| Smart folder | `--c-smart` | 139 92 246 | 167 139 250 | Funnel badge on smart folders only |
| Media | `--c-media-bg` | 0 0 0 | 0 0 0 | Behind pictures and in the image editor |
| Scrim | `--scrim` | 10 14 20 at 45 % | black 60 % | Behind dialogs and the phone drawer |

Folder label colours (`.folder-color-*`, ten hues, deeper on light, brighter on dark) are user data, not
roles; use them only for folder icons and swatches.

### Measured contrast (WCAG 2.2)

| Pair | Light | Dark | Needs |
|---|---|---|---|
| Text on surface | 15.0 | 14.9 | 4.5 |
| Muted text on surface / on canvas | 5.4 / 5.0 | 7.2 / 7.4 | 4.5 |
| Accent ink on surface / on canvas | 6.1 / 5.1 | 7.9 | 4.5 |
| On-accent ink on accent (gel middle) | 6.0 | 8.5 | 4.5 |
| White on danger gel | 5.7 | 5.7 | 4.5 |
| Danger on surface | 5.5 | 5.0 | 4.5 |
| Warning on surface | 4.9 | 10.1 | 4.5 |
| Focus ring on surface | 6.1 | 9.2 | 3 |
| Faint (placeholder) on surface | 2.7 | 3.8 | exempt; never for real text |

The gel's bottom stop is darker (4.0 light): button text sits on the middle stop, so keep label padding
symmetric. The green gel against a light surface is 2.9:1, so every gel keeps its darker rim
(`--shadow-gel`), which gives the 3:1 boundary.

**Never state by colour alone.** Pair colour with a second cue: required vs excluded chips (excluded is
struck through), selected rows (glow **and** weight 600), sync status (icon **and** label), errors (icon or
text), unread notifications (dot **and** highlight).

---

## 6. Materials and elevation

Five materials. Each thing on screen is exactly one of them; choose by what it *does*.

| Material | Tokens | Is | Examples |
|---|---|---|---|
| **Glass** (level 1) | `--glass`, `--glass-sheen`, `--shadow-surface` | A panel that holds content. White rim light on the top edge, hairline, soft shadow. | `.card`, `.surface`, sidebar panel, `.note-tile` |
| **Float glass** (level 2–3) | `--glass-strong`, `--shadow-float`, `--blur-float` | A layer above the page; blurs what is behind (Aero). | `.glass-float`: menus, popovers, tooltips, toasts, dialogs, `.sel-bar`, export banner |
| **Well** | `--field-bg`, `--shadow-field`, `--glow-focus`, `--glow-invalid` | A recessed place you type into or that holds a value. Glows green when focused. | `.input`, `.filter-search`, `.seg` track, `.meter` track, slider track |
| **Droplet** | `--drop-bg` (= `--drop-gloss` + `--drop-tint`), `--shadow-drop`, `--shadow-drop-hover`, `--shadow-drop-press` | A clear water drop: anything you press that is not the main action. Light enters from the top left (Wii U); a specular highlight sits on the top half (Aqua). | `.button-secondary`, `.filter-btn`, `.status-chip`, `.pill`, `.drop-btn`, `.seg [aria-pressed=true]`, `.theme-option` |
| **Gel** | `--gel-tint`, `--gel-bg`, `--shadow-gel`, `--shadow-gel-hover` | A coloured drop: the main action, or a state that is "on". | `.button`, `.button-danger`, switch on, `.filter-chip-select[aria-checked=true]`, `.meter-fill`, `.fse-tool[data-active]`, `.bell-badge`, brand mark |

Plus one state, not a material:

| State | Tokens | Is |
|---|---|---|
| **Selection glow** (XMB) | `--select-bg`, `--shadow-select` | The current item in a list: a lit glass strip with a green rim and glow, text at 600. Tree rows, settings nav, menu highlight, unread notifications. The rim and glow reach about 10px outside the row: a scrolling list clips them sideways, so give it room (`-mx-2 px-2` inside a padded card). |

**Pinstripes** (`--pinstripe` with `--band-gloss`, Aqua) mark *chrome*, never content: the title band of
dialogs (`.dialog-sheet::before`), the full-screen editor toolbar and the sign-in brand panel. Nowhere else.

**Gel scope (implementation rule).** CSS custom properties are computed where they are declared, so
`--gel-bg`, `--shadow-gel` and `--shadow-gel-hover` are declared on the gel elements themselves (the
`:where(...)` list under "Gel scope" in `index.css`). To make a new gel, add its selector to that list and set
only `--gel-tint` on it (`--c-danger-gel`, a folder colour `--fc`, …). Setting `--gel-tint` on an element
that is not in the list does nothing.

**Droplet layers.** When a droplet needs its own tint (warning chip, accent action), combine
`var(--drop-gloss)` with a colour; never `var(--drop-bg), <colour>` (a colour is only valid as the last
background layer).

**Elevation rules.** Glass may sit on the canvas only. Float glass may sit on anything. Never nest glass in
glass (a card inside a card): group with spacing and headings instead. Wells and droplets may sit on glass
or float glass.

### z-layers

| Token | Value | Layer |
|---|---|---|
| `--z-topbar` | 50 | Top bar |
| `--z-banner` | 60 | Export banner, selection format bar |
| `--z-drawer` | 80 | Phone drawer |
| `--z-overlay` / `--z-modal` | 90 / 100 | Dialog scrim / dialog, full-screen editor |
| `--z-overlay-stacked` / `--z-modal-stacked` | 110 / 120 | A dialog opened from a dialog |
| `--z-popover` | 200 | Menus, popovers, tooltips (always above dialogs that opened them) |

Classes: `.layer-overlay`, `.layer-modal`, `.layer-overlay-stacked`, `.layer-modal-stacked`, `.layer-popover`.
Toasts are Sonner's own top layer.

---

## 7. Spacing, radii, sizes

**Spacing scale** (`--space-N`, Tailwind step in brackets): 4 (1), 8 (2), 12 (3), 16 (4), 20 (5), 24 (6),
32 (8), 48 (12).

- Inside a control: 4–8. Between related items (chips, buttons in a row): 6–8. Between groups: 12–16.
  Between sections of a dialog: 20–24. Card padding `--pad-surface` 16. Screen edge: 16 on phones, 24 on
  desktop.
- Padding is never smaller than the gaps it holds. Siblings of one kind share one gap set on their parent.

**Radii.**

| Token | Value | Role |
|---|---|---|
| `--r-sm` | 8px | Menu items, tree rows, small inner cells |
| `--r-md` | 12px | Wells (inputs, search), thumbnails, toasts, small panels |
| `--r-lg` | 16px | Glass and float glass: cards, tiles, sidebar, popovers, dialogs |
| `--r-pill` | 999px | Every droplet and gel |

Nested corners: inner radius = outer radius − inset (a menu item in a 6px-padded menu: 16 − 6 ≈ 8 → `--r-sm`).
Aliases kept for old code: `--radius` = `--r-lg`, `--radius-control` = `--r-md`.

**Control heights.**

| Token | Value | Use |
|---|---|---|
| `--h-sm` | 28px | Chips, tags, chip-row actions, tool buttons in menus |
| `--h-md` | 36px | Buttons, droplets, filter bar, inputs in bars, status chip (30 in the top bar) |
| `--h-lg` | 44px | Sign-in fields and submit; touch-first primary actions |

Minimum target 24×24 everywhere (WCAG 2.5.8), 40×40 for touch-only controls (`pointer: coarse`).

**Icons.** One set: MUI Icons, **Rounded** variant (`@mui/icons-material/*Rounded`). Sizes `--icon-sm`
16px (`.icon-sm`, inline with text), `--icon-md` 20px (editor tools), `--icon-lg` 22px (`.icon-35`, top
bar). Icons sit beside a text label, or the button has an `aria-label`. No text characters as icons (`⋮`,
`▸`, `✓`, `×`): use `MoreVertRounded`, `ChevronRightRounded`, `CheckRounded`, `CloseRounded`.

---

## 8. Components

Every class below lives in `src/index.css`. Reuse it; add a variant here before styling one locally.

### Buttons

| Variant | Class | Material | Height | Padding | Text |
|---|---|---|---|---|---|
| Primary | `.button` | Green gel | `--h-md` | 0 16 | `--fs-ui` 600, `--c-on-accent` |
| Primary, attention | `.button.button-default` | Green gel + one gloss sweep when it becomes enabled | same | same | same |
| Secondary | `.button.button-secondary` | Droplet | `--h-md` | 0 16 | `--fs-ui` 600, `--text-primary` |
| Destructive | `.button.button-danger` | Red gel | `--h-md` | 0 16 | white 600 |
| Destructive, quiet | `.button.button-secondary.button-danger-quiet` | Droplet | `--h-md` | 0 16 | `--c-danger` |
| Compact droplet | `.filter-btn` | Droplet | `--h-md` | 0 14 | `--fs-small`, muted → primary on hover |
| Ghost | `.filter-btn.filter-btn-ghost` | none until hover (tint) | inherits | | muted |
| Accent text | `.filter-btn.filter-btn-accent`, `.link-btn`, `.folder-new-btn` | none | | | `--c-accent-ink` |
| Icon | `.icon-btn` (+ `.icon-35` for 22px icons) | none; radial hover light | 32–34 | 6 | muted → primary |
| Close (dialogs) | `.icon-btn.icon-btn-close` | as icon; hover glows red (Aero) | | | |
| Round glass | `.drop-btn` | Droplet on float glass | 32 round | | primary |

One primary (gel) per task region. Labels name the action ("Create", "Export", "Sign in").

**States** (all variants):

| State | Droplet | Gel |
|---|---|---|
| Rest | `--shadow-drop` | `--shadow-gel` |
| Hover (`hover: hover` only) | `--shadow-drop-hover` (green hot-track glow), text to primary | `--shadow-gel-hover`, brightness 1.05 |
| Press | `--shadow-drop-press` + `scale(var(--press-scale))` in `--dur-instant`, spring back with `--ease-drop` | same scale, brightness 0.95 |
| Focus-visible | global ring: 2px `--c-focus`, offset 2px | same |
| Disabled | flat (`--field-bg`, no shadow), label `--text-faint`, `cursor: not-allowed` | same: the gel drains to a well |
| Pending | label stays, a 16px spinner (`.auth-spinner`) replaces or precedes the icon; button disabled | same |

### Chips and tags

| Kind | Class | Look |
|---|---|---|
| Filter chip, required | `.filter-chip` | Green-tinted gel, `--h-sm` + 2, text `--c-accent-ink` |
| Filter chip, excluded | `.filter-chip.filter-chip-neg` | Red-tinted gel, text `--c-danger`, label struck through |
| Filter chip, flag | `.filter-chip.filter-chip-flag` | Droplet |
| Tag on a note | `.pill.pill-tag` | Small droplet, 26px, `--fs-small` |
| Rule chip (read-only) | `.rule-chip-tag` / `.rule-chip-without` | Outline only (not pressable): green / red, excluded struck through |
| Choice chip | `.filter-chip-select` | Droplet; `aria-checked=true` → green gel |
| Role badge | `.role-badge` | Quiet well, `--fs-caption` |

A click on a filter chip flips required ↔ excluded; the label never changes and the chip never changes
width. Only × removes it.

### Inputs

`.input`: well, `--r-md`, min-height `--h-md`, padding 0 12 (textarea: 8 12), `--fs-body` (14 in bars).
Placeholder `--text-faint`. Focus: `--glow-focus` (green rim + glow) instead of the ring. Invalid
(`aria-invalid=true`): red rim + glow, and an error line below in `--c-danger` with `role="alert"`.
Label above the field (`.auth-label`, `--fs-small` 600), hint below (`.auth-hint`, `--fs-small` muted).
Checkboxes use `accent-color: rgb(var(--c-accent))`. Switches: `.settings-switch` (well track, gel when on).
Range sliders: none in the app; a choice of a few steps is a − n + stepper (`.tile-stepper`), and the picture
editor crops with a frame (below), not a zoom slider.

### Menus, popovers, tooltips

Float glass, `--r-lg`, padding 6, `layer-popover`. Items (`.dropdown-item`): `--r-sm`, 32px min height,
`--fs-ui`, muted; highlighted = selection glow. Separators: 1px `--line`. Destructive items `.menu-danger`.
Radio-like items (sort) use `role="menuitemradio"` + `aria-checked` and a `CheckRounded` icon.
Submenu arrow: `ChevronRightRounded`. Enter (`.dropdown-menu`, `.pop-anim` on popovers and tooltips): fade +
scale from 0.97 at the trigger origin, `--dur-small` `--ease-enter`; exit `--dur-micro`. Tooltips: float glass, `--fs-caption`, padding 6 10.

### Dialogs

`DialogContent` (`src/components/ui/dialog.tsx`): float glass, `--r-lg`, `.dialog-sheet` (title band with
gloss and pinstripes, 56px), width `min(92vw, 32rem)` (settings 46rem, one fixed height for all its sections so the nav never moves). Title = `DialogTitle` default
(h3); don't override its size or colour. Close = `.icon-btn.icon-btn-close` top right. Actions bottom
right: secondary(ies) then the primary gel last. Enter: Aqua sheet (from 8px above, fade),
`--dur-medium` `--ease-enter`; scrim fades. Stacked dialogs pass `stacked`.

### Cards, tiles, list rows

- Note card: glass, `--pad-surface`, gap 12 between images, text, tags, footer. Footer `--fs-small` muted.
  In the feed the whole card opens the note (`.note-card-openable`); controls inside it keep their own
  clicks and selecting text does not open it. The relative date is the link to the note (`.note-date-link`).
  ⋮ (`.note-more`, 26px icon button) ends the footer row: hidden until the card is hovered, its place
  kept so nothing shifts, always shown on touch. No overlay or tint on hover.
- Tile: glass square, `--r-lg`, hover lifts 2px with the hot-track glow; picture tiles keep text on a
  dark fade.
- Tree rows (`.filter-row`): 32px, `--r-sm`; hover tint 6 %; selected = selection glow + 600.
- Member rows, bell items, settings rows: 40px min, `--r-sm`.

### Tabs and segmented controls

- Segmented (`.seg`, `.auth-tabs`): well track; the selected segment is a droplet (`aria-pressed`/
  `aria-selected`), text 600.
- Settings nav (vertical, `role="tab"`): rows with selection glow when selected.
- Underline tabs (`.settings-tab`): accent ink underline 2px + 600.

### Toasts

Sonner, unstyled + `.toast*`. Float glass, `--r-md`, `--fs-ui`; icon coloured by status and a 1px status
rim (`.toast-success|error|warning|info`). Action = small green-tinted button (`.toast-action`). Close 24px
droplet, visible on hover/focus (always on touch).

### Progress

`.meter` > `.meter-fill`: Sims-style needs bar. Well track 6px tall, `--r-pill`; the fill is a green gel
with a highlight. Determinate: `role="progressbar"` with `aria-valuenow/min/max` and an `aria-label` on `.meter`; never put a
meter inside a button (its role is flattened into the button's name).
Indeterminate (`.meter.is-indeterminate`): Aqua barber stripes moving at `--dur-expressive` per stripe,
static stripes under reduced motion. Spinners: `.auth-spinner` (16px), `.upload-spinner` (12px).

### Small parts

| Part | Class | Look |
|---|---|---|
| Collapsed composer ("Add note…") | `.composer-collapsed` inside `.card` | Muted text button, primary on hover |
| Composer text | `.inline-editor` in an `.input` well | Rich text (tiptap, stored as Markdown): typed Markdown turns into formatting, a `.sel-bar` appears over selected text |
| Composer tools | `.composer-tool` (photo, date) | 34px icon buttons in the bottom row, no material until hover; the date shows its day (`.has-label`) only when it is not today |
| Picture thumbnail while writing | `.thumb-cell` (`.is-target` while dragging over) | `--c-media-bg`, `--r-md`, well shadow |
| Document of a note | `.file-list` > `.file-chip` (`.file-chip-main`, `.file-chip-action`) | Droplet at `--h-md`: MUI Rounded icon for the kind (muted), name (truncated at 28ch), size in caption. Click opens a preview for text, Markdown, CSV, PDF and .docx, and downloads anything else. The end button is download (in the note) or remove (in the editor). Upload badge on the top-right corner. Same chip, as a link, on the public page |
| Document preview | `DocumentPreviewDialog` (`.doc-preview-body`) | Dialog 45rem wide; the content in a well, max 60vh (PDF 70vh), scrolls. Text in mono `--fs-small`, Markdown through the note renderer, CSV as a table with a sticky header, PDF as white sheets (`.pdf-page`, drawn when scrolled near), Word as note prose (`.docx-view`) |
| Documents of a tile | `.tile-files` | Caption line under the text: icon and first file name, "+N" for the rest |
| Control on a picture | `.thumb-remove`, `.thumb-edit` | 24px dark disc with `CloseRounded` / `EditRounded` |
| Remove × inside a pill | `.pill-x` | 18px round, muted |
| Code to copy | `.code-block` | Well, mono caption |
| Card ⋮ | `.note-more` (+ `.is-open` while its menu is open) | 26px icon button at the end of the footer row |
| Tiles per row | the tiles button of the layout `.seg`, while tiles are on | Opens `.tile-stepper` (− n +, droplet buttons, no caption) |
| Section label in the sidebar | `.tree-label` | Caption, 600, uppercase, 0.06em |
| Phone drawer | `.drawer-sheet`, `.drawer-scrim` | Float glass sheet; scrim fades |
| Crop frame (picture editor) | `.crop-frame`, `.crop-handle-*`, `.crop-grid`, `.crop-shade` | The whole picture stays in view; a white frame with a 3×3 grid sits on it, outside is dimmed. Corners (and sides, when the shape is free) resize, inside moves, arrows move, Shift+arrows resize. Round pictures show a circle in a square frame. Hit areas 32px, 44px on touch |
| Brand mark | `.brand` (on the "focuz" heading), `.auth-logo` | Green gel diamond before the word |

### Empty, loading, error states

- Empty list: `.feed-empty`, a dashed quiet well with one line of muted text that says what will appear,
  plus the action if there is one ("Create one with “New”").
- Loading: show the layout's own skeleton or keep the last content; never a full-screen spinner after
  sign-in. Pictures still downloading: their box with `--c-media-bg`; in tiles with a centred 12px
  `.upload-spinner` (`.tile-media-loading`) and `aria-busy` on the tile's media.
- Error: inline next to what failed, `--c-danger` text with an icon or a `role="alert"` line, plus a way to
  retry. Toasts only for events, not for continuous state (the status chip shows that).

### App chrome

- Top bar: transparent over a canvas-coloured fade; brand `focuz` with `.brand-mark` (green gel diamond).
  Right side: status chip (droplet, 30px), bell, settings (`.icon-btn .icon-35`).
- Sidebar: space rail (Wii U bezel tiles, 46px; selected tile has a green bezel and the side pill;
  unselected tiles are `scale(0.9)` and slightly dimmer, XMB) + glass panel with space header and folder
  tree.
- Phone drawer: float glass sheet sliding from the left (`--dur-medium`).

---

## 9. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 70ms | Press down, colour on press |
| `--dur-micro` | 120ms | Hover, focus glow, checkbox, small state icons, menu exit |
| `--dur-small` | 180ms | Menus, popovers, tooltips, toasts, row expand, header hide |
| `--dur-medium` | 260ms | Dialogs, drawer, tab thumb, space tile scale |
| `--dur-large` | 380ms | Layout shifts (rare) |
| `--dur-release` | 420ms | Droplet spring back after press |
| `--dur-expressive` | 700ms | Gloss sweep on `.button-default`; one barber stripe |
| `--ease-standard` | cubic-bezier(0.2, 0, 0, 1) | Movement within the screen |
| `--ease-enter` | cubic-bezier(0, 0, 0, 1) | Things arriving |
| `--ease-exit` | cubic-bezier(0.3, 0, 1, 1) | Things leaving (exits ≈ ⅔ of the entrance) |
| `--ease-drop` | cubic-bezier(0.34, 1.56, 0.64, 1) | Droplet release, space tile scale (small overshoot, Wii U) |
| `--press-scale` | 0.96 | Droplet and gel press squash |

Rules:
- Every movement has a job: feedback (press, hover, focus), causality (sheet from its trigger), or
  orientation (drawer, selection). Animate `transform`, `opacity`, `box-shadow`, `filter`, colours. Never
  `transition: all`.
- Press responds within `--dur-instant` and never delays the action.
- Only droplets, gels and space tiles overshoot. Text, panels, dialogs and pages never bounce.
- One ambient element per screen: the XMB ribbon (`body::after`, 120 s per loop, linear). Nothing else
  loops except spinners and the indeterminate meter, which mean "working".
- No pulsing badges or dots, no scroll reveals, no intro cascades.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the ribbon stops; press, hover and selection keep
  their colour and shadow changes but lose scale and movement; dialogs and drawer fade; barber stripes
  stand still; spinners slow down.

---

## 10. Accessibility

- WCAG 2.2 AA: text 4.5:1, large text and UI boundaries 3:1 (see the contrast table).
- Focus: one global `:focus-visible` ring, 2px `--c-focus`, offset 2px (`-2px` inside clipped containers).
  Wells show `--glow-focus` instead. Never remove an outline without a replacement.
- State never by colour alone (section 5).
- Targets: 24px minimum, 40px on coarse pointers for icon-only controls.
- Every icon-only button has an `aria-label`; decorative icons are `aria-hidden`.
- Keep keyboard paths: menus (Radix), tree (arrows, F2), chips (Enter/Space flips), dialogs (Esc).
- Reduced motion as in section 9.

---

## 11. Layout

- Breakpoints: Tailwind `sm` 640, `md` 768 (sidebar appears), `xl` 1280. Below `md` the folder tree moves
  into the drawer and the top bar shows the current view title.
- Desktop grid: sidebar 304px (324 at `xl`) + feed 620px, centred, max width 1440; tiles take the full
  remaining width.
- Feed: one column of cards, gap 12. Tiles: square grid, 2–8 per row as the width allows, picked from the
  tiles button in the toolbar.
- The main scroller keeps `scrollbar-gutter: stable`. The top bar hides on scroll down and returns on
  scroll up (`--dur-small`).

## 12. Voice and copy

Plain, short, specific; English. Buttons name the action. Helper text only when it states a fact the user
needs (a limit, a consequence, a format). Dates: relative in the feed ("3w"), exact in details. Ellipsis
`…` for "opens more", curly quotes in prose. No "seamless", no exclamation marks, no emoji in UI.

## 13. Prohibited in this project

- Catalog patterns: `background-glow` (only the XMB ribbon), `ai-palette` (no purple/indigo, no gradient
  text), `lazy-cool` (glow only for hover, focus, selection), `cardocalypse` (no glass in glass),
  `pulsing-status-dot`, `attention-everywhere`, `icon-tile` above headings, `page-narration`.
- Tailwind palette colours and the `dark:` variant in components.
- Text characters as icons; a second icon set.
- Copying reference assets: no XP Start button, Aqua traffic lights, plumbob 3D model, PlayStation icons.

## 14. How to add a new element (checklist for agents)

1. Read this file. Find the closest existing component in section 8 and reuse its class.
2. Decide its material by what it does: holds content → glass; floats → float glass; you type into it →
   well; you press it → droplet; it is the main action or an "on" state → gel; it is the current item →
   selection glow.
3. Take sizes from tokens: height `--h-sm|md|lg`, radius by role (`--r-*`), spacing from the scale, type
   from the scale (`--fs-*`, weights 400/600/700/800 only).
4. Colours from roles only (`--text-*`, `--c-*`). Text in accent colour uses `--c-accent-ink`; text on a
   gel uses `--c-on-accent` (or white on the danger gel).
5. States: rest, hover (`@media (hover: hover)`), press (squash for droplets/gels), focus-visible (global
   ring, or the well glow), disabled, selected, pending, error. Write them all.
6. Motion from section 9 tokens; check it under `prefers-reduced-motion: reduce`.
7. Both themes: check light and dark. If you need a new value, add the token to `index.css` (both
   themes) **and** to this file in the same change.
8. Icons: MUI Rounded, with a label or `aria-label`.
9. Check at 375px and desktop width, keyboard only, and contrast with the table in section 5.

## 15. Discrepancies and exceptions

| Rule | Scope | Reason | Source |
|---|---|---|---|
| Type scale | Tiles (`.tile-body`, `.tile-foot`) | Type follows the tile width via container units | `NoteGrid.tsx` |
| Type scale | `.auth-logo` 22px, `.auth-code` 26px, `.fse-content` 16px, `.bell-badge` 10px | Wordmark, one-time-code entry, long-form writing, a count inside a 16px badge | audit G6 |
| Material set | `.note-carousel-*`, `.tile-media-*`, `.upload-badge` | Controls sitting on photos use a dark translucent disc for legibility over any picture | photos |
| `×` as a character | `TagsInput.tsx`, `ActivitiesInput.tsx` remove buttons | Not yet replaced by `CloseRounded`; styled to the icon size | audit G17 |
| Folder label colours | `.folder-color-*` | User-chosen hues, outside the accent rule | folder look dialog |
| Photo viewer | `NoteImages.tsx` lightbox (black 60 % backdrop, black arrow buttons) | Photos are shown on black, as in every viewer; not restyled yet | photos |
| `HighlightedText.tsx` | `bg-yellow-400/30` mark | Component is not used (import commented out in `NoteCard`) | code |
