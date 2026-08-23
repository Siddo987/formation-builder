<?php
/**
 * Hand-rolled .env loader — zero dependencies, so the backend deploys by just uploading files
 * (no composer step). Reads KEY=VALUE lines, skips blank lines and lines starting with '#',
 * strips optional matching single/double quotes around the value. Populates env_get()'s cache
 * on first call; safe to call repeatedly.
 */

function env_load($path) {
    static $cache = null;
    if ($cache !== null) return $cache;
    $cache = [];
    if (!is_readable($path)) return $cache;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        $eq = strpos($line, '=');
        if ($eq === false) continue;
        $key = trim(substr($line, 0, $eq));
        $value = trim(substr($line, $eq + 1));
        if (strlen($value) >= 2) {
            $first = $value[0];
            $last = $value[strlen($value) - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $value = substr($value, 1, -1);
            }
        }
        $cache[$key] = $value;
    }
    return $cache;
}

function env_get($key, $default = null) {
    $vars = env_load(__DIR__ . '/../../.env');
    return array_key_exists($key, $vars) ? $vars[$key] : $default;
}
