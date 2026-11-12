<?php
/**
 * POST /api/share/presence.php — heartbeat for the per-Bild edit lock (#2076/#2047, js/share.js).
 * Every editing tab posts every few seconds which Bild it has open; the reply lists the other tabs
 * on this share so each client works out who holds which Bild. Ages are measured on the server
 * clock, so a skewed client clock doesn't matter.
 *
 * multipart/form-data body:
 *   id, edit_token : as commit.php
 *   client_id      : random per-tab id
 *   author         : nickname shown on the lock
 *   formation_id   : the Bild this tab has open ('' = none)
 *   on_ms          : how long it has had that Bild open (the client restarts it after 2 min idle)
 *   idle_ms        : time since its last pointer/key input
 *   leave          : '1' = tab is closing, just drop its row
 *
 * Response: {head_commit, clients: [{client_id, author, formation_id, on_ms, idle_ms, seen_ms}]}
 * head_commit lets the client poll history.php right away instead of waiting for its 8 s tick.
 */

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/account.php';

require_method('POST');
db_ensure_schema();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) json_error('Ungültige Link-ID', 400);
$client = (string) ($_POST['client_id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{8,32}$/', $client)) json_error('Ungültige client_id', 400);

$shareStmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
$shareStmt->execute([':id' => $id]);
$share = $shareStmt->fetch();
if (!$share) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
share_assert_can_write($share);

$now = (int) round(microtime(true) * 1000);
$ms = function (string $key): int { return max(0, min(86400000, (int) ($_POST[$key] ?? 0))); };

db()->prepare('DELETE FROM share_presence WHERE (share_id = :s AND client_id = :c) OR seen_at < :old')
    ->execute([':s' => $id, ':c' => $client, ':old' => $now - 60000]);

if (($_POST['leave'] ?? '') !== '1') {
    $fid = (string) ($_POST['formation_id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{0,40}$/', $fid)) $fid = '';
    db()->prepare('INSERT INTO share_presence (share_id, client_id, author, formation_id, since_at, active_at, seen_at)
                   VALUES (:s, :c, :a, :f, :si, :ac, :se)')
        ->execute([
            ':s' => $id, ':c' => $client, ':a' => mb_substr(trim((string) ($_POST['author'] ?? '')), 0, 60), ':f' => $fid,
            ':si' => $now - $ms('on_ms'), ':ac' => $now - $ms('idle_ms'), ':se' => $now,
        ]);
}

$rows = db()->prepare('SELECT * FROM share_presence WHERE share_id = :s AND client_id <> :c');
$rows->execute([':s' => $id, ':c' => $client]);
$clients = array_map(function ($r) use ($now) {
    return [
        'client_id'    => (string) $r['client_id'],
        'author'       => (string) $r['author'],
        'formation_id' => (string) $r['formation_id'],
        'on_ms'        => $now - (int) $r['since_at'],
        'idle_ms'      => $now - (int) $r['active_at'],
        'seen_ms'      => $now - (int) $r['seen_at'],
    ];
}, $rows->fetchAll());

json_response(['head_commit' => (string) ($share['head_commit'] ?? ''), 'clients' => $clients]);
