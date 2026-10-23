package share

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func saveEdit(t *testing.T, s *Server, item Item, fields map[string]any) Item {
	t.Helper()
	fields["expectedUpdatedAt"] = item.UpdatedAt
	w := jsonRequest(s, "PATCH", "/api/items/"+item.ID, fields)
	requireStatus(t, w, 200)
	var body struct {
		Item Item `json:"item"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Item
}

func assertBytes(t *testing.T, s *Server, id, want string) *httptest.ResponseRecorder {
	t.Helper()
	w := request(s, "GET", "/api/items/"+id+"/download", nil, nil)
	requireStatus(t, w, 200)
	hash := sha256.Sum256([]byte(want))
	if w.Body.String() != want || w.Header().Get("Content-Length") != strconv.Itoa(len(want)) || w.Header().Get("ETag") != `"sha256-`+hex.EncodeToString(hash[:])+`"` {
		t.Fatalf("content snapshot mismatch: %v", w.Header())
	}
	return w
}

func TestSharedEditExactContentRoutingAndConflicts(t *testing.T) {
	s := openTest(t, testConfig(t))
	register(t, s, senderID, "Sender snapshot")
	register(t, s, recipientID, "Recipient")
	item := sendText(t, s, senderID, []string{recipientID})
	before := arrivals(t, s, recipientID, "?after=0")
	ack(t, s, recipientID, before.NextCursor)
	before = arrivals(t, s, recipientID, "?after=0")
	oldTag := request(s, "HEAD", "/api/items/"+item.ID+"/download", nil, nil).Header().Get("ETag")
	sub := &subscriber{make(chan event, 4), make(chan struct{})}
	s.eventsBroker.subs[sub] = struct{}{}
	text := "  \t\r\n<script>inert</script>\n```go\n" + strings.Repeat("漢🏡", 300) + "\n```\r\n"
	edited := saveEdit(t, s, item, map[string]any{"name": "Shared code.md", "text": text, "pinned": true})
	if edited.ID != item.ID || edited.Kind != item.Kind || edited.CreatedAt != item.CreatedAt || edited.SourceDevice != item.SourceDevice || edited.SourceDeviceID != item.SourceDeviceID || !reflect.DeepEqual(edited.TargetDeviceIDs, item.TargetDeviceIDs) || edited.MIMEType != item.MIMEType || edited.Status != "ready" || !edited.Pinned || edited.Name != "Shared code.md" || edited.Size != int64(len(text)) || edited.UpdatedAt <= item.UpdatedAt {
		t.Fatal("edit changed immutable fields or lost mutations")
	}
	if edited.Preview != string([]rune(text)[:512]) {
		t.Fatal("preview not bounded/current")
	}
	if got := arrivals(t, s, recipientID, "?after=0"); !reflect.DeepEqual(before, got) {
		t.Fatal("edit changed arrivals/ACK")
	}
	w := request(s, "GET", "/api/items?forDevice="+recipientID+"&q=shared%20code", nil, nil)
	requireStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), item.ID) {
		t.Fatal("edit lost For you/search")
	}
	w = request(s, "GET", "/api/items?before="+encodeCursor(item), nil, nil)
	if strings.Contains(w.Body.String(), item.ID) {
		t.Fatal("edit changed pagination order")
	}
	w = assertBytes(t, s, item.ID, text)
	if w.Header().Get("ETag") == oldTag {
		t.Fatal("content edit kept old ETag")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+item.ID+"/download", nil, map[string]string{"Range": "bytes=1-4", "If-Range": oldTag}), 200)
	w = request(s, "GET", "/api/items/"+item.ID+"/download", nil, map[string]string{"Range": "bytes=1-4", "If-Range": w.Header().Get("ETag")})
	requireStatus(t, w, 206)
	if w.Body.String() != text[1:5] {
		t.Fatal("edited ranges changed bytes")
	}
	stale := jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"name": "lost.txt", "text": "lost", "pinned": false, "expectedUpdatedAt": item.UpdatedAt})
	requireStatus(t, stale, 409)
	if !strings.Contains(stale.Body.String(), "edit_conflict") {
		t.Fatal("missing conflict code")
	}
	if getItem(t, s, item.ID).Name != edited.Name {
		t.Fatal("stale mixed edit partially applied")
	}
	if len(sub.events) != 1 {
		t.Fatal("Save must emit one small event; conflict none")
	}
	e := <-sub.events
	if e != (event{"updated", item.ID}) {
		t.Fatal("unexpected edit event")
	}
	// An equal-length replacement must also switch the immutable content pointer.
	edited = saveEdit(t, s, edited, map[string]any{"text": strings.Repeat("x", len(text))})
	assertBytes(t, s, item.ID, strings.Repeat("x", len(text)))
	edited = saveEdit(t, s, edited, map[string]any{"text": ""})
	assertBytes(t, s, item.ID, "")
	if edited.Size != 0 || edited.Preview != "" {
		t.Fatal("empty edit retained old metadata")
	}
}

func TestEditValidationPinCompatibilityAndFileRename(t *testing.T) {
	cfg := testConfig(t)
	cfg.MaxTextBytes = 8
	s := openTest(t, cfg)
	item := postText(t, s, "old")
	path := "/api/items/" + item.ID
	cases := []struct {
		body   string
		status int
	}{
		{`{}`, 400}, {`null`, 400}, {`{"expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 400},
		{`{"text":"x"}`, 400}, {`{"name":"x","expectedUpdatedAt":"invalid"}`, 400},
		{`{"pinned":null}`, 400}, {`{"pinned":1}`, 400}, {`{"pinned":"true"}`, 400},
		{`{"pinned":true,"extra":1}`, 400}, {`{"pinned":true,"text":null}`, 400},
		{`{"pinned":true,"name":null}`, 400}, {`{"pinned":true,"expectedUpdatedAt":null}`, 400},
		{`{"text":123,"expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 400},
		{`{"text":"\ud800","expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 400},
		{"{\"text\":\"\xff\",\"expectedUpdatedAt\":\"" + item.UpdatedAt + "\"}", 400},
		{`{"text":"123456789","expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 413},
		{`{"name":"../bad","expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 400},
		{`{"name":"","expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 400},
		{`{"name":"bad\nname","expectedUpdatedAt":"` + item.UpdatedAt + `"}`, 400},
		{`{"pinned":true} ` + strings.Repeat(" ", 6*8+(16<<10)), 400},
	}
	for _, tc := range cases {
		w := request(s, "PATCH", path, strings.NewReader(tc.body), map[string]string{"Content-Type": "application/json"})
		if len(tc.body) > 6*8+(16<<10) {
			requireStatus(t, w, 413)
			continue
		}
		requireStatus(t, w, tc.status)
	}
	if getItem(t, s, item.ID).UpdatedAt != item.UpdatedAt {
		t.Fatal("invalid patch mutated entry")
	}
	encoded := `{"text":"` + strings.Repeat(`\u0000`, 9) + `","expectedUpdatedAt":"` + item.UpdatedAt + `"}`
	requireStatus(t, request(s, "PATCH", path, strings.NewReader(encoded), map[string]string{"Content-Type": "application/json"}), 413)
	// Legacy pins still work; even a clock rollback must advance the token.
	future := "2099-01-01T00:00:00.000000000Z"
	if _, err := s.db.Exec(`UPDATE items SET updated_at=? WHERE id=?`, future, item.ID); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, jsonRequest(s, "PATCH", path, map[string]bool{"pinned": true}), 200)
	item = getItem(t, s, item.ID)
	if item.UpdatedAt != "2099-01-01T00:00:00.000000001Z" || !item.Pinned {
		t.Fatal("pin timestamp not monotonic")
	}
	requireStatus(t, jsonRequest(s, "PATCH", path, map[string]any{"pinned": false, "expectedUpdatedAt": future}), 409)
	item = saveEdit(t, s, item, map[string]any{"text": "12345678"})
	assertBytes(t, s, item.ID, "12345678")
	loc, id := createUpload(t, s, 4, "code.go", "file", "text/x-go")
	pending := getItem(t, s, id)
	requireStatus(t, jsonRequest(s, "PATCH", "/api/items/"+id, map[string]any{"name": "x.go", "expectedUpdatedAt": pending.UpdatedAt}), 409)
	requireStatus(t, patch(s, loc, 0, strings.NewReader("code")), 204)
	file := getItem(t, s, id)
	requireStatus(t, jsonRequest(s, "PATCH", "/api/items/"+id, map[string]any{"name": "partial.go", "text": "no", "pinned": true, "expectedUpdatedAt": file.UpdatedAt}), 400)
	if getItem(t, s, id).Name != file.Name || getItem(t, s, id).Pinned {
		t.Fatal("invalid file edit partially applied")
	}
	tag := assertBytes(t, s, id, "code").Header().Get("ETag")
	file = saveEdit(t, s, file, map[string]any{"name": "renamed.go"})
	if assertBytes(t, s, id, "code").Header().Get("ETag") != tag {
		t.Fatal("rename changed content ETag")
	}
	w := request(s, "GET", "/api/items/"+id+"/text", nil, nil)
	requireStatus(t, w, 200)
	if w.Body.String() != "code" || w.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatal("file text preparation changed content")
	}
}

func TestEditedUploadsKeepOriginalTusLength(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	register(t, s, recipientID, "Recipient")
	loc, id := createUpload(t, s, 3, "original.txt", "text", "text/plain")
	requireStatus(t, patch(s, loc, 0, strings.NewReader("old")), 204)
	item := getItem(t, s, id)
	for _, text := range []string{"larger edited text", "x", ""} {
		item = saveEdit(t, s, item, map[string]any{"text": text})
		w := request(s, "HEAD", loc, nil, map[string]string{"Tus-Resumable": "1.0.0"})
		requireStatus(t, w, 200)
		if w.Header().Get("Upload-Length") != "3" || w.Header().Get("Upload-Offset") != "3" {
			t.Fatal("edit changed tus completion")
		}
		requireStatus(t, patch(s, loc, 3, strings.NewReader("")), 204)
		assertBytes(t, s, id, text)
		if len(arrivalIDs(t, s, recipientID)) != 1 {
			t.Fatal("edited completion duplicated arrival")
		}
		u := &upload{s, id}
		if _, err := u.WriteChunk(context.Background(), 0, strings.NewReader("x")); err == nil {
			t.Fatal("ready upload accepted new bytes")
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	assertBytes(t, s, id, "")
	w := request(s, "HEAD", loc, nil, map[string]string{"Tus-Resumable": "1.0.0"})
	requireStatus(t, w, 200)
	if w.Header().Get("Upload-Length") != "3" || w.Header().Get("Upload-Offset") != "3" {
		t.Fatal("restart lost original completion")
	}
	// An originally empty upload remains complete after growing by an edit.
	loc, id = createUpload(t, s, 0, "zero.txt", "text", "text/plain")
	item = saveEdit(t, s, getItem(t, s, id), map[string]any{"text": "grown"})
	w = request(s, "HEAD", loc, nil, map[string]string{"Tus-Resumable": "1.0.0"})
	requireStatus(t, w, 200)
	if w.Header().Get("Upload-Length") != "0" || w.Header().Get("Upload-Offset") != "0" {
		t.Fatal("zero-length protocol state changed")
	}
	requireStatus(t, patch(s, loc, 0, strings.NewReader("")), 204)
	assertBytes(t, s, item.ID, "grown")
}

func TestEditFaultsPreserveCommittedContent(t *testing.T) {
	for _, stage := range []string{"file_sync", "directory_sync", "sql_update", "commit_rejected", "commit_response", "cleanup"} {
		t.Run(stage, func(t *testing.T) {
			cfg := testConfig(t)
			s := openTest(t, cfg)
			item := postText(t, s, "last committed")
			old, err := s.get(item.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			sub := &subscriber{make(chan event, 4), make(chan struct{})}
			s.eventsBroker.subs[sub] = struct{}{}
			s.editFault = func(point string) error {
				if point == stage {
					return errors.New("injected durability failure")
				}
				return nil
			}
			if stage == "sql_update" {
				if _, err = s.db.Exec(`CREATE TRIGGER reject_edit BEFORE UPDATE OF blob_id ON items BEGIN SELECT RAISE(FAIL,'edit update failed'); END;`); err != nil {
					t.Fatal(err)
				}
			}
			if stage == "commit_rejected" {
				// This is a real SQLite COMMIT error, after the UPDATE succeeded.
				if _, err = s.db.Exec(`CREATE TABLE edit_commit_guard(id TEXT REFERENCES devices(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject_commit AFTER UPDATE OF blob_id ON items BEGIN INSERT INTO edit_commit_guard VALUES('absent'); END;`); err != nil {
					t.Fatal(err)
				}
			}
			w := jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"text": "new committed", "name": "new.md", "pinned": true, "expectedUpdatedAt": item.UpdatedAt})
			success := stage == "commit_response" || stage == "cleanup"
			if success {
				requireStatus(t, w, 200)
				assertBytes(t, s, item.ID, "new committed")
				if len(sub.events) != 1 {
					t.Fatal("committed Save missing event")
				}
			} else {
				requireStatus(t, w, 500)
				assertBytes(t, s, item.ID, "last committed")
				if current := getItem(t, s, item.ID); !reflect.DeepEqual(current, item) {
					t.Fatal("failed Save changed metadata")
				}
				if len(sub.events) != 0 {
					t.Fatal("failed Save emitted event")
				}
			}
			s.editFault = nil
			if stage == "commit_rejected" {
				var foreignKeys int
				if err = s.db.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil || foreignKeys != 1 {
					t.Fatal("reconnected DB lost foreign key enforcement")
				}
				if _, err = s.db.Exec(`DROP TRIGGER reject_commit`); err != nil {
					t.Fatal(err)
				}
			}
			if stage == "sql_update" {
				if _, err = s.db.Exec(`DROP TRIGGER reject_edit`); err != nil {
					t.Fatal(err)
				}
			}
			if stage == "cleanup" {
				if _, err = os.Stat(s.blob(old.BlobID)); err != nil {
					t.Fatal("cleanup fault did not retain old bytes")
				}
				used, err := s.usedBytes()
				if err != nil || used != int64(len("last committed")+len("new committed")) {
					t.Fatal("retired bytes not counted")
				}
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			s = openTest(t, cfg)
			want := "last committed"
			if success {
				want = "new committed"
			}
			assertBytes(t, s, item.ID, want)
			entries, err := os.ReadDir(filepath.Join(cfg.DataDir, "blobs"))
			if err != nil || len(entries) != 1 {
				t.Fatal("restart retained unreferenced edit blobs")
			}
		})
	}
}

func TestEditRecoveryAtDurableBoundaries(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(fmt.Sprint(committed), func(t *testing.T) {
			cfg := testConfig(t)
			s := openTest(t, cfg)
			item := postText(t, s, "old")
			old, err := s.get(item.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			id, err := newID()
			if err != nil {
				t.Fatal(err)
			}
			file, err := os.OpenFile(s.blob(id), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = io.WriteString(file, "new"); err != nil {
				t.Fatal(err)
			}
			if err = file.Sync(); err != nil {
				t.Fatal(err)
			}
			file.Close()
			if err = s.syncBlobs(); err != nil {
				t.Fatal(err)
			}
			if committed {
				next := old
				next.BlobID = id
				next.UpdatedAt, err = nextUpdated(old.UpdatedAt)
				if err != nil {
					t.Fatal(err)
				}
				hash := sha256.Sum256([]byte("new"))
				next.Checksum = hex.EncodeToString(hash[:])
				next.Preview = "new"
				if err = s.commitEdit(&next, old.UpdatedAt); err != nil {
					t.Fatal(err)
				}
			}
			// Leave precisely the durable files/row at a precommit or postcommit crash.
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			s = openTest(t, cfg)
			want := "old"
			retired := id
			if committed {
				want = "new"
				retired = old.BlobID
			}
			assertBytes(t, s, item.ID, want)
			if _, err = os.Stat(s.blob(retired)); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("recovery retained orphan")
			}
		})
	}
}

func TestEditBudgetIncludesFullReplacementPromisesAndRetiredBytes(t *testing.T) {
	cfg := testConfig(t)
	cfg.MaxStorageBytes = 100
	s := openTest(t, cfg)
	item := postText(t, s, strings.Repeat("a", 40))
	loc, id := createUpload(t, s, 40, "pending.bin", "file", "application/octet-stream")
	// Only 20 bytes are written, but the remaining 20 are still promised.
	requireStatus(t, patch(s, loc, 0, strings.NewReader(strings.Repeat("p", 20))), 204)
	requireStatus(t, jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"text": strings.Repeat("b", 21), "expectedUpdatedAt": item.UpdatedAt}), 507)
	assertBytes(t, s, item.ID, strings.Repeat("a", 40))
	orphan := strings.Repeat("e", 32)
	if err := os.WriteFile(s.blob(orphan), []byte("12345"), 0600); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"text": strings.Repeat("b", 16), "expectedUpdatedAt": item.UpdatedAt}), 507)
	item = saveEdit(t, s, item, map[string]any{"text": strings.Repeat("b", 15)})
	// Reservations also count retired/orphan bytes rather than max(sum,used).
	requireStatus(t, request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": "41", "Upload-Metadata": metadata("no.bin", "file", "application/octet-stream")}), 507)
	// Fresh free-space checks include unfinished promises as well as candidate.
	s.cfg.MaxStorageBytes = 0
	_, physicalID := createUpload(t, s, 32<<20, "physical.bin", "file", "application/octet-stream")
	free, err := s.freeBytes()
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.MinFreeBytes = free - (1 << 20)
	requireStatus(t, jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"text": "x", "expectedUpdatedAt": item.UpdatedAt}), 507)
	s.cfg.MinFreeBytes = 0
	requireStatus(t, request(s, "DELETE", "/api/items/"+physicalID, nil, nil), 204)
	requireStatus(t, request(s, "DELETE", "/api/items/"+id, nil, nil), 204)
	item = saveEdit(t, s, item, map[string]any{"text": ""})
	assertBytes(t, s, item.ID, "")
}

// Pause at the first HTTP write, after content opened its immutable descriptor.
type blockedContent struct {
	*httptest.ResponseRecorder
	entered, release chan struct{}
	once             sync.Once
}

func (w *blockedContent) WriteHeader(code int) {
	w.once.Do(func() { close(w.entered); <-w.release })
	w.ResponseRecorder.WriteHeader(code)
}
func (w *blockedContent) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.entered); <-w.release })
	return w.ResponseRecorder.Write(p)
}

func TestDownloadSnapshotSurvivesEditAndDelete(t *testing.T) {
	s := openTest(t, testConfig(t))
	item := postText(t, s, "old same length")
	w := &blockedContent{ResponseRecorder: httptest.NewRecorder(), entered: make(chan struct{}), release: make(chan struct{})}
	r := httptest.NewRequest("GET", "/api/items/"+item.ID+"/download", nil)
	r.Header.Set("Authorization", "Bearer "+testToken)
	done := make(chan struct{})
	go func() { s.Handler().ServeHTTP(w, r); close(done) }()
	<-w.entered
	item = saveEdit(t, s, item, map[string]any{"text": "new same length", "name": "new.md"})
	// Exercise the defensive tus reader with the same snapshot helper while locked.
	var reader io.ReadCloser
	if err := s.withItemLock(context.Background(), item.ID, func() (err error) { reader, err = (&upload{s, item.ID}).GetReader(context.Background()); return err }); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, request(s, "DELETE", "/api/items/"+item.ID, nil, nil), 204)
	close(w.release)
	<-done
	requireStatus(t, w.ResponseRecorder, 200)
	if w.Body.String() != "old same length" || !strings.Contains(w.Header().Get("Content-Disposition"), "Household") {
		t.Fatal("old HTTP reader mixed new bytes or metadata")
	}
	body, err := io.ReadAll(reader)
	reader.Close()
	if err != nil || string(body) != "new same length" {
		t.Fatal("opened tus reader failed after delete")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+item.ID+"/download", nil, nil), 404)
}

func TestConcurrentSaveAndDeleteSerialize(t *testing.T) {
	s := openTest(t, testConfig(t))
	item := postText(t, s, "base")
	start := make(chan struct{})
	statuses := make(chan int, 2)
	for _, text := range []string{"first", "second"} {
		go func(text string) {
			<-start
			statuses <- jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"text": text, "expectedUpdatedAt": item.UpdatedAt}).Code
		}(text)
	}
	close(start)
	a, b := <-statuses, <-statuses
	if !((a == 200 && b == 409) || (a == 409 && b == 200)) {
		t.Fatalf("concurrent saves: %d %d", a, b)
	}
	item = getItem(t, s, item.ID)
	start = make(chan struct{})
	statuses = make(chan int, 2)
	go func() {
		<-start
		statuses <- jsonRequest(s, "PATCH", "/api/items/"+item.ID, map[string]any{"text": "saved", "expectedUpdatedAt": item.UpdatedAt}).Code
	}()
	go func() { <-start; statuses <- request(s, "DELETE", "/api/items/"+item.ID, nil, nil).Code }()
	close(start)
	a, b = <-statuses, <-statuses
	if a != 204 && b != 204 {
		t.Fatal("delete lost")
	}
	if a != 200 && a != 204 && a != 404 {
		t.Fatal(a)
	}
	if b != 200 && b != 204 && b != 404 {
		t.Fatal(b)
	}
	entries, err := os.ReadDir(filepath.Join(s.cfg.DataDir, "blobs"))
	if err != nil || len(entries) != 0 {
		t.Fatal("concurrent delete orphaned committed edit")
	}
}

func TestTextDownloadFormats(t *testing.T) {
	s := openTest(t, testConfig(t))
	text := "# Markdown\r\n```go\n\tprintln(\"🏡\")\n```\r\n"
	item := postText(t, s, text)
	for _, bad := range []string{"format=", "format=pdf", "format=MD", "format=txt&format=md", "format=txt&format=txt", "format=%FF", "format=%ZZ"} {
		requireStatus(t, request(s, "GET", "/api/items/"+item.ID+"/download?"+bad, nil, nil), 400)
	}
	for _, name := range []string{"notes.txt", "notes.MD", "code.go", ".env", ".txt", "folderless 🏡.md", strings.Repeat("漢", 85)} {
		item = saveEdit(t, s, item, map[string]any{"name": name})
		ordinary := assertBytes(t, s, item.ID, text)
		for _, format := range []string{"txt", "md"} {
			path := "/api/items/" + item.ID + "/download?format=" + format
			w := request(s, "GET", path, nil, nil)
			requireStatus(t, w, 200)
			suggested := textFilename(name, format)
			if w.Body.String() != text || w.Header().Get("ETag") != ordinary.Header().Get("ETag") || w.Header().Get("Content-Length") != ordinary.Header().Get("Content-Length") || !strings.Contains(w.Header().Get("Content-Disposition"), "filename*=UTF-8''"+url.PathEscape(suggested)) || safeLabel(suggested, 255, true) != nil || !strings.HasSuffix(suggested, "."+format) {
				t.Fatal("format changed bytes or produced invalid filename")
			}
			w = request(s, "HEAD", path, nil, nil)
			requireStatus(t, w, 200)
			if w.Body.Len() != 0 || w.Header().Get("Content-Length") != strconv.Itoa(len(text)) {
				t.Fatal("format HEAD wrong")
			}
			w = request(s, "GET", path, nil, map[string]string{"Range": "bytes=1-4", "If-Range": ordinary.Header().Get("ETag")})
			requireStatus(t, w, 206)
			if w.Body.String() != text[1:5] {
				t.Fatal("format range wrong")
			}
		}
	}
	if textFilename("code.go", "md") != "code.md" || textFilename("notes.txt", "md") != "notes.md" || textFilename(".env", "txt") != ".env.txt" || textFilename(".txt", "md") != ".txt.md" || textFilename(".env.local", "txt") != ".env.txt" || textFilename("", "md") != "Shared text.md" {
		t.Fatal("suffix rules changed")
	}
	loc, id := createUpload(t, s, 3, "file.md", "file", "text/markdown")
	requireStatus(t, patch(s, loc, 0, strings.NewReader("abc")), 204)
	assertBytes(t, s, id, "abc")
	for _, format := range []string{"txt", "md"} {
		w := request(s, "GET", "/api/items/"+id+"/download?format="+format, nil, nil)
		requireStatus(t, w, 404)
		if !strings.Contains(w.Body.String(), `"code":"not_text"`) {
			t.Fatal("file gained a text export")
		}
	}
}

func TestSchemaV2ContentPointerMigrationAndRollback(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			cfg := testConfig(t)
			s := openTest(t, cfg)
			register(t, s, recipientID, "Recipient")
			loc, id := createUpload(t, s, 3, "legacy.txt", "text", "text/plain")
			requireStatus(t, patch(s, loc, 0, strings.NewReader("old")), 204)
			page := arrivals(t, s, recipientID, "?after=0")
			ack(t, s, recipientID, page.NextCursor)
			// Simulate a real v2 database, retaining device/arrival state and blobs.
			if _, err := s.db.Exec(`ALTER TABLE items DROP COLUMN blob_id; ALTER TABLE items DROP COLUMN upload_length; PRAGMA user_version=2;`); err != nil {
				t.Fatal(err)
			}
			if fail {
				if _, err := s.db.Exec(`ALTER TABLE items ADD COLUMN upload_length INTEGER NOT NULL DEFAULT 0`); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			if fail {
				if broken, err := Open(cfg); err == nil {
					broken.Close()
					t.Fatal("conflicting schema migrated")
				}
				db, err := sql.Open("sqlite", filepath.Join(cfg.DataDir, "metadata.sqlite"))
				if err != nil {
					t.Fatal(err)
				}
				var version, count int
				if err = db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 2 {
					t.Fatal("v2 rollback version changed")
				}
				if err = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('items') WHERE name='blob_id'`).Scan(&count); err != nil || count != 0 {
					t.Fatal("v2 rollback left pointer column")
				}
				if _, err = db.Exec(`ALTER TABLE items DROP COLUMN upload_length`); err != nil {
					t.Fatal(err)
				}
				db.Close()
			}
			s = openTest(t, cfg)
			row, err := s.get(id, false)
			if err != nil || row.BlobID != id || row.UploadLength != 3 {
				t.Fatal("legacy pointer/length not migrated")
			}
			assertBytes(t, s, id, "old")
			if got := arrivals(t, s, recipientID, "?after=0"); len(got.Notifications) != 1 || got.NextCursor != page.NextCursor || got.AckCursor != page.NextCursor {
				t.Fatal("migration changed arrival sequence/ACK")
			}
			item := saveEdit(t, s, row.Item, map[string]any{"text": "new longer"})
			assertBytes(t, s, item.ID, "new longer")
		})
	}
}

func TestEditDuringCompletionAndOversizeStoredText(t *testing.T) {
	cfg := testConfig(t)
	cfg.MaxTextBytes = 4
	s := openTest(t, cfg)
	loc, id := createUpload(t, s, 8, "large.txt", "text", "text/plain")
	pending := getItem(t, s, id)
	start := make(chan struct{})
	statuses := make(chan int, 2)
	go func() { <-start; statuses <- patch(s, loc, 0, strings.NewReader("12345678")).Code }()
	go func() {
		<-start
		statuses <- jsonRequest(s, "PATCH", "/api/items/"+id, map[string]any{"text": "new", "expectedUpdatedAt": pending.UpdatedAt}).Code
	}()
	close(start)
	a, b := <-statuses, <-statuses
	if !((a == 204 && b == 409) || (a == 409 && b == 204)) {
		t.Fatalf("edit/completion raced: %d %d", a, b)
	}
	item := getItem(t, s, id)
	item = saveEdit(t, s, item, map[string]any{"name": "large.md"})
	assertBytes(t, s, id, "12345678")
	requireStatus(t, jsonRequest(s, "PATCH", "/api/items/"+id, map[string]any{"text": "12345", "expectedUpdatedAt": item.UpdatedAt}), 413)
	item = saveEdit(t, s, item, map[string]any{"text": "🏡"})
	assertBytes(t, s, item.ID, "🏡")
}

func TestEditStreamingRequestLimitAndCancellation(t *testing.T) {
	cfg := testConfig(t)
	cfg.MaxTextBytes = 8
	s := openTest(t, cfg)
	item := postText(t, s, "old")
	path := "/api/items/" + item.ID
	// No Content-Length: also enforce the bound while checking trailing JSON.
	r := httptest.NewRequest("PATCH", path, strings.NewReader(`{"pinned":true}`+strings.Repeat(" ", 6*8+(16<<10))))
	r.ContentLength = -1
	r.Header.Set("Authorization", "Bearer "+testToken)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 413)
	if getItem(t, s, item.ID).UpdatedAt != item.UpdatedAt {
		t.Fatal("oversize streaming request mutated entry")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	row, err := s.get(item.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.replaceText(ctx, &row, item.UpdatedAt, "new"); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled edit proceeded", err)
	}
	assertBytes(t, s, item.ID, "old")
	entries, err := os.ReadDir(filepath.Join(cfg.DataDir, "blobs"))
	if err != nil || len(entries) != 1 {
		t.Fatal("cancelled edit leaked candidate")
	}
}
