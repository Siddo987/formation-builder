---
name: Aufstellung
description: Formation choreography editor — stage in the middle, Bilder left, properties right, playback and timeline below.
colors:
  canvas-grey: "#f5f5f5"
  panel-white: "#ffffff"
  field-grey: "#f5f5f5"
  hover-grey: "#ebebeb"
  hairline: "#e6e6e6"
  hairline-strong: "#d4d4d4"
  ink: "#1e1e1e"
  ink-secondary: "#4d4d4d"
  ink-muted: "#6e6e6e"
  selection-blue: "#0d99ff"
  link-blue: "#0b6fcb"
  primary: "#0b6fcb"
  primary-hover: "#095fae"
  pair-green: "#0a7f63"
  split-amber: "#b45309"
  danger-red: "#d92d20"
  warn-cream: "#fff4cc"
  warn-ink: "#5c4700"
  floor-white: "#ffffff"
  grid-line: "#efefef"
  grid-zero: "#cfcfcf"
  stage-edge: "#dadada"
  ghost-grey: "#8c8c8c"
  dancer-saffron: "#e0a336"
  dancer-teal: "#4fa3a0"
  dancer-lavender: "#8d79d1"
  dancer-rose: "#d1637d"
  dancer-steel: "#5b93c4"
  dancer-moss: "#8fae4f"
  dancer-rust: "#c96b3f"
  dancer-lilac: "#a688c9"
typography:
  headline:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
    fontFeature: "'tnum'"
  title:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  control:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
  micro:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  xs: "3px"
  sm: "4px"
  md: "5px"
  lg: "8px"
  sheet: "12px"
  full: "50%"
spacing:
  "2": "2px"
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "16": "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel-white}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ghost:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.field-grey}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    size: "28px"
  button-icon-hover:
    backgroundColor: "{colors.hover-grey}"
    textColor: "{colors.ink}"
  input-field:
    backgroundColor: "{colors.field-grey}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  tab-workspace:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    padding: "0 10px"
    height: "44px"
  tab-workspace-active:
    textColor: "{colors.ink}"
  view-card:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.lg}"
    padding: "16px"
  dancer-dot:
    rounded: "{rounded.full}"
    textColor: "{colors.panel-white}"
    size: "18px-28px"
---

# Design System: Aufstellung

## Overview

**Creative North Star: "The Precise Editor"**

Aufstellung looks like the editor its users already know: a canvas in the middle, a list of layers on the left, properties on the right, a timeline underneath. The familiarity is deliberate; the quality bar is precision rather than novelty. Every surface is a flat white panel on a light grey canvas, divided by single hairlines, set in Inter at 11 to 13 pixels, with one blue for whatever is selected, playing or focused.

Density is high and calm. Controls are 28px tall on desktop, labels sit at 11px, and nothing is decorated. Colour is spent almost entirely on the work: the dancers on the floor carry the only saturated colours, and two semantic hues (green for couples and moves, amber for split couples) mark formation structure. The stage is the work piece; the chrome around it recedes. Light comes first, the dark theme mirrors it value for value, and a device-following mode sits between them.

On the phone the same parts restack instead of shrinking: stage on top, the selection as a single bar beneath, the Bilder as a horizontal strip, the dock at the bottom, and the dancer list and stage properties rising as bottom sheets.

**Key Characteristics:**
- Flat white panels on a #f5f5f5 canvas, 1px hairlines, no decorative shadows.
- Inter only, 10 to 15px, weights 400 to 600, sentence case.
- One blue for selection, playhead and focus; a deeper blue for filled buttons.
- Dancer colours are the only saturated data colours.
- Borderless grey-filled inputs, underline tabs, 5px corners.
- State changes in 150ms ease-out and nothing else.

## Colors

A neutral grey shell with one working blue, two structural hues and a palette of saturated dancer colours that belong to the floor, not the chrome.

### Primary
- **Selection Blue** (`selection-blue`): the system's one live colour. Selected dancers' rings, the playhead and its cap, the focus ring, the rubber-band selection, the active Bild's wash, checkbox and slider accents, alignment guides in the video layout editor. Identical in both themes.
- **Fill Blue** (`primary`, hover `primary-hover`): the deeper blue that sits behind white text, because Selection Blue is too light to carry white type. Primary buttons, the active Bild number on the timeline, the current step badge on the Musik page. Identical in both themes so white text stays at 5:1.
- **Link Blue** (`link-blue`): blue text on light ground (active Bild index, add-button hover, links). Lifts to #5cb8ff in dark.
- **Selection Wash** (rgba(13,153,255,.12); .2 in dark): background of selected rows, the active Bild row, pressed toggles, the played part of the timeline.

