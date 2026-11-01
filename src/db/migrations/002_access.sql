-- 002: members, roles and N-person approval. Rules live in the database (triggers), not only in the UI.
CREATE TABLE member (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(trim(email)) AND email LIKE '%_@_%._%'),
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended')),
  person_id TEXT REFERENCES person(id),
  google_sub TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_member_email ON member(email);
CREATE UNIQUE INDEX ux_member_one_owner ON member(role) WHERE role = 'owner';

CREATE TABLE approval_request (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('save_person','delete_person')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  summary TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES member(id),
  needed INTEGER NOT NULL CHECK (needed BETWEEN 2 AND 3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected','failed','cancelled')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE TABLE approval_vote (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES approval_request(id),
  voter_id TEXT NOT NULL REFERENCES member(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (request_id, voter_id)            -- one vote per person, so N approvals = N different people
);
CREATE INDEX ix_vote_request ON approval_vote(request_id);

CREATE TRIGGER trg_member_no_hard_delete BEFORE DELETE ON member BEGIN SELECT RAISE(ABORT,'members cannot be deleted, suspend instead'); END;
CREATE TRIGGER trg_member_owner_protect BEFORE UPDATE ON member
WHEN OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.status <> 'active') BEGIN SELECT RAISE(ABORT,'the owner cannot be demoted or suspended'); END;
CREATE TRIGGER trg_member_email_fixed BEFORE UPDATE OF email ON member
WHEN NEW.email <> OLD.email BEGIN SELECT RAISE(ABORT,'member email cannot be changed'); END;

CREATE TRIGGER trg_request_submit_rules BEFORE INSERT ON approval_request BEGIN
  SELECT RAISE(ABORT,'only an active editor can submit a change for approval')
  WHERE NOT EXISTS (SELECT 1 FROM member WHERE id = NEW.submitted_by AND role = 'editor' AND status = 'active');
END;
CREATE TRIGGER trg_request_no_delete BEFORE DELETE ON approval_request BEGIN SELECT RAISE(ABORT,'requests are kept forever'); END;
CREATE TRIGGER trg_request_final BEFORE UPDATE ON approval_request
WHEN OLD.status <> 'pending' BEGIN SELECT RAISE(ABORT,'a resolved request cannot change'); END;
CREATE TRIGGER trg_request_enough BEFORE UPDATE OF status ON approval_request
WHEN NEW.status = 'applied' AND (SELECT COUNT(*) FROM approval_vote WHERE request_id = NEW.id AND decision = 'approve') < NEW.needed
BEGIN SELECT RAISE(ABORT,'not enough approvals'); END;

CREATE TRIGGER trg_vote_rules BEFORE INSERT ON approval_vote BEGIN
  SELECT RAISE(ABORT,'request is not pending') WHERE NOT EXISTS (SELECT 1 FROM approval_request WHERE id = NEW.request_id AND status = 'pending');
  SELECT RAISE(ABORT,'submitter cannot vote on own request') WHERE EXISTS (SELECT 1 FROM approval_request WHERE id = NEW.request_id AND submitted_by = NEW.voter_id);
  SELECT RAISE(ABORT,'voter must be an active owner, admin or editor') WHERE NOT EXISTS (SELECT 1 FROM member WHERE id = NEW.voter_id AND status = 'active' AND role IN ('owner','admin','editor'));
END;
CREATE TRIGGER trg_vote_immutable_upd BEFORE UPDATE ON approval_vote BEGIN SELECT RAISE(ABORT,'votes cannot be changed'); END;
CREATE TRIGGER trg_vote_immutable_del BEFORE DELETE ON approval_vote BEGIN SELECT RAISE(ABORT,'votes cannot be deleted'); END;

-- history
CREATE TRIGGER trg_member_log_ins AFTER INSERT ON member BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('member',NEW.id,'insert',
    json_object('email',NEW.email,'name',NEW.display_name,'role',NEW.role,'status',NEW.status),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_member_log_upd AFTER UPDATE ON member BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('member',NEW.id,'update',
    json_object('role',OLD.role,'status',OLD.status),json_object('email',NEW.email,'name',NEW.display_name,'role',NEW.role,'status',NEW.status),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_approval_request_log_ins AFTER INSERT ON approval_request BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('approval_request',NEW.id,'insert',
    json_object('kind',NEW.kind,'summary',NEW.summary,'status',NEW.status,'needed',NEW.needed),NEW.submitted_by);
END;
CREATE TRIGGER trg_approval_request_log_upd AFTER UPDATE ON approval_request BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,before_json,after_json,actor) VALUES('approval_request',NEW.id,'update',
    json_object('status',OLD.status),json_object('kind',NEW.kind,'summary',NEW.summary,'status',NEW.status,'error',NEW.error),(SELECT value FROM app_context WHERE key='actor'));
END;
CREATE TRIGGER trg_approval_vote_log_ins AFTER INSERT ON approval_vote BEGIN
  INSERT INTO change_log(entity_table,entity_id,action,after_json,actor) VALUES('approval_vote',NEW.id,'insert',
    json_object('request_id',NEW.request_id,'decision',NEW.decision,'comment',NEW.comment),NEW.voter_id);
END;
