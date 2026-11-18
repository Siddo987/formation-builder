<?php
/**
 * Shared helpers for the share-link commit graph (api/share/commit.php, merge.php, history.php,
 * get.php). One row per edit that reaches the server; `parent_ids` is 0/1/2 comma-separated
 * commit ids (2 = merge). The `shares` row keeps `head_commit` = the mainline tip and mirrors its
 * payload in `payload_json`/`version` so read-only opens stay one lookup.
 *
 * Trust model is the same as the rest of the share API: no accounts, anyone with the opaque id can
 * push. The 3-way merge itself runs client-side (js/history.js) — the server only records commits
 * and validates the payload shape.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/http.php';

/** A commit id: same alphabet as random_id(). */
function commit_new_id(): string { return random_id(22); }
function branch_new_id(): string { return random_id(12); }

/** UTC ISO-8601 with millisecond precision — lexically sortable and parseable by `new Date()`
 *  client-side. Stored in a VARCHAR (plain DATETIME truncates the sub-second part that keeps two
 *  commits in the same second ordered). */
function commit_now(): string {
    $t = microtime(true);
    return gmdate('Y-m-d\TH:i:s', (int) $t) . sprintf('.%03dZ', (int) (($t - (int) $t) * 1000));
}

function commit_fetch(string $shareId, string $commitId): ?array {
    if (!preg_match('/^[A-Za-z0-9]{6,32}$/', $commitId)) return null;
    $st = db()->prepare('SELECT * FROM share_commits WHERE commit_id = :c AND share_id = :s');
    $st->execute([':c' => $commitId, ':s' => $shareId]);
    $row = $st->fetch();
    return $row ?: null;
}

/** All commits for a share, oldest first, without their payloads (a busy share has thousands, ~60 MB). */
function commits_all(string $shareId): array {
    $st = db()->prepare('SELECT commit_id, share_id, parent_ids, branch_id, author, note, created_at FROM share_commits WHERE share_id = :s ORDER BY created_at ASC');
    $st->execute([':s' => $shareId]);
    return $st->fetchAll();
}

function commit_insert(string $shareId, string $parentIds, string $branchId, string $author, string $note, string $payloadJson): string {
    $id = commit_new_id();
    $st = db()->prepare('INSERT INTO share_commits (commit_id, share_id, parent_ids, branch_id, author, note, created_at, payload_json)
                         VALUES (:c, :s, :p, :b, :a, :n, :t, :pj)');
    $st->execute([
        ':c' => $id, ':s' => $shareId, ':p' => $parentIds, ':b' => $branchId,
        ':a' => mb_substr($author, 0, 60), ':n' => mb_substr($note, 0, 200),
        ':t' => commit_now(), ':pj' => $payloadJson,
    ]);
    return $id;
}

/**
 * Makes sure the share has at least one commit. A share created before the commit graph existed
 * has head_commit = NULL — synthesize its current payload as the root commit. Returns the current
 * head commit id.
 */
function commits_ensure_root(array $shareRow): string {
    if (!empty($shareRow['head_commit'])) return (string) $shareRow['head_commit'];
    $rootId = commit_new_id();
    $branch = branch_new_id();
    $st = db()->prepare('INSERT INTO share_commits (commit_id, share_id, parent_ids, branch_id, author, note, created_at, payload_json)
                         VALUES (:c, :s, \'\', :b, \'\', :n, :t, :pj)');
    $st->execute([
        ':c' => $rootId, ':s' => $shareRow['id'], ':b' => $branch,
        ':n' => 'Ausgangsstand', ':t' => commit_now(), ':pj' => (string) $shareRow['payload_json'],
    ]);
    db()->prepare('UPDATE shares SET head_commit = :h WHERE id = :s')->execute([':h' => $rootId, ':s' => $shareRow['id']]);
    return $rootId;
}

/** branch_id of a given commit, or '' if unknown. */
function commit_branch(string $shareId, string $commitId): string {
    $c = commit_fetch($shareId, $commitId);
    return $c ? (string) $c['branch_id'] : '';
}

/** Validates a decoded payload is the expected project shape. */
function commit_valid_payload($payload): bool {
    return is_array($payload) && isset($payload['dancers']) && isset($payload['formations'])
        && is_array($payload['dancers']) && is_array($payload['formations']);
}

/**
 * Tip commits per branch: a commit that is nobody's parent. Returns
 * [ ['branch_id'=>, 'tip'=>, 'author'=>, 'created_at'=>], ... ], excluding the mainline head.
 */
function commits_branch_tips(array $commits, string $headCommit): array {
    $isParent = [];
    foreach ($commits as $c) {
        foreach (array_filter(explode(',', (string) $c['parent_ids'])) as $p) $isParent[$p] = true;
    }
    $tips = [];
    foreach ($commits as $c) {
        if (isset($isParent[$c['commit_id']])) continue;
        if ($c['commit_id'] === $headCommit) continue;
        $tips[] = [
            'branch_id'  => (string) $c['branch_id'],
            'tip'        => (string) $c['commit_id'],
            'author'     => (string) $c['author'],
            'created_at' => (string) $c['created_at'],
        ];
    }
    return $tips;
}