### Secondary
- **Pair Green** (`pair-green`; #34c79e in dark): couples and the moves between Bilder. Pair-selection ring, couple group borders, Zwischenposition chips, speed-curve line, completed steps. Wash at 10% (14% dark).
- **Split Amber** (`split-amber`; #f2a65a in dark): a couple split into Lead and Follow for one Bild. Role badge, dashed split rows, the Split toggle when active. Wash at 11% (15% dark).

### Tertiary
- **Danger Red** (`danger-red`; #ff6b61 in dark): delete, clash warnings, out-of-order marks, save errors. Wash at 9% (15% dark).
- **Warn Cream / Warn Ink** (`warn-cream` on `warn-ink`; #3b3212 / #ffe28a in dark): read-only banner and Bild-lock notices only.

### Neutral
- **Canvas Grey** (`canvas-grey`; #1e1e1e dark): the workspace behind the stage and behind the Musik and Teilen pages.
- **Panel White** (`panel-white`; #2c2c2c dark): header, side list, inspector, dock, cards, menus, dialogs.
- **Field Grey** (`field-grey`; #383838 dark): the fill of every input, select and segmented control track.
- **Hover Grey** (`hover-grey`; #444444 dark): hover behind icon buttons and the pressed menu button.
- **Hairline / Strong Hairline** (`hairline`, `hairline-strong`; #3d3d3d / #525252 dark): panel dividers and card borders; the strong one for hovered fields, dashed add buttons and timeline flags.
- **Ink / Secondary / Muted** (`ink`, `ink-secondary`, `ink-muted`; #f5f5f5 / #c7c7c7 / #a3a3a3 dark): primary text, values and icons, captions and labels.
- **Floor** (`floor-white`; #262626 dark) with **Grid** (`grid-line`, `grid-zero`), **Stage Edge** and **Ghost Grey**: the stage surface, its metre grid, the centre axes, and onion-skin and template dots.

### Dancer palette
Eight saturated mid-tones (`dancer-saffron` through `dancer-lilac`), assigned in order to dancers. White initials and a 1.5px white rim sit on them, which is why they stay mid-value in both themes.

### Named Rules
**The One Blue Rule.** Blue means "this is selected, playing or focused" (Selection Blue) or "this is the action" (Fill Blue). No other UI element is blue, and no other hue signals selection.

**The Floor Owns the Colour Rule.** Saturated colour belongs to the dancers. Chrome stays neutral; green, amber and red appear only when they mark couple structure, a split or a danger.

**The Panel-Ink Rule.** Text and icons on a saturated semantic fill (pair, split, danger) use the panel colour, not white, so they read in both themes: white on the light-theme fills, near-black on the brighter dark-theme fills. White text is reserved for Fill Blue, which keeps one value in both themes.

## Typography

**Body Font:** Inter (with system-ui, -apple-system, Segoe UI)
**Display Font:** none; the same Inter carries every role.
**Label/Mono Font:** none in the UI. Manrope and JetBrains Mono stay loaded only because the video export draws onto its canvas with them.

**Character:** a single quiet sans at small sizes, the way pro editors set their chrome. Hierarchy comes from weight (500 to 600) and ink level, not size jumps.

### Hierarchy
- **Headline** (600, 15px, tabular): the running play time in the dock; on phones, the project name, menu items and workspace tabs move up to 14 to 15px.
- **Title** (600, 13px, 1.3): project name, dialog and sheet titles, the live Bild name, song name, the selection label.
- **Body** (400 to 500, 13px, 1.4): the base size on `body`, menu items, workspace and Musik sub-tabs.
- **Control** (500, 12px): buttons, inputs, selects, list rows, Bild names, dancer names, hints in views.
- **Label** (600, 11px): section heads in the inspector and in views ("Auswahl", "Bild", "Bühne"), sentence case. Regular-weight 11px in Muted Ink for field labels, captions and counts.
- **Micro** (600, 10px): timeline Bild flags, chip numbers, step badges. Grid labels drop to 9px.

### Named Rules
**The Tabular-Where-Numbers-Run Rule.** Tabular numerals only on elements that hold changing or stacked numbers: play time, coordinates, timeline flags, bar readouts, marks, inspector values, counts. Never on the body: Inter's tabular feature widens the hyphen in running German text.

**The Sentence-Case Rule.** No uppercase, no letter-spaced labels in the UI. Section heads are 11px semibold in normal case.

## Layout

The desktop shell is a fixed grid: a 44px header, then the Choreo workspace as three columns (Bilder/Tänzer list 256px, stage flexible, inspector 296px) over a full-width dock. Under 1200px the side columns narrow to 224 / 264px; on short landscape windows (max-height 560px) to 184 / 232px with a 40px header and a one-row dock. The page never scrolls; only lists, the inspector and the Musik and Teilen pages do.

The stage is sized from its container (`container-type:size`) at the floor's real aspect ratio, inside a 3×3 frame whose outer cells carry the editable room labels, so labels never sit on the dance floor.

Musik is a single centred column (max 1040px, the step views 820px). Teilen & Export is an auto-fit grid of 340 to 520px cards, centred, 16px gaps; the video layout editor spans the full row up to 1240px.

Spacing runs on a 2px base with 4, 6, 8, 10, 12 and 16 as the common steps: 8px gaps between controls, 12 to 16px panel padding, 16px around and between cards.

**Phone** (max-width 899.98px in portrait, or anything under 600px): controls grow to 34px (36 to 44px icon buttons on touch), the header wraps with the three workspace tabs as a full-width row beneath, and Choreo restacks to stage, a 50px selection bar, the horizontal Bilder strip (84px cards) and the dock with the timeline on top. The dancer list and "Bild & Bühne" become bottom sheets (12px top corners, grab handle, scrim, max 78 to 82dvh); dialogs dock to the bottom the same way. Inputs move to 16px text so iOS does not zoom.

**Touch** (hover:none or pointer:coarse): nothing depends on hover; remove buttons stay visible and invisible hit areas grow around dancers and small buttons.

### Named Rules
**The No-Page-Scroll Rule.** The editor is a fixed frame. Lists, the inspector and the strip scroll inside it; the stage never moves.

**The One-Layer Rule.** Musik and Teilen & Export are pages, not dialogs. A real dialog is only for a short question and never opens over another dialog.

## Elevation & Depth

Flat by default. Panels, cards, list rows and the stage separate by tone (white panel on grey canvas) and 1px hairlines. Shadows appear only on things that float above the frame: menus, popovers, the floating selection bar, dialogs and bottom sheets. The stage carries a 1px edge ring with a faint 1-3px drop so the floor reads as an object on the canvas.

### Shadow Vocabulary
- **Float** (`0 10px 30px -8px var(--shadow), 0 0 0 .5px var(--shadow)`): project menu, popovers, the floating selection bar.
- **Dialog** (`0 20px 50px -12px var(--shadow), 0 0 0 .5px var(--shadow)`): modal dialogs.
- **Sheet** (`0 -10px 40px -10px var(--shadow)`): phone bottom sheets.
- **Stage** (`0 0 0 1px var(--stage-edge), 0 1px 3px rgba(0,0,0,.06)`): the dance floor.
- **Selection ring** (`0 0 0 2px var(--floor), 0 0 0 4px <ring colour>`): a selected dancer, a gap of floor colour then a 2px ring in Selection Blue or Pair Green.

`--shadow` is rgba(0,0,0,.14) in light and .5 in dark; the scrim is .32 / .5.

### Named Rules
**The Float-Only Rule.** A shadow means "this sits above the editor and will go away". Nothing that is part of the frame casts one.

## Shapes

Small, consistent corners: 5px on controls, rows and inputs; 8px on cards, menus, popovers, dialogs and couple groups; 3 to 4px on chips, badges, Bild previews and inner fields; 12px on the top corners of phone sheets. The stage itself is nearly square-cornered (2px). Dancers, swatches, onion dots and the play button are circles.

Borders are 1px solid hairlines. Dashed borders carry meaning: the add buttons (dashed Strong Hairline, Selection Blue on hover), a Follow dancer and split couple rows (dashed amber), spread Bild flags on the timeline, and template ghost dots.

Icons are inline SVG line icons, 2px stroke, round caps and joins, 13 to 16px, in currentColor.

## Components

Restrained, exact and quiet: controls look like the ones in a professional design tool, and every state change is a 150ms ease-out shift of background, border or colour.

### Buttons
- **Shape:** gently rounded (5px), 28px tall on desktop, 34 to 38px on phone.
- **Primary:** Fill Blue with white 12px semibold text, 12px side padding; hover deepens to Primary Hover. Disabled turns Field Grey with Muted Ink, never a faded blue: blue means something can happen.
- **Ghost (default):** Panel White, 1px Hairline border, Ink 12px medium text; hover moves to Field Grey and Strong Hairline. Danger variant uses red text and a red-wash hover.
- **Icon:** 28px square, transparent, Secondary Ink; hover Hover Grey with full Ink. 36 to 40px on touch.
- **Play:** a 32px circle (44px on touch) in Fill Blue with a white glyph (hover Fill Blue Hover).
- **Add:** full-width, dashed Strong Hairline, Muted Ink; hover shifts border and text to blue over the Selection Wash.
- **Toggle:** a ghost button whose pressed state is the Selection Wash with a blue border and Link Blue text.

### Inputs / Fields
- **Style:** borderless fills: Field Grey, a transparent 1px border, 5px corners, 28px tall (24px for coordinate fields), 12px text.
- **Hover:** the border appears in Strong Hairline.
- **Focus:** a 2px Selection Blue outline inset by 2px and the fill turns Panel White.
- **Inline-editable text** (project name, Bild names, dancer names, room labels): transparent until hover, then a hairline; on focus the same blue outline.

### Navigation
- **Workspace tabs** (Choreo · Musik · Teilen & Export) sit in the header: 13px medium Muted Ink, the current tab in Ink semibold with a 2px Ink underline at the header's bottom edge. Musik sub-tabs follow the same pattern, with numbered circle badges.
- **Segmented control** (Bilder | Tänzer): a Field Grey track with 2px padding; the selected segment becomes a white chip with a hairline ring.
- **Project menu**: a floating 248px panel of 32px rows (44px on phone) with muted icons and hairline separators.

### Cards / Containers
- **View cards** on the Musik and Teilen & Export pages: Panel White, 1px Hairline, 8px corners, 44px header, 16px body padding (12px on phone), no shadow.
- **Inspector sections:** stacked blocks with 12px / 16px padding and a hairline below, each headed by an 11px semibold label.
- **Dialogs:** 460px wide (380 narrow, 680 wide), 8px corners, Dialog shadow over the scrim; bottom sheets on phone.

### Chips
- **Move chips** between Bilder: 20px squares, 4px corners, Pair Green border and wash; solid green with panel-coloured text when active. Add and speed chips are dashed until set.
- **Timeline flags:** small white tags with a hairline and a tick; the current Bild fills with Fill Blue and white text.

### Bilder list (signature)
Each Bild is a row like a layer: a 40px floor preview with tiny dancer dots, the running number and section above the editable name, the mark time at the right. Hover is Field Grey, the current Bild is the Selection Wash with blue number and mark. Moves and Zwischenpositionen sit between rows as named lines and green chips. On phone the list becomes a horizontal strip of 84px cards with a blue border on the current one.

### Dancer dot (signature)
A circle 18 to 28px (scaled with the stage), filled with the dancer's colour, 1.5px white rim, white 8px initials, a soft 1-3px drop, a white facing notch. Selection adds the floor-gap ring in blue; couple selection in green. A split Lead or Follow shrinks to 12 to 18px, gets an amber ring and a corner role badge; the Follow's rim is dashed. The name label appears on hover in a dark tooltip.

### Dock and timeline
A white bar under the stage: transport, play time, the live Bild name and bar, tempo, and the "Bild auf Takt" action, above a timeline that shows song sections, bars and waveform with the Bilder as numbered flags. The playhead is a 2px Selection Blue line with a small cap; the played part is the Selection Wash.

### Armed delete
A delete button first arms: it fills red with panel-coloured icon and pulses a red wash ring (1.1s), then deletes on the second press. This pulse and the 200ms sheet slide are the only motions beyond 150ms state transitions.

## Do's and Don'ts

### Do:
- **Do** use Selection Blue for selection, playhead and focus, and Fill Blue for any blue fill that carries white text.
- **Do** put panel-coloured text (var(--panel)) on pair, split and danger fills so it reads in both themes.
- **Do** keep controls at 28px with 12px text on desktop and grow them to 34 to 44px with 16px input text on touch.
- **Do** separate surfaces by tone and 1px hairlines; reserve shadows for menus, popovers, dialogs and sheets.
- **Do** animate state changes as 150ms ease-out on background, border, colour or opacity, and honour prefers-reduced-motion.
- **Do** set tabular numerals on each numeric element individually.
- **Do** define every colour as a token with a light value and a dark mirror under both the prefers-color-scheme guard and data-theme="dark".
- **Do** give every function a visible control; context menus and shortcuts are extra paths.

### Don't:
- **Don't** introduce a second accent hue or use blue for anything that is not selection, focus, playback or the primary action.
- **Don't** use saturated colour in the chrome; it belongs to the dancers.
- **Don't** put white text on Selection Blue or on the semantic fills.
- **Don't** set tabular numerals on body text.
- **Don't** use uppercase or letter-spaced labels, kickers or eyebrows in the UI.
- **Don't** use Manrope or JetBrains Mono in the interface; they exist for the video export only.
- **Don't** open a dialog on top of another dialog, or turn a workspace page back into a dialog.
- **Don't** add decorative motion, gradients or shadows on frame elements.
