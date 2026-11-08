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

/** MySQL/MariaDB table layout, mirroring schema.sql (keep both in sync). db_ensure_schema_mysql()
 *  creates a missing table from it and adds any column an existing table lacks. Starter rows
 *  (figures seeds) stay in schema.sql only. */
const DB_MYSQL_TABLES = [
    'shares' => [
        'columns' => [
            'id'           => 'VARCHAR(32) NOT NULL PRIMARY KEY',
            'created_at'   => 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
            'updated_at'   => 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
            'version'      => "VARCHAR(40) NOT NULL DEFAULT ''",
            'project_name' => "VARCHAR(120) NOT NULL DEFAULT ''",
            'payload_json' => 'JSON NOT NULL',
            'logo_path'    => 'VARCHAR(255) NULL',
            'song_path'    => 'VARCHAR(255) NULL',
            'delete_token' => 'VARCHAR(64) NULL',
            'head_commit'  => 'VARCHAR(32) NULL',
            'edit_token'   => 'VARCHAR(64) NULL',
        ],
        'extra' => [],
    ],
    'share_commits' => [
        'columns' => [
            'commit_id'    => 'VARCHAR(32) NOT NULL PRIMARY KEY',
            'share_id'     => 'VARCHAR(32) NOT NULL',
            'parent_ids'   => "VARCHAR(140) NOT NULL DEFAULT ''",
            'branch_id'    => "VARCHAR(32) NOT NULL DEFAULT ''",
            'author'       => "VARCHAR(60) NOT NULL DEFAULT ''",
            'note'         => "VARCHAR(200) NOT NULL DEFAULT ''",
            'created_at'   => 'VARCHAR(30) NOT NULL',
            'payload_json' => 'JSON NOT NULL',
        ],
        'extra' => ['INDEX share_commits_by_share (share_id, created_at)'],
    ],
    'share_presence' => [
        'columns' => [
            'share_id'     => 'VARCHAR(32) NOT NULL',
            'client_id'    => 'VARCHAR(32) NOT NULL',
            'author'       => "VARCHAR(60) NOT NULL DEFAULT ''",
            'formation_id' => "VARCHAR(40) NOT NULL DEFAULT ''",
            'since_at'     => 'BIGINT NOT NULL',
            'active_at'    => 'BIGINT NOT NULL',
            'seen_at'      => 'BIGINT NOT NULL',
        ],
        'extra' => ['PRIMARY KEY (share_id, client_id)'],
    ],
    'figures' => [
        'columns' => [
            'id'             => 'VARCHAR(32) NOT NULL PRIMARY KEY',
            'name'           => 'VARCHAR(120) NOT NULL',
            'description'    => 'VARCHAR(255) NULL',
            'transform_json' => 'JSON NOT NULL',
            'sort_order'     => 'INT NOT NULL DEFAULT 0',
        ],
        'extra' => [],
    ],
];

/** Ensures every table/column the API uses exists. sqlite (dev, see db.php header) gets the full
 *  schema created here; MySQL/MariaDB gets missing tables and columns added from DB_MYSQL_TABLES,
 *  so a deploy with a new column no longer needs a manual schema.sql run before saving works
 *  again (it used to fail with a 500 until someone did). */
function db_ensure_schema(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    if (env_get('DB_DRIVER', 'mysql') !== 'sqlite') {
        db_ensure_schema_mysql();
        return;
    }
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
    // Migration for a dev sqlite file created before updated_at/version existed — CREATE TABLE IF
    // NOT EXISTS is a no-op against an existing table and older sqlite has no ADD COLUMN IF NOT
    // EXISTS, so add each column and ignore the error — and backfill any pre-existing rows so they
    // don't read as an empty string.
    try { $pdo->exec("ALTER TABLE shares ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE shares ADD COLUMN version TEXT NOT NULL DEFAULT ''"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE shares ADD COLUMN head_commit TEXT"); } catch (Throwable $e) {}
    try { $pdo->exec("ALTER TABLE shares ADD COLUMN edit_token TEXT"); } catch (Throwable $e) {}
    $pdo->exec("UPDATE shares SET updated_at = created_at WHERE updated_at = ''");
    $pdo->exec("UPDATE shares SET version = lower(hex(randomblob(12))) WHERE version = ''");
    $pdo->exec("CREATE TABLE IF NOT EXISTS share_commits (
        commit_id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL,
        parent_ids TEXT NOT NULL DEFAULT '',
        branch_id TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS share_commits_by_share ON share_commits (share_id, created_at)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS share_presence (
        share_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        formation_id TEXT NOT NULL DEFAULT '',
        since_at INTEGER NOT NULL,
        active_at INTEGER NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (share_id, client_id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS figures (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        transform_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
    )");
}

/** MySQL/MariaDB half of db_ensure_schema(): one information_schema lookup, then CREATE TABLE /
 *  ALTER TABLE ADD COLUMN for whatever DB_MYSQL_TABLES has that the database doesn't. Runs on every
 *  API request (get.php is polled every 8s per open tab), so a complete schema is remembered in a
 *  temp-dir marker for 10 minutes — short enough that a restored older dump heals by itself.
 *  Failures go to the PHP error log instead of aborting the request; the query that needs the
 *  missing piece then fails loudly on its own. */
function db_ensure_schema_mysql(): void {
    $marker = sys_get_temp_dir() . '/rwkreator-schema-'
        . md5(env_get('DB_HOST', 'localhost') . '|' . env_get('DB_NAME', '') . '|' . serialize(DB_MYSQL_TABLES));
    $mtime = @filemtime($marker);
    if ($mtime !== false && time() - $mtime < 600) return;

    $pdo = db();
    try {
        $existing = [];
        $rows = $pdo->query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
        foreach ($rows as $r) $existing[strtolower($r['TABLE_NAME'])][strtolower($r['COLUMN_NAME'])] = true;
    } catch (Throwable $e) {
        error_log('db_ensure_schema: information_schema lookup failed: ' . $e->getMessage());
        return;
    }

    $complete = true;
    foreach (DB_MYSQL_TABLES as $table => $def) {
        $sql = [];
        if (!isset($existing[$table])) {
            $parts = [];
            foreach ($def['columns'] as $col => $type) $parts[] = "`{$col}` {$type}";
            $sql[] = "CREATE TABLE IF NOT EXISTS `{$table}` (" . implode(', ', array_merge($parts, $def['extra']))
                . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
        } else {
            foreach ($def['columns'] as $col => $type) {
                if (!isset($existing[$table][$col])) $sql[] = "ALTER TABLE `{$table}` ADD COLUMN `{$col}` {$type}";
            }
        }
        foreach ($sql as $stmt) {
            try {
                $pdo->exec($stmt);
                error_log('db_ensure_schema: applied ' . $stmt);
            } catch (Throwable $e) {
                $complete = false;
                error_log('db_ensure_schema: failed ' . $stmt . ' — ' . $e->getMessage());
            }
        }
    }
    if ($complete) @touch($marker);
}
