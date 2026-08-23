-- Aufstellung backend schema (MySQL 5.7+ / MariaDB 10.2+, InnoDB, utf8mb4).
--
-- Run this once against your database after filling in real credentials in .env
-- (copy .env.example -> .env first). E.g. via phpMyAdmin's SQL tab, or:
--   mysql -u USER -p DBNAME < schema.sql
--
-- (If you're testing locally without a MySQL server yet, set DB_DRIVER=sqlite in .env instead —
-- api/lib/db.php creates the equivalent tables automatically in that mode, this file is not needed.)

CREATE TABLE IF NOT EXISTS shares (
  id            VARCHAR(32)   NOT NULL PRIMARY KEY,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  project_name  VARCHAR(120)  NOT NULL DEFAULT '',
  payload_json  JSON          NOT NULL,
  logo_path     VARCHAR(255)  NULL,
  song_path     VARCHAR(255)  NULL,
  delete_token  VARCHAR(64)   NULL
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

-- Admin-presettable "Vorlagen": target *shapes* shown client-side as a transparent ghost overlay
-- (js/stage.js, renderLayoutGhost()) that the user drags into place and rotates, then dancers get
-- manually dragged onto it by hand. `positions_json` is an ordered array of {"x":n,"y":n} that
-- matters only relative to each other, not as fixed stage coordinates — center the shape around
-- (0,0) here; the client places/rotates it on the actual stage. Same -7..7 scale as dancer
-- positions. The client matches slots to dancers by order, up to however many dancers the current
-- project actually has. Nothing here is tied to a specific project's dancer ids.
CREATE TABLE IF NOT EXISTS layouts (
  id              VARCHAR(32)   NOT NULL PRIMARY KEY,
  name            VARCHAR(120)  NOT NULL,
  description     VARCHAR(255)  NULL,
  positions_json  JSON          NOT NULL,
  origin_x        FLOAT         NOT NULL DEFAULT 0,
  origin_y        FLOAT         NOT NULL DEFAULT 0,
  sort_order      INT           NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Re-running this file against a database that already has an older `layouts` table (created
-- before origin_x/origin_y existed) — CREATE TABLE IF NOT EXISTS above is a no-op there, so add
-- the columns explicitly. Needs MySQL 8.0.29+ for ADD COLUMN IF NOT EXISTS; on an older MySQL,
-- drop the "IF NOT EXISTS" and ignore the resulting "duplicate column" error if it's already there.
ALTER TABLE layouts ADD COLUMN IF NOT EXISTS origin_x FLOAT NOT NULL DEFAULT 0;
ALTER TABLE layouts ADD COLUMN IF NOT EXISTS origin_y FLOAT NOT NULL DEFAULT 0;

-- The rotation pivot ("Orientierungspunkt") — where the layout-select rotation input in the app
-- turns the shape around, and rendered client-side as its own distinct, grabbable ghost point
-- alongside the per-dancer ones. Defaults to (0,0), matching the previous fixed pivot exactly, so
-- existing rows/behavior are unaffected until an admin deliberately repositions it.
INSERT INTO layouts (id, name, description, positions_json, origin_x, origin_y, sort_order) VALUES
  ('lay-reihe', 'Reihe', 'Eine gerade Linie.',
   '[{"x":-7,"y":0},{"x":-5,"y":0},{"x":-3,"y":0},{"x":-1,"y":0},{"x":1,"y":0},{"x":3,"y":0},{"x":5,"y":0},{"x":7,"y":0}]', 0, 0, 1),
  ('lay-kreis', 'Kreis', 'Gleichmäßig auf einem Kreis verteilt.',
   '[{"x":0,"y":-4.5},{"x":3.2,"y":-3.2},{"x":4.5,"y":0},{"x":3.2,"y":3.2},{"x":0,"y":4.5},{"x":-3.2,"y":3.2},{"x":-4.5,"y":0},{"x":-3.2,"y":-3.2}]', 0, 0, 2),
  ('lay-v-form', 'V-Form', 'Spitze nach vorn, nach hinten geöffnet.',
   '[{"x":0,"y":4},{"x":-2,"y":2},{"x":2,"y":2},{"x":-4,"y":0},{"x":4,"y":0},{"x":-6,"y":-2},{"x":6,"y":-2},{"x":0,"y":-4}]', 0, 0, 3),
  ('lay-doppelreihe', 'Doppelreihe', 'Zwei versetzte Reihen hintereinander.',
   '[{"x":-6,"y":1.5},{"x":-3,"y":1.5},{"x":0,"y":1.5},{"x":3,"y":1.5},{"x":6,"y":1.5},{"x":-4.5,"y":-1.5},{"x":-1.5,"y":-1.5},{"x":1.5,"y":-1.5},{"x":4.5,"y":-1.5}]', 0, 0, 4)
ON DUPLICATE KEY UPDATE name = VALUES(name);
