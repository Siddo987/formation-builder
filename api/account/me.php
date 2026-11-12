<?php
/** GET /api/account/me.php — wer auf diesem Gerät angemeldet ist: {username} oder {username:null} (#2104). */

require_once __DIR__ . '/../lib/account.php';

require_method('GET');
db_ensure_schema();
$user = account_user();
json_response(['username' => $user ? $user['username'] : null]);
