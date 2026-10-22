package share

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
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
	file, err := os.OpenFile(s.blob(id), os.O_RDWR, 0600)
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
			if row.Kind == "text" {
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
						return fail()
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
			return readErr
		}
	}
	if count != row.Size || len(carry) > 0 {
		return fail()
	}
	_, err = s.db.Exec(`UPDATE items SET status='ready',preview=?,checksum=?,updated_at=? WHERE id=? AND status='uploading'`, snippet.String(), hex.EncodeToString(hash.Sum(nil)), now(), id)
	if err == nil {
		s.eventsBroker.publish("updated", id)
	}
	return err
}
