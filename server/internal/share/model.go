package share

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const timestampFormat = "2006-01-02T15:04:05.000000000Z"

var validID = regexp.MustCompile(`^[a-f0-9]{32}$`)

type Item struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	Name            string   `json:"name"`
	Size            int64    `json:"size"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
	Status          string   `json:"status"`
	Preview         string   `json:"preview,omitempty"`
	Pinned          bool     `json:"pinned"`
	SourceDevice    string   `json:"sourceDevice,omitempty"`
	MIMEType        string   `json:"mimeType,omitempty"`
	SourceDeviceID  string   `json:"sourceDeviceId,omitempty"`
	TargetDeviceIDs []string `json:"targetDeviceIds,omitempty"`
}

type record struct {
	Item
	Checksum     string
	Upload       bool
	BlobID       string
	UploadLength int64
}

const columns = `id,kind,name,size,created_at,updated_at,status,preview,pinned,source_device,mime_type,checksum,is_upload,source_device_id,target_device_ids,blob_id,upload_length`

type scanner interface{ Scan(...any) error }

func scanRecord(row scanner) (record, error) {
	var r record
	var targets string
	err := row.Scan(&r.ID, &r.Kind, &r.Name, &r.Size, &r.CreatedAt, &r.UpdatedAt, &r.Status, &r.Preview, &r.Pinned, &r.SourceDevice, &r.MIMEType, &r.Checksum, &r.Upload, &r.SourceDeviceID, &targets, &r.BlobID, &r.UploadLength)
	if err == nil {
		err = json.Unmarshal([]byte(targets), &r.TargetDeviceIDs)
	}
	if err == nil && !validID.MatchString(r.BlobID) {
		err = errors.New("invalid stored blob ID")
	}
	return r, err
}

func (s *Server) get(id string, includeDeleting bool) (record, error) {
	if !validID.MatchString(id) {
		return record{}, sql.ErrNoRows
	}
	query := `SELECT ` + columns + ` FROM items WHERE id=?`
	if !includeDeleting {
		query += ` AND status!='deleting'`
	}
	return scanRecord(s.db.QueryRow(query, id))
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func nextUpdated(previous string) (string, error) {
	before, err := time.Parse(timestampFormat, previous)
	if err != nil {
		return "", err
	}
	updated := time.Now().UTC()
	if !updated.After(before) {
		updated = before.Add(time.Nanosecond)
	}
	return updated.Format(timestampFormat), nil
}

func now() string { return time.Now().UTC().Format(timestampFormat) }

func safeLabel(value string, max int, filename bool) error {
	if value == "" || !utf8.ValidString(value) || len(value) > max {
		return errors.New("invalid name or label length")
	}
	if filename && (value == "." || value == ".." || strings.ContainsAny(value, `/\\`)) {
		return errors.New("filename must not contain a path")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New("control characters are not allowed in metadata")
		}
	}
	return nil
}
