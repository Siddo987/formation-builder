<?php
/**
 * POST /api/share/merge.php — records a merge commit (two parents) and publishes it as the new
 * mainline head, so every device converges to the merged result on its next poll. The 3-way merge
 * itself runs client-side (js/history.js mergeStates); this endpoint only records it.
 *
 * multipart/form-data body:
 *   id            : share id (required)
 *   commit_a      : one parent commit id (required) — usually "ours"
 *   commit_b      : the other parent commit id (required) — the branch being merged in
 *   expected_head : the mainline head the client merged against (required) — 409 if it moved
 *   payload       : the merged project JSON (required)
 *   author        : nickname (optional)
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/account.php';
require_once __DIR__ . '/../lib/commits.php';

require_method('POST');
db_ensure_schema();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) json_error('Ungültige Link-ID', 400);

$shareStmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
$shareStmt->execute([':id' => $id]);
$share = $shareStmt->fetch();
if (!$share) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
$access = share_assert_can_write($share);

$head = commits_ensure_root($share);

$a = (string) ($_POST['commit_a'] ?? '');
$b = (string) ($_POST['commit_b'] ?? '');
$expectedHead = (string) ($_POST['expected_head'] ?? '');
if (!commit_fetch($id, $a) || !commit_fetch($id, $b)) json_error('Unbekannter Commit', 400);
if ($expectedHead !== '' && $expectedHead !== $head) {
    json_error('Der Hauptast hat sich inzwischen geändert — bitte erneut zusammenführen.', 409);
}

$payloadRaw = $_POST['payload'] ?? '';
$payload = json_decode($payloadRaw, true);
if (!commit_valid_payload($payload)) json_error('Ungültige oder fehlende payload');

$maxBytes = (int) env_get('SHARE_MAX_BYTES', 26214400);
if (strlen($payloadRaw) > $maxBytes) json_error('Payload zu groß', 413);

share_assert_payload_rights($access, json_decode((string) $share['payload_json'], true), $payload);

$author = trim((string) ($_POST['author'] ?? ''));
$payloadJson = json_encode($payload, JSON_UNESCAPED_UNICODE);

// The merge lands on the mainline: keep the head commit's branch_id.
$branchId = commit_branch($id, $head);
$mergeCommit = commit_insert($id, $a . ',' . $b, $branchId, $author, 'Zusammengeführt', $payloadJson);

$version = random_id(16);
db()->prepare('UPDATE shares SET project_name = :pn, payload_json = :pj, updated_at = :ua, version = :v, head_commit = :hc WHERE id = :id')
    ->execute([
        ':pn' => substr((string) ($payload['projectName'] ?? ''), 0, 120),
        ':pj' => $payloadJson,
        ':ua' => gmdate('Y-m-d H:i:s'),
        ':v'  => $version,
        ':hc' => $mergeCommit,
        ':id' => $id,
    ]);

json_response(['commit_id' => $mergeCommit, 'head_commit' => $mergeCommit, 'rev' => $version]);
