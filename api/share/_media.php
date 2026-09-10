<?php
/**
 * Shared logo/song handling for share writes (create.php/update.php/commit.php). Same present/file
 * semantics throughout:
 *   present=false        -> remove any stored file
 *   present=true + file  -> replace
 *   present=true, no file -> keep whatever is stored
 *
 * "file" here means either a normal $_FILES entry (small media that fit in the main request) or a
 * <kind>_upload_id + <kind>_filename pair (media the client had to split into chunks via
 * media_chunk.php first — see js/share.js's attachShareMedia() — because the reverse proxy in front
 * of this app caps a single request body near 1 MB). share_resolve_incoming() below turns either
 * shape into the same $_FILES-like array so the rest of the pipeline doesn't care which one it got.
 */

// Include-only — nothing to do if hit directly.
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) { http_response_code(404); exit; }

function share_media_safe_ext(array $file, string $fallback): string {
    $fromName = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
    if (preg_match('/^[a-z0-9]{2,4}$/', $fromName)) return $fromName;
    $mimeMap = [
        'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/svg+xml' => 'svg',
        'audio/mpeg' => 'mp3', 'audio/wav' => 'wav', 'audio/ogg' => 'ogg', 'audio/mp4' => 'm4a', 'audio/aac' => 'aac',
    ];
    return $mimeMap[$file['type'] ?? ''] ?? $fallback;
}

function share_media_delete(?string $relPath): void {
    if (!$relPath) return;
    $abs = __DIR__ . '/../uploads/' . $relPath;
    if (is_file($abs)) @unlink($abs);
}

/** POST field reader for the *_upload_id fields: '' and "no file present" both mean null, so
 *  callers can treat "no upload_id" and "no raw file" the same way without a nested ternary. */
function share_post_upload_id(string $field): ?string {
    $v = (string) ($_POST[$field] ?? '');
    return $v === '' ? null : $v;
}

function share_media_tmp_dir(string $uploadId): ?string {
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $uploadId)) return null;
    return __DIR__ . '/../uploads/tmp/' . $uploadId;
}

/** Chunk part filenames are just their numeric index — sorted numerically, not lexically. */
function share_media_sorted_parts(string $dir): array {
    $parts = glob($dir . '/[0-9]*') ?: [];
    usort($parts, function ($a, $b) { return (int) basename($a) <=> (int) basename($b); });
    return $parts;
}

/** Byte count of an incoming file without assembling it — cheap enough to do before the
 *  SHARE_MAX_BYTES check so an oversized upload is rejected without ever concatenating it. */
function share_incoming_size(?array $rawFile, ?string $uploadId): int {
    if ($rawFile) return (int) ($rawFile['size'] ?? 0);
    $dir = $uploadId ? share_media_tmp_dir($uploadId) : null;
    if (!$dir || !is_dir($dir)) return 0;
    $total = 0;
    foreach (share_media_sorted_parts($dir) as $p) $total += (int) filesize($p);
    return $total;
}

/** Deletes an upload's chunk parts without assembling them — used when the request is rejected
 *  (e.g. over budget) so abandoned chunks don't wait around for the 24h GC in media_chunk.php. */
function share_discard_incoming_upload(?string $uploadId): void {
    $dir = $uploadId ? share_media_tmp_dir($uploadId) : null;
    if (!$dir || !is_dir($dir)) return;
    foreach (share_media_sorted_parts($dir) as $p) @unlink($p);
    @rmdir($dir);
}

/**
 * Resolves one incoming file to a $_FILES-shaped array, whichever form it arrived in. For a chunked
 * upload this concatenates the parts into a single temp file and removes the chunk dir — the result
 * carries '__chunked' => true so share_consume_ingested() below knows to rename() it into place
 * instead of calling move_uploaded_file() (which only works on files PHP itself received as an
 * upload). Returns null if neither a raw file nor a resolvable upload_id was given.
 */
