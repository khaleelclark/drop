package share

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

var errBudget = errors.New("storage capacity unavailable")

type storageInfo struct {
	UsedBytes       int64  `json:"usedBytes"`
	FreeBytes       int64  `json:"freeBytes"`
	MaxFileBytes    int64  `json:"maxFileBytes"`
	MaxTextBytes    int64  `json:"maxTextBytes"`
	MaxStorageBytes *int64 `json:"maxStorageBytes"`
}

func (s *Server) freeBytes() (int64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(s.cfg.DataDir, &st); err != nil {
		return 0, err
	}
	// Capacity is bounded to signed int64 even on unusually large filesystems.
	if st.Bavail > uint64((1<<63-1)/uint64(st.Bsize)) {
		return 1<<63 - 1, nil
	}
	return int64(st.Bavail) * int64(st.Bsize), nil
}

func (s *Server) usedBytes() (int64, error) {
	entries, err := os.ReadDir(filepath.Join(s.cfg.DataDir, "blobs"))
	if err != nil {
		return 0, err
	}
	var total int64
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return 0, err
		}
		total += info.Size()
	}
	return total, nil
}

// reserve checks all promised bytes, not merely bytes already uploaded. The
// budget mutex covers this check and the durable insertion, across clients.
func (s *Server) reserve(r *record) error {
	s.budgetMu.Lock()
	defer s.budgetMu.Unlock()
	var reserved int64
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(size),0) FROM items`).Scan(&reserved); err != nil {
		return err
	}
	used, err := s.usedBytes()
	if err != nil {
		return err
	}
	free, err := s.freeBytes()
	if err != nil {
		return err
	}
	committed := max(reserved, used)
	if s.cfg.MaxStorageBytes > 0 && (committed > s.cfg.MaxStorageBytes || r.Size > s.cfg.MaxStorageBytes-committed) {
		return errBudget
	}
	remaining := max(int64(0), reserved-used)
	if free < s.cfg.MinFreeBytes || remaining > free-s.cfg.MinFreeBytes || r.Size > free-s.cfg.MinFreeBytes-remaining {
		return errBudget
	}
	created := time.Now().UTC()
	if !created.After(s.lastCreated) {
		created = s.lastCreated.Add(time.Nanosecond)
	}
	r.CreatedAt = created.Format(timestampFormat)
	r.UpdatedAt = r.CreatedAt
	_, err = s.db.Exec(`INSERT INTO items (`+columns+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, r.ID, r.Kind, r.Name, r.Size, r.CreatedAt, r.UpdatedAt, r.Status, r.Preview, r.Pinned, r.SourceDevice, r.MIMEType, r.Checksum, r.Upload)
	if err != nil {
		return err
	}
	s.lastCreated = created
	file, err := os.OpenFile(s.blob(r.ID), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err == nil {
		err = file.Sync()
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
	}
	if err == nil {
		err = s.syncBlobs()
	}
	if err != nil {
		_, _ = s.db.Exec(`DELETE FROM items WHERE id=?`, r.ID)
		return err
	}
	s.eventsBroker.publish("created", r.ID)
	return nil
}

func (s *Server) syncBlobs() error {
	dir, err := os.Open(filepath.Join(s.cfg.DataDir, "blobs"))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (s *Server) storage(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		methodError(w)
		return
	}
	used, err := s.usedBytes()
	if err != nil {
		safeInternal(w, err)
		return
	}
	free, err := s.freeBytes()
	if err != nil {
		safeInternal(w, err)
		return
	}
	info := storageInfo{UsedBytes: used, FreeBytes: free, MaxFileBytes: s.cfg.MaxFileBytes, MaxTextBytes: s.cfg.MaxTextBytes}
	if s.cfg.MaxStorageBytes > 0 {
		n := s.cfg.MaxStorageBytes
		info.MaxStorageBytes = &n
	}
	writeJSON(w, 200, info)
}

// The tombstone precedes unlink, so a crash cannot make an orphaned ready item
// downloadable. Recovery retries tombstones and removes unreferenced blobs.
// Caller holds the same per-item lock used by tusd.
func (s *Server) deleteRecord(id string) error {
	if _, err := s.get(id, true); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE items SET status='deleting',updated_at=? WHERE id=?`, now(), id); err != nil {
		return err
	}
	if err := os.Remove(s.blob(id)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := s.syncBlobs(); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM items WHERE id=?`, id); err != nil {
		return err
	}
	s.eventsBroker.publish("deleted", id)
	return nil
}

func (s *Server) recover() error {
	rows, err := s.db.Query(`SELECT ` + columns + ` FROM items`)
	if err != nil {
		return err
	}
	var records []record
	for rows.Next() {
		r, err := scanRecord(rows)
		if err != nil {
			rows.Close()
			return err
		}
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	known := make(map[string]bool, len(records))
	for _, r := range records {
		if !validID.MatchString(r.ID) {
			return errors.New("invalid stored item ID")
		}
		known[r.ID] = true
		if r.Status == "deleting" {
			if err := s.deleteRecord(r.ID); err != nil {
				return err
			}
			continue
		}
		stat, err := os.Stat(s.blob(r.ID))
		if errors.Is(err, fs.ErrNotExist) {
			if err := s.markFailed(r.ID); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if !stat.Mode().IsRegular() {
			return errors.New("non-regular blob found")
		}
		if r.Status == "uploading" && stat.Size() == r.Size {
			// Failed UTF-8/length validation is a persisted state, not a startup
			// failure. A transient DB/disk error must abort startup, however.
			err = s.complete(r.ID)
			if err != nil && !errors.Is(err, errValidation) {
				return err
			}
		} else if stat.Size() > r.Size || (r.Status == "ready" && stat.Size() != r.Size) || (r.Status == "uploading" && !r.Upload) {
			if err := s.markFailed(r.ID); err != nil {
				return err
			}
		}
	}
	entries, err := os.ReadDir(filepath.Join(s.cfg.DataDir, "blobs"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if validID.MatchString(entry.Name()) && !known[entry.Name()] {
			if err := os.Remove(s.blob(entry.Name())); err != nil {
				return err
			}
		}
	}
	return s.syncBlobs()
}

func (s *Server) markFailed(id string) error {
	_, err := s.db.Exec(`UPDATE items SET status='failed',updated_at=? WHERE id=? AND status!='deleting'`, now(), id)
	if err == nil {
		s.eventsBroker.publish("updated", id)
	}
	return err
}

func (s *Server) cleanupLoop() {
	defer s.workers.Done()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			if err := s.Cleanup(time.Now()); err != nil {
				log.Printf("Transfer cleanup failed: %v", err)
			}
		}
	}
}

// Cleanup expires abandoned/failed transfers, never completed household content.
func (s *Server) Cleanup(at time.Time) error {
	if s.cfg.UploadTTL <= 0 {
		return nil
	}
	cutoff := at.Add(-s.cfg.UploadTTL).UTC().Format(timestampFormat)
	rows, err := s.db.Query(`SELECT id FROM items WHERE status IN ('uploading','failed','deleting') AND updated_at < ?`, cutoff)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, id := range ids {
		err := s.withItemLock(context.Background(), id, func() error {
			r, err := s.get(id, true)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			if r.Status == "ready" || r.UpdatedAt >= cutoff {
				return nil
			}
			return s.deleteRecord(id)
		})
		if err != nil {
			return fmt.Errorf("cleanup transfer: %w", err)
		}
	}
	return nil
}
