package share

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"
)

var errValidation = errors.New("content validation failed")

// Caller holds the tus/item lock, or runs before the HTTP listener starts.
func (s *Server) complete(id string) error {
	row, err := s.get(id, false)
	if err != nil {
		return err
	}
	if row.Status == "ready" {
		return nil
	}
	if row.Status != "uploading" {
		return errValidation
	}
	file, err := os.OpenFile(s.blob(row.BlobID), os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	if err = file.Sync(); err != nil {
		return err
	}
	stat, err := file.Stat()
	if err != nil {
		return err
	}
	fail := func() error {
		if err := s.markFailed(id); err != nil {
			return err
		}
		return errValidation
	}
	if !stat.Mode().IsRegular() || stat.Size() != row.Size {
		return fail()
	}
	count, preview, checksum, err := inspectContent(file, row.Kind == "text", false)
	if errors.Is(err, errValidation) || (err == nil && count != row.Size) {
		return fail()
	}
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var status string
	if err = tx.QueryRow(`SELECT status FROM items WHERE id=?`, id).Scan(&status); err != nil {
		return err
	}
	if status == "ready" {
		return nil
	}
	if status != "uploading" {
		return errValidation
	}
	readyAt, err := nextUpdated(row.UpdatedAt)
	if err != nil {
		return err
	}
	if len(row.TargetDeviceIDs) == 0 {
		_, err = tx.Exec(`INSERT INTO notifications(device_id,item_id,created_at)
SELECT id,?,? FROM devices WHERE id!=? ON CONFLICT(device_id,item_id) DO NOTHING`, id, readyAt, row.SourceDeviceID)
	} else {
		for _, target := range row.TargetDeviceIDs {
			// A forgotten explicit destination is skipped, never broadcast.
			_, err = tx.Exec(`INSERT INTO notifications(device_id,item_id,created_at)
SELECT id,?,? FROM devices WHERE id=? ON CONFLICT(device_id,item_id) DO NOTHING`, id, readyAt, target)
			if err != nil {
				break
			}
		}
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE items SET status='ready',preview=?,checksum=?,updated_at=? WHERE id=? AND status='uploading'`, preview, checksum, readyAt, id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.eventsBroker.publish("updated", id)
	return nil
}

// Read bounded blocks; only a split rune and the bounded preview cross reads.
func inspectContent(file io.Reader, text, rejectControls bool) (int64, string, string, error) {
	hash := sha256.New()
	buffer := make([]byte, 128<<10)
	carry := make([]byte, 0, 4)
	var snippet strings.Builder
	points := 0
	var count int64
	for {
		n, readErr := file.Read(buffer)
		if n > 0 {
			count += int64(n)
			_, _ = hash.Write(buffer[:n])
			if text {
				// Only a split UTF-8 rune crosses block boundaries. The preview is
				// capped at 512 code points; the body is never accumulated.
				data := buffer[:n]
				if len(carry) > 0 {
					joined := make([]byte, 0, len(carry)+n)
					joined = append(joined, carry...)
					data = append(joined, data...)
					carry = carry[:0]
				}
				for len(data) > 0 {
					if !utf8.FullRune(data) {
						carry = append(carry, data...)
						break
					}
					r, size := utf8.DecodeRune(data)
					if r == utf8.RuneError && size == 1 {
						return 0, "", "", errValidation
					}
					if rejectControls && unicode.IsControl(r) && r != '\t' && r != '\r' && r != '\n' {
						return 0, "", "", errValidation
					}
					if points < 512 {
						snippet.WriteRune(r)
						points++
					}
					data = data[size:]
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return 0, "", "", readErr
		}
	}
	if len(carry) > 0 {
		return 0, "", "", errValidation
	}
	return count, snippet.String(), hex.EncodeToString(hash.Sum(nil)), nil
}
