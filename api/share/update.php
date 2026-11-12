<?php
/**
 * POST /api/share/update.php — overwrites an *existing* share's snapshot in place, turning the
 * link from a one-time export into a standing pointer at "this Formation" that stays current: the
 * client (js/share.js) calls this on every local edit once a project is bound to a share id
 * (state.sharedId), and every other browser that opened the same link picks the change up on its
 * next poll (see pollSharedUpdate()). Same trust model as create.php — no auth, anyone holding the
 * opaque id can push to it (matches "share via link" with no accounts anywhere in this app).
 *
 * multipart/form-data body:
 *   id           : the share id to update (required)
 *   payload      : JSON string, same shape create.php accepts
 *   logo_present : '1' if the project currently has a logo, '0' if not (required)
 *   song_present : '1' if the project currently has a song, '0' if not (required)
 *   logo, song   : optional files — included only when the bytes actually changed this call.
 *                  logo_present/song_present alone (with no file) means "unchanged, keep the
 *                  currently-stored file"; '0' means "remove it"; '1' + a file means "replace it".
 *                  This lets routine position/name edits push without re-uploading a multi-MB song
 *                  every time, while still handling "the user removed their logo" correctly.
 *   logo_upload_id, song_upload_id, logo_filename, song_filename
 *                : the alternative to logo/song for media too big for one request — see
 *                  media_chunk.php and _media.php's share_resolve_incoming().
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/account.php';
require_once __DIR__ . '/_media.php';

require_method('POST');
db_ensure_schema();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) {
    json_error('Ungültige Link-ID', 400);
}

$existing = db()->prepare('SELECT * FROM shares WHERE id = :id');
$existing->execute([':id' => $id]);
$row = $existing->fetch();
if (!$row) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
$access = share_assert_can_write($row);

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

$logoPresent = ($_POST['logo_present'] ?? '0') === '1';
$songPresent = ($_POST['song_present'] ?? '0') === '1';
share_assert_payload_rights($access, json_decode((string) $row['payload_json'], true), $payload);
share_assert_media_rights($access, $row, $logoPresent, $songPresent, $logoFile || $logoUploadId, $songFile || $songUploadId);

[$logoPath, $songPath, $touchLogo, $touchSong] = share_apply_media(
    $id, $row['logo_path'], $row['song_path'], $logoPresent, $songPresent,
    $logoFile, $songFile, $logoUploadId, $songUploadId,
    (string) ($_POST['logo_filename'] ?? ''), (string) ($_POST['song_filename'] ?? '')
);

$version = random_id(16);
$sets = ['project_name = :project_name', 'payload_json = :payload_json', 'updated_at = :updated_at', 'version = :version'];
$params = [
    ':id' => $id,
    ':project_name' => substr((string) ($payload['projectName'] ?? ''), 0, 120),
    ':payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ':updated_at' => gmdate('Y-m-d H:i:s'),
    ':version' => $version,
];
if ($touchLogo) { $sets[] = 'logo_path = :logo_path'; $params[':logo_path'] = $logoPath; }
if ($touchSong) { $sets[] = 'song_path = :song_path'; $params[':song_path'] = $songPath; }

$stmt = db()->prepare('UPDATE shares SET ' . implode(', ', $sets) . ' WHERE id = :id');
$stmt->execute($params);

json_response(['ok' => true, 'rev' => $version]);