function share_resolve_incoming(?array $rawFile, ?string $uploadId, ?string $filenameHint): ?array {
    if ($rawFile) return $rawFile + ['__chunked' => false];
    $dir = $uploadId ? share_media_tmp_dir($uploadId) : null;
    if (!$dir || !is_dir($dir)) return null;
    $parts = share_media_sorted_parts($dir);
    if (!$parts) return null;

    $assembled = $dir . '.assembled';
    $out = fopen($assembled, 'wb');
    if (!$out) return null;
    $size = 0;
    foreach ($parts as $p) {
        $in = fopen($p, 'rb');
        if (!$in) continue;
        while (!feof($in)) {
            $buf = fread($in, 1048576);
            if ($buf === false || $buf === '') break;
            $size += strlen($buf);
            fwrite($out, $buf);
        }
        fclose($in);
    }
    fclose($out);

    // Parts are consumed once assembled, win or lose — the caller either moves $assembled into
    // place next or discards it; either way the chunk dir itself has no further use.
    foreach ($parts as $p) @unlink($p);
    @rmdir($dir);

    return ['tmp_name' => $assembled, 'name' => (string) $filenameHint, 'type' => '', 'size' => $size, 'error' => UPLOAD_ERR_OK, '__chunked' => true];
}

/** move_uploaded_file() rejects anything that isn't a genuine PHP upload — a chunk-assembled file
 *  needs a plain filesystem move instead. */
function share_consume_ingested(array $file, string $dest): bool {
    if (!empty($file['__chunked'])) {
        if (@rename($file['tmp_name'], $dest)) return true;
        $ok = @copy($file['tmp_name'], $dest);
        @unlink($file['tmp_name']);
        return $ok;
    }
    return move_uploaded_file($file['tmp_name'], $dest);
}

/**
 * Applies the present/file rules for both logo and song, resolving chunked uploads as needed.
 * $logoFile/$songFile are raw $_FILES entries (or null); $logoUploadId/$songUploadId + the matching
 * *NameHint are the chunked alternative (or null). Returns [$logoPath, $songPath, $touchLogo, $touchSong].
 */
function share_apply_media(
    string $id, ?string $logoPath, ?string $songPath, bool $logoPresent, bool $songPresent,
    ?array $logoFile, ?array $songFile,
    ?string $logoUploadId = null, ?string $songUploadId = null,
    ?string $logoNameHint = null, ?string $songNameHint = null
): array {
    $uploadsRoot = __DIR__ . '/../uploads/shares/' . $id;
    $touchLogo = false;
    $touchSong = false;

    $handle = function (string $kind, ?string &$path, bool $present, ?array $rawFile, ?string $uploadId, ?string $nameHint, bool &$touch) use ($uploadsRoot, $id) {
        if (!$present) {
            if ($path) { share_media_delete($path); $path = null; $touch = true; }
            share_discard_incoming_upload($uploadId); // e.g. a chunked upload that raced a removal
            return;
        }
        $file = share_resolve_incoming($rawFile, $uploadId, $nameHint);
        if (!$file) return; // present, no new file: keep stored
        if (!is_dir($uploadsRoot) && !mkdir($uploadsRoot, 0770, true) && !is_dir($uploadsRoot)) {
            json_error('Konnte Upload-Verzeichnis nicht anlegen', 500);
        }
        share_media_delete($path);
        $ext = share_media_safe_ext($file, 'bin');
        $rel = 'shares/' . $id . '/' . $kind . '.' . $ext;
        if (!share_consume_ingested($file, $uploadsRoot . '/' . $kind . '.' . $ext)) {
            json_error(ucfirst($kind) . '-Upload fehlgeschlagen', 500);
        }
        $path = $rel;
        $touch = true;
    };

    $handle('logo', $logoPath, $logoPresent, $logoFile, $logoUploadId, $logoNameHint, $touchLogo);
    $handle('song', $songPath, $songPresent, $songFile, $songUploadId, $songNameHint, $touchSong);

    return [$logoPath, $songPath, $touchLogo, $touchSong];
}
