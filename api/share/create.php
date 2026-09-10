<?php
/**
 * POST /api/share/create.php — creates the share row a link points at (rwkreator.sidowski.de/?share=<id>)
 * and stores the project's current state as its first revision. The link is live from then on:
 * api/share/update.php overwrites this same row on every edit anyone with the link makes, and each
 * open browser pulls the latest on its 8s poll (see js/share.js). This endpoint only mints the id
 * and seeds it — all later writes go through update.php.
 *
 * multipart/form-data body:
 *   payload        : JSON string — {projectName, dancers, formations, axes, showAxes, pairs, tempo, activeIndex}
 *                    (same shape buildStgBlob() already serializes client-side, minus the logo/song
 *                    blobs, which travel separately instead of being embedded/base64'd)
 *   logo, song     : optional files — used when the media is small enough to ride in this request
 *   logo_upload_id, song_upload_id, logo_filename, song_filename
 *                  : the alternative for media too big for one request — see media_chunk.php and
 *                    _media.php's share_resolve_incoming(). *_filename only matters for its
 *                    extension (used to pick the stored file's name), same as a raw file's name.
 *
 * No auth to create (matches the low-friction "share via link" intent) and no auth to view.
 * Ids are opaque/non-sequential (see random_id()). No revoke/delete in this version — see the
 * unused `delete_token` column in schema.sql for the forward-compatible placeholder.
 *
 * NOTE on upload size: SHARE_MAX_BYTES (checked below) is this app's own cap, but PHP's
 * `upload_max_filesize`/`post_max_size` ini settings are enforced by PHP itself *before* this
 * script ever runs (commonly 2M/8M by default on shared hosting) — a single chunk bigger than that
 * fails silently at the PHP layer regardless of SHARE_MAX_BYTES. Raise both ini settings (via
 * php.ini, or a hosting control panel's PHP settings page) if chunk uploads start failing; the
 * client's MEDIA_CHUNK_BYTES (js/share.js) is picked comfortably under the common 2M default.
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/_media.php';

require_method('POST');
db_ensure_schema();

$maxBytes = (int) env_get('SHARE_MAX_BYTES', 104857600);

$payloadRaw = $_POST['payload'] ?? '';
$payload = json_decode($payloadRaw, true);
if (!is_array($payload) || !isset($payload['dancers']) || !isset($payload['formations'])) {
    json_error('Ungültige oder fehlende payload');
}

$logoFile = (!empty($_FILES['logo']['tmp_name']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) ? $_FILES['logo'] : null;
$songFile = (!empty($_FILES['song']['tmp_name']) && $_FILES['song']['error'] === UPLOAD_ERR_OK) ? $_FILES['song'] : null;
$logoUploadId = $logoFile ? null : share_post_upload_id('logo_upload_id');
$songUploadId = $songFile ? null : share_post_upload_id('song_upload_id');

$totalBytes = strlen($payloadRaw) + share_incoming_size($logoFile, $logoUploadId) + share_incoming_size($songFile, $songUploadId);
if ($totalBytes > $maxBytes) {
    share_discard_incoming_upload($logoUploadId);
    share_discard_incoming_upload($songUploadId);
    json_error('Datei zu groß (' . round($totalBytes / 1048576, 1) . ' MB, Limit ' . round($maxBytes / 1048576, 1) . ' MB)', 413);
}

$id = random_id();
// create.php has no "existing" media to weigh against — presence is just "was a file/upload_id
// given at all", same shape share_apply_media() already expects from update.php/commit.php.
[$logoPath, $songPath] = share_apply_media(
    $id, null, null, $logoFile !== null || $logoUploadId !== null, $songFile !== null || $songUploadId !== null,
    $logoFile, $songFile, $logoUploadId, $songUploadId,
    (string) ($_POST['logo_filename'] ?? ''), (string) ($_POST['song_filename'] ?? '')
);

// updated_at starts out equal to created_at (set explicitly here rather than relying on a column
// default, which differs between MySQL's CURRENT_TIMESTAMP and sqlite's — see db.php) — bumped by
// api/share/update.php on every subsequent edit once a project is bound to this id. `version` is a
// fresh opaque token the client polls against (pollSharedUpdate() in js/share.js) — not the
// DATETIME itself, which only has one-second resolution and could miss two edits landing in the
// same second.
$now = gmdate('Y-m-d H:i:s');
$version = random_id(16);
// Wer den Link erstellt, bekommt dieses Token einmalig zurück (der Client hängt es an den
// Bearbeiten-Link als ?t=…). Ohne passendes Token weisen update.php/commit.php/merge.php jeden
// Schreibversuch ab -> ein Link ohne ?t= ist reiner Nur-Ansehen-Link.
$editToken = random_id(32);
$stmt = db()->prepare('INSERT INTO shares (id, created_at, updated_at, version, project_name, payload_json, logo_path, song_path, edit_token) VALUES (:id, :created_at, :updated_at, :version, :project_name, :payload_json, :logo_path, :song_path, :edit_token)');
$stmt->execute([
    ':id' => $id,
    ':created_at' => $now,
    ':updated_at' => $now,
    ':version' => $version,
    ':project_name' => substr((string) ($payload['projectName'] ?? ''), 0, 120),
    ':payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ':logo_path' => $logoPath,
    ':song_path' => $songPath,
    ':edit_token' => $editToken,
]);

json_response(['id' => $id, 'rev' => $version, 'edit_token' => $editToken], 201);
