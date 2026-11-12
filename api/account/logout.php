<?php
/** POST /api/account/logout.php — meldet dieses Gerät ab (#2104). */

require_once __DIR__ . '/../lib/account.php';

require_method('POST');
db_ensure_schema();
account_end_session();
json_response(['ok' => true]);
