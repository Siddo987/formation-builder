<?php
/**
 * GET /api/share/history.php?id=<id> — the commit graph for a share link. Powers the Verlauf
 * panel and the sync poll (js/share.js / js/history.js).
 *
 * Response:
 *   {
 *     head_commit: "<mainline tip>",
 *     commits:  [ {commit_id, parent_ids, branch_id, author, note, created_at}, ... ]  // no payload
 *     branches: [ {branch_id, tip, author, created_at}, ... ]   // open (un-merged) branch tips
 *   }
 * A share created before the commit graph existed gets its root commit synthesized on first hit.
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/commits.php';

require_method('GET');
db_ensure_schema();

$id = $_GET['id'] ?? '';
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) json_error('Ungültige Link-ID', 400);

$shareStmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
$shareStmt->execute([':id' => $id]);
$share = $shareStmt->fetch();
if (!$share) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);

$head = commits_ensure_root($share);
$commits = commits_all($id);

$slim = array_map(function ($c) {
    return [
        'commit_id'  => (string) $c['commit_id'],
        'parent_ids' => (string) $c['parent_ids'],
        'branch_id'  => (string) $c['branch_id'],
        'author'     => (string) $c['author'],
        'note'       => (string) $c['note'],
        'created_at' => (string) $c['created_at'],
    ];
}, $commits);

json_response([
    'head_commit' => $head,
    'commits'     => $slim,
    'branches'    => commits_branch_tips($commits, $head),
]);
