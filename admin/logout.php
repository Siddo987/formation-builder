<?php
require_once __DIR__ . '/../api/lib/auth.php';
admin_logout();
header('Location: login.php');
exit;
