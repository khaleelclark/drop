package share

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

const maxDevices = 64

var errRouting = errors.New("invalid source or recipient devices")

type Device struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Platform  string `json:"platform"`
	CreatedAt string `json:"createdAt"`
}

// Bound recipient metadata separately from the much larger JSON text envelope.
type targetList []string

type deviceID string

func (id *deviceID) UnmarshalJSON(raw []byte) error {
	var value strictString
	if err := json.Unmarshal(raw, &value); err != nil || !validID.MatchString(string(value)) {
		return errRouting
	}
	*id = deviceID(value)
	return nil
}

func (ids *targetList) UnmarshalJSON(raw []byte) error {
	if len(raw) > 16<<10 || len(raw) == 0 || raw[0] != '[' {
		return errRouting
	}
	var values []strictString
	if err := json.Unmarshal(raw, &values); err != nil || len(values) > maxDevices {
		return errRouting
	}
	*ids = make(targetList, len(values))
	for i, value := range values {
		(*ids)[i] = string(value)
	}
	return nil
}

// Validate and snapshot the sender label in the same transaction as reservation.
func validateRouting(tx *sql.Tx, row *record) error {
	if row.SourceDeviceID != "" {
		if !validID.MatchString(row.SourceDeviceID) {
			return errRouting
		}
		err := tx.QueryRow(`SELECT label FROM devices WHERE id=?`, row.SourceDeviceID).Scan(&row.SourceDevice)
		if errors.Is(err, sql.ErrNoRows) {
			return errRouting
		}
		if err != nil {
			return err
		}
	} else if row.SourceDevice != "" {
		if err := safeLabel(row.SourceDevice, 128, false); err != nil {
			return errRouting
		}
	}
	if len(row.TargetDeviceIDs) > maxDevices || (len(row.TargetDeviceIDs) > 0 && row.SourceDeviceID == "") {
		return errRouting
	}
	seen := make(map[string]bool, len(row.TargetDeviceIDs))
	for _, id := range row.TargetDeviceIDs {
		if !validID.MatchString(id) || id == row.SourceDeviceID || seen[id] {
			return errRouting
		}
		seen[id] = true
		var found string
		err := tx.QueryRow(`SELECT id FROM devices WHERE id=?`, id).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return errRouting
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) registerDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		methodError(w)
		return
	}
	var body struct {
		ID               strictString `json:"id"`
		Label            strictString `json:"label"`
		Platform         strictString `json:"platform"`
		PreserveExisting bool         `json:"preserveExisting"`
	}
	if !decodeJSON(w, r, 16<<10, &body) {
		return
	}
	if !validID.MatchString(string(body.ID)) || safeLabel(string(body.Label), 128, false) != nil {
		writeError(w, 400, "invalid_device", "Invalid device ID or label")
		return
	}
	switch body.Platform {
	case "macos", "linux", "android", "browser":
	default:
		writeError(w, 400, "invalid_platform", "Invalid device platform")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer tx.Rollback()
	var count, exists int
	if err = tx.QueryRow(`SELECT COUNT(*),COALESCE(MAX(id=?),0) FROM devices`, string(body.ID)).Scan(&count, &exists); err != nil {
		safeInternal(w, err)
		return
	}
	if count >= maxDevices && exists == 0 {
		writeError(w, 409, "device_limit", "The household device registry is full")
		return
	}
	_, err = tx.Exec(`INSERT INTO devices(id,label,platform,created_at) VALUES(?,?,?,?)
ON CONFLICT(id) DO UPDATE SET label=excluded.label,platform=excluded.platform WHERE NOT ?`, string(body.ID), string(body.Label), string(body.Platform), now(), body.PreserveExisting)
	var d Device
	if err == nil {
		err = tx.QueryRow(`SELECT id,label,platform,created_at FROM devices WHERE id=?`, string(body.ID)).Scan(&d.ID, &d.Label, &d.Platform, &d.CreatedAt)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		safeInternal(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"device": d})
}

