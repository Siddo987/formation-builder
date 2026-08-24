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
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';

require_method('POST');
db_ensure_schema();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) {
    json_error('Ungültige Link-ID', 400);
}

$existing = db()->prepare('SELECT logo_path, song_path FROM shares WHERE id = :id');
$existing->execute([':id' => $id]);
$row = $existing->fetch();
if (!$row) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);

$maxBytes = (int) env_get('SHARE_MAX_BYTES', 26214400);

$payloadRaw = $_POST['payload'] ?? '';
$payload = json_decode($payloadRaw, true);
if (!is_array($payload) || !isset($payload['dancers']) || !isset($payload['formations'])) {
    json_error('Ungültige oder fehlende payload');
}

$logoFile = (!empty($_FILES['logo']['tmp_name']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) ? $_FILES['logo'] : null;
$songFile = (!empty($_FILES['song']['tmp_name']) && $_FILES['song']['error'] === UPLOAD_ERR_OK) ? $_FILES['song'] : null;

$totalBytes = strlen($payloadRaw) + ($logoFile ? $logoFile['size'] : 0) + ($songFile ? $songFile['size'] : 0);
if ($totalBytes > $maxBytes) {
    json_error('Datei zu groß (' . round($totalBytes / 1048576, 1) . ' MB, Limit ' . round($maxBytes / 1048576, 1) . ' MB)', 413);
}

function share_update_safe_ext(array $file, string $fallback): string {
    $fromName = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
    if (preg_match('/^[a-z0-9]{2,4}$/', $fromName)) return $fromName;
    $mimeMap = [
        'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/svg+xml' => 'svg',
        'audio/mpeg' => 'mp3', 'audio/wav' => 'wav', 'audio/ogg' => 'ogg', 'audio/mp4' => 'm4a', 'audio/aac' => 'aac',
    ];
    return $mimeMap[$file['type'] ?? ''] ?? $fallback;
}

function share_update_delete(?string $relPath): void {
    if (!$relPath) return;
    $abs = __DIR__ . '/../uploads/' . $relPath;
    if (is_file($abs)) @unlink($abs);
}

$uploadsRoot = __DIR__ . '/../uploads/shares/' . $id;
$logoPresent = ($_POST['logo_present'] ?? '0') === '1';
$songPresent = ($_POST['song_present'] ?? '0') === '1';

$logoPath = $row['logo_path'];
$songPath = $row['song_path'];
$touchLogo = false;
$touchSong = false;

if (!$logoPresent) {
    if ($logoPath) { share_update_delete($logoPath); $logoPath = null; $touchLogo = true; }
} elseif ($logoFile) {
    if (!is_dir($uploadsRoot) && !mkdir($uploadsRoot, 0770, true) && !is_dir($uploadsRoot)) {
        json_error('Konnte Upload-Verzeichnis nicht anlegen', 500);
    }
    share_update_delete($logoPath);
    $ext = share_update_safe_ext($logoFile, 'bin');
    $rel = 'shares/' . $id . '/logo.' . $ext;
    if (!move_uploaded_file($logoFile['tmp_name'], $uploadsRoot . '/logo.' . $ext)) {
        json_error('Logo-Upload fehlgeschlagen', 500);
    }
    $logoPath = $rel;
    $touchLogo = true;
}
// logo_present === true with no file: unchanged, keep whatever's already stored.

if (!$songPresent) {
    if ($songPath) { share_update_delete($songPath); $songPath = null; $touchSong = true; }
} elseif ($songFile) {
    if (!is_dir($uploadsRoot) && !mkdir($uploadsRoot, 0770, true) && !is_dir($uploadsRoot)) {
        json_error('Konnte Upload-Verzeichnis nicht anlegen', 500);
    }
    share_update_delete($songPath);
    $ext = share_update_safe_ext($songFile, 'bin');
    $rel = 'shares/' . $id . '/song.' . $ext;
    if (!move_uploaded_file($songFile['tmp_name'], $uploadsRoot . '/song.' . $ext)) {
        json_error('Song-Upload fehlgeschlagen', 500);
    }
    $songPath = $rel;
    $touchSong = true;
}

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
