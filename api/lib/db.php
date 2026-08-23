<?php
/**
 * PDO connection helper, built from .env values. Defaults to MySQL (matches the shared-hosting
 * deployment target); set DB_DRIVER=sqlite in .env for local development without a MySQL server
 * (e.g. while testing on a machine that doesn't have one set up yet — schema.sql's statements
 * are plain-enough SQL to work under either, see its header comment).
 */

require_once __DIR__ . '/env.php';

function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $driver = env_get('DB_DRIVER', 'mysql');
    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    if ($driver === 'sqlite') {
        $path = env_get('DB_SQLITE_PATH', __DIR__ . '/../../data/aufstellung.sqlite');
        $dir = dirname($path);
        if (!is_dir($dir)) mkdir($dir, 0770, true);
        $pdo = new PDO('sqlite:' . $path, null, null, $opts);
        $pdo->exec('PRAGMA foreign_keys = ON');
    } else {
        $host = env_get('DB_HOST', 'localhost');
        $name = env_get('DB_NAME', '');
        $user = env_get('DB_USER', '');
        $pass = env_get('DB_PASS', '');
        $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, $opts);
    }

    return $pdo;
}

/** Ensures the shares/figures tables exist — used for the sqlite dev-convenience path (see db.php
 *  header) so a fresh local setup works without manually running schema.sql first. On MySQL,
 *  schema.sql (run once by the site owner) is the source of truth; this is a no-op there beyond
 *  the guard, since real deployments run schema.sql explicitly instead. */
function db_ensure_schema(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    if (env_get('DB_DRIVER', 'mysql') !== 'sqlite') return;
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        project_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        logo_path TEXT,
        song_path TEXT,
        delete_token TEXT
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS figures (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        transform_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
    )");
}
