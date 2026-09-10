<?php
/**
 * POST /api/share/commit.php — records one edit as a commit in the share's history graph
 * (js/history.js / js/share.js). Replaces the old blind overwrite of update.php:
 *
 *   - client sends `base_commit` = the commit it last synced to.
 *   - base_commit == current mainline head  -> fast-forward: append commit, advance head,
 *     mirror payload onto the `shares` row (+ handle logo/song like update.php). {is_branch:false}
 *   - otherwise                             -> the client has diverged: append the commit on a
 *     NEW branch_id (or continue its existing branch), head untouched. {is_branch:true}
 *
 * multipart/form-data body:
 *   id            : share id (required)
 *   base_commit   : last synced commit id ('' = fresh client, treated as "fork from head")
 *   payload       : JSON project state (same shape create.php/update.php accept)
 *   author        : nickname for the history entry (optional)
 *   note          : short summary of the change (optional)
 *   logo_present, song_present, logo, song : as update.php — only honoured on a fast-forward
 *   logo_upload_id, song_upload_id, logo_filename, song_filename
 *                 : the alternative to logo/song for media too big for one request — see
 *                   media_chunk.php and _media.php's share_resolve_incoming(). Also only honoured
 *                   on a fast-forward.
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/commits.php';
require_once __DIR__ . '/_media.php';

require_method('POST');
db_ensure_schema();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) json_error('Ungültige Link-ID', 400);

$shareStmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
$shareStmt->execute([':id' => $id]);
$share = $shareStmt->fetch();
if (!$share) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
share_assert_can_write($share);

$payloadRaw = $_POST['payload'] ?? '';
$payload = json_decode($payloadRaw, true);
if (!commit_valid_payload($payload)) json_error('Ungültige oder fehlende payload');

$maxBytes = (int) env_get('SHARE_MAX_BYTES', 104857600);
$logoFile = (!empty($_FILES['logo']['tmp_name']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) ? $_FILES['logo'] : null;
$songFile = (!empty($_FILES['song']['tmp_name']) && $_FILES['song']['error'] === UPLOAD_ERR_OK) ? $_FILES['song'] : null;
$logoUploadId = $logoFile ? null : share_post_upload_id('logo_upload_id');
$songUploadId = $songFile ? null : share_post_upload_id('song_upload_id');
$totalBytes = strlen($payloadRaw) + share_incoming_size($logoFile, $logoUploadId) + share_incoming_size($songFile, $songUploadId);
if ($totalBytes > $maxBytes) {
    share_discard_incoming_upload($logoUploadId);
    share_discard_incoming_upload($songUploadId);
    json_error('Datei zu groß (' . round($totalBytes / 1048576, 1) . ' MB)', 413);
}

$author = trim((string) ($_POST['author'] ?? ''));
$note   = trim((string) ($_POST['note'] ?? ''));
$payloadJson = json_encode($payload, JSON_UNESCAPED_UNICODE);

$head = commits_ensure_root($share);
$headBranch = commit_branch($id, $head);

$base = (string) ($_POST['base_commit'] ?? '');
if ($base === '' || !commit_fetch($id, $base)) {
    // Client has no (valid) knowledge of the graph yet — treat this as a fast-forward from head.
    $base = $head;
}

$isFastForward = ($base === $head);

if ($isFastForward) {
    $branchId = $headBranch;
} else {
    $baseBranch = commit_branch($id, $base);
    // Continuing an already-diverged branch keeps its id; diverging from the mainline starts a new one.
    $branchId = ($baseBranch !== '' && $baseBranch !== $headBranch) ? $baseBranch : branch_new_id();
}

$newCommit = commit_insert($id, $base, $branchId, $author, $note, $payloadJson);

if ($isFastForward) {
    // Mirror onto the shares row + carry logo/song forward (same present/file semantics as update.php).
    [$logoPath, $songPath, $touchLogo, $touchSong] = share_apply_media(
        $id, $share['logo_path'], $share['song_path'],
        ($_POST['logo_present'] ?? '0') === '1', ($_POST['song_present'] ?? '0') === '1',
        $logoFile, $songFile, $logoUploadId, $songUploadId,
        (string) ($_POST['logo_filename'] ?? ''), (string) ($_POST['song_filename'] ?? '')
    );
    $version = random_id(16);
    $sets = ['project_name = :pn', 'payload_json = :pj', 'updated_at = :ua', 'version = :v', 'head_commit = :hc'];
    $params = [
        ':id' => $id,
        ':pn' => substr((string) ($payload['projectName'] ?? ''), 0, 120),
        ':pj' => $payloadJson,
        ':ua' => gmdate('Y-m-d H:i:s'),
        ':v'  => $version,
        ':hc' => $newCommit,
    ];
    if ($touchLogo) { $sets[] = 'logo_path = :lp'; $params[':lp'] = $logoPath; }
    if ($touchSong) { $sets[] = 'song_path = :sp'; $params[':sp'] = $songPath; }
    db()->prepare('UPDATE shares SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);

    json_response(['commit_id' => $newCommit, 'branch_id' => $branchId, 'is_branch' => false, 'head_commit' => $newCommit, 'rev' => $version]);
}

// Diverged: media is only honoured on a fast-forward (see header comment) — a chunked upload that
// rode along anyway has no home to go to, so discard it now instead of waiting on the 24h GC.
share_discard_incoming_upload($logoUploadId);
share_discard_incoming_upload($songUploadId);

json_response(['commit_id' => $newCommit, 'branch_id' => $branchId, 'is_branch' => true, 'head_commit' => $head]);
