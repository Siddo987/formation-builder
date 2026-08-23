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

-- Admin-presettable "Vorlagen": generic target arrangements shown client-side as a transparent
-- ghost overlay (js/stage.js, renderLayoutGhost()) that dancers get manually dragged onto — unlike
-- figures, these are absolute slot positions, not a relative transform, and nothing here is tied
-- to a specific project's dancer ids. `positions_json` is an ordered array of {"x":n,"y":n} on the
-- same -7..7 stage grid as dancer positions; the client matches slots to dancers by order, up to
-- however many dancers the current project actually has.
CREATE TABLE IF NOT EXISTS layouts (
  id              VARCHAR(32)   NOT NULL PRIMARY KEY,
  name            VARCHAR(120)  NOT NULL,
  description     VARCHAR(255)  NULL,
  positions_json  JSON          NOT NULL,
  sort_order      INT           NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO layouts (id, name, description, positions_json, sort_order) VALUES
  ('lay-reihe', 'Reihe', 'Eine gerade Linie am vorderen Bühnenrand.',
   '[{"x":-6,"y":5},{"x":-3,"y":5},{"x":0,"y":5},{"x":3,"y":5},{"x":6,"y":5},{"x":-4.5,"y":5},{"x":4.5,"y":5},{"x":0,"y":5}]', 1),
  ('lay-kreis', 'Kreis', 'Gleichmäßig auf einem Kreis um die Bühnenmitte verteilt.',
   '[{"x":0,"y":-4.5},{"x":3.2,"y":-3.2},{"x":4.5,"y":0},{"x":3.2,"y":3.2},{"x":0,"y":4.5},{"x":-3.2,"y":3.2},{"x":-4.5,"y":0},{"x":-3.2,"y":-3.2}]', 2),
  ('lay-v-form', 'V-Form', 'Spitze zum Publikum, nach hinten geöffnet.',
   '[{"x":0,"y":5},{"x":-2,"y":3},{"x":2,"y":3},{"x":-4,"y":1},{"x":4,"y":1},{"x":-6,"y":-1},{"x":6,"y":-1},{"x":0,"y":-3}]', 3),
  ('lay-doppelreihe', 'Doppelreihe', 'Zwei versetzte Reihen hintereinander.',
   '[{"x":-6,"y":5},{"x":-3,"y":5},{"x":0,"y":5},{"x":3,"y":5},{"x":6,"y":5},{"x":-4.5,"y":2},{"x":-1.5,"y":2},{"x":1.5,"y":2},{"x":4.5,"y":2}]', 4)
ON DUPLICATE KEY UPDATE name = VALUES(name);
