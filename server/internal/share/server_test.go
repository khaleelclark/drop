package share

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

const testToken = "test-household-token-123456789"

func testConfig(t *testing.T) Config {
	t.Helper()
	cfg := DefaultConfig()
	cfg.DataDir = t.TempDir()
	cfg.Origin = "https://household.test"
	cfg.Token = testToken
	cfg.MinFreeBytes = 0
	cfg.UploadTTL = 0
	return cfg
}
func openTest(t *testing.T, cfg Config) *Server {
	t.Helper()
	s, err := Open(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	return s
}
func request(s *Server, method, path string, body io.Reader, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, body)
	r.Header.Set("Authorization", "Bearer "+testToken)
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func requireStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d want %d: %s", w.Code, status, w.Body.String())
	}
}
func metadata(name, kind, typ string) string {
	encode := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	return "filename " + encode(name) + ",kind " + encode(kind) + ",filetype " + encode(typ)
}
func createUpload(t *testing.T, s *Server, size int64, name, kind, typ string) (string, string) {
	t.Helper()
	w := request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": strconv.FormatInt(size, 10), "Upload-Metadata": metadata(name, kind, typ)})
	requireStatus(t, w, 201)
	location, id := w.Header().Get("Location"), w.Header().Get("X-Item-ID")
	if location != "/api/uploads/"+id || !validID.MatchString(id) || w.Header().Get("Upload-Offset") != "0" {
		t.Fatalf("bad creation headers: %v", w.Header())
	}
	return location, id
}
func patch(s *Server, location string, offset int64, body io.Reader) *httptest.ResponseRecorder {
	return request(s, "PATCH", location, body, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Offset": strconv.FormatInt(offset, 10), "Content-Type": "application/offset+octet-stream"})
}
func getItem(t *testing.T, s *Server, id string) Item {
	t.Helper()
	w := request(s, "GET", "/api/items/"+id, nil, nil)
	requireStatus(t, w, 200)
	var body struct {
		Item Item `json:"item"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Item
}
func postText(t *testing.T, s *Server, text string) Item {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"text": text, "name": "Household 🏡.txt"})
	w := request(s, "POST", "/api/text", bytes.NewReader(body), map[string]string{"Content-Type": "application/json"})
	requireStatus(t, w, 201)
	var response struct {
		Item Item `json:"item"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Item
}

func TestSecurityBoundary(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	for _, path := range []string{"/api/items", "/api/storage", "/api/events", "/api/uploads/", "/api/items/" + strings.Repeat("a", 32) + "/download"} {
		r := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		requireStatus(t, w, 401)
	}
	r := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 200)
	w = request(s, "POST", "/api/text", strings.NewReader(`{"text":"bad"}`), map[string]string{"Content-Type": "application/json", "Origin": "https://evil.test"})
	requireStatus(t, w, 403)
	// Bearer native requests without Origin are allowed; an untrusted Origin
	// cannot bypass the check merely by adding a bearer token.
	item := postText(t, s, "inert <script>alert(1)</script>\n")
	for _, origin := range []string{"", "https://evil.test"} {
		r = httptest.NewRequest("POST", "/api/session", strings.NewReader(`{"token":"`+testToken+`"}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		w = httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		requireStatus(t, w, 403)
	}
	r = httptest.NewRequest("POST", "/api/session", strings.NewReader(`{"token":"`+testToken+`"}`))
	r.Header.Set("Origin", cfg.Origin)
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 204)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].MaxAge != 30*24*60*60 || cookies[0].Path != "/api" {
		t.Fatalf("unsafe cookie: %v", cookies)
	}
	r = httptest.NewRequest("GET", "/api/items/"+item.ID+"/text", nil)
	r.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 200)
	if w.Header().Get("Content-Type") != "text/plain; charset=utf-8" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("text not served inertly")
	}
	r = httptest.NewRequest("DELETE", "/api/items/"+item.ID, nil)
	r.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 403)
	r.Header.Set("Origin", cfg.Origin)
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 204)
	for _, addr := range []string{"0.0.0.0:8787", ":8787", "[::]:8787", "localhost:8787"} {
		bad := cfg
		bad.Addr = addr
		if bad.Validate() == nil {
			t.Fatalf("accepted bind %s", addr)
		}
	}
	bad := cfg
	bad.Token = ""
	if bad.Validate() == nil {
		t.Fatal("accepted missing production token")
	}
	if _, err := Open(cfg); err == nil {
		t.Fatal("allowed concurrent process/store open")
	}
}

func TestStaticCSPAllowsWasmWithoutJavaScriptEval(t *testing.T) {
	cfg := testConfig(t)
	cfg.WebDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(cfg.WebDir, "index.html"), []byte("<!doctype html><title>Household</title>"), 0600); err != nil {
		t.Fatal(err)
	}
	s := openTest(t, cfg)
	for _, path := range []string{"/", "/api/health"} {
		w := request(s, "GET", path, nil, nil)
		requireStatus(t, w, 200)
		directives := map[string][]string{}
		for _, part := range strings.Split(w.Header().Get("Content-Security-Policy"), ";") {
			fields := strings.Fields(part)
			if len(fields) > 0 {
				directives[fields[0]] = fields[1:]
			}
		}
		want := "'self'"
		if path == "/" {
			want += " 'wasm-unsafe-eval'"
		}
		if got := strings.Join(directives["script-src"], " "); got != want {
			t.Fatalf("%s script policy = %q, want %q", path, got, want)
		}
		for _, values := range directives {
			for _, value := range values {
				if value == "'unsafe-eval'" || value == "'unsafe-inline'" || value == "*" {
					t.Fatalf("broad CSP exception %q", value)
				}
			}
		}
		if strings.Join(directives["connect-src"], " ") != "'self'" || strings.Join(directives["object-src"], " ") != "'none'" {
			t.Fatal("unrelated CSP protections changed")
		}
	}
}

func TestTextPreservedAndBounded(t *testing.T) {
	s := openTest(t, testConfig(t))
	text := "  \t" + strings.Repeat("🏡漢字é\r\n", 220000) + "\n<script>inert</script>\x00end\n"
	item := postText(t, s, text)
	if item.Size != int64(len(text)) || item.Status != "ready" || utf8.RuneCountInString(item.Preview) != 512 {
		t.Fatal("bad text metadata")
	}
	w := request(s, "GET", "/api/items/"+item.ID+"/text", nil, nil)
	requireStatus(t, w, 200)
	if w.Body.String() != text {
		t.Fatal("stored text changed")
	}
	w = request(s, "GET", "/api/items", nil, nil)
	requireStatus(t, w, 200)
	if w.Body.Len() > 10000 || bytes.Contains(w.Body.Bytes(), []byte("inert</script>")) {
		t.Fatal("full text leaked into feed")
	}
	w = request(s, "GET", "/api/items/"+item.ID+"/download", nil, nil)
	requireStatus(t, w, 200)
	if !strings.Contains(w.Header().Get("Content-Disposition"), "filename*=UTF-8''") {
		t.Fatal("missing Unicode filename")
	}
	if w.Body.String() != text {
		t.Fatal("download changed text")
	}
	for _, body := range []string{`{"text":"\ud800"}`, `{"text":"\udc00"}`, "{\"text\":\"\xff\"}", `{"text":null}`, `{}`} {
		w = request(s, "POST", "/api/text", strings.NewReader(body), map[string]string{"Content-Type": "application/json"})
		requireStatus(t, w, 400)
	}
	postText(t, s, "emoji \U0001f600 and escaped / and \\")
	cfg := testConfig(t)
	cfg.MaxTextBytes = 5
	small := openTest(t, cfg)
	w = request(small, "POST", "/api/text", strings.NewReader(`{"text":"123456"}`), map[string]string{"Content-Type": "application/json"})
	requireStatus(t, w, 413)
	postText(t, small, "🏡a") // five UTF-8 bytes, not five runes
}

func TestUploadResumeRestartRangeIntegrity(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	content := []byte("0123456789\x00\xff household bytes \n")
	location, id := createUpload(t, s, int64(len(content)), "family.bin", "file", "application/octet-stream")
	if getItem(t, s, id).Status != "uploading" {
		t.Fatal("new upload unexpectedly ready")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+id+"/download", nil, nil), 409)
	w := patch(s, location, 0, bytes.NewReader(content[:7]))
	requireStatus(t, w, 204)
	if w.Header().Get("Upload-Offset") != "7" {
		t.Fatal("wrong confirmed offset")
	}
	requireStatus(t, patch(s, location, 0, bytes.NewReader(content[7:])), 409)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	w = request(s, "HEAD", location, nil, map[string]string{"Tus-Resumable": "1.0.0"})
	requireStatus(t, w, 200)
	if w.Header().Get("Upload-Offset") != "7" {
		t.Fatal("restart lost offset")
	}
	requireStatus(t, patch(s, location, 7, bytes.NewReader(content[7:])), 204)
	if getItem(t, s, id).Status != "ready" {
		t.Fatal("upload never ready")
	}
	w = request(s, "GET", "/api/items/"+id+"/download", nil, nil)
	requireStatus(t, w, 200)
	if !bytes.Equal(w.Body.Bytes(), content) {
		t.Fatal("download byte mismatch")
	}
	digest := sha256.Sum256(content)
	if w.Header().Get("ETag") != `"sha256-`+hex.EncodeToString(digest[:])+`"` {
		t.Fatal("bad checksum ETag")
	}
	w = request(s, "HEAD", "/api/items/"+id+"/download", nil, nil)
	requireStatus(t, w, 200)
	if w.Body.Len() != 0 || w.Header().Get("Content-Length") != strconv.Itoa(len(content)) {
		t.Fatal("bad HEAD")
	}
	w = request(s, "GET", "/api/items/"+id+"/download", nil, map[string]string{"Range": "bytes=3-10"})
	requireStatus(t, w, 206)
	if !bytes.Equal(w.Body.Bytes(), content[3:11]) {
		t.Fatal("bad range bytes")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+id+"/download", nil, map[string]string{"Range": "bytes=9999-"}), 416)
	requireStatus(t, request(s, "GET", location, nil, nil), 405)
	requireStatus(t, request(s, "DELETE", location, nil, map[string]string{"Tus-Resumable": "1.0.0"}), 409)
	requireStatus(t, request(s, "DELETE", "/api/items/"+id, nil, nil), 204)
	requireStatus(t, request(s, "HEAD", location, nil, nil), 404)
	if _, err := os.Stat(s.blob(id)); !os.IsNotExist(err) {
		t.Fatal("deleted blob remains")
	}
}

func TestUploadValidationRecoveryAndCleanup(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	for _, name := range []string{"../escape", "a/b", "a\\b", "bad\r\nname", ".."} {
		w := request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": "3", "Upload-Metadata": metadata(name, "file", "application/octet-stream")})
		requireStatus(t, w, 400)
	}
	location, invalidID := createUpload(t, s, 2, "invalid.txt", "text", "text/plain")
	requireStatus(t, patch(s, location, 0, bytes.NewReader([]byte{0xff, 0xfe})), 422)
	if getItem(t, s, invalidID).Status != "failed" {
		t.Fatal("invalid text published")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+invalidID+"/download", nil, nil), 409)
	// The multi-byte rune straddles the validator's 128 KiB block boundary.
	text := strings.Repeat("a", (128<<10)-1) + "🏡" + strings.Repeat("漢", 100)
	location, validID := createUpload(t, s, int64(len(text)), "valid.txt", "text", "text/plain; charset=utf-8")
	requireStatus(t, patch(s, location, 0, strings.NewReader(text)), 204)
	if getItem(t, s, validID).Status != "ready" {
		t.Fatal("split UTF-8 rune rejected")
	}
	_, pendingID := createUpload(t, s, 4, "pending.bin", "file", "application/octet-stream")
	// Model a crash after synced last bytes and before the metadata transition.
	if err := os.WriteFile(s.blob(pendingID), []byte("done"), 0600); err != nil {
		t.Fatal(err)
	}
	_, incompleteID := createUpload(t, s, 9, "incomplete.bin", "file", "application/octet-stream")
	_, emptyID := createUpload(t, s, 0, "empty.bin", "file", "application/octet-stream")
	if getItem(t, s, emptyID).Status != "ready" {
		t.Fatal("empty upload not ready")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	if getItem(t, s, pendingID).Status != "ready" || getItem(t, s, incompleteID).Status != "uploading" {
		t.Fatal("bad recovery state")
	}
	s.cfg.UploadTTL = time.Hour
	if err := s.Cleanup(time.Now().Add(2 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{invalidID, incompleteID} {
		requireStatus(t, request(s, "GET", "/api/items/"+id, nil, nil), 404)
	}
	if getItem(t, s, pendingID).Status != "ready" {
		t.Fatal("cleanup expired ready item")
	}
}

func TestFinalizationRetryWithoutServerRestart(t *testing.T) {
	for _, method := range []string{"HEAD", "PATCH"} {
		t.Run(method, func(t *testing.T) {
			s := openTest(t, testConfig(t))
			content := []byte("complete bytes survive a transient ready transition failure")
			location, id := createUpload(t, s, int64(len(content)), "recoverable.bin", "file", "application/octet-stream")
			// Fail only the final metadata transition after WriteChunk has synced
			// all bytes. Dropping the trigger clears the temporary fault while
			// keeping the same Server, database connection, and upload resource.
			_, err := s.db.Exec(`CREATE TRIGGER inject_ready_failure BEFORE UPDATE OF status ON items
			WHEN NEW.status='ready' BEGIN SELECT RAISE(FAIL,'injected temporary ready failure'); END`)
			if err != nil {
				t.Fatal(err)
			}
			requireStatus(t, patch(s, location, 0, bytes.NewReader(content)), 500)
			if getItem(t, s, id).Status != "uploading" {
				t.Fatal("transient failure lost pending state")
			}
			requireStatus(t, request(s, "GET", "/api/items/"+id+"/download", nil, nil), 409)
			stat, err := os.Stat(s.blob(id))
			if err != nil || stat.Size() != int64(len(content)) {
				t.Fatal("final bytes were not preserved")
			}
			if _, err = s.db.Exec(`DROP TRIGGER inject_ready_failure`); err != nil {
				t.Fatal(err)
			}
			if method == "HEAD" {
				w := request(s, method, location, nil, map[string]string{"Tus-Resumable": "1.0.0"})
				requireStatus(t, w, 200)
				if w.Header().Get("Upload-Offset") != strconv.Itoa(len(content)) {
					t.Fatal("HEAD lost final offset")
				}
			} else {
				requireStatus(t, patch(s, location, int64(len(content)), nil), 204)
			}
			if getItem(t, s, id).Status != "ready" {
				t.Fatal("retry did not finish pending validation")
			}
			w := request(s, "GET", "/api/items/"+id+"/download", nil, nil)
			requireStatus(t, w, 200)
			if !bytes.Equal(w.Body.Bytes(), content) {
				t.Fatal("recovery changed stored bytes")
			}
		})
	}
}

func TestReservationBudgetAndFeedPagination(t *testing.T) {
	cfg := testConfig(t)
	cfg.MaxStorageBytes = 100
	cfg.MaxFileBytes = 100
	s := openTest(t, cfg)
	var wg sync.WaitGroup
	statuses := make(chan int, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": "20", "Upload-Metadata": metadata("budget.bin", "file", "application/octet-stream")})
			statuses <- w.Code
		}()
	}
	wg.Wait()
	close(statuses)
	accepted := 0
	for status := range statuses {
		if status == 201 {
			accepted++
		} else if status != 507 {
			t.Fatalf("unexpected status %d", status)
		}
	}
	if accepted != 5 {
		t.Fatalf("accepted %d reservations, want 5", accepted)
	}
	// Deliberately tie timestamps: pagination must use both timestamp and ID.
	if _, err := s.db.Exec(`UPDATE items SET created_at=?`, now()); err != nil {
		t.Fatal(err)
	}
	w := request(s, "GET", "/api/storage", nil, nil)
	requireStatus(t, w, 200)
	var storage storageInfo
	if err := json.Unmarshal(w.Body.Bytes(), &storage); err != nil {
		t.Fatal(err)
	}
	if storage.UsedBytes != 0 || storage.MaxStorageBytes == nil || *storage.MaxStorageBytes != 100 {
		t.Fatal("incorrect accounting")
	}
	seen := map[string]bool{}
	path := "/api/items?limit=2"
	for {
		w = request(s, "GET", path, nil, nil)
		requireStatus(t, w, 200)
		var page struct {
			Items      []Item  `json:"items"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatal("duplicate page item")
			}
			seen[item.ID] = true
		}
		if page.NextCursor == nil {
			break
		}
		path = "/api/items?limit=2&before=" + *page.NextCursor
	}
	if len(seen) != 5 {
		t.Fatal("pagination lost an item")
	}
	requireStatus(t, request(s, "GET", "/api/items?before=not-a-valid-cursor", nil, nil), 400)
}

func TestBoundedEvents(t *testing.T) {
	s := openTest(t, testConfig(t))
	sub := &subscriber{make(chan event, 32), make(chan struct{})}
	s.eventsBroker.subs[sub] = struct{}{}
	for i := 0; i < 33; i++ {
		s.eventsBroker.publish("updated", strings.Repeat("a", 32))
	}
	select {
	case <-sub.overflow:
	default:
		t.Fatal("slow subscriber was not disconnected")
	}
	if len(s.eventsBroker.subs) != 0 {
		t.Fatal("overflowed subscriber retained")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/events", nil)
	r.Header.Set("Authorization", "Bearer "+testToken)
	response, err := server.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	buf := make([]byte, len(": connected; refresh feed\n\n"))
	if _, err = io.ReadFull(response.Body, buf); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(buf), ": connected") {
		t.Fatal("missing connection heartbeat")
	}
}

type patternReader struct{ offset int64 }

func (r *patternReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte((r.offset + int64(i)) * 31 % 251)
	}
	r.offset += int64(len(p))
	return len(p), nil
}

