<?php
/**
 * Minimal session-based admin auth for /admin — a single shared password from .env (ADMIN_PASSWORD),
 * no accounts/roles, matching the rest of this app's zero-dependency approach. Not meant to
 * withstand a determined attacker with many guesses; it's a lock on the site owner's own
 * maintenance page, not a multi-tenant auth system.
 */

require_once __DIR__ . '/env.php';

function admin_password_configured(): bool {
    $pw = env_get('ADMIN_PASSWORD', '');
    return $pw !== '';
}

function admin_session_start(): void {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

function admin_is_authed(): bool {
    admin_session_start();
    return !empty($_SESSION['admin_authed']);
}

/** Redirects to login.php (preserving the originally requested page) unless already authed. */
function admin_require(): void {
    if (admin_is_authed()) return;
    admin_session_start();
    $_SESSION['admin_redirect'] = $_SERVER['REQUEST_URI'] ?? 'index.php';
    header('Location: login.php');
    exit;
}

function admin_login(string $password): bool {
    admin_session_start();
    $configured = env_get('ADMIN_PASSWORD', '');
    if ($configured !== '' && hash_equals($configured, $password)) {
        session_regenerate_id(true);
        $_SESSION['admin_authed'] = true;
        return true;
    }
    return false;
}

function admin_logout(): void {
    admin_session_start();
    $_SESSION = [];
    session_destroy();
}

/** One CSRF token per session, for the admin POST forms (add/delete figure/layout rows). */
function admin_csrf_token(): string {
    admin_session_start();
    if (empty($_SESSION['admin_csrf'])) {
        $_SESSION['admin_csrf'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['admin_csrf'];
}

function admin_csrf_check(): bool {
    admin_session_start();
    $sent = $_POST['csrf'] ?? '';
    $known = $_SESSION['admin_csrf'] ?? '';
    return $known !== '' && hash_equals($known, $sent);
}
