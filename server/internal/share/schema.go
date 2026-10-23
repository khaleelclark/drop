package share

import "errors"

func (s *Server) migrate() error {
	if _, err := s.db.Exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err = tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version > 3 {
		return errors.New("metadata schema is newer than this server supports")
	}
	if version == 0 {
		_, err = tx.Exec(`CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>=0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
 preview TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, source_device TEXT NOT NULL DEFAULT '',
 mime_type TEXT NOT NULL DEFAULT '', checksum TEXT NOT NULL DEFAULT '', is_upload INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_created ON items(created_at DESC,id DESC);`)
		if err != nil {
			return err
		}
	}
	if version < 2 {
		_, err = tx.Exec(`ALTER TABLE items ADD COLUMN source_device_id TEXT NOT NULL DEFAULT '' CHECK(length(source_device_id) IN (0,32));
ALTER TABLE items ADD COLUMN target_device_ids TEXT NOT NULL DEFAULT '[]' CHECK(length(target_device_ids)<=2241);
CREATE TABLE devices (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, platform TEXT NOT NULL, created_at TEXT NOT NULL,
 ack_sequence INTEGER NOT NULL DEFAULT 0 CHECK(ack_sequence>=0)
);
CREATE TABLE notifications (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, UNIQUE(device_id,item_id)
);
CREATE INDEX notifications_device_sequence ON notifications(device_id,sequence);
PRAGMA user_version=2;`)
		if err != nil {
			return err
		}
	}
	if version < 3 {
		_, err = tx.Exec(`ALTER TABLE items ADD COLUMN blob_id TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN upload_length INTEGER NOT NULL DEFAULT 0 CHECK(upload_length>=0);
UPDATE items SET blob_id=id,upload_length=CASE WHEN is_upload=1 THEN size ELSE 0 END;
PRAGMA user_version=3;`)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
