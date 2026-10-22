package share

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"

	"github.com/tus/tusd/v2/pkg/handler"
)

type uploadStore struct{ s *Server }
type upload struct {
	s  *Server
	id string
}

var _ handler.DataStore = (*uploadStore)(nil)
var _ handler.TerminaterDataStore = (*uploadStore)(nil)
var _ handler.Upload = (*upload)(nil)
var _ handler.TerminatableUpload = (*upload)(nil)

func tusError(status int, code, message string) error { return handler.NewError(code, message, status) }

func (store *uploadStore) NewUpload(ctx context.Context, info handler.FileInfo) (handler.Upload, error) {
	if info.SizeIsDeferred || info.IsPartial || info.IsFinal || info.Size < 0 || info.Size > store.s.cfg.MaxFileBytes {
		return nil, tusError(400, "invalid_length", "A fixed valid Upload-Length is required")
	}
	if !validID.MatchString(info.ID) {
		return nil, tusError(400, "invalid_id", "Invalid upload ID")
	}
	name := info.MetaData["filename"]
	if err := safeLabel(name, 255, true); err != nil {
		return nil, tusError(400, "invalid_filename", err.Error())
	}
	kind := info.MetaData["kind"]
	if kind == "" {
		kind = "file"
	}
	if kind != "file" && kind != "text" {
		return nil, tusError(400, "invalid_kind", "Upload kind must be file or text")
	}
	source := info.MetaData["sourceDevice"]
	if source != "" {
		if err := safeLabel(source, 128, false); err != nil {
			return nil, tusError(400, "invalid_source", err.Error())
		}
	}
	contentType := info.MetaData["filetype"]
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	typ, params, err := mime.ParseMediaType(contentType)
	if err != nil || len(contentType) > 255 {
		return nil, tusError(400, "invalid_type", "Invalid content type")
	}
	if kind == "text" && (typ != "text/plain" || (params["charset"] != "" && !strings.EqualFold(params["charset"], "utf-8"))) {
		return nil, tusError(400, "invalid_type", "Text uploads must be UTF-8 text/plain")
	}
	row := record{Item: Item{ID: info.ID, Kind: kind, Name: name, Size: info.Size, Status: "uploading", SourceDevice: source, MIMEType: contentType}, Upload: true}
	if err := store.s.reserve(&row); err != nil {
		if errors.Is(err, errBudget) {
			return nil, tusError(507, "storage_full", "Storage capacity unavailable")
		}
		return nil, err
	}
	return &upload{store.s, info.ID}, nil
}

func (store *uploadStore) GetUpload(ctx context.Context, id string) (handler.Upload, error) {
	row, err := store.s.get(id, false)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !row.Upload) {
		return nil, handler.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &upload{store.s, id}, nil
}

func (store *uploadStore) AsTerminatableUpload(up handler.Upload) handler.TerminatableUpload {
	return up.(*upload)
}

func (u *upload) GetInfo(ctx context.Context) (handler.FileInfo, error) {
	row, err := u.s.get(u.id, false)
	if errors.Is(err, sql.ErrNoRows) {
		return handler.FileInfo{}, handler.ErrNotFound
	}
	if err != nil {
		return handler.FileInfo{}, err
	}
	stat, err := os.Stat(u.s.blob(u.id))
	if errors.Is(err, os.ErrNotExist) {
		return handler.FileInfo{}, handler.ErrNotFound
	}
	if err != nil {
		return handler.FileInfo{}, err
	}
	if !stat.Mode().IsRegular() || stat.Size() > row.Size {
		return handler.FileInfo{}, tusError(409, "invalid_length", "Stored upload length is invalid")
	}
	// tusd does not call FinishUpload again when a retried PATCH is already
	// at its final offset. Retry recoverable finalization here, under tusd's
	// item lock for existing uploads, so HEAD/resume also repairs a full blob
	// left uploading by a temporary fsync/read/SQLite error. Newly created
	// zero-byte uploads are safe to finalize before their first response.
	if row.Status == "uploading" && stat.Size() == row.Size {
		if err := u.s.complete(u.id); err != nil {
			if errors.Is(err, errValidation) {
				return handler.FileInfo{}, tusError(422, "validation_failed", "Uploaded content failed validation")
			}
			return handler.FileInfo{}, err
		}
	}
	return handler.FileInfo{ID: u.id, Size: row.Size, Offset: stat.Size(), MetaData: handler.MetaData{"filename": row.Name, "filetype": row.MIMEType, "kind": row.Kind, "sourceDevice": row.SourceDevice}}, nil
}

