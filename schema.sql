-- Aufstellung backend schema (MySQL 5.7+ / MariaDB 10.2+, InnoDB, utf8mb4).
--
-- Run this once against your database after filling in real credentials in .env
-- (copy .env.example -> .env first). E.g. via phpMyAdmin's SQL tab, or:
--   mysql -u USER -p DBNAME < schema.sql
--
-- (If you're testing locally without a MySQL server yet, set DB_DRIVER=sqlite in .env instead —
-- api/lib/db.php creates the equivalent tables automatically in that mode, this file is not needed.)
--
-- On MySQL/MariaDB api/lib/db.php (DB_MYSQL_TABLES, keep it in sync with this file) also adds
-- missing tables and columns by itself on the next API request, so a new column no longer breaks
-- saving until this file is re-run. The starter Figuren rows below still come only from here.

CREATE TABLE IF NOT EXISTS shares (
  id            VARCHAR(32)   NOT NULL PRIMARY KEY,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version       VARCHAR(40)   NOT NULL DEFAULT '',
  project_name  VARCHAR(120)  NOT NULL DEFAULT '',
  payload_json  JSON          NOT NULL,
  logo_path     VARCHAR(255)  NULL,
  song_path     VARCHAR(255)  NULL,
  delete_token  VARCHAR(64)   NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Re-running this file against a database that already has an older `shares` table (created
-- before updated_at/version existed, i.e. before live/persistent share links — see
-- api/share/update.php) — CREATE TABLE IF NOT EXISTS above is a no-op there, so add the columns
-- explicitly. Needs MySQL 8.0.29+ for ADD COLUMN IF NOT EXISTS; on an older MySQL, drop the "IF
-- NOT EXISTS" and ignore the resulting "duplicate column" error if it's already there. `version` is an opaque per-write token the client polls against
-- (pollSharedUpdate() in js/share.js) — deliberately not the DATETIME itself, which only has
-- one-second resolution and could miss two edits landing in the same second.
ALTER TABLE shares ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE shares ADD COLUMN IF NOT EXISTS version VARCHAR(40) NOT NULL DEFAULT '';

-- Version history / branching for share links (see js/history.js + api/share/commit.php|merge.php).
-- Each edit that reaches the server is a commit; concurrent editors who no longer sit on the
-- mainline tip get their own branch_id; a merge commit has two parents (comma-separated). The
-- `shares` row keeps head_commit = the mainline tip, and its payload_json/version mirror that
-- commit's payload (so get.php and read-only opens stay a single fast lookup).
ALTER TABLE shares ADD COLUMN IF NOT EXISTS head_commit VARCHAR(32) NULL;

-- Nur-Ansehen-Links: create.php vergibt pro Link ein edit_token und gibt es nur dem Ersteller
-- zurück. Der Bearbeiten-Link trägt ?t=<edit_token>, der Ansehen-Link nicht. update.php /
-- commit.php / merge.php weisen einen Schreibversuch ohne passendes Token mit 403 ab. Alt-Links
-- (edit_token IS NULL) bleiben wie bisher frei bearbeitbar, damit bereits verschickte Links weiter
-- funktionieren.
ALTER TABLE shares ADD COLUMN IF NOT EXISTS edit_token VARCHAR(64) NULL;

CREATE TABLE IF NOT EXISTS share_commits (
  commit_id    VARCHAR(32)  NOT NULL PRIMARY KEY,
  share_id     VARCHAR(32)  NOT NULL,
  parent_ids   VARCHAR(140) NOT NULL DEFAULT '',
  branch_id    VARCHAR(32)  NOT NULL DEFAULT '',
  author       VARCHAR(60)  NOT NULL DEFAULT '',
  note         VARCHAR(200) NOT NULL DEFAULT '',
  -- UTC ISO-8601 string with ms ("2026-08-29T14:30:05.123Z"); a plain DATETIME truncates the
  -- sub-second part that keeps two commits landing in the same second ordered.
  created_at   VARCHAR(30)  NOT NULL,
  payload_json JSON         NOT NULL,
  INDEX share_commits_by_share (share_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Wer gerade welches Bild offen hat (Bild-Sperre, api/share/presence.php). Kurzlebig: Zeilen ohne
-- Herzschlag seit 60 s löscht presence.php selbst. Zeiten in ms seit 1970 (Server-Uhr).
CREATE TABLE IF NOT EXISTS share_presence (
  share_id     VARCHAR(32) NOT NULL,
  client_id    VARCHAR(32) NOT NULL,
  author       VARCHAR(60) NOT NULL DEFAULT '',
  formation_id VARCHAR(40) NOT NULL DEFAULT '',
  since_at     BIGINT      NOT NULL,
  active_at    BIGINT      NOT NULL,
  seen_at      BIGINT      NOT NULL,
  PRIMARY KEY (share_id, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS figures (
  id              VARCHAR(32)   NOT NULL PRIMARY KEY,
  name            VARCHAR(120)  NOT NULL,
  description     VARCHAR(255)  NULL,
  transform_json  JSON          NOT NULL,
  sort_order      INT           NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A handful of starter Figuren so the catalog isn't empty out of the box — edit, remove, or add
-- more directly in the table (or via /admin once ADMIN_PASSWORD is set, see .env.example).
-- `transform_json` shape is documented in api/figures.php.
INSERT INTO figures (id, name, description, transform_json, sort_order) VALUES
  ('fig-90-rechts', '90° im Uhrzeigersinn', 'Dreht die Auswahl (oder alle) 90° um die Bühnenmitte.',
   '{"mode":"solo","pivot":"stage-center","rotateDeg":90,"translateX":0,"translateY":0}', 1),
  ('fig-90-links', '90° gegen den Uhrzeigersinn', 'Dreht die Auswahl (oder alle) -90° um die Bühnenmitte.',
   '{"mode":"solo","pivot":"stage-center","rotateDeg":-90,"translateX":0,"translateY":0}', 2),
  ('fig-vorwaerts', 'Vorwärts 2 Schritte', 'Bewegt die Auswahl (oder alle) 2 Einheiten Richtung Publikum.',
   '{"mode":"solo","pivot":"selection-centroid","rotateDeg":0,"translateX":0,"translateY":2}', 3),
  ('fig-wechsel', 'Partner wechseln', 'Jedes gespeicherte Paar tauscht die Plätze (180° um den eigenen Mittelpunkt).',
   '{"mode":"couples","partnerA":{"rotateDeg":180,"translateX":0,"translateY":0},"partnerB":{"rotateDeg":180,"translateX":0,"translateY":0}}', 4)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- The Vorlagen (Reihe, Kreis, V-Form, …) are generated client-side for the choreo's pair count
-- (LAYOUT_SHAPES in js/stage.js); the old admin-made `layouts` table is gone.
DROP TABLE IF EXISTS layouts;
