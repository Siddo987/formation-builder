<?php
/**
 * GET /api/layouts.php — read-only catalog of preset "Vorlagen" (target arrangements).
 *
 * Each row's `positions_json` is an ordered array of {"x":n,"y":n} that matters only relative to
 * each other (a shape centered around its own origin) — not fixed stage coordinates, and not tied
 * to a specific project's dancers. `origin` ({"x":n,"y":n}, admin-settable, defaults to {0,0}) is
 * the rotation pivot — the "Orientierungspunkt" the shape turns around and, on the client, its own
 * distinct grabbable ghost point alongside the per-dancer ones. The client (js/stage.js) shows the
 * whole thing as a transparent ghost overlay that the user drags into place and rotates
 * (activeLayoutOffset/activeLayoutRotateDeg, transient, never sent back to the server), matching
 * slots to the current project's dancers by order, up to however many dancers there actually are.
 * The user then drags dancers onto the ghost by hand; nothing here moves them automatically.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/http.php';

require_method('GET');
db_ensure_schema();

$rows = db()->query('SELECT id, name, description, positions_json, origin_x, origin_y, sort_order FROM layouts ORDER BY sort_order ASC, name ASC')->fetchAll();

$layouts = array_map(function ($row) {
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'description' => $row['description'],
        'positions' => json_decode($row['positions_json'], true),
        // The rotation pivot ("Orientierungspunkt") — defaults to (0,0) for rows from before this
        // column existed (see the ALTER TABLE migrations in schema.sql/db.php).
        'origin' => ['x' => (float)($row['origin_x'] ?? 0), 'y' => (float)($row['origin_y'] ?? 0)],
    ];
}, $rows);

json_response(['layouts' => $layouts]);
