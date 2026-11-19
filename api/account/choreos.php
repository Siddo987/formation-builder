<?php
/**
 * GET /api/account/choreos.php — die geteilten Choreos, die dem angemeldeten Konto gehören (#2184):
 * {choreos: [{id, name, updated_at, edit_token}]}, zuletzt geänderte zuerst.
 */

require_once __DIR__ . '/../lib/account.php';

require_method('GET');
db_ensure_schema();
$user = account_user();
if (!$user) json_error('Dafür musst du angemeldet sein.', 401);

$stmt = db()->prepare('SELECT id, project_name, updated_at, edit_token FROM shares WHERE owner_id = :u ORDER BY updated_at DESC');
$stmt->execute([':u' => $user['id']]);
json_response(['choreos' => array_map(function ($r) {
    return ['id' => (string) $r['id'], 'name' => (string) $r['project_name'], 'updated_at' => gmdate('c', strtotime($r['updated_at'] . ' UTC')), 'edit_token' => (string) ($r['edit_token'] ?? '')];
}, $stmt->fetchAll())]);
