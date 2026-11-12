<?php
/**
 * POST /api/share/owner.php — Besitz und Links einer geteilten Choreo (#2104).
 *
 * Body (form): id, edit_token, action =
 *   claim    : angemeldet + Bearbeiten-Link einer Choreo ohne Besitzer -> man wird Besitzer.
 *              Ein Alt-Link ohne edit_token bekommt dabei eins: ab dann ist er nur zum Ansehen.
 *   settings : Besitzer — view_link_enabled, edit_link_enabled (0/1), link_rights (kommagetrennt).
 *   rotate   : Besitzer — neuer Bearbeiten-Link, der alte bearbeitet nichts mehr.
 *   delete   : Besitzer, oder ohne Besitzer jeder mit vollem Bearbeiten-Link — endgültig löschen.
 * Antwort: {access: …} wie get.php, bei claim/rotate mit dem neuen edit_token; bei delete {deleted:true}.
 */

require_once __DIR__ . '/../lib/account.php';
require_once __DIR__ . '/_media.php';

require_method('POST');
db_ensure_schema();

$id = (string) ($_POST['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $id)) json_error('Ungültige Link-ID', 400);
$load = function () use ($id) {
    $stmt = db()->prepare('SELECT * FROM shares WHERE id = :id');
    $stmt->execute([':id' => $id]);
    return $stmt->fetch() ?: null;
};
$share = $load();
if (!$share) json_error('Dieser Link wurde nicht gefunden oder ist nicht mehr gültig', 404);
$access = share_access($share);
$user = account_user();
$action = (string) ($_POST['action'] ?? '');

if ($action === 'delete') {
    if (!$access['owner'] && (!empty($share['owner_id']) || count($access['rights']) < count(SHARE_RIGHTS))) {
        json_error('Löschen darf nur, wem die Choreo gehört.', 403);
    }
    share_media_delete($share['logo_path']);
    share_media_delete($share['song_path']);
    foreach (['share_commits', 'share_presence'] as $table) db()->prepare("DELETE FROM {$table} WHERE share_id = :id")->execute([':id' => $id]);
    db()->prepare('DELETE FROM shares WHERE id = :id')->execute([':id' => $id]);
    json_response(['deleted' => true]);
}

if (!$user) json_error('Dafür musst du angemeldet sein.', 401);

if ($action === 'claim') {
    if (!empty($share['owner_id'])) json_error('Diese Choreo gehört schon jemandem.', 409);
    share_assert_right($access, 'edit');
    $token = (string) ($share['edit_token'] ?? '') ?: random_id(32);
    // owner_id IS NULL in the WHERE: of two claiming at once, only the first wins
    $done = db()->prepare('UPDATE shares SET owner_id = :u, edit_token = :t WHERE id = :id AND owner_id IS NULL');
    $done->execute([':u' => $user['id'], ':t' => $token, ':id' => $id]);
    if (!$done->rowCount()) json_error('Diese Choreo gehört schon jemandem.', 409);
} elseif ($action === 'settings' || $action === 'rotate') {
    if (!$access['owner']) json_error('Das darf nur, wem die Choreo gehört.', 403);
    if ($action === 'rotate') {
        db()->prepare('UPDATE shares SET edit_token = :t WHERE id = :id')->execute([':t' => random_id(32), ':id' => $id]);
    } else {
        $rights = array_values(array_intersect(SHARE_RIGHTS, explode(',', (string) ($_POST['link_rights'] ?? ''))));
        db()->prepare('UPDATE shares SET view_link_enabled = :v, edit_link_enabled = :e, link_rights = :r WHERE id = :id')->execute([
            ':v' => ($_POST['view_link_enabled'] ?? '1') === '1' ? 1 : 0,
            ':e' => ($_POST['edit_link_enabled'] ?? '1') === '1' ? 1 : 0,
            ':r' => implode(',', $rights),
            ':id' => $id,
        ]);
    }
} else {
    json_error('Unbekannte Aktion', 400);
}

$share = $load();
json_response(['access' => share_access_info($share, share_access($share))]);
