<?php
/**
 * POST /api/account/login.php — anmelden, mit register=1 erst ein Konto anlegen (#2104).
 * Body (form): username, password, register. Antwort: {username}; setzt das Sitzungs-Cookie.
 * Kein Passwort-Reset per E-Mail (es gibt keine E-Mail) — so abgesprochen.
 */

require_once __DIR__ . '/../lib/account.php';

require_method('POST');
db_ensure_schema();

$username = trim((string) ($_POST['username'] ?? ''));
$password = (string) ($_POST['password'] ?? '');
if (!preg_match('/^[\p{L}\p{N}_.\- ]{3,40}$/u', $username)) json_error('Der Nutzername braucht 3 bis 40 Zeichen: Buchstaben, Ziffern, Leerzeichen, Punkt, Binde- oder Unterstrich.');
if (strlen($password) < 8 || strlen($password) > 200) json_error('Das Passwort braucht mindestens 8 Zeichen.');

if (($_POST['register'] ?? '') === '1') {
    $id = random_id();
    try {
        db()->prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (:id, :u, :p, :c)')
            ->execute([':id' => $id, ':u' => $username, ':p' => password_hash($password, PASSWORD_DEFAULT), ':c' => gmdate('Y-m-d H:i:s')]);
    } catch (PDOException $e) {
        json_error('Diesen Nutzernamen gibt es schon.', 409); // unique key, also case-insensitive
    }
    account_start_session($id);
    json_response(['username' => $username], 201);
}

$stmt = db()->prepare('SELECT id, username, password_hash FROM users WHERE username = :u');
$stmt->execute([':u' => $username]);
$user = $stmt->fetch();
if (!$user || !password_verify($password, $user['password_hash'])) {
    usleep(400000); // slows down guessing
    json_error('Nutzername oder Passwort stimmt nicht.', 401);
}
account_start_session((string) $user['id']);
json_response(['username' => (string) $user['username']]);
