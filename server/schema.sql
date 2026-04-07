CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  x INT NOT NULL DEFAULT 3,
  y INT NOT NULL DEFAULT 3,
  hp INT NOT NULL DEFAULT 100,
  current_map TEXT NOT NULL DEFAULT 'town',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE characters ADD COLUMN IF NOT EXISTS current_map TEXT NOT NULL DEFAULT 'town';

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  UNIQUE (character_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory_items(character_id);

ALTER TABLE characters ADD COLUMN IF NOT EXISTS weapon_bonus INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_slots (
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot INT NOT NULL CHECK (slot >= 0 AND slot < 10),
  item_type TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  item_meta JSONB,
  PRIMARY KEY (character_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_inventory_slots_character ON inventory_slots(character_id);

-- Existing DBs may predate item_meta; CREATE TABLE does not add columns.
ALTER TABLE inventory_slots ADD COLUMN IF NOT EXISTS item_meta JSONB;

ALTER TABLE characters ADD COLUMN IF NOT EXISTS gold INT NOT NULL DEFAULT 50;

ALTER TABLE characters ADD COLUMN IF NOT EXISTS equipment JSONB DEFAULT '{"weapon":null,"helmet":null,"chest":null,"boots":null}'::jsonb;