func (s *Server) devices(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		methodError(w)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,label,platform,created_at FROM devices ORDER BY created_at,id`)
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer rows.Close()
	devices := make([]Device, 0)
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.Label, &d.Platform, &d.CreatedAt); err != nil {
			safeInternal(w, err)
			return
		}
		devices = append(devices, d)
	}
	if err := rows.Err(); err != nil {
		safeInternal(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"devices": devices})
}

func (s *Server) device(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/devices/"), "/")
	if !validID.MatchString(parts[0]) {
		writeError(w, 400, "invalid_device", "Invalid device ID")
		return
	}
	id := parts[0]
	if len(parts) == 1 {
		if r.Method != "DELETE" {
			methodError(w)
			return
		}
		if _, err := s.db.ExecContext(r.Context(), `DELETE FROM devices WHERE id=?`, id); err != nil {
			safeInternal(w, err)
			return
		}
		w.WriteHeader(204)
		return
	}
	if len(parts) == 2 && parts[1] == "notifications" {
		s.notifications(w, r, id)
	} else if len(parts) == 3 && parts[1] == "notifications" && parts[2] == "ack" {
		s.ackNotifications(w, r, id)
	} else {
		writeError(w, 404, "not_found", "Endpoint not found")
	}
}

func parseSequence(raw string) (int64, error) {
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 || strconv.FormatInt(n, 10) != raw {
		return 0, errors.New("invalid notification cursor")
	}
	return n, nil
}

func deviceError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "device_not_found", "Device not registered")
	} else {
		safeInternal(w, err)
	}
}

type notification struct {
	Sequence  string `json:"sequence"`
	ItemID    string `json:"itemId"`
	CreatedAt string `json:"createdAt"`
}

func (s *Server) notifications(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != "GET" {
		methodError(w)
		return
	}
	limit := 50
	if raw, present := r.URL.Query()["limit"]; present {
		var err error
		limit, err = strconv.Atoi(raw[0])
		if err != nil || limit < 1 || limit > 100 {
			writeError(w, 400, "invalid_limit", "Limit must be between 1 and 100")
			return
		}
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer tx.Rollback()
	var ack, high int64
	if err = tx.QueryRow(`SELECT ack_sequence FROM devices WHERE id=?`, id).Scan(&ack); err != nil {
		deviceError(w, err)
		return
	}
	if err = tx.QueryRow(`SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='notifications'),0)`).Scan(&high); err != nil {
		safeInternal(w, err)
		return
	}
	after := ack
	if raw, present := r.URL.Query()["after"]; present {
		after, err = parseSequence(raw[0])
		if err != nil || after > high {
			writeError(w, 400, "invalid_cursor", "Invalid or future notification cursor")
			return
		}
	}
	rows, err := tx.Query(`SELECT n.sequence,n.item_id,n.created_at FROM notifications n
JOIN items i ON i.id=n.item_id WHERE n.device_id=? AND n.sequence>? AND i.status='ready'
ORDER BY n.sequence LIMIT ?`, id, after, limit+1)
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer rows.Close()
	arrivals := make([]notification, 0, limit)
	next, more := strconv.FormatInt(after, 10), false
	for rows.Next() {
		var n notification
		var sequence int64
		if err = rows.Scan(&sequence, &n.ItemID, &n.CreatedAt); err != nil {
			safeInternal(w, err)
			return
		}
		if len(arrivals) == limit {
			more = true
			break
		}
		n.Sequence = strconv.FormatInt(sequence, 10)
		next = n.Sequence
		arrivals = append(arrivals, n)
	}
	if err = rows.Err(); err != nil {
		safeInternal(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"notifications": arrivals, "nextCursor": next, "ackCursor": strconv.FormatInt(ack, 10), "hasMore": more})
}

func (s *Server) ackNotifications(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != "POST" {
		methodError(w)
		return
	}
	var body struct {
		Through strictString `json:"through"`
	}
	if !decodeJSON(w, r, 16<<10, &body) {
		return
	}
	through, err := parseSequence(string(body.Through))
	if err != nil {
		writeError(w, 400, "invalid_cursor", "Invalid notification cursor")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		safeInternal(w, err)
		return
	}
	defer tx.Rollback()
	var ack, high int64
	if err = tx.QueryRow(`SELECT ack_sequence FROM devices WHERE id=?`, id).Scan(&ack); err != nil {
		deviceError(w, err)
		return
	}
	if err = tx.QueryRow(`SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='notifications'),0)`).Scan(&high); err != nil {
		safeInternal(w, err)
		return
	}
	if through > high {
		writeError(w, 400, "invalid_cursor", "Future notification cursor")
		return
	}
	ack = max(ack, through)
	_, err = tx.Exec(`UPDATE devices SET ack_sequence=? WHERE id=?`, ack, id)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		safeInternal(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"ackCursor": strconv.FormatInt(ack, 10)})
}
