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
-- more directly in the table. `transform_json` shape is documented in api/figures.php.
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
