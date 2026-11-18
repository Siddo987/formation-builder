<?php
/**
 * /api/share/videos.php — Videos zu Abschnitten einer geteilten Choreo (#2092). Sie liegen neben
 * der Choreo (Tabelle share_videos, Dateien unter uploads/shares/<id>/videos/), nicht im Verlauf:
 * ein Video gehört zu einem oder mehreren Abschnitten, gemerkt über die Id des Bilds, mit dem der
 * Abschnitt beginnt.
 *
 * GET  ?id=…&t=…  -> {videos: [{id, name, mime, size, sections, created_at, url, sha256}], can_edit}
 * POST id, edit_token, action =
 *   add    : upload_id (Stücke über media_chunk.php), name, sections (JSON-Liste) — höchstens 200 MB,
 *            dieselbe Datei (SHA-256) nur einmal je Choreo (409)
 *   update : video_id, name, sections
 *   delete : video_id
 * Schreiben braucht das Recht „videos“ (api/lib/account.php).
 */

require_once __DIR__ . '/../lib/account.php';
require_once __DIR__ . '/_media.php';

const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv'];

db_ensure_schema();

$id = (string) ($_GET['id'] ?? $_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) json_error('Ungültige Link-ID', 400);
$stmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
$stmt->execute([':id' => $id]);
$share = $stmt->fetch();
if (!$share) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
$access = share_assert_can_view($share);

function video_list(string $id): array {
    $stmt = db()->prepare('SELECT * FROM share_videos WHERE share_id = :id ORDER BY created_at, id');
    $stmt->execute([':id' => $id]);
    $base = dirname(dirname($_SERVER['SCRIPT_NAME'])) . '/uploads/';
    return array_map(function ($v) use ($base) {
        $hash = (string) ($v['sha256'] ?? '');
        $file = __DIR__ . '/../uploads/' . $v['path'];
        if ($hash === '' && is_file($file)) { // added before hashes were kept: hashed once, here
            $hash = hash_file('sha256', $file);
            db()->prepare('UPDATE share_videos SET sha256 = :h WHERE id = :v')->execute([':h' => $hash, ':v' => $v['id']]);
        }
        return [
            'id' => $v['id'], 'name' => $v['name'], 'mime' => $v['mime'], 'size' => (int) $v['size'],
            'sections' => json_decode((string) $v['sections'], true) ?: [], 'created_at' => $v['created_at'],
            'url' => $base . $v['path'], 'sha256' => $hash,
        ];
    }, $stmt->fetchAll());
}

function video_sections(): string {
    $raw = json_decode((string) ($_POST['sections'] ?? '[]'), true);
    if (!is_array($raw) || count($raw) > 200) json_error('Ungültige Abschnitte', 400);
    $ids = [];
    foreach ($raw as $s) {
        if (!is_string($s) || $s === '' || strlen($s) > 64) json_error('Ungültige Abschnitte', 400);
        $ids[] = $s;
    }
    return json_encode(array_values(array_unique($ids)));
}

function video_name(): string {
    $name = trim((string) ($_POST['name'] ?? ''));
    return mb_substr($name === '' ? 'Video' : $name, 0, 200);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response(['videos' => video_list($id), 'can_edit' => in_array('videos', $access['rights'], true)]);
}
require_method('POST');
share_assert_right($access, 'videos');

$action = (string) ($_POST['action'] ?? '');
if ($action === 'add') {
    $uploadId = share_post_upload_id('upload_id');
    if (share_incoming_size(null, $uploadId) > VIDEO_MAX_BYTES) {
        share_discard_incoming_upload($uploadId);
        json_error('Das Video ist größer als 200 MB.', 413);
    }
    $name = video_name();
    $sections = video_sections();
    $file = share_resolve_incoming(null, $uploadId, $name);
    if (!$file || !$file['size']) json_error('Video fehlt', 400);
    $ext = share_media_safe_ext(['type' => (string) ($_POST['mime'] ?? '')] + $file, 'mp4');
    if (!in_array($ext, VIDEO_EXTS, true)) {
        @unlink($file['tmp_name']);
        json_error('Das ist keine Videodatei (erlaubt: ' . implode(', ', VIDEO_EXTS) . ').', 415);
    }
    // Each video only once per choreo (#2162), recognised by its content.
    $hash = hash_file('sha256', $file['tmp_name']);
    foreach (video_list($id) as $v) {
        if ($v['sha256'] !== $hash) continue;
        @unlink($file['tmp_name']);
        json_error('Dieses Video ist schon da: „' . $v['name'] . '“.', 409);
    }
    $videoId = random_id(22);
    $dir = __DIR__ . '/../uploads/shares/' . $id . '/videos';
    if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) json_error('Konnte Upload-Verzeichnis nicht anlegen', 500);
    if (!share_consume_ingested($file, $dir . '/' . $videoId . '.' . $ext)) json_error('Video-Upload fehlgeschlagen', 500);
    db()->prepare('INSERT INTO share_videos (id, share_id, name, mime, size, path, sections, created_at, sha256) VALUES (:v, :s, :n, :m, :z, :p, :c, :t, :h)')->execute([
        ':v' => $videoId, ':s' => $id, ':n' => $name, ':m' => mb_substr((string) ($_POST['mime'] ?? ''), 0, 100),
        ':z' => $file['size'], ':p' => 'shares/' . $id . '/videos/' . $videoId . '.' . $ext,
        ':c' => $sections, ':t' => gmdate('Y-m-d H:i:s'), ':h' => $hash,
    ]);
} elseif ($action === 'update' || $action === 'delete') {
    $stmt = db()->prepare('SELECT path FROM share_videos WHERE id = :v AND share_id = :s');
    $stmt->execute([':v' => (string) ($_POST['video_id'] ?? ''), ':s' => $id]);
    $path = $stmt->fetchColumn();
    if ($path === false) json_error('Dieses Video gibt es nicht mehr.', 404);
    if ($action === 'delete') {
        share_media_delete($path);
        db()->prepare('DELETE FROM share_videos WHERE id = :v')->execute([':v' => $_POST['video_id']]);
    } else {
        db()->prepare('UPDATE share_videos SET name = :n, sections = :c WHERE id = :v')
            ->execute([':n' => video_name(), ':c' => video_sections(), ':v' => $_POST['video_id']]);
    }
} else {
    json_error('Unbekannte Aktion', 400);
}
json_response(['videos' => video_list($id), 'can_edit' => true]);
