<?php
/**
 * POST /api/share/create.php — stores a snapshot of the current project so it can be opened
 * via a link (rwkreator.sidowski.de/?share=<id>). Not live/collaborative editing — visiting the
 * link loads a read-only copy into the app, the same way opening a .stg file does.
 *
 * multipart/form-data body:
 *   payload : JSON string — {projectName, dancers, formations, axes, showAxes, pairs, tempo, activeIndex}
 *             (same shape buildStgBlob() already serializes client-side, minus the logo/song blobs,
 *             which travel as separate file fields below instead of being embedded/base64'd)
 *   logo    : optional file
 *   song    : optional file
 *
 * No auth to create (matches the low-friction "share via link" intent) and no auth to view.
 * Ids are opaque/non-sequential (see random_id()). No revoke/delete in this version — see the
 * unused `delete_token` column in schema.sql for the forward-compatible placeholder.
 *
 * NOTE on upload size: SHARE_MAX_BYTES (checked below) is this app's own cap, but PHP's
 * `upload_max_filesize`/`post_max_size` ini settings are enforced by PHP itself *before* this
 * script ever runs (commonly 2M/8M by default on shared hosting) — a song file bigger than that
 * fails silently at the PHP layer regardless of SHARE_MAX_BYTES. Raise both ini settings (via
 * php.ini, or a hosting control panel's PHP settings page) to comfortably above SHARE_MAX_BYTES
 * if uploads are failing for normal-sized songs.
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';

require_method('POST');
db_ensure_schema();

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

function share_safe_ext(array $file, string $fallback): string {
    $fromName = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
    if (preg_match('/^[a-z0-9]{2,4}$/', $fromName)) return $fromName;
    $mimeMap = [
        'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/svg+xml' => 'svg',
        'audio/mpeg' => 'mp3', 'audio/wav' => 'wav', 'audio/ogg' => 'ogg', 'audio/mp4' => 'm4a', 'audio/aac' => 'aac',
    ];
    return $mimeMap[$file['type'] ?? ''] ?? $fallback;
}

$id = random_id();
$uploadsRoot = __DIR__ . '/../uploads/shares/' . $id;
$logoPath = null;
$songPath = null;

if ($logoFile || $songFile) {
    if (!mkdir($uploadsRoot, 0770, true) && !is_dir($uploadsRoot)) {
        json_error('Konnte Upload-Verzeichnis nicht anlegen', 500);
    }
}
if ($logoFile) {
    $ext = share_safe_ext($logoFile, 'bin');
    $rel = 'shares/' . $id . '/logo.' . $ext;
    if (!move_uploaded_file($logoFile['tmp_name'], $uploadsRoot . '/logo.' . $ext)) {
        json_error('Logo-Upload fehlgeschlagen', 500);
    }
    $logoPath = $rel;
}
if ($songFile) {
    $ext = share_safe_ext($songFile, 'bin');
    $rel = 'shares/' . $id . '/song.' . $ext;
    if (!move_uploaded_file($songFile['tmp_name'], $uploadsRoot . '/song.' . $ext)) {
        json_error('Song-Upload fehlgeschlagen', 500);
    }
    $songPath = $rel;
}

$stmt = db()->prepare('INSERT INTO shares (id, created_at, project_name, payload_json, logo_path, song_path) VALUES (:id, :created_at, :project_name, :payload_json, :logo_path, :song_path)');
$stmt->execute([
    ':id' => $id,
    ':created_at' => gmdate('Y-m-d H:i:s'),
    ':project_name' => substr((string) ($payload['projectName'] ?? ''), 0, 120),
    ':payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ':logo_path' => $logoPath,
    ':song_path' => $songPath,
]);

json_response(['id' => $id], 201);
