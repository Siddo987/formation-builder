<?php
require_once __DIR__ . '/../api/lib/auth.php';
require_once __DIR__ . '/../api/lib/db.php';

admin_require();
db_ensure_schema();

$error = '';
$notice = '';
$dbError = '';
$rows = [];

function random_row_id2(string $prefix): string {
    return $prefix . '-' . bin2hex(random_bytes(6));
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!admin_csrf_check()) {
            $error = 'Sitzung abgelaufen — bitte erneut versuchen.';
        } elseif (($_POST['action'] ?? '') === 'delete') {
            $stmt = db()->prepare('DELETE FROM layouts WHERE id = ?');
            $stmt->execute([(string)($_POST['id'] ?? '')]);
            $notice = 'Vorlage gelöscht.';
        } elseif (($_POST['action'] ?? '') === 'add') {
            $name = trim((string)($_POST['name'] ?? ''));
            $description = trim((string)($_POST['description'] ?? ''));
            $positionsRaw = trim((string)($_POST['positions_json'] ?? ''));
            $sortOrder = (int)($_POST['sort_order'] ?? 0);
            $decoded = json_decode($positionsRaw, true);
            $validPositions = is_array($decoded) && count($decoded) > 0 && array_reduce($decoded, function ($ok, $p) {
                return $ok && is_array($p) && isset($p['x']) && isset($p['y']) && is_numeric($p['x']) && is_numeric($p['y']);
            }, true);
            if ($name === '') {
                $error = 'Name fehlt.';
            } elseif (!$validPositions) {
                $error = 'Positions-JSON ist ungültig — erwartet wird eine Liste wie [{"x":0,"y":5},{"x":2,"y":3}].';
            } else {
                $stmt = db()->prepare('INSERT INTO layouts (id, name, description, positions_json, sort_order) VALUES (?, ?, ?, ?, ?)');
                $stmt->execute([random_row_id2('lay'), $name, $description, json_encode($decoded, JSON_UNESCAPED_UNICODE), $sortOrder]);
                $notice = 'Vorlage "' . $name . '" angelegt.';
            }
        }
    }
    $rows = db()->query('SELECT id, name, description, positions_json, sort_order FROM layouts ORDER BY sort_order ASC, name ASC')->fetchAll();
} catch (Throwable $e) {
    error_log($e->getMessage());
    $dbError = 'Datenbank nicht erreichbar oder Tabelle "layouts" fehlt — wurde schema.sql schon gegen die echte Datenbank ausgeführt?';
}
$csrf = admin_csrf_token();
function h2($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Vorlagen — Admin — Aufstellung</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{font-family:system-ui,sans-serif;background:#f4efe6;color:#241a30;margin:0;padding:2rem;}
  .wrap{max-width:900px;margin:0 auto;}
  h1{font-size:1.3rem;margin:0 0 .3rem;}
  nav{margin-bottom:1.2rem;font-size:.85rem;}
  nav a{color:#8d79d1;text-decoration:none;font-weight:600;margin-right:1rem;}
  nav a:hover{text-decoration:underline;}
  nav a.current{color:#241a30;}
  .card{background:#fff;border-radius:12px;padding:1.2rem 1.4rem;margin-bottom:1.2rem;box-shadow:0 4px 14px -8px rgba(0,0,0,.2);}
  table{width:100%;border-collapse:collapse;font-size:.85rem;}
  th,td{text-align:left;padding:.5rem .4rem;border-bottom:1px solid #eee;vertical-align:top;}
  th{color:#8a7c9c;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;}
  code,pre{font-family:ui-monospace,Consolas,monospace;font-size:.76rem;background:#f4efe6;border-radius:6px;padding:.2rem .4rem;}
  pre{white-space:pre-wrap;word-break:break-word;margin:0;max-width:340px;}
  label{display:block;font-size:.78rem;font-weight:700;margin:.7rem 0 .25rem;color:#5c5268;}
  input[type="text"],input[type="number"],textarea{width:100%;box-sizing:border-box;padding:.5rem .6rem;border-radius:8px;border:1px solid #ddd3c0;font-size:.85rem;font-family:inherit;}
  textarea{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;min-height:80px;}
  button{margin-top:1rem;padding:.55rem 1.1rem;border-radius:8px;border:none;background:#d99a34;color:#241a30;font-weight:700;cursor:pointer;}
  button:hover{background:#e0a336;}
  .del-btn{margin:0;padding:.3rem .6rem;font-size:.72rem;background:#f6dcd8;color:#a5443a;}
  .del-btn:hover{background:#f0c4bd;}
  .notice{color:#3c7a5a;font-size:.82rem;}
  .error{color:#a5443a;font-size:.82rem;}
  .hint{color:#8a7c9c;font-size:.78rem;}
</style>
</head>
<body>
<div class="wrap">
  <h1>Aufstellung — Admin</h1>
  <nav><a href="index.php">Figuren</a><a class="current" href="layouts.php">Vorlagen</a><a href="logout.php">Abmelden</a></nav>

  <?php if ($notice): ?><p class="notice"><?= h2($notice) ?></p><?php endif; ?>
  <?php if ($error): ?><p class="error"><?= h2($error) ?></p><?php endif; ?>
  <?php if ($dbError): ?><p class="error"><?= h2($dbError) ?></p><?php endif; ?>

  <div class="card">
    <table>
      <thead><tr><th>Name</th><th>Beschreibung</th><th>Positionen</th><th>Reihenfolge</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $row): ?>
        <tr>
          <td><?= h2($row['name']) ?></td>
          <td><?= h2($row['description']) ?></td>
          <td><pre><?= h2($row['positions_json']) ?></pre></td>
          <td><?= h2($row['sort_order']) ?></td>
          <td>
            <form method="post" onsubmit="return confirm('Vorlage wirklich löschen?');">
              <input type="hidden" name="csrf" value="<?= h2($csrf) ?>">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="id" value="<?= h2($row['id']) ?>">
              <button type="submit" class="del-btn">Löschen</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="5" class="hint">Noch keine Vorlagen.</td></tr><?php endif; ?>
      </tbody>
    </table>
  </div>

  <div class="card">
    <strong>Neue Vorlage</strong>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= h2($csrf) ?>">
      <input type="hidden" name="action" value="add">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" required maxlength="120">
      <label for="description">Beschreibung (optional)</label>
      <input type="text" id="description" name="description" maxlength="255">
      <label for="positions_json">Positions-JSON</label>
      <textarea id="positions_json" name="positions_json" required placeholder='[{"x":-6,"y":5},{"x":0,"y":5},{"x":6,"y":5}]'></textarea>
      <p class="hint">
        Liste von Zielpunkten auf dem Bühnenraster (-7 bis 7, wie bei Tänzer-Positionen), in der Reihenfolge, in der sie den Tänzern zugeordnet werden.
        Mehr Punkte als Tänzer im Projekt sind erlaubt (der Rest wird einfach nicht angezeigt).
      </p>
      <label for="sort_order">Reihenfolge (kleiner = weiter oben)</label>
      <input type="number" id="sort_order" name="sort_order" value="0">
      <button type="submit">Vorlage anlegen</button>
    </form>
  </div>
</div>
</body>
</html>
