package share

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// encoding/json otherwise repairs invalid UTF-8 and lone UTF-16 surrogates.
// Text must be preserved exactly, so reject those inputs instead.
type strictString string

func (s *strictString) UnmarshalJSON(raw []byte) error {
	if !utf8.Valid(raw) || len(raw) < 2 || raw[0] != '"' {
		return errors.New("invalid UTF-8 string")
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw)-1 {
			return errors.New("invalid escape")
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return errors.New("invalid Unicode escape")
		}
		n, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return err
		}
		i += 4
		if n >= 0xDC00 && n <= 0xDFFF {
			return errors.New("unpaired Unicode surrogate")
		}
		if n >= 0xD800 && n <= 0xDBFF {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return errors.New("unpaired Unicode surrogate")
			}
			low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if err != nil || low < 0xDC00 || low > 0xDFFF {
				return errors.New("unpaired Unicode surrogate")
			}
			i += 6
		}
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*s = strictString(value)
	return nil
}

func (s *Server) items(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		methodError(w)
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeError(w, 400, "invalid_limit", "Limit must be between 1 and 100")
			return
		}
		limit = value
	}
	query := `SELECT ` + columns + ` FROM items WHERE status!='deleting'`
	args := []any{}
	if raw := r.URL.Query().Get("before"); raw != "" {
		before, id, err := decodeCursor(raw)
		if err != nil {
			writeError(w, 400, "invalid_cursor", "Invalid cursor")
			return
		}
		query += ` AND (created_at < ? OR (created_at = ? AND id < ?))`
		args = append(args, before, before, id)
	}
	if q := r.URL.Query().Get("q"); q != "" {
		if len(q) > 1024 || !utf8.ValidString(q) {
			writeError(w, 400, "invalid_query", "Search query is too long or invalid")
			return
		}
		query += ` AND instr(lower(name || char(10) || preview || char(10) || source_device),lower(?))>0`
		args = append(args, q)
	}
	query += ` ORDER BY created_at DESC,id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer rows.Close()
	items := make([]Item, 0, limit)
	var next *string
	for rows.Next() {
		row, err := scanRecord(rows)
		if err != nil {
			safeInternal(w, err)
			return
		}
		if len(items) == limit {
			cursor := encodeCursor(items[len(items)-1])
			next = &cursor
			break
		}
		items = append(items, row.Item)
	}
	if err := rows.Err(); err != nil {
		safeInternal(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func encodeCursor(item Item) string {
	return base64.RawURLEncoding.EncodeToString([]byte(item.CreatedAt + "|" + item.ID))
}
func decodeCursor(raw string) (string, string, error) {
	if len(raw) > 256 {
		return "", "", errors.New("invalid cursor")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return "", "", err
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 || !validID.MatchString(parts[1]) {
		return "", "", errors.New("invalid cursor")
	}
	before, err := time.Parse(timestampFormat, parts[0])
	if err != nil {
		return "", "", err
	}
	return before.UTC().Format(timestampFormat), parts[1], nil
}

func (s *Server) item(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/items/"), "/")
	if len(parts) > 2 || !validID.MatchString(parts[0]) {
		writeError(w, 404, "not_found", "Item not found")
		return
	}
	id := parts[0]
	if len(parts) == 2 {
		if parts[1] != "download" && parts[1] != "text" {
			writeError(w, 404, "not_found", "Endpoint not found")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			methodError(w)
			return
		}
		s.content(w, r, id, parts[1] == "text")
		return
	}
	switch r.Method {
	case "GET":
		row, err := s.get(id, false)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "not_found", "Item not found")
			return
		}
		if err != nil {
			safeInternal(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"item": row.Item})
	case "DELETE":
		err := s.withItemLock(r.Context(), id, func() error { return s.deleteRecord(id) })
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "not_found", "Item not found")
			return
		}
		if err != nil {
			safeInternal(w, err)
			return
		}
		w.WriteHeader(204)
	case "PATCH":
		var body struct {
			Pinned *bool `json:"pinned"`
		}
		if !decodeJSON(w, r, 4096, &body) {
			return
		}
		if body.Pinned == nil {
			writeError(w, 400, "missing_pinned", "A pinned boolean is required")
			return
		}
		var row record
		err := s.withItemLock(r.Context(), id, func() error {
			var err error
			row, err = s.get(id, false)
			if err != nil {
				return err
			}
			_, err = s.db.Exec(`UPDATE items SET pinned=?,updated_at=? WHERE id=?`, *body.Pinned, now(), id)
			if err == nil {
				row, err = s.get(id, false)
			}
			return err
		})
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "not_found", "Item not found")
			return
		}
		if err != nil {
			safeInternal(w, err)
			return
		}
		s.eventsBroker.publish("updated", id)
		writeJSON(w, 200, map[string]any{"item": row.Item})
	default:
		methodError(w)
	}
}

func (s *Server) text(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		methodError(w)
		return
	}
	var body struct {
		Text         *strictString `json:"text"`
		Name         strictString  `json:"name"`
		SourceDevice strictString  `json:"sourceDevice"`
	}
	if !decodeJSON(w, r, 6*s.cfg.MaxTextBytes+(16<<10), &body) {
		return
	}
	if body.Text == nil {
		writeError(w, 400, "missing_text", "A text string is required")
		return
	}
	text := string(*body.Text)
	if int64(len(text)) > s.cfg.MaxTextBytes {
		writeError(w, 413, "text_too_large", "Text exceeds the configured byte limit; upload a text file instead")
		return
	}
	name := string(body.Name)
	if name == "" {
		name = "Shared text.txt"
	}
	if err := safeLabel(name, 255, true); err != nil {
		writeError(w, 400, "invalid_name", err.Error())
		return
	}
	if body.SourceDevice != "" {
		if err := safeLabel(string(body.SourceDevice), 128, false); err != nil {
			writeError(w, 400, "invalid_source", err.Error())
			return
		}
	}
	id, err := newID()
	if err != nil {
		safeInternal(w, err)
		return
	}
	row := record{Item: Item{ID: id, Kind: "text", Name: name, Size: int64(len(text)), Status: "uploading", SourceDevice: string(body.SourceDevice), MIMEType: "text/plain"}}
	if err = s.reserve(&row); err != nil {
		if errors.Is(err, errBudget) {
			writeError(w, 507, "storage_full", "Storage capacity unavailable")
			return
		}
		safeInternal(w, err)
		return
	}
	err = s.withItemLock(r.Context(), id, func() error {
		file, err := os.OpenFile(s.blob(id), os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		writer := &budgetWriter{s: s, file: file, ctx: r.Context(), remaining: int64(len(text))}
		_, err = io.CopyBuffer(writer, readerOnly{strings.NewReader(text)}, make([]byte, 128<<10))
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
		return s.complete(id)
	})
	if err != nil {
		_ = s.markFailed(id)
		safeInternal(w, err)
		return
	}
	row, err = s.get(id, false)
	if err != nil {
		safeInternal(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"item": row.Item})
}

func (s *Server) content(w http.ResponseWriter, r *http.Request, id string, textOnly bool) {
	row, err := s.get(id, false)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "not_found", "Item not found")
		return
	}
	if err != nil {
		safeInternal(w, err)
		return
	}
	if row.Status != "ready" {
		writeError(w, 409, "not_ready", "Item is not ready")
		return
	}
	if textOnly && row.Kind != "text" {
		writeError(w, 404, "not_text", "Item is not text")
		return
	}
	file, err := os.Open(s.blob(id))
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, 404, "not_found", "Content not found")
		return
	}
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		safeInternal(w, err)
		return
	}
	if stat.Size() != row.Size || !stat.Mode().IsRegular() {
		writeError(w, 409, "content_unavailable", "Stored content failed a length check")
		return
	}
	w.Header().Set("ETag", `"sha256-`+row.Checksum+`"`)
	w.Header().Set("Content-Type", "application/octet-stream")
	if textOnly {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	} else {
		w.Header().Set("Content-Disposition", `attachment; filename="`+asciiFilename(row.Name)+`"; filename*=UTF-8''`+url.PathEscape(row.Name))
	}
	created, _ := time.Parse(time.RFC3339Nano, row.UpdatedAt)
	http.ServeContent(&contentResponse{ResponseWriter: w}, r, row.Name, created, file)
}

// Preserve the JSON error contract for errors generated by ServeContent (for
// example an unsatisfiable Range) while streaming successful bodies directly.
type contentResponse struct {
	http.ResponseWriter
	failed bool
}

func (w *contentResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *contentResponse) WriteHeader(status int) {
	if status >= 400 {
		w.failed = true
		w.Header().Del("Content-Length")
		w.Header().Del("Content-Disposition")
		writeError(w.ResponseWriter, status, "download_error", http.StatusText(status))
		return
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *contentResponse) Write(p []byte) (int, error) {
	if w.failed {
		return len(p), nil
	}
	return w.ResponseWriter.Write(p)
}

// Avoid optional WriterTo implementations bypassing the fixed transfer buffer.
type readerOnly struct{ io.Reader }

func asciiFilename(name string) string {
	var out strings.Builder
	for _, r := range name {
		if out.Len() >= 180 {
			break
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune(" ._-", r) {
			out.WriteRune(r)
		} else {
			out.WriteByte('_')
		}
	}
	result := strings.TrimSpace(out.String())
	if result == "" || result == "." || result == ".." {
		return "download"
	}
	return result
}
