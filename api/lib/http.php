<?php
/** Small shared helpers for the JSON API endpoints. */

// Converts any uncaught exception (a DB connection failure being the most likely case — e.g.
// before .env is filled in or during a DB outage) into a clean JSON 500 instead of PHP dumping a
// raw HTML stack trace with a 200 status. The real error still goes to the server's error log,
// just not to the client — PDOException messages can include schema/query details worth keeping
// out of client-facing output even though PHP 8.2 already redacts the password itself.
set_exception_handler(function (Throwable $e): void {
    error_log($e->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => 'Interner Serverfehler'], JSON_UNESCAPED_UNICODE);
    exit;
});

function json_response($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $message, int $status = 400): void {
    json_response(['error' => $message], $status);
}

function require_method(string $method): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        json_error('Method not allowed', 405);
    }
}

/** Reads and JSON-decodes the request body, or errors out with a 400. */
function read_json_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) json_error('Ungültiger JSON-Body');
    return $data;
}

/** Opaque, non-sequential id (base62, default 22 chars ≈ 131 bits — plenty to resist guessing). */
function random_id(int $length = 22): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    $out = '';
    $bytes = random_bytes($length);
    for ($i = 0; $i < $length; $i++) {
        $out .= $alphabet[ord($bytes[$i]) % strlen($alphabet)];
    }
    return $out;
}