// Default is a small streamed integration test. Set the environment variable to
// 21474836480 explicitly to exercise 20 GiB on a disk with sufficient capacity.
// It never creates a whole-file []byte on either side of the HTTP connection.
func TestStreamedTransfer(t *testing.T) {
	var size int64 = 9 << 20
	if raw := os.Getenv("HOUSEHOLD_TEST_LARGE_BYTES"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			t.Fatal("invalid HOUSEHOLD_TEST_LARGE_BYTES")
		}
		size = n
	}
	cfg := testConfig(t)
	cfg.MaxFileBytes = max(cfg.MaxFileBytes, size)
	s := openTest(t, cfg)
	location, id := createUpload(t, s, size, "streamed.bin", "file", "application/octet-stream")
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	source := &patternReader{}
	sent := sha256.New()
	for offset := int64(0); offset < size; {
		length := min(int64(8<<20), size-offset)
		r, err := http.NewRequest("PATCH", server.URL+location, io.TeeReader(io.LimitReader(source, length), sent))
		if err != nil {
			t.Fatal(err)
		}
		r.ContentLength = length
		r.Header.Set("Authorization", "Bearer "+testToken)
		r.Header.Set("Tus-Resumable", "1.0.0")
		r.Header.Set("Content-Type", "application/offset+octet-stream")
		r.Header.Set("Upload-Offset", strconv.FormatInt(offset, 10))
		resp, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode != 204 {
			t.Fatalf("patch %d: %s", resp.StatusCode, body)
		}
		offset += length
	}
	r, _ := http.NewRequest("GET", server.URL+"/api/items/"+id+"/download", nil)
	r.Header.Set("Authorization", "Bearer "+testToken)
	resp, err := server.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.Status)
	}
	received := sha256.New()
	n, err := io.CopyBuffer(received, resp.Body, make([]byte, 128<<10))
	if err != nil {
		t.Fatal(err)
	}
	if n != size || !bytes.Equal(sent.Sum(nil), received.Sum(nil)) {
		t.Fatal("streamed byte integrity failed")
	}
	t.Logf("streamed upload + download verified: %d bytes, SHA-256 %s", n, fmt.Sprintf("%x", received.Sum(nil)))
}
