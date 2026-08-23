<?php
require_once __DIR__ . '/../api/lib/auth.php';
require_once __DIR__ . '/../api/lib/db.php';

admin_require();
db_ensure_schema();

$error = '';
$notice = '';
$dbError = '';
$rows = [];

function random_row_id(string $prefix): string {
    return $prefix . '-' . bin2hex(random_bytes(6));
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!admin_csrf_check()) {
            $error = 'Sitzung abgelaufen — bitte erneut versuchen.';
        } elseif (($_POST['action'] ?? '') === 'delete') {
            $stmt = db()->prepare('DELETE FROM figures WHERE id = ?');
            $stmt->execute([(string)($_POST['id'] ?? '')]);
            $notice = 'Figur gelöscht.';
        } elseif (($_POST['action'] ?? '') === 'add') {
            $name = trim((string)($_POST['name'] ?? ''));
            $description = trim((string)($_POST['description'] ?? ''));
            $sortOrder = (int)($_POST['sort_order'] ?? 0);
            $mode = ($_POST['mode'] ?? 'solo') === 'couples' ? 'couples' : 'solo';
            $numOrZero = function ($key) { return is_numeric($_POST[$key] ?? null) ? (float)$_POST[$key] : 0.0; };
            if ($mode === 'couples') {
                $transform = [
                    'mode' => 'couples',
                    'partnerA' => ['rotateDeg' => $numOrZero('aRotateDeg'), 'translateX' => $numOrZero('aTx'), 'translateY' => $numOrZero('aTy')],
                    'partnerB' => ['rotateDeg' => $numOrZero('bRotateDeg'), 'translateX' => $numOrZero('bTx'), 'translateY' => $numOrZero('bTy')],
                ];
            } else {
                $pivot = ($_POST['pivot'] ?? 'stage-center') === 'selection-centroid' ? 'selection-centroid' : 'stage-center';
                $transform = [
                    'mode' => 'solo',
                    'pivot' => $pivot,
                    'rotateDeg' => $numOrZero('rotateDeg'),
                    'translateX' => $numOrZero('translateX'),
                    'translateY' => $numOrZero('translateY'),
                ];
            }
            if ($name === '') {
                $error = 'Name fehlt.';
            } else {
                $stmt = db()->prepare('INSERT INTO figures (id, name, description, transform_json, sort_order) VALUES (?, ?, ?, ?, ?)');
                $stmt->execute([random_row_id('fig'), $name, $description, json_encode($transform, JSON_UNESCAPED_UNICODE), $sortOrder]);
                $notice = 'Figur "' . $name . '" angelegt.';
            }
        }
    }
    $rows = db()->query('SELECT id, name, description, transform_json, sort_order FROM figures ORDER BY sort_order ASC, name ASC')->fetchAll();
} catch (Throwable $e) {
    error_log($e->getMessage());
    $dbError = 'Datenbank nicht erreichbar oder Tabelle "figures" fehlt — wurde schema.sql schon gegen die echte Datenbank ausgeführt?';
}
$csrf = admin_csrf_token();
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function describe_transform(string $json): string {
    $t = json_decode($json, true);
    if (!is_array($t)) return $json;
    $fmt = function ($n) { return (is_numeric($n) ? rtrim(rtrim(number_format((float)$n, 2), '0'), '.') : '0'); };
    if (($t['mode'] ?? '') === 'couples') {
        $a = $t['partnerA'] ?? [];
        $b = $t['partnerB'] ?? [];
        return 'Paare · Lead: ' . $fmt($a['rotateDeg'] ?? 0) . '°, X' . $fmt($a['translateX'] ?? 0) . ', Y' . $fmt($a['translateY'] ?? 0)
             . ' / Follow: ' . $fmt($b['rotateDeg'] ?? 0) . '°, X' . $fmt($b['translateX'] ?? 0) . ', Y' . $fmt($b['translateY'] ?? 0);
    }
    $pivotLabel = ($t['pivot'] ?? 'stage-center') === 'selection-centroid' ? 'Auswahlmitte' : 'Bühnenmitte';
    return 'Einzeln · ' . $pivotLabel . ' · ' . $fmt($t['rotateDeg'] ?? 0) . '°, X' . $fmt($t['translateX'] ?? 0) . ', Y' . $fmt($t['translateY'] ?? 0);
}
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Figuren — Admin — Aufstellung</title>
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
  input[type="text"],input[type="number"],select,textarea{width:100%;box-sizing:border-box;padding:.5rem .6rem;border-radius:8px;border:1px solid #ddd3c0;font-size:.85rem;font-family:inherit;}
  textarea{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;min-height:80px;}
  .triplet{display:flex;gap:.7rem;flex-wrap:wrap;}
  .triplet > div{flex:1;min-width:100px;}
  .triplet label{margin:.3rem 0 .2rem;}
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
  <nav><a class="current" href="index.php">Figuren</a><a href="layouts.php">Vorlagen</a><a href="logout.php">Abmelden</a></nav>

  <?php if ($notice): ?><p class="notice"><?= h($notice) ?></p><?php endif; ?>
  <?php if ($error): ?><p class="error"><?= h($error) ?></p><?php endif; ?>
  <?php if ($dbError): ?><p class="error"><?= h($dbError) ?></p><?php endif; ?>

  <div class="card">
    <table>
      <thead><tr><th>Name</th><th>Beschreibung</th><th>Transform</th><th>Reihenfolge</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $row): ?>
        <tr>
          <td><?= h($row['name']) ?></td>
          <td><?= h($row['description']) ?></td>
          <td><?= h(describe_transform($row['transform_json'])) ?></td>
          <td><?= h($row['sort_order']) ?></td>
          <td>
            <form method="post" onsubmit="return confirm('Figur wirklich löschen?');">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="id" value="<?= h($row['id']) ?>">
              <button type="submit" class="del-btn">Löschen</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$rows): ?><tr><td colspan="5" class="hint">Noch keine Figuren.</td></tr><?php endif; ?>
      </tbody>
    </table>
  </div>

  <div class="card">
    <strong>Neue Figur</strong>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="add">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" required maxlength="120">
      <label for="description">Beschreibung (optional)</label>
      <input type="text" id="description" name="description" maxlength="255">

      <label for="mode">Art</label>
      <select name="mode" id="mode">
        <option value="solo">Einzeln — Auswahl (Strg/Cmd-Klick) oder alle Tänzer</option>
        <option value="couples">Paare — jedes gespeicherte Paar bewegt sich individuell</option>
      </select>

      <div id="soloFields">
        <label for="pivot">Drehpunkt</label>
        <select name="pivot" id="pivot">
          <option value="stage-center">Bühnenmitte</option>
          <option value="selection-centroid">Mittelpunkt der Auswahl</option>
        </select>
        <div class="triplet">
          <div><label for="rotateDeg">Drehung °</label><input type="number" id="rotateDeg" name="rotateDeg" value="0" step="1"></div>
          <div><label for="translateX">Verschiebung X</label><input type="number" id="translateX" name="translateX" value="0" step="0.5"></div>
          <div><label for="translateY">Verschiebung Y</label><input type="number" id="translateY" name="translateY" value="0" step="0.5"></div>
        </div>
      </div>

      <div id="couplesFields" hidden>
        <p class="hint">Lead/Follow richten sich danach, wer beim Speichern eines Paares zuerst (Lead) bzw. zweitens (Follow) ausgewählt wurde.</p>
        <strong style="font-size:.8rem;">Lead</strong>
        <div class="triplet">
          <div><label for="aRotateDeg">Drehung °</label><input type="number" id="aRotateDeg" name="aRotateDeg" value="0" step="1"></div>
          <div><label for="aTx">X</label><input type="number" id="aTx" name="aTx" value="0" step="0.5"></div>
          <div><label for="aTy">Y</label><input type="number" id="aTy" name="aTy" value="0" step="0.5"></div>
        </div>
        <strong style="font-size:.8rem;">Follow</strong>
        <div class="triplet">
          <div><label for="bRotateDeg">Drehung °</label><input type="number" id="bRotateDeg" name="bRotateDeg" value="0" step="1"></div>
          <div><label for="bTx">X</label><input type="number" id="bTx" name="bTx" value="0" step="0.5"></div>
          <div><label for="bTy">Y</label><input type="number" id="bTy" name="bTy" value="0" step="0.5"></div>
        </div>
      </div>

      <label for="sort_order">Reihenfolge (kleiner = weiter oben)</label>
      <input type="number" id="sort_order" name="sort_order" value="0">
      <button type="submit">Figur anlegen</button>
    </form>
  </div>
</div>
<script>
  var modeSelect = document.getElementById('mode');
  var soloFields = document.getElementById('soloFields');
  var couplesFields = document.getElementById('couplesFields');
  modeSelect.addEventListener('change', function(){
    var isCouples = modeSelect.value === 'couples';
    soloFields.hidden = isCouples;
    couplesFields.hidden = !isCouples;
  });
</script>
</body>
</html>
