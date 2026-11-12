<?php
/**
 * GET /api/share/get.php?id=<id> — returns a stored project snapshot as JSON, including public
 * URLs for the logo/song if the share had them. The client (js/share.js) fetches those URLs
 * itself to rebuild real Blobs, so a loaded shared project behaves exactly like a locally opened
 * one from that point on (editable, re-exportable, persisted to IndexedDB the normal way).
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/account.php';

require_method('GET');
db_ensure_schema();

$id = $_GET['id'] ?? '';
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) {
    json_error('Ungültige Link-ID', 400);
}

$stmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
$stmt->execute([':id' => $id]);
$row = $stmt->fetch();
if (!$row) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
$access = share_assert_can_view($row);

// ?commit=<id> — the payload of one specific commit (for viewing/merging a branch, js/share.js).
// Logo/song still come from the `shares` row: media only ever lives on the mainline.
$commitId = $_GET['commit'] ?? '';
if ($commitId !== '') {
    if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $commitId)) json_error('Ungültige Commit-ID', 400);
    $cs = db()->prepare('SELECT payload_json, commit_id FROM share_commits WHERE commit_id = :c AND share_id = :s');
    $cs->execute([':c' => $commitId, ':s' => $id]);
    $crow = $cs->fetch();
    if (!$crow) json_error('Commit nicht gefunden', 404);
    $payload = json_decode($crow['payload_json'], true) ?: [];
    $payload['rev'] = (string) $crow['commit_id'];
} else {
    $payload = json_decode($row['payload_json'], true) ?: [];
    // Opaque token the client compares across polls (pollSharedUpdate() in js/share.js) to notice
    // someone else's edit without re-diffing the whole payload.
    $payload['rev'] = (string) $row['version'];
}

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

$payload['access'] = share_access_info($row, $access); // js/share.js takes it off before the payload becomes state

json_response($payload);
