-- Migration 001: core genealogy schema
-- Rules: ids are UUID text, rows are never hard-deleted (deleted_at), unknown = NULL (never guessed),
-- every fact carries status + can be cited to a source, every change is written to change_log.

CREATE TABLE app_context (key TEXT PRIMARY KEY, value TEXT);  -- app sets key='actor' (who is editing)

CREATE TABLE branch (
  id TEXT PRIMARY KEY, name_bn TEXT, name_en TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT,
  CHECK (name_bn IS NOT NULL OR name_en IS NOT NULL)
);

CREATE TABLE place (
  id TEXT PRIMARY KEY, name_bn TEXT, name_en TEXT,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('house','village','union_parishad','upazila','district','division','country','other')),
  parent_id TEXT REFERENCES place(id),
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  note TEXT, status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT,
  CHECK (name_bn IS NOT NULL OR name_en IS NOT NULL),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE person (
  id TEXT PRIMARY KEY,
  sex TEXT NOT NULL DEFAULT 'unknown' CHECK (sex IN ('male','female','other','unknown')),
  living_status TEXT NOT NULL DEFAULT 'unknown' CHECK (living_status IN ('living','deceased','unknown')),
  branch_id TEXT REFERENCES branch(id),
  is_placeholder INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0,1)),  -- 1 = unknown ancestor slot
  note TEXT, status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);

CREATE TABLE person_name (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person(id),
  kind TEXT NOT NULL DEFAULT 'birth' CHECK (kind IN ('birth','bangla','english','nickname','title','married','other')),
  language TEXT NOT NULL DEFAULT 'bn' CHECK (language IN ('bn','en','other')),
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  given_name TEXT, family_name TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_person_primary_name ON person_name(person_id, language) WHERE is_primary = 1 AND deleted_at IS NULL;

CREATE TABLE family_union (   -- marriage / partnership; dates live in event rows (type marriage/divorce)
  id TEXT PRIMARY KEY,
  partner1_id TEXT REFERENCES person(id),
  partner2_id TEXT REFERENCES person(id),
  kind TEXT NOT NULL DEFAULT 'marriage' CHECK (kind IN ('marriage','partnership','unknown')),
  end_reason TEXT CHECK (end_reason IN ('divorce','death','annulled','separated')),
  note TEXT, status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT,
  CHECK (partner1_id IS NOT NULL OR partner2_id IS NOT NULL),
  CHECK (partner1_id IS NULL OR partner2_id IS NULL OR partner1_id <> partner2_id)
);

CREATE TABLE parent_child (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES person(id),
  child_id TEXT NOT NULL REFERENCES person(id),
  kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('biological','adoptive','step','foster','guardian','unknown')),
  parent_role TEXT NOT NULL DEFAULT 'parent' CHECK (parent_role IN ('father','mother','parent')),
  union_id TEXT REFERENCES family_union(id),
  note TEXT, status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT,
  CHECK (parent_id <> child_id)
);
CREATE UNIQUE INDEX ux_parent_child_pair ON parent_child(parent_id, child_id, kind) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_one_bio_role ON parent_child(child_id, parent_role)
  WHERE kind = 'biological' AND parent_role <> 'parent' AND deleted_at IS NULL;
CREATE INDEX ix_pc_child ON parent_child(child_id);
CREATE INDEX ix_pc_parent ON parent_child(parent_id);

