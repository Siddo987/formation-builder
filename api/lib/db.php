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
        updated_at TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        project_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        logo_path TEXT,
        song_path TEXT,
        delete_token TEXT
    )");
    // Migration for a dev sqlite file created before updated_at/version existed (see
    // layouts.origin_x/y above for why this pattern is needed) — and backfill any pre-existing
    // rows so they don't read as an empty string.
    try { $pdo->exec("ALTER TABLE shares ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE shares ADD COLUMN version TEXT NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
    $pdo->exec("UPDATE shares SET updated_at = created_at WHERE updated_at = ''");
    $pdo->exec("UPDATE shares SET version = lower(hex(randomblob(12))) WHERE version = ''");
    $pdo->exec("CREATE TABLE IF NOT EXISTS figures (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        transform_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS layouts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        positions_json TEXT NOT NULL,
        origin_x REAL NOT NULL DEFAULT 0,
        origin_y REAL NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
    )");
    // Migration for a dev sqlite file created before origin_x/origin_y existed — CREATE TABLE IF
    // NOT EXISTS above is a no-op against an already-existing table, so add the columns directly;
    // ignore the error if they're already there (older sqlite has no ADD COLUMN IF NOT EXISTS).
    try { $pdo->exec("ALTER TABLE layouts ADD COLUMN origin_x REAL NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE layouts ADD COLUMN origin_y REAL NOT NULL DEFAULT 0"); } catch (Throwable $e) {}
}
