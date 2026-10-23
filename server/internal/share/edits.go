package share

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Optional values retain presence and reject null instead of treating it as omitted.
type editString struct {
	set   bool
	value strictString
}

func (v *editString) UnmarshalJSON(raw []byte) error {
	if err := v.value.UnmarshalJSON(raw); err != nil {
		return err
	}
	v.set = true
	return nil
}

type editBool struct {
	set, value bool
}

func (v *editBool) UnmarshalJSON(raw []byte) error {
	if string(raw) != "true" && string(raw) != "false" {
		return errors.New("expected boolean")
	}
	v.set, v.value = true, string(raw) == "true"
	return nil
}

type itemEdit struct {
	Pinned   editBool   `json:"pinned"`
	Name     editString `json:"name"`
	Text     editString `json:"text"`
	Expected editString `json:"expectedUpdatedAt"`
}

type itemError struct {
	status        int
	code, message string
}

func (e *itemError) Error() string { return e.message }

func writeItemError(w http.ResponseWriter, err error) {
	var e *itemError
	switch {
	case errors.As(err, &e):
		writeError(w, e.status, e.code, e.message)
	case errors.Is(err, sql.ErrNoRows), errors.Is(err, os.ErrNotExist):
		writeError(w, 404, "not_found", "Item or content not found")
	case errors.Is(err, errBudget):
		writeError(w, 507, "storage_full", "Storage capacity unavailable")
	default:
		safeInternal(w, err)
	}
}

func (s *Server) editItem(w http.ResponseWriter, r *http.Request, id string) {
	var body itemEdit
	if !decodeJSON(w, r, 6*s.cfg.MaxTextBytes+(16<<10), &body) {
		return
	}
	if !body.Pinned.set && !body.Name.set && !body.Text.set {
		writeError(w, 400, "missing_mutation", "At least one change is required")
		return
	}
	if body.Name.set || body.Text.set || body.Expected.set {
		_, err := time.Parse(timestampFormat, string(body.Expected.value))
		if !body.Expected.set || err != nil {
			writeError(w, 400, "invalid_version", "The opening updatedAt value is required")
			return
		}
	}
	if body.Name.set {
		if err := safeLabel(string(body.Name.value), 255, true); err != nil {
			writeError(w, 400, "invalid_name", err.Error())
			return
		}
	}
	if body.Text.set && int64(len(body.Text.value)) > s.cfg.MaxTextBytes {
		writeError(w, 413, "text_too_large", "Text exceeds the configured byte limit")
		return
	}
	var row record
	err := s.withItemLock(r.Context(), id, func() error {
		var err error
		row, err = s.get(id, false)
		if err != nil {
			return err
		}
		if body.Expected.set && string(body.Expected.value) != row.UpdatedAt {
			return &itemError{409, "edit_conflict", "This entry changed; reload before saving again"}
		}
		if (body.Name.set || body.Text.set) && row.Status != "ready" {
			return &itemError{409, "not_ready", "Item is not ready"}
		}
		if body.Text.set && row.Kind != "text" {
			return &itemError{400, "invalid_kind", "Only text entries support body editing"}
		}
		previous := row.UpdatedAt
		row.UpdatedAt, err = nextUpdated(previous)
		if err != nil {
			return err
		}
		if body.Name.set {
			row.Name = string(body.Name.value)
		}
		if body.Pinned.set {
			row.Pinned = body.Pinned.value
		}
		if body.Text.set {
			return s.replaceText(r.Context(), &row, previous, string(body.Text.value))
		}
		return s.commitEdit(&row, previous)
	})
	if err != nil {
		writeItemError(w, err)
		return
	}
	s.eventsBroker.publish("updated", id)
	writeJSON(w, 200, map[string]any{"item": row.Item})
}

// CAS is inside a transaction even though normal writers also share the item lock.
// Never retry an ambiguous commit: confirm the unique version/pointer instead.
func (s *Server) commitEdit(row *record, previous string) error {
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		return err
	}
	defer conn.Close()
	tx, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE items SET name=?,pinned=?,size=?,preview=?,checksum=?,blob_id=?,updated_at=? WHERE id=? AND updated_at=? AND status!='deleting'`, row.Name, row.Pinned, row.Size, row.Preview, row.Checksum, row.BlobID, row.UpdatedAt, row.ID, previous)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return &itemError{409, "edit_conflict", "This entry changed; reload before saving again"}
	}
	err = tx.Commit()
	if err == nil {
		err = s.editCheckpoint("commit_response")
	}
	if err != nil {
		// SQLite can leave a failed COMMIT transaction active. Discard this
		// connection before confirming from a fresh committed view.
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		current, readErr := s.get(row.ID, true)
		if readErr == nil && current.UpdatedAt == row.UpdatedAt && current.BlobID == row.BlobID {
			return nil
		}
	}
	return err
}

func (s *Server) replaceText(ctx context.Context, row *record, previous, text string) error {
	// Upload block writers never acquire budgetMu. Their remaining promises are
	// included here; holding it prevents new reservations or another edit racing us.
	s.budgetMu.Lock()
	defer s.budgetMu.Unlock()
	if err := s.checkBudget(s.db, int64(len(text))); err != nil {
		return err
	}
	id, err := newID()
	if err != nil {
		return err
	}
	file, err := os.OpenFile(s.blob(id), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	// On uncertainty retain both files. Startup removes only unreferenced blobs.
	committing := false
	defer func() {
		if !committing {
			if err := os.Remove(s.blob(id)); err == nil {
				_ = s.syncBlobs()
			}
		}
	}()
	writer := &budgetWriter{s: s, file: file, ctx: ctx, remaining: int64(len(text))}
	if _, err = io.CopyBuffer(writer, readerOnly{strings.NewReader(text)}, make([]byte, 128<<10)); err != nil {
		return err
	}
	if err = s.editCheckpoint("file_sync"); err == nil {
		err = file.Sync()
	}
	if err != nil {
		return err
	}
	if err = s.editCheckpoint("directory_sync"); err == nil {
		err = s.syncBlobs()
	}
	if err != nil {
		return err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	row.Size, row.Preview, row.Checksum, err = inspectContent(file, true, false)
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	old := row.BlobID
	row.BlobID = id
	committing = true
	if err = s.commitEdit(row, previous); err != nil {
		current, readErr := s.get(row.ID, true)
		if readErr == nil && current.BlobID != id {
			committing = false
		}
		return err
	}
	err = s.editCheckpoint("cleanup")
	if err == nil {
		err = os.Remove(s.blob(old))
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("Retired content cleanup deferred: %v", err)
	} else if err := s.syncBlobs(); err != nil {
		log.Printf("Retired content directory sync deferred: %v", err)
	}
	return nil
}

func (s *Server) editCheckpoint(stage string) error {
	if s.editFault != nil {
		return s.editFault(stage)
	}
	return nil
}
