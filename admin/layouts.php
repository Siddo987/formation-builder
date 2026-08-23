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
            $originRaw = trim((string)($_POST['origin_json'] ?? ''));
            $sortOrder = (int)($_POST['sort_order'] ?? 0);
            $decoded = json_decode($positionsRaw, true);
            $validPositions = is_array($decoded) && count($decoded) > 0 && array_reduce($decoded, function ($ok, $p) {
                return $ok && is_array($p) && isset($p['x']) && isset($p['y']) && is_numeric($p['x']) && is_numeric($p['y']);
            }, true);
            $originDecoded = json_decode($originRaw, true);
            $originX = (is_array($originDecoded) && isset($originDecoded['x']) && is_numeric($originDecoded['x'])) ? (float)$originDecoded['x'] : 0.0;
            $originY = (is_array($originDecoded) && isset($originDecoded['y']) && is_numeric($originDecoded['y'])) ? (float)$originDecoded['y'] : 0.0;
            if ($name === '') {
                $error = 'Name fehlt.';
            } elseif (!$validPositions) {
                $error = 'Positions-JSON ist ungültig — erwartet wird eine Liste wie [{"x":0,"y":5},{"x":2,"y":3}].';
            } else {
                $stmt = db()->prepare('INSERT INTO layouts (id, name, description, positions_json, origin_x, origin_y, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([random_row_id2('lay'), $name, $description, json_encode($decoded, JSON_UNESCAPED_UNICODE), $originX, $originY, $sortOrder]);
                $notice = 'Vorlage "' . $name . '" angelegt.';
            }
        }
    }
    $rows = db()->query('SELECT id, name, description, positions_json, origin_x, origin_y, sort_order FROM layouts ORDER BY sort_order ASC, name ASC')->fetchAll();
} catch (Throwable $e) {
    error_log($e->getMessage());
    $dbError = 'Datenbank nicht erreichbar oder Tabelle "layouts" fehlt — wurde schema.sql schon gegen die echte Datenbank ausgeführt?';
}
$csrf = admin_csrf_token();
function h2($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function describe_positions(string $json): string {
    $p = json_decode($json, true);
    if (!is_array($p)) return $json;
    $n = count($p);
    return $n . ($n === 1 ? ' Punkt' : ' Punkte');
}
function describe_origin($x, $y): string {
    $fmt = function ($v) { return rtrim(rtrim(sprintf('%.2f', round((float)$v, 2)), '0'), '.'); };
    return '(' . $fmt($x) . ' / ' . $fmt($y) . ')';
}
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
  .vorlage-grid{
    position:relative; width:100%; max-width:360px; aspect-ratio:1;
    background:
      linear-gradient(#e8dfcb 1px, transparent 1px),
      linear-gradient(90deg, #e8dfcb 1px, transparent 1px);
    background-size:calc(100%/7) calc(100%/7);
    background-color:#faf6ef;
    border:1px solid #ddd3c0; border-radius:10px;
    cursor:crosshair; user-select:none; touch-action:none;
  }
  .vorlage-origin{
    position:absolute; width:20px; height:20px;
    transform:translate(-50%,-50%) rotate(45deg);
    background:#8d79d1; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.25);
    cursor:grab;
  }
  .vorlage-origin:active{cursor:grabbing;}
  .vorlage-point{
    position:absolute; width:26px; height:26px;
    transform:translate(-50%,-50%); border-radius:50%;
    background:#d99a34; color:#241a30; font-weight:700; font-size:.7rem;
    display:flex; align-items:center; justify-content:center;
    cursor:grab; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.25);
  }
  .vorlage-point:active{cursor:grabbing;}
  .vorlage-toolbar{display:flex; align-items:center; gap:.6rem; margin-top:.5rem; flex-wrap:wrap;}
  .vorlage-toolbar button{margin-top:0; padding:.4rem .7rem; font-size:.78rem;}
  .vorlage-toolbar button.secondary{background:#eee2ce; color:#5c5268;}
  .vorlage-toolbar button.secondary:hover{background:#e4d5b8;}
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
      <thead><tr><th>Name</th><th>Beschreibung</th><th>Positionen</th><th>Orientierungspunkt</th><th>Reihenfolge</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $row): ?>
        <tr>
          <td><?= h2($row['name']) ?></td>
          <td><?= h2($row['description']) ?></td>
          <td><?= h2(describe_positions($row['positions_json'])) ?> <details><summary class="hint" style="cursor:pointer;display:inline;">JSON</summary><pre><?= h2($row['positions_json']) ?></pre></details></td>
          <td><?= h2(describe_origin($row['origin_x'] ?? 0, $row['origin_y'] ?? 0)) ?></td>
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
      <?php if (!$rows): ?><tr><td colspan="6" class="hint">Noch keine Vorlagen.</td></tr><?php endif; ?>
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
      <label>Form (nur Positionen relativ zueinander — die ganze Form wird beim Anzeigen frei auf der Bühne platziert und gedreht)</label>
      <div class="vorlage-grid" id="vorlageGrid"></div>
      <div class="vorlage-toolbar">
        <button type="button" class="secondary" id="vorlageUndoBtn">Letzten Punkt entfernen</button>
        <button type="button" class="secondary" id="vorlageClearBtn">Alle löschen</button>
        <button type="button" class="secondary" id="vorlageOriginResetBtn">Orientierungspunkt zurücksetzen</button>
        <span class="hint" id="vorlagePointCount">0 Punkte</span>
      </div>
      <p class="hint">
        Auf das Raster klicken = Punkt hinzufügen. Punkt ziehen = verschieben. Doppelklick auf einen Punkt = löschen.
        Die Reihenfolge (Nummern) bestimmt, welcher Tänzer welchem Punkt zugeordnet wird.
        Der violette Diamant ist der <strong>Orientierungspunkt</strong> — der Punkt, um den sich die Vorlage
        dreht (Drehfeld auf der Bühne) und den man dort auch selbst greifen und verschieben kann; frei ziehbar,
        muss kein Tänzer-Punkt sein.
      </p>
      <input type="hidden" name="positions_json" id="positions_json" value="[]">
      <input type="hidden" name="origin_json" id="origin_json" value='{"x":0,"y":0}'>
      <label for="sort_order">Reihenfolge (kleiner = weiter oben)</label>
      <input type="number" id="sort_order" name="sort_order" value="0">
      <button type="submit">Vorlage anlegen</button>
    </form>
  </div>
</div>
<script>
(function(){
  var GRID_MIN = -7, GRID_MAX = 7, GRID_SPAN = 14;
  var grid = document.getElementById('vorlageGrid');
  var field = document.getElementById('positions_json');
  var originField = document.getElementById('origin_json');
  var countEl = document.getElementById('vorlagePointCount');
  var points = [];
  var origin = {x: 0, y: 0};
  var suppressNextClick = false;

  function toPercent(v){ return ((v - GRID_MIN) / GRID_SPAN) * 100; }
  function toGrid(pct){ return (pct / 100) * GRID_SPAN + GRID_MIN; }
  function snap(v){ return Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(v * 2) / 2)); }

  function sync(){
    field.value = JSON.stringify(points);
    originField.value = JSON.stringify(origin);
    countEl.textContent = points.length + (points.length === 1 ? ' Punkt' : ' Punkte');
    render();
  }

  // The orientation point ("Orientierungspunkt") is its own always-present, non-deletable marker
  // — a diamond distinct from the numbered dancer-slot dots — draggable the same way, but not
  // tied to any dancer. It's the rotation pivot on the stage side (see js/stage.js's
  // layoutPointToStage), so unlike the numbered points, dragging it never adds/removes anything.
  function renderOrigin(){
    var el = grid.querySelector('.vorlage-origin');
    if(!el){
      el = document.createElement('div');
      el.className = 'vorlage-origin';
      el.title = 'Orientierungspunkt — Drehpunkt der Vorlage; ziehen zum Verschieben';
      el.addEventListener('pointerdown', function(e){
        e.preventDefault(); e.stopPropagation();
        try{ el.setPointerCapture(e.pointerId); }catch(err){}
        function onMove(ev){
          var rect = grid.getBoundingClientRect();
          var px = ((ev.clientX - rect.left) / rect.width) * 100;
          var py = ((ev.clientY - rect.top) / rect.height) * 100;
          origin = { x: snap(toGrid(px)), y: snap(toGrid(py)) };
          sync();
        }
        function onUp(){
          suppressNextClick = true;
          try{ el.releasePointerCapture(e.pointerId); }catch(err){}
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
        }
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      });
      grid.appendChild(el);
    }
    el.style.left = toPercent(origin.x) + '%';
    el.style.top = toPercent(origin.y) + '%';
  }

  function render(){
    grid.querySelectorAll('.vorlage-point').forEach(function(el){ el.remove(); });
    renderOrigin();
    points.forEach(function(p, i){
      var el = document.createElement('div');
      el.className = 'vorlage-point';
      el.style.left = toPercent(p.x) + '%';
      el.style.top = toPercent(p.y) + '%';
      el.textContent = String(i + 1);
      el.title = 'Ziehen zum Verschieben, Doppelklick zum Löschen';
      el.addEventListener('dblclick', function(e){
        e.preventDefault(); e.stopPropagation();
        points.splice(i, 1);
        sync();
      });
      el.addEventListener('pointerdown', function(e){
        e.preventDefault(); e.stopPropagation();
        try{ el.setPointerCapture(e.pointerId); }catch(err){}
        function onMove(ev){
          var rect = grid.getBoundingClientRect();
          var px = ((ev.clientX - rect.left) / rect.width) * 100;
          var py = ((ev.clientY - rect.top) / rect.height) * 100;
          points[i] = { x: snap(toGrid(px)), y: snap(toGrid(py)) };
          sync();
        }
        function onUp(){
          suppressNextClick = true;
          try{ el.releasePointerCapture(e.pointerId); }catch(err){}
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
        }
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      });
      grid.appendChild(el);
    });
  }

  grid.addEventListener('click', function(e){
    if(suppressNextClick){ suppressNextClick = false; return; }
    if(e.target !== grid) return;
    var rect = grid.getBoundingClientRect();
    var px = ((e.clientX - rect.left) / rect.width) * 100;
    var py = ((e.clientY - rect.top) / rect.height) * 100;
    points.push({ x: snap(toGrid(px)), y: snap(toGrid(py)) });
    sync();
  });

  document.getElementById('vorlageUndoBtn').addEventListener('click', function(){
    points.pop();
    sync();
  });
  document.getElementById('vorlageClearBtn').addEventListener('click', function(){
    points = [];
    sync();
  });
  document.getElementById('vorlageOriginResetBtn').addEventListener('click', function(){
    origin = {x: 0, y: 0};
    sync();
  });

  sync();
})();
</script>
</body>
</html>