// The tus handler holds its per-item lock and limits src to the remaining size.
// Sync before confirming the offset; a partial write remains resumable from HEAD.
func (u *upload) WriteChunk(ctx context.Context, offset int64, src io.Reader) (int64, error) {
	row, err := u.s.get(u.id, false)
	if err != nil {
		return 0, err
	}
	if row.Status != "uploading" {
		return 0, tusError(409, "not_uploading", "Item no longer accepts upload bytes")
	}
	file, err := os.OpenFile(u.s.blob(u.id), os.O_WRONLY, 0600)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return 0, err
	}
	if offset < 0 || offset != stat.Size() || offset > row.Size {
		return 0, tusError(409, "offset_mismatch", "Upload offset does not match stored bytes")
	}
	if _, err = file.Seek(offset, io.SeekStart); err != nil {
		return 0, err
	}
	writer := &budgetWriter{s: u.s, file: file, ctx: ctx, remaining: row.Size - offset}
	n, copyErr := io.CopyBuffer(writer, readerOnly{src}, make([]byte, 128<<10))
	if err = file.Sync(); err != nil {
		return n, err
	}
	if _, err = u.s.db.Exec(`UPDATE items SET updated_at=? WHERE id=?`, now(), u.id); err != nil {
		return n, err
	}
	return n, copyErr
}

type budgetWriter struct {
	s         *Server
	file      *os.File
	ctx       context.Context
	remaining int64
}

func (w *budgetWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if int64(len(p)) > w.remaining {
		return 0, tusError(413, "length_exceeded", "Upload exceeds the declared size")
	}
	free, err := w.s.freeBytes()
	if err != nil {
		return 0, err
	}
	if free < w.s.cfg.MinFreeBytes || int64(len(p)) > free-w.s.cfg.MinFreeBytes {
		return 0, tusError(507, "storage_full", "Minimum free space would be exceeded")
	}
	n, err := w.file.Write(p)
	w.remaining -= int64(n)
	return n, err
}

func (u *upload) GetReader(ctx context.Context) (io.ReadCloser, error) {
	// tus download routes are disabled; still defend this datastore boundary.
	row, err := u.s.get(u.id, false)
	if err != nil {
		return nil, err
	}
	if row.Status != "ready" {
		return nil, tusError(409, "not_ready", "Item is not ready")
	}
	return os.Open(u.s.blob(u.id))
}
func (u *upload) FinishUpload(ctx context.Context) error {
	err := u.s.complete(u.id)
	if errors.Is(err, errValidation) {
		return tusError(422, "validation_failed", "Uploaded content failed validation")
	}
	return err
}
func (u *upload) Terminate(ctx context.Context) error {
	row, err := u.s.get(u.id, false)
	if err != nil {
		return err
	}
	if row.Status == "ready" {
		return tusError(409, "already_ready", "Delete the completed item through the items API")
	}
	return u.s.deleteRecord(u.id)
}

// Reject ambiguous/invalid metadata before tusd's deliberately forgiving parser.
func validMetadata(raw string) bool {
	if len(raw) > 8192 {
		return false
	}
	seen := map[string]bool{}
	if raw == "" {
		return true
	}
	for _, entry := range strings.Split(raw, ",") {
		parts := strings.Split(strings.TrimSpace(entry), " ")
		if len(parts) < 1 || len(parts) > 2 || parts[0] == "" || seen[parts[0]] {
			return false
		}
		seen[parts[0]] = true
		if len(parts) == 2 {
			if _, err := base64.StdEncoding.DecodeString(parts[1]); err != nil {
				return false
			}
		}
	}
	return true
}

// tus replies contain only metadata and bounded error text. Buffer this small
// response to keep the application's JSON error shape, never the upload body.
type tusResponse struct {
	target http.ResponseWriter
	header http.Header
	status int
	body   strings.Builder
}

func (w *tusResponse) Header() http.Header         { return w.header }
func (w *tusResponse) Unwrap() http.ResponseWriter { return w.target }
func (w *tusResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *tusResponse) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if w.body.Len() < 16384 {
		n := min(len(p), 16384-w.body.Len())
		_, _ = w.body.Write(p[:n])
	}
	return len(p), nil
}

func (s *Server) uploads(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/uploads/")
	if id != "" && !validID.MatchString(id) {
		writeError(w, 404, "not_found", "Upload not found")
		return
	}
	if r.Method == "POST" && !validMetadata(r.Header.Get("Upload-Metadata")) {
		writeError(w, 400, "invalid_metadata", "Invalid upload metadata")
		return
	}
	response := &tusResponse{target: w, header: make(http.Header)}
	s.tus.ServeHTTP(response, r)
	for key, values := range response.header {
		// This API is same-origin. Do not inherit tusd's permissive CORS defaults.
		if strings.HasPrefix(strings.ToLower(key), "access-control-") {
			continue
		}
		w.Header()[key] = values
	}
	status := response.status
	if status == 0 {
		status = 200
	}
	if status >= 400 {
		w.Header().Del("Content-Length")
		writeError(w, status, "upload_error", http.StatusText(status))
		return
	}
	if location := w.Header().Get("Location"); location != "" {
		// A relative URL cannot be poisoned by incoming Host/forwarded headers.
		if index := strings.LastIndex(location, "/"); index >= 0 {
			w.Header().Set("Location", "/api/uploads/"+location[index+1:])
		}
	}
	w.WriteHeader(status)
	_, _ = io.WriteString(w, response.body.String())
}
