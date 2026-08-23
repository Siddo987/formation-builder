<?php
/**
 * GET /api/layouts.php — read-only catalog of preset "Vorlagen" (target arrangements).
 *
 * Each row's `positions_json` is an ordered array of {"x":n,"y":n} that matters only relative to
 * each other (a shape centered around its own origin) — not fixed stage coordinates, and not tied
 * to a specific project's dancers. The client (js/stage.js) shows them as a transparent ghost
 * overlay that the user drags into place and rotates (activeLayoutOffset/activeLayoutRotateDeg,
 * transient, never sent back to the server), matching slots to the current project's dancers by
 * order, up to however many dancers there actually are. The user then drags dancers onto the
 * ghost by hand; nothing here moves them automatically.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/http.php';

require_method('GET');
db_ensure_schema();

$rows = db()->query('SELECT id, name, description, positions_json, sort_order FROM layouts ORDER BY sort_order ASC, name ASC')->fetchAll();

$layouts = array_map(function ($row) {
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'description' => $row['description'],
        'positions' => json_decode($row['positions_json'], true),
    ];
}, $rows);

json_response(['layouts' => $layouts]);