CREATE TABLE event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('birth','death','burial','marriage','divorce','residence','migration','education','occupation','achievement','property','family_history','other')),
  person_id TEXT REFERENCES person(id),
  union_id TEXT REFERENCES family_union(id),
  title TEXT, description TEXT,
  place_id TEXT REFERENCES place(id),
  d_text TEXT,                                   -- date exactly as the source wrote it
  d_calendar TEXT NOT NULL DEFAULT 'gregorian' CHECK (d_calendar IN ('gregorian','bengali','hijri','other')),
  d_qualifier TEXT NOT NULL DEFAULT 'unknown' CHECK (d_qualifier IN ('exact','about','before','after','between','unknown')),
  d_y INTEGER, d_m INTEGER CHECK (d_m BETWEEN 1 AND 12), d_d INTEGER CHECK (d_d BETWEEN 1 AND 31),
  d_end_y INTEGER, d_end_m INTEGER CHECK (d_end_m BETWEEN 1 AND 12), d_end_d INTEGER CHECK (d_end_d BETWEEN 1 AND 31),
  status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT,
  CHECK (type = 'family_history' OR person_id IS NOT NULL OR union_id IS NOT NULL),
  CHECK (d_qualifier <> 'unknown' OR (d_y IS NULL AND d_m IS NULL AND d_d IS NULL)),   -- no guessed dates
  CHECK (d_qualifier = 'unknown' OR d_y IS NOT NULL),
  CHECK (d_qualifier = 'between' OR d_end_y IS NULL),
  CHECK (d_qualifier <> 'between' OR d_end_y IS NOT NULL)
);
CREATE INDEX ix_event_person ON event(person_id, type);
CREATE INDEX ix_event_year ON event(d_y);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('photo','video','audio','document','other')),
  file_name TEXT NOT NULL, mime_type TEXT, byte_size INTEGER,
  sha256 TEXT NOT NULL,                          -- detects duplicate files and silent corruption
  storage_key TEXT NOT NULL,                     -- path/key of the ORIGINAL file in storage
  title TEXT, description TEXT, date_text TEXT, year INTEGER, origin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_media_sha ON media(sha256) WHERE deleted_at IS NULL;

