<?php
/**
 * GET /api/figures.php — read-only catalog of preset movement "Figuren".
 *
 * Each row's `transform_json` is one of:
 *   {"mode":"solo", "pivot":"stage-center"|"selection-centroid", "rotateDeg":n, "translateX":n, "translateY":n}
 *     Applied to the client's current pair-selection if one is active, else to every dancer,
 *     rotated/translated as a single rigid group around the given pivot.
 *   {"mode":"couples", "partnerA":{"rotateDeg":n,"translateX":n,"translateY":n}, "partnerB":{...}}
 *     Applied per saved dancer-pair (see the client's state.pairs): each pair's own current
 *     midpoint is the pivot, partnerA's recipe applies to memberIds[0], partnerB's to memberIds[1].
 *
 * The client (js/formations.js, applyFigure()) does the actual geometry — this endpoint just
 * serves the catalog as JSON, cached in memory by the client after the first load.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/http.php';

require_method('GET');
db_ensure_schema();

$rows = db()->query('SELECT id, name, description, transform_json, sort_order FROM figures ORDER BY sort_order ASC, name ASC')->fetchAll();

$figures = array_map(function ($row) {
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'description' => $row['description'],
        'transform' => json_decode($row['transform_json'], true),
    ];
}, $rows);

json_response(['figures' => $figures]);
