# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Trainer am Rechner (primary):** builds the choreo of a formation team on a laptop or desktop: dancers and couples, the Bilder (formation pictures) and the moves between them, the song with its sections, beats, bars and phrasing, the time marks, then shares it and exports videos and Schritte-PDFs.
- **Tänzer am Handy:** open the view-only link on their phone, at home or in the hall, to look up their own path, positions, timing and the step videos.
- **Training in der Halle:** a tablet or laptop at the edge of the floor plays the choreo with the music for the whole team.

Several trainers editing together (edit link, Verlauf with branches) exists but is secondary.

## Product Purpose

RWKREATOR plans dance formation choreographies (ballroom Standard and Latin formation teams, e.g. RWK Kassel's StaFo-A and LaFo-B). It replaces Excel choreo sheets with drawn pictures: every Bild is a formation on the floor, playback animates the moves between them in sync with the song, and every dancer gets their own path, bar counts and step sheets. Success: a trainer turns a choreo idea into a playable, shareable plan without hunting for functions, and every dancer can see exactly where to be on which bar.

## Positioning

A formation planner that knows ballroom formation work: couples that split into Lead and Follow only in one Bild, turns and orbits along a move, Bilder anchored on bar lines of a song whose sections, beats, the 1 and the phrasing (QQS+, figures) it detects with its own dance-tempo-aware beat AI, per-dancer Schritte-PDFs and section videos, live share links with history.

## Operating Context

- Trainers work at a desk with mouse and keyboard, long sessions, many small edits; they rely on shortcuts and gestures.
- Dancers check on a phone, one-handed, often right before or during training; view-only.
- In the hall the screen is seen from a few metres away while music plays.
- Source material: Excel choreo sheets (Takt/Rhythmus/Figur tables with drawn pictures), the competition song, training videos.

## Capabilities and Constraints

- Every existing function stays; the rework reorders and exposes them, it removes none. Functions today: Bilder (add, duplicate, reorder, name, notes, categories/Abschnitte, Zwischenpositionen, named Übergänge), dancers and couples (Lead/Follow split per Bild, turns, Eigendrehung, Kreisbahn, rotate selection, copy/paste positions, templates/Vorlagen, figure catalog and own figures), stage (size, grid, room labels, facing arrows, paths, clash warning, background logo), song (upload, delay, speed, Nur Musik, start points), Musik & Takte (sections, dance per section, beat detection, the 1, corrections, Phrasierung and Figur per bar), time marks (Jetzt, bar-line snapping, zoomable waveform timeline), playback with ghost/onion dots, export (.stg, .auf, video with layout editor, Schritte-PDF), open recent/file, new choreo, delete, share links (view/edit, owner accounts, rights), Verlauf with branches and merge, section videos, offline use, read-only mode, two-tab guard, save-error banner.
- Keyboard shortcuts and gestures stay as they are (Strg+Z/Y, arrows, Strg+A/C/V, double-click or T splits a couple, Esc, right-click / long-press for all functions, timeline keys, Musik & Takte keys).
- Light, dark and "wie das Gerät" themes stay.
- Terminology may be revised where it helps understanding.
- Technical: static HTML/CSS/JS without a build step, served live from this repo; scripts share globals; German UI; service worker for offline use; Cloudflare edge cache busted with `?v=` in index.html.

## Brand Commitments

- The user chose the category standard on purpose (2026-11-18): a familiar editor look, executed at Figma's craft level (picked from rendered variants of this app over Linear and Apple styles). Light first, dark mirrored.
- Name „RWKREATOR“ (was „Aufstellung“ until 2026-11-20), German UI.

## Evidence on Hand

- Real choreos on the production share store (StaFo-A with song, sections, bars and phrasing; LaFo-B), the Excel choreo sheets in `_data/rwkreator_std/`.
- No testimonials, user numbers or claims beyond this.

## Product Principles

1. The stage is the work piece; everything else serves the picture on the floor.
2. The path through the work is visible: dancers → Bilder → song → bars → marks → share/export, and the app shows where you are on it.
3. Nothing hides: every function has a visible home; context menus and shortcuts are faster paths, never the only path.
4. One layer at a time: no dialog opens on top of another dialog.
5. The phone is first class for looking and learning; the desk is first class for building.

## Accessibility & Inclusion

No product-specific requirement recorded; keep WCAG 2.1 AA basics (contrast, focus, keyboard, touch targets).