CREATE TABLE media_person (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id),
  person_id TEXT NOT NULL REFERENCES person(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_media_person ON media_person(media_id, person_id) WHERE deleted_at IS NULL;

CREATE TABLE source (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('elder_testimony','document','certificate','photo','letter','book','website','other')),
  title TEXT NOT NULL, informant TEXT, date_text TEXT, description TEXT,
  media_id TEXT REFERENCES media(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);

CREATE TABLE citation (       -- links any fact (row/field) to its source
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id),
  target_table TEXT NOT NULL CHECK (target_table IN ('person','person_name','family_union','parent_child','event','place','person_note','person_attribute')),
  target_id TEXT NOT NULL, field_name TEXT, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX ix_citation_target ON citation(target_table, target_id);

CREATE TABLE person_note (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person(id),
  kind TEXT NOT NULL CHECK (kind IN ('biography','personality','likes','dislikes','memory','achievement','other')),
  title TEXT, body TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'bn',
  status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);

CREATE TABLE person_attribute (   -- open-ended facts so new kinds of data need no schema change
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person(id),
  key TEXT NOT NULL, value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified','unverified','estimated','unknown')) DEFAULT 'unverified',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX ix_attr_person ON person_attribute(person_id, key);

CREATE TABLE change_log (        -- append-only history of every change
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_table TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete','restore')),
  before_json TEXT, after_json TEXT, actor TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_log_entity ON change_log(entity_table, entity_id);
CREATE TRIGGER trg_log_no_update BEFORE UPDATE ON change_log BEGIN SELECT RAISE(ABORT,'change_log is append-only'); END;
CREATE TRIGGER trg_log_no_delete BEFORE DELETE ON change_log BEGIN SELECT RAISE(ABORT,'change_log is append-only'); END;

-- A person can never become their own ancestor, and a child has at most 2 biological parents.
CREATE TRIGGER trg_pc_no_cycle_ins BEFORE INSERT ON parent_child
WHEN NEW.deleted_at IS NULL BEGIN
  SELECT RAISE(ABORT,'cycle: parent is a descendant of child') WHERE EXISTS (
    WITH RECURSIVE d(id) AS (SELECT NEW.child_id UNION SELECT pc.child_id FROM parent_child pc JOIN d ON pc.parent_id = d.id WHERE pc.deleted_at IS NULL)
    SELECT 1 FROM d WHERE id = NEW.parent_id);
  SELECT RAISE(ABORT,'a child can have at most 2 biological parents') WHERE NEW.kind = 'biological' AND
    (SELECT COUNT(*) FROM parent_child WHERE child_id = NEW.child_id AND kind = 'biological' AND deleted_at IS NULL) >= 2;
END;
CREATE TRIGGER trg_pc_no_cycle_upd BEFORE UPDATE OF parent_id, child_id ON parent_child
WHEN NEW.deleted_at IS NULL BEGIN
  SELECT RAISE(ABORT,'cycle: parent is a descendant of child') WHERE EXISTS (
    WITH RECURSIVE d(id) AS (SELECT NEW.child_id UNION SELECT pc.child_id FROM parent_child pc JOIN d ON pc.parent_id = d.id WHERE pc.deleted_at IS NULL AND pc.id <> NEW.id)
    SELECT 1 FROM d WHERE id = NEW.parent_id);
END;

-- Possible duplicate people: same name (ignoring case/spaces) and same or unknown birth year.
CREATE VIEW v_possible_duplicates AS
SELECT DISTINCT a.person_id AS person_a, b.person_id AS person_b, a.full_name AS name
FROM person_name a
JOIN person_name b ON lower(trim(a.full_name)) = lower(trim(b.full_name)) AND a.person_id < b.person_id AND b.deleted_at IS NULL
JOIN person pa ON pa.id = a.person_id AND pa.deleted_at IS NULL AND pa.is_placeholder = 0
JOIN person pb ON pb.id = b.person_id AND pb.deleted_at IS NULL AND pb.is_placeholder = 0
LEFT JOIN event ea ON ea.person_id = a.person_id AND ea.type = 'birth' AND ea.deleted_at IS NULL
LEFT JOIN event eb ON eb.person_id = b.person_id AND eb.type = 'birth' AND eb.deleted_at IS NULL
WHERE a.deleted_at IS NULL AND (ea.d_y IS NULL OR eb.d_y IS NULL OR ea.d_y = eb.d_y);

-- Auto-generated: history logging and protection against hard deletes
CREATE TRIGGER trg_branch_log_ins AFTER INSERT ON branch BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('branch',NEW.id,'insert',json_object('id',NEW.id,'name_bn',NEW.name_bn,'name_en',NEW.name_en,'note',NEW.note,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_branch_log_upd AFTER UPDATE ON branch BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('branch',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'name_bn',OLD.name_bn,'name_en',OLD.name_en,'note',OLD.note,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'name_bn',NEW.name_bn,'name_en',NEW.name_en,'note',NEW.note,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_branch_no_hard_delete BEFORE DELETE ON branch BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_place_log_ins AFTER INSERT ON place BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('place',NEW.id,'insert',json_object('id',NEW.id,'name_bn',NEW.name_bn,'name_en',NEW.name_en,'type',NEW.type,'parent_id',NEW.parent_id,'latitude',NEW.latitude,'longitude',NEW.longitude,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_place_log_upd AFTER UPDATE ON place BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('place',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'name_bn',OLD.name_bn,'name_en',OLD.name_en,'type',OLD.type,'parent_id',OLD.parent_id,'latitude',OLD.latitude,'longitude',OLD.longitude,'note',OLD.note,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'name_bn',NEW.name_bn,'name_en',NEW.name_en,'type',NEW.type,'parent_id',NEW.parent_id,'latitude',NEW.latitude,'longitude',NEW.longitude,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_place_no_hard_delete BEFORE DELETE ON place BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_person_log_ins AFTER INSERT ON person BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('person',NEW.id,'insert',json_object('id',NEW.id,'sex',NEW.sex,'living_status',NEW.living_status,'branch_id',NEW.branch_id,'is_placeholder',NEW.is_placeholder,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_log_upd AFTER UPDATE ON person BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('person',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'sex',OLD.sex,'living_status',OLD.living_status,'branch_id',OLD.branch_id,'is_placeholder',OLD.is_placeholder,'note',OLD.note,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'sex',NEW.sex,'living_status',NEW.living_status,'branch_id',NEW.branch_id,'is_placeholder',NEW.is_placeholder,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_no_hard_delete BEFORE DELETE ON person BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_person_name_log_ins AFTER INSERT ON person_name BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('person_name',NEW.id,'insert',json_object('id',NEW.id,'person_id',NEW.person_id,'kind',NEW.kind,'language',NEW.language,'full_name',NEW.full_name,'given_name',NEW.given_name,'family_name',NEW.family_name,'is_primary',NEW.is_primary,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_name_log_upd AFTER UPDATE ON person_name BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('person_name',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'person_id',OLD.person_id,'kind',OLD.kind,'language',OLD.language,'full_name',OLD.full_name,'given_name',OLD.given_name,'family_name',OLD.family_name,'is_primary',OLD.is_primary,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'person_id',NEW.person_id,'kind',NEW.kind,'language',NEW.language,'full_name',NEW.full_name,'given_name',NEW.given_name,'family_name',NEW.family_name,'is_primary',NEW.is_primary,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_name_no_hard_delete BEFORE DELETE ON person_name BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_family_union_log_ins AFTER INSERT ON family_union BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('family_union',NEW.id,'insert',json_object('id',NEW.id,'partner1_id',NEW.partner1_id,'partner2_id',NEW.partner2_id,'kind',NEW.kind,'end_reason',NEW.end_reason,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_family_union_log_upd AFTER UPDATE ON family_union BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('family_union',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'partner1_id',OLD.partner1_id,'partner2_id',OLD.partner2_id,'kind',OLD.kind,'end_reason',OLD.end_reason,'note',OLD.note,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'partner1_id',NEW.partner1_id,'partner2_id',NEW.partner2_id,'kind',NEW.kind,'end_reason',NEW.end_reason,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_family_union_no_hard_delete BEFORE DELETE ON family_union BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_parent_child_log_ins AFTER INSERT ON parent_child BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('parent_child',NEW.id,'insert',json_object('id',NEW.id,'parent_id',NEW.parent_id,'child_id',NEW.child_id,'kind',NEW.kind,'parent_role',NEW.parent_role,'union_id',NEW.union_id,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_parent_child_log_upd AFTER UPDATE ON parent_child BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('parent_child',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'parent_id',OLD.parent_id,'child_id',OLD.child_id,'kind',OLD.kind,'parent_role',OLD.parent_role,'union_id',OLD.union_id,'note',OLD.note,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'parent_id',NEW.parent_id,'child_id',NEW.child_id,'kind',NEW.kind,'parent_role',NEW.parent_role,'union_id',NEW.union_id,'note',NEW.note,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_parent_child_no_hard_delete BEFORE DELETE ON parent_child BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_event_log_ins AFTER INSERT ON event BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('event',NEW.id,'insert',json_object('id',NEW.id,'type',NEW.type,'person_id',NEW.person_id,'union_id',NEW.union_id,'title',NEW.title,'description',NEW.description,'place_id',NEW.place_id,'d_text',NEW.d_text,'d_calendar',NEW.d_calendar,'d_qualifier',NEW.d_qualifier,'d_y',NEW.d_y,'d_m',NEW.d_m,'d_d',NEW.d_d,'d_end_y',NEW.d_end_y,'d_end_m',NEW.d_end_m,'d_end_d',NEW.d_end_d,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_event_log_upd AFTER UPDATE ON event BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('event',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'type',OLD.type,'person_id',OLD.person_id,'union_id',OLD.union_id,'title',OLD.title,'description',OLD.description,'place_id',OLD.place_id,'d_text',OLD.d_text,'d_calendar',OLD.d_calendar,'d_qualifier',OLD.d_qualifier,'d_y',OLD.d_y,'d_m',OLD.d_m,'d_d',OLD.d_d,'d_end_y',OLD.d_end_y,'d_end_m',OLD.d_end_m,'d_end_d',OLD.d_end_d,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'type',NEW.type,'person_id',NEW.person_id,'union_id',NEW.union_id,'title',NEW.title,'description',NEW.description,'place_id',NEW.place_id,'d_text',NEW.d_text,'d_calendar',NEW.d_calendar,'d_qualifier',NEW.d_qualifier,'d_y',NEW.d_y,'d_m',NEW.d_m,'d_d',NEW.d_d,'d_end_y',NEW.d_end_y,'d_end_m',NEW.d_end_m,'d_end_d',NEW.d_end_d,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_event_no_hard_delete BEFORE DELETE ON event BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_media_log_ins AFTER INSERT ON media BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('media',NEW.id,'insert',json_object('id',NEW.id,'kind',NEW.kind,'file_name',NEW.file_name,'mime_type',NEW.mime_type,'byte_size',NEW.byte_size,'sha256',NEW.sha256,'storage_key',NEW.storage_key,'title',NEW.title,'description',NEW.description,'date_text',NEW.date_text,'year',NEW.year,'origin_note',NEW.origin_note,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_media_log_upd AFTER UPDATE ON media BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('media',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'kind',OLD.kind,'file_name',OLD.file_name,'mime_type',OLD.mime_type,'byte_size',OLD.byte_size,'sha256',OLD.sha256,'storage_key',OLD.storage_key,'title',OLD.title,'description',OLD.description,'date_text',OLD.date_text,'year',OLD.year,'origin_note',OLD.origin_note,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'kind',NEW.kind,'file_name',NEW.file_name,'mime_type',NEW.mime_type,'byte_size',NEW.byte_size,'sha256',NEW.sha256,'storage_key',NEW.storage_key,'title',NEW.title,'description',NEW.description,'date_text',NEW.date_text,'year',NEW.year,'origin_note',NEW.origin_note,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_media_no_hard_delete BEFORE DELETE ON media BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_media_person_log_ins AFTER INSERT ON media_person BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('media_person',NEW.id,'insert',json_object('id',NEW.id,'media_id',NEW.media_id,'person_id',NEW.person_id,'note',NEW.note,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_media_person_log_upd AFTER UPDATE ON media_person BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('media_person',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'media_id',OLD.media_id,'person_id',OLD.person_id,'note',OLD.note,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'media_id',NEW.media_id,'person_id',NEW.person_id,'note',NEW.note,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_media_person_no_hard_delete BEFORE DELETE ON media_person BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_source_log_ins AFTER INSERT ON source BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('source',NEW.id,'insert',json_object('id',NEW.id,'kind',NEW.kind,'title',NEW.title,'informant',NEW.informant,'date_text',NEW.date_text,'description',NEW.description,'media_id',NEW.media_id,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_source_log_upd AFTER UPDATE ON source BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('source',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'kind',OLD.kind,'title',OLD.title,'informant',OLD.informant,'date_text',OLD.date_text,'description',OLD.description,'media_id',OLD.media_id,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'kind',NEW.kind,'title',NEW.title,'informant',NEW.informant,'date_text',NEW.date_text,'description',NEW.description,'media_id',NEW.media_id,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_source_no_hard_delete BEFORE DELETE ON source BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_citation_log_ins AFTER INSERT ON citation BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('citation',NEW.id,'insert',json_object('id',NEW.id,'source_id',NEW.source_id,'target_table',NEW.target_table,'target_id',NEW.target_id,'field_name',NEW.field_name,'detail',NEW.detail,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_citation_log_upd AFTER UPDATE ON citation BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('citation',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'source_id',OLD.source_id,'target_table',OLD.target_table,'target_id',OLD.target_id,'field_name',OLD.field_name,'detail',OLD.detail,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'source_id',NEW.source_id,'target_table',NEW.target_table,'target_id',NEW.target_id,'field_name',NEW.field_name,'detail',NEW.detail,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_citation_no_hard_delete BEFORE DELETE ON citation BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_person_note_log_ins AFTER INSERT ON person_note BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('person_note',NEW.id,'insert',json_object('id',NEW.id,'person_id',NEW.person_id,'kind',NEW.kind,'title',NEW.title,'body',NEW.body,'language',NEW.language,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_note_log_upd AFTER UPDATE ON person_note BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('person_note',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'person_id',OLD.person_id,'kind',OLD.kind,'title',OLD.title,'body',OLD.body,'language',OLD.language,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'person_id',NEW.person_id,'kind',NEW.kind,'title',NEW.title,'body',NEW.body,'language',NEW.language,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_note_no_hard_delete BEFORE DELETE ON person_note BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
CREATE TRIGGER trg_person_attribute_log_ins AFTER INSERT ON person_attribute BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('person_attribute',NEW.id,'insert',json_object('id',NEW.id,'person_id',NEW.person_id,'key',NEW.key,'value',NEW.value,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_attribute_log_upd AFTER UPDATE ON person_attribute BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('person_attribute',NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'delete' WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restore' ELSE 'update' END,
    json_object('id',OLD.id,'person_id',OLD.person_id,'key',OLD.key,'value',OLD.value,'status',OLD.status,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'created_by',OLD.created_by,'deleted_at',OLD.deleted_at),json_object('id',NEW.id,'person_id',NEW.person_id,'key',NEW.key,'value',NEW.value,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'created_by',NEW.created_by,'deleted_at',NEW.deleted_at),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_person_attribute_no_hard_delete BEFORE DELETE ON person_attribute BEGIN SELECT RAISE(ABORT,'use soft delete (set deleted_at)'); END;
