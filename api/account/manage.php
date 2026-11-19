<?php
/**
 * POST /api/account/manage.php — das eigene Konto verwalten (#2184). Body (form): password und action =
 *   password : new_password setzen; alle anderen Geräte werden abgemeldet.
 *   delete   : Konto löschen. Seine Choreos bleiben über ihre Links erreichbar und gehören dann
 *              niemandem mehr (wie vor #2104: wer den Bearbeiten-Link hat, darf alles).
 */

require_once __DIR__ . '/../lib/account.php';

require_method('POST');
db_ensure_schema();
$user = account_user();
if (!$user) json_error('Dafür musst du angemeldet sein.', 401);

$stmt = db()->prepare('SELECT password_hash FROM users WHERE id = :id');
$stmt->execute([':id' => $user['id']]);
if (!password_verify((string) ($_POST['password'] ?? ''), (string) $stmt->fetchColumn())) {
    usleep(400000); // slows down guessing
    json_error('Das Passwort stimmt nicht.', 403);
}

$action = (string) ($_POST['action'] ?? '');
if ($action === 'password') {
    $new = (string) ($_POST['new_password'] ?? '');
    if (strlen($new) < 8 || strlen($new) > 200) json_error('Das neue Passwort braucht mindestens 8 Zeichen.');
    db()->prepare('UPDATE users SET password_hash = :p WHERE id = :id')->execute([':p' => password_hash($new, PASSWORD_DEFAULT), ':id' => $user['id']]);
    db()->prepare('DELETE FROM user_sessions WHERE user_id = :u AND token_hash <> :h')
        ->execute([':u' => $user['id'], ':h' => hash('sha256', (string) $_COOKIE[SESSION_COOKIE])]);
    json_response(['ok' => true]);
}
if ($action === 'delete') {
    db()->prepare('UPDATE shares SET owner_id = NULL WHERE owner_id = :u')->execute([':u' => $user['id']]);
    db()->prepare('DELETE FROM user_sessions WHERE user_id = :u')->execute([':u' => $user['id']]);
    db()->prepare('DELETE FROM users WHERE id = :id')->execute([':id' => $user['id']]);
    account_set_cookie('', time() - 3600);
    json_response(['deleted' => true]);
}
json_error('Unbekannte Aktion', 400);
