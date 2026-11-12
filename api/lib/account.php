<?php
/**
 * Konten und Rechte geteilter Choreos (#2104). Ein Konto (Nutzername + Passwort) braucht nur, wer
 * die Rechte einer Choreo festlegen will: Wer sie übernimmt, wird Besitzer und kann Ansehen- und
 * Bearbeiten-Link abschalten, festlegen was der Bearbeiten-Link darf, ihn erneuern und die Choreo
 * endgültig löschen. Ohne Besitzer gilt wie bisher: wer den Bearbeiten-Link hat, darf alles.
 *
 * Angemeldet wird per HttpOnly-Cookie (SameSite=Strict, also kein CSRF über fremde Seiten); in
 * user_sessions liegt nur der SHA-256 des Tokens.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/http.php';

const SESSION_COOKIE = 'rwk_session';
const SHARE_RIGHTS = ['edit', 'rename', 'delete', 'media', 'videos'];

function account_user(): ?array {
    static $user = false;
    if ($user !== false) return $user;
    $user = null;
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token === '' || strlen($token) > 128) return null;
    $stmt = db()->prepare('SELECT u.id, u.username, s.last_seen_at FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = :h');
    $stmt->execute([':h' => hash('sha256', $token)]);
    $row = $stmt->fetch();
    if (!$row) return null;
    if (strtotime($row['last_seen_at'] . ' UTC') < time() - 3600) {
        db()->prepare('UPDATE user_sessions SET last_seen_at = :t WHERE token_hash = :h')
            ->execute([':t' => gmdate('Y-m-d H:i:s'), ':h' => hash('sha256', $token)]);
    }
    $user = ['id' => (string) $row['id'], 'username' => (string) $row['username']];
    return $user;
}

function account_set_cookie(string $value, int $expires): void {
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expires, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict',
        'secure' => ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https',
    ]);
}

function account_start_session(string $userId): void {
    $token = random_id(40);
    $now = gmdate('Y-m-d H:i:s');
    db()->prepare('INSERT INTO user_sessions (token_hash, user_id, created_at, last_seen_at) VALUES (:h, :u, :c, :c)')
        ->execute([':h' => hash('sha256', $token), ':u' => $userId, ':c' => $now]);
    account_set_cookie($token, time() + 365 * 86400);
}

function account_end_session(): void {
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token !== '') db()->prepare('DELETE FROM user_sessions WHERE token_hash = :h')->execute([':h' => hash('sha256', $token)]);
    account_set_cookie('', time() - 3600);
}

/** The edit token a request carries: POST field on writes, ?t= on reads. */
function share_request_token(): string {
    return (string) ($_POST['edit_token'] ?? $_GET['t'] ?? '');
}

function share_link_rights(array $share): array {
    $raw = $share['link_rights'] ?? null;
    if ($raw === null) return SHARE_RIGHTS;
    return array_values(array_intersect(SHARE_RIGHTS, explode(',', (string) $raw)));
}

/**
 * What this request may do with the share: {owner, can_view, rights}.
 *   - owner (signed in as owner_id): everything, whatever the link settings say.
 *   - edit link (matching, switched-on edit_token): everything without an owner, else link_rights.
 *   - legacy share without edit_token: everything, as before view-only links existed.
 *   - anyone else: view only, and only while the view link is on.
 */
function share_access(array $share): array {
    $user = account_user();
    $isOwner = $user && ($share['owner_id'] ?? null) === $user['id'];
    if ($isOwner) return ['owner' => true, 'can_view' => true, 'rights' => SHARE_RIGHTS];
    $owned = !empty($share['owner_id']);
    $needed = (string) ($share['edit_token'] ?? '');
    $token = share_request_token();
    $editLink = $needed === '' || ($token !== '' && hash_equals($needed, $token) && (!$owned || (int) $share['edit_link_enabled'] === 1));
    if ($editLink) return ['owner' => false, 'can_view' => true, 'rights' => $owned ? share_link_rights($share) : SHARE_RIGHTS];
    return ['owner' => false, 'can_view' => !$owned || (int) $share['view_link_enabled'] === 1, 'rights' => []];
}

/** Any write needs the edit right: the owner, a switched-on edit link, or a legacy link without token. */
function share_assert_can_write(array $share): array {
    $access = share_access($share);
    share_assert_right($access, 'edit');
    return $access;
}

/** Lied/Logo: an upload, or a present flag that differs from what's stored, needs the media right. */
function share_assert_media_rights(array $access, array $share, bool $logoPresent, bool $songPresent, bool $newLogo, bool $newSong): void {
    if ($newLogo || $newSong || $logoPresent !== !empty($share['logo_path']) || $songPresent !== !empty($share['song_path'])) {
        share_assert_right($access, 'media');
    }
}

function share_assert_can_view(array $share): array {
    $access = share_access($share);
    if (!$access['can_view']) json_error('Dieser Link wurde abgeschaltet.', 403);
    return $access;
}

function share_assert_right(array $access, string $right): void {
    if (in_array($right, $access['rights'], true)) return;
    $msg = [
        'edit'   => 'Dieser Link ist nur zum Ansehen — Bearbeiten ist damit nicht möglich.',
        'rename' => 'Mit diesem Link darfst du die Choreo nicht umbenennen.',
        'delete' => 'Mit diesem Link darfst du keine Bilder löschen.',
        'media'  => 'Mit diesem Link darfst du Lied und Logo nicht ändern.',
        'videos' => 'Mit diesem Link darfst du keine Videos hochladen oder löschen.',
    ][$right] ?? 'Keine Berechtigung.';
    json_error($msg, 403);
}

/**
 * A write of $new over $old (both project payloads) only renames or drops Bilder when the link may.
 * The browser hides those controls already; this keeps a hand-made request from doing it anyway.
 */
function share_assert_payload_rights(array $access, ?array $old, array $new): void {
    if (!$old) return;
    if ((string) ($old['projectName'] ?? '') !== (string) ($new['projectName'] ?? '')) share_assert_right($access, 'rename');
    $ids = function ($p) { return array_map(function ($f) { return (string) ($f['id'] ?? ''); }, is_array($p['formations'] ?? null) ? $p['formations'] : []); };
    if (array_diff($ids($old), $ids($new))) share_assert_right($access, 'delete');
}

/** Account info for the client: who is signed in, and how this share is owned. */
function share_access_info(array $share, array $access): array {
    $info = ['owner' => $access['owner'], 'owned' => !empty($share['owner_id']), 'rights' => $access['rights'], 'owner_name' => null];
    if ($info['owned']) {
        $stmt = db()->prepare('SELECT username FROM users WHERE id = :id');
        $stmt->execute([':id' => $share['owner_id']]);
        $info['owner_name'] = $stmt->fetchColumn() ?: null;
    }
    if ($access['owner']) {
        $info['view_link_enabled'] = (int) $share['view_link_enabled'] === 1;
        $info['edit_link_enabled'] = (int) $share['edit_link_enabled'] === 1;
        $info['link_rights'] = share_link_rights($share);
        $info['edit_token'] = (string) ($share['edit_token'] ?? '');
    }
    return $info;
}
