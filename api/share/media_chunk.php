<?php
/**
 * POST /api/share/media_chunk.php — accepts one chunk of a logo/song upload. The reverse proxy in
 * front of this app caps a single request body near 1 MB (see js/share.js's SHARE_BODY_BUDGET), so
 * a real song file (several MB, sometimes tens of MB) can never travel in one multipart POST — this
 * endpoint lets the client split it into pieces that each comfortably clear that cap. Nothing here
 * validates a total chunk count or assembles anything: create.php/update.php/commit.php do that once
 * every chunk has landed, by resolving a <field>_upload_id instead of a raw file (see _media.php's
 * share_resolve_incoming()).
 *
 * multipart/form-data body:
 *   upload_id : client-generated token identifying this upload (required, [A-Za-z0-9_-]{8,64})
 *   index     : 0-based chunk index (required)
 *   chunk     : the chunk's bytes (required, file field)
 *
 * Chunks land under api/uploads/tmp/<upload_id>/<index>, one file per chunk — reassembly just reads
 * them back in numeric order, so nothing needs the total count up front.
 */

require_once __DIR__ . '/../lib/http.php';

require_method('POST');

$uploadId = (string) ($_POST['upload_id'] ?? '');
if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $uploadId)) json_error('Ungültige upload_id', 400);

$index = (int) ($_POST['index'] ?? -1);
if ($index < 0 || $index > 100000) json_error('Ungültiger chunk-Index', 400);

$chunkFile = $_FILES['chunk'] ?? null;
if (!$chunkFile || $chunkFile['error'] !== UPLOAD_ERR_OK) json_error('Chunk fehlt oder Upload-Fehler', 400);

$tmpRoot = __DIR__ . '/../uploads/tmp';
media_chunk_gc($tmpRoot);

$dir = $tmpRoot . '/' . $uploadId;
if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
    json_error('Konnte Upload-Verzeichnis nicht anlegen', 500);
}
if (!move_uploaded_file($chunkFile['tmp_name'], $dir . '/' . $index)) {
    json_error('Chunk konnte nicht gespeichert werden', 500);
}

json_response(['ok' => true]);

/** Deletes tmp upload dirs whose newest chunk is older than 24h. There's no cron on this (shared
 *  hosting) deploy, so this runs opportunistically on a small fraction of calls instead — cheap
 *  enough per-request, and frequent enough that abandoned uploads (a closed tab mid-upload, a
 *  rejected oversized file whose discard call somehow didn't run) don't pile up on disk. */
function media_chunk_gc(string $tmpRoot): void {
    if (!is_dir($tmpRoot) || mt_rand(1, 50) !== 1) return;
    $cutoff = time() - 86400;
    foreach (glob($tmpRoot . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        $newest = 0;
        foreach (glob($dir . '/*') ?: [] as $f) $newest = max($newest, (int) filemtime($f));
        if ($newest > 0 && $newest < $cutoff) {
            foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
            @rmdir($dir);
        }
    }
}
