<?php
/**
 * GET /api/share/get.php?id=<id> — returns a stored project snapshot as JSON, including public
 * URLs for the logo/song if the share had them. The client (js/share.js) fetches those URLs
 * itself to rebuild real Blobs, so a loaded shared project behaves exactly like a locally opened
 * one from that point on (editable, re-exportable, persisted to IndexedDB the normal way).
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';

require_method('GET');
db_ensure_schema();

$id = $_GET['id'] ?? '';
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) {
    json_error('Ungültige Link-ID', 400);
}

$stmt = db()->prepare('SELECT project_name, payload_json, logo_path, song_path FROM shares WHERE id = :id');
$stmt->execute([':id' => $id]);
$row = $stmt->fetch();
if (!$row) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);

$payload = json_decode($row['payload_json'], true) ?: [];

// uploads/ sits next to api/ (see create.php) — build a root-relative URL the client can fetch
// directly regardless of which path this app is deployed under. payload_json already carries
// {name,mime,opacity} for the logo/song (the client included it when creating the share) —
// merge the fetchable url in rather than replacing it.
$baseUrl = dirname(dirname($_SERVER['SCRIPT_NAME'])) . '/uploads/';

if ($row['logo_path']) {
    $logoMeta = is_array($payload['logo'] ?? null) ? $payload['logo'] : [];
    $payload['logo'] = array_merge($logoMeta, ['url' => $baseUrl . $row['logo_path']]);
} else {
    $payload['logo'] = null;
}
if ($row['song_path']) {
    $songMeta = is_array($payload['song'] ?? null) ? $payload['song'] : [];
    $payload['song'] = array_merge($songMeta, ['url' => $baseUrl . $row['song_path']]);
} else {
    $payload['song'] = null;
}

json_response($payload);
