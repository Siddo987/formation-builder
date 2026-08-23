<?php
require_once __DIR__ . '/../api/lib/auth.php';

admin_session_start();
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (admin_login((string)($_POST['password'] ?? ''))) {
        $redirect = $_SESSION['admin_redirect'] ?? 'index.php';
        unset($_SESSION['admin_redirect']);
        header('Location: ' . $redirect);
        exit;
    }
    $error = admin_password_configured()
        ? 'Falsches Passwort.'
        : 'ADMIN_PASSWORD ist in .env noch nicht gesetzt — Login ist erst danach möglich.';
}

if (admin_is_authed()) {
    header('Location: index.php');
    exit;
}
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Admin-Login — Aufstellung</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{font-family:system-ui,sans-serif;background:#241a30;color:#f2eef7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  form{background:#2b2038;padding:2rem;border-radius:14px;width:100%;max-width:320px;box-shadow:0 20px 44px -20px rgba(0,0,0,.5);}
  h1{font-size:1.2rem;margin:0 0 1.2rem;}
  label{display:block;font-size:.8rem;font-weight:600;margin-bottom:.3rem;color:#cabfdb;}
  input[type="password"]{width:100%;box-sizing:border-box;padding:.6rem .7rem;border-radius:8px;border:1px solid #453a55;background:#1c1626;color:#f2eef7;font-size:.9rem;}
  button{margin-top:1rem;width:100%;padding:.6rem;border-radius:8px;border:none;background:#d99a34;color:#241a30;font-weight:700;cursor:pointer;}
  button:hover{background:#e0a336;}
  .error{color:#e08a7d;font-size:.82rem;margin-top:.8rem;}
</style>
</head>
<body>
<form method="post" autocomplete="off">
  <h1>Aufstellung — Admin</h1>
  <label for="password">Passwort</label>
  <input type="password" id="password" name="password" autofocus required>
  <button type="submit">Anmelden</button>
  <?php if ($error): ?><p class="error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
</form>
</body>
</html>
