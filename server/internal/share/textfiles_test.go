package share

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestTextFileClassificationFixture(t *testing.T) {
	data, err := os.ReadFile("../../../clients/shared/text-file-fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version          int      `json:"version"`
		ApplicationTypes []string `json:"applicationTypes"`
		Extensions       []string `json:"extensions"`
		Cases            []struct {
			Name, MIMEType string
			Candidate      bool
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Version != 1 || !reflect.DeepEqual(fixture.ApplicationTypes, strings.Fields(textFileApplicationTypes)) || !reflect.DeepEqual(fixture.Extensions, strings.Fields(textFileExtensions)) || len(fixture.Cases) != 10 {
		t.Fatal("server classification differs from the shared fixture")
	}
	s := openTest(t, testConfig(t))
	for _, tc := range fixture.Cases {
		if textFileCandidate(tc.Name, tc.MIMEType) != tc.Candidate {
			t.Errorf("classification differs for %q %q", tc.Name, tc.MIMEType)
		}
		w := request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": "0", "Upload-Metadata": metadata(tc.Name, "text", tc.MIMEType)})
		if tc.Candidate {
			requireStatus(t, w, 201)
			item := getItem(t, s, w.Header().Get("X-Item-ID"))
			if item.Kind != "text" || item.Status != "ready" || item.Size != 0 {
				t.Fatal("eligible empty text upload did not become ready")
			}
		} else {
			requireStatus(t, w, 400)
			if !strings.Contains(w.Body.String(), `"code":"upload_error"`) {
				t.Fatal("ineligible text upload did not fail metadata validation")
			}
		}
	}
	for _, typ := range fixture.ApplicationTypes {
		if !textFileCandidate("no-suffix", strings.ToUpper(typ)) {
			t.Errorf("unsupported application type %q", typ)
		}
	}
	for _, ext := range fixture.Extensions {
		if !textFileCandidate("source."+strings.ToUpper(ext), "application/octet-stream") {
			t.Errorf("unsupported extension %q", ext)
		}
	}
	for _, typ := range []string{"text/plain; charset=utf-16", "application/json; charset=latin1", "text/plain; charset=\"\"", "text/plain; charset=utf-8; charset=latin1", "not a mime type"} {
		if textFileCandidate("file.md", typ) {
			t.Errorf("accepted invalid/unsupported charset %q", typ)
		}
		requireStatus(t, request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": "0", "Upload-Metadata": metadata("file.md", "text", typ)}), 400)
	}
	for _, typ := range []string{"text/plain", "text/x-custom; charset=utf-8", "application/json; charset=\"UTF-8\""} {
		if !textFileCandidate("no-suffix", typ) {
			t.Errorf("rejected supported MIME hint %q", typ)
		}
	}
}

func TestMarkdownTextUploadEditHTTP(t *testing.T) {
	s := openTest(t, testConfig(t))
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	do := func(method, path, body string, headers map[string]string, status int) (*http.Response, string) {
		t.Helper()
		r, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Authorization", "Bearer "+testToken)
		for key, value := range headers {
			r.Header.Set(key, value)
		}
		response, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != status {
			t.Fatalf("%s %s: status=%d want=%d body=%q err=%v", method, path, response.StatusCode, status, data, err)
		}
		return response, string(data)
	}
	original := "\ufeff# Markdown\r\n```go\n\tprintln(\"🏡\")\n```\r\n"
	response, _ := do("POST", "/api/uploads/", "", map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": strconv.Itoa(len(original)), "Upload-Metadata": metadata("note.md", "text", "text/markdown; charset=UTF-8")}, 201)
	location, id := response.Header.Get("Location"), response.Header.Get("X-Item-ID")
	do("PATCH", location, original, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream"}, 204)
	_, body := do("GET", "/api/items/"+id, "", nil, 200)
	var result struct{ Item Item }
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatal(err)
	}
	if result.Item.Kind != "text" || result.Item.Name != "note.md" || result.Item.MIMEType != "text/markdown; charset=UTF-8" || result.Item.Status != "ready" || result.Item.Size != int64(len(original)) {
		t.Fatal("Markdown text upload did not preserve its metadata")
	}
	_, body = do("GET", "/api/items/"+id+"/text", "", nil, 200)
	if body != original {
		t.Fatal("Markdown text upload changed original bytes")
	}
	edited := "# Saved\r\n\tcode <script>inert</script> 漢🏡\r\n"
	data, err := json.Marshal(map[string]string{"text": edited, "expectedUpdatedAt": result.Item.UpdatedAt})
	if err != nil {
		t.Fatal(err)
	}
	do("PATCH", "/api/items/"+id, string(data), map[string]string{"Content-Type": "application/json"}, 200)
	for _, format := range []string{"txt", "md"} {
		path := "/api/items/" + id + "/download?format=" + format
		response, body = do("GET", path, "", nil, 200)
		if body != edited || response.ContentLength != int64(len(edited)) || !strings.Contains(response.Header.Get("Content-Disposition"), "filename*=UTF-8''note."+format) {
			t.Fatal("edited Markdown export changed bytes, length or suggestion")
		}
		tag := response.Header.Get("ETag")
		response, body = do("HEAD", path, "", nil, 200)
		if body != "" || response.ContentLength != int64(len(edited)) || response.Header.Get("ETag") != tag {
			t.Fatal("edited Markdown download HEAD differs from GET")
		}
	}
	response, _ = do("HEAD", location, "", map[string]string{"Tus-Resumable": "1.0.0"}, 200)
	if response.Header.Get("Upload-Length") != strconv.Itoa(len(original)) || response.Header.Get("Upload-Offset") != strconv.Itoa(len(original)) {
		t.Fatal("Markdown edit changed original tus completion")
	}
	do("PATCH", location, "", map[string]string{"Tus-Resumable": "1.0.0", "Upload-Offset": strconv.Itoa(len(original)), "Content-Type": "application/offset+octet-stream"}, 204)
	_, body = do("GET", "/api/items/"+id+"/text", "", nil, 200)
	if body != edited {
		t.Fatal("tus completion retry replaced saved Markdown")
	}
	invalid := strings.Repeat("private prefix", 12000) + "\xff"
	response, _ = do("POST", "/api/uploads/", "", map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": strconv.Itoa(len(invalid)), "Upload-Metadata": metadata("masquerade.md", "file", "text/markdown")}, 201)
	location, id = response.Header.Get("Location"), response.Header.Get("X-Item-ID")
	do("PATCH", location, invalid, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream"}, 204)
	response, body = do("GET", "/api/items/"+id+"/text", "", nil, 415)
	if response.Header.Get("Content-Type") != "application/json; charset=utf-8" || !strings.Contains(body, `"code":"not_text"`) || strings.Contains(body, "private prefix") {
		t.Fatal("invalid file preparation sent bytes before full validation")
	}
	_, body = do("GET", "/api/items/"+id+"/download", "", nil, 200)
	if body != invalid {
		t.Fatal("rejected file preparation changed its ordinary download")
	}
}

func TestTextCandidateUploadValidation(t *testing.T) {
	cfg := testConfig(t)
	cfg.MaxTextBytes = 16
	s := openTest(t, cfg)
	for _, tc := range []struct {
		name, typ, body string
		status          int
	}{
		{"large.md", "text/markdown", strings.Repeat("a", textFileLimit+1), 204},
		{"source.rs", "application/octet-stream", "\x00\x01\u0085\t\r\n", 204},
		{"invalid.md", "text/markdown", strings.Repeat("a", (128<<10)+1) + "\xff", 422},
		{"truncated.rs", "application/octet-stream", "prefix\xf0\x9f", 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			location, id := createUpload(t, s, int64(len(tc.body)), tc.name, "text", tc.typ)
			requireStatus(t, patch(s, location, 0, strings.NewReader(tc.body)), tc.status)
			if tc.status == 204 {
				if getItem(t, s, id).Status != "ready" {
					t.Fatal("valid text candidate did not become ready")
				}
				w := request(s, "GET", "/api/items/"+id+"/text", nil, nil)
				requireStatus(t, w, 200)
				if w.Body.String() != tc.body {
					t.Fatal("kind=text preparation limit or normalization changed its bytes")
				}
			} else {
				if getItem(t, s, id).Status != "failed" {
					t.Fatal("invalid UTF-8 text candidate became ready")
				}
				requireStatus(t, request(s, "GET", "/api/items/"+id+"/download", nil, nil), 409)
			}
		})
	}
}

func TestTextFilePreparation(t *testing.T) {
	s := openTest(t, testConfig(t))
	for _, tc := range []struct {
		name, filename, typ, body string
		status                    int
		code                      string
	}{
		{"exact text", "file.md", "application/octet-stream", "\ufeff# Markdown\r\n```go\n\tprintln(\"🏡\")\n```\r\n", 200, ""},
		{"empty", "empty.txt", "text/plain", "", 200, ""},
		{"split rune", "source.rs", "application/octet-stream", strings.Repeat("a", (128<<10)-1) + "🏡\r\n", 200, ""},
		{"replacement rune", "file.txt", "text/plain", "valid \ufffd rune", 200, ""},
		{"no suffix", "plain", "text/x-custom; charset=UTF-8", "exact\r\n", 200, ""},
		{"JSON MIME", "data", "application/json", `{ "inert": "<script>" }`, 200, ""},
		{"NUL masquerade", "file.md", "text/markdown", "not\x00text", 415, "not_text"},
		{"control", "file.txt", "text/plain", "not\x01text", 415, "not_text"},
		{"DEL", "file.txt", "text/plain", "not\x7ftext", 415, "not_text"},
		{"C1", "file.txt", "text/plain", "not\u0085text", 415, "not_text"},
		{"invalid UTF8", "file.md", "text/plain", "prefix\xff", 415, "not_text"},
		{"truncated UTF8", "file.md", "text/plain", "prefix\xf0\x9f", 415, "not_text"},
		{"late invalid UTF8", "file.md", "text/plain", strings.Repeat("a", (128<<10)+2) + "\xff", 415, "not_text"},
		{"nonUTF8 charset", "file.md", "text/plain; charset=iso-8859-1", "ASCII does not override charset", 415, "not_text"},
		{"UTF16 charset", "file.md", "application/octet-stream; charset=utf-16", "ASCII does not override charset", 415, "not_text"},
		{"unknown extension", "file.unknown", "application/octet-stream", "valid UTF8 lacks an eligible hint", 415, "not_text"},
		{"binary candidate", "image.png", "image/png", "\x89PNG\x00", 415, "not_text"},
		{"exact limit", "limit.txt", "text/plain", strings.Repeat("a", textFileLimit), 200, ""},
		{"over limit", "limit.txt", "text/plain", strings.Repeat("a", textFileLimit+1), 413, "text_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			loc, id := createUpload(t, s, int64(len(tc.body)), tc.filename, "file", tc.typ)
			if len(tc.body) > 0 {
				requireStatus(t, patch(s, loc, 0, strings.NewReader(tc.body)), 204)
			}
			w := request(s, "GET", "/api/items/"+id+"/text", nil, nil)
			requireStatus(t, w, tc.status)
			if tc.status == 200 {
				if w.Body.String() != tc.body || w.Header().Get("Content-Type") != "text/plain; charset=utf-8" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Content-Length") != request(s, "HEAD", "/api/items/"+id+"/download", nil, nil).Header().Get("Content-Length") {
					t.Fatal("file preparation changed bytes or inert headers")
				}
			} else if !strings.Contains(w.Body.String(), `"code":"`+tc.code+`"`) || w.Header().Get("Content-Type") != "application/json; charset=utf-8" || strings.Contains(w.Body.String(), "prefix") {
				t.Fatal("invalid preparation leaked content or failed without a typed error")
			}
			if getItem(t, s, id).Status != "ready" {
				t.Fatal("preparation failed the original file")
			}
			assertBytes(t, s, id, tc.body)
		})
	}
	// Existing kind=text semantics, including controls and larger bodies, stay intact.
	item := postText(t, s, "\x00\x01\u0085\t\r\n")
	w := request(s, "GET", "/api/items/"+item.ID+"/text", nil, nil)
	requireStatus(t, w, 200)
	if w.Body.String() != "\x00\x01\u0085\t\r\n" {
		t.Fatal("changed legacy text semantics")
	}
}

func TestTextFilePreparationSnapshotAndSize(t *testing.T) {
	s := openTest(t, testConfig(t))
	body := "\ufeff# exact\r\n\t🏡\n"
	loc, id := createUpload(t, s, int64(len(body)), "original.md", "file", "text/markdown")
	requireStatus(t, patch(s, loc, 0, strings.NewReader(body)), 204)
	var row record
	var file *os.File
	err := s.withItemLock(context.Background(), id, func() (err error) {
		row, file, err = s.openContent(id)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	_ = saveEdit(t, s, row.Item, map[string]any{"name": "renamed.zip"})
	requireStatus(t, request(s, "DELETE", "/api/items/"+id, nil, nil), 204)
	if err := prepareTextFile(row, file); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(file)
	if err != nil || string(data) != body {
		t.Fatal("preparation failed to rewind its original unlinked snapshot")
	}
	row.Size = textFileLimit + 1
	if err := prepareTextFile(row, file); err == nil {
		t.Fatal("oversize metadata bypassed the preparation limit")
	}
	// A descriptor that grows after the size check still has a bounded validation read.
	large, err := os.CreateTemp(t.TempDir(), "large")
	if err != nil {
		t.Fatal(err)
	}
	defer large.Close()
	if _, err := io.Copy(large, strings.NewReader(strings.Repeat("a", textFileLimit+2))); err != nil {
		t.Fatal(err)
	}
	if _, err := large.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	row.Size = 0
	if err := prepareTextFile(row, large); err == nil {
		t.Fatal("oversize descriptor bypassed the preparation limit")
	} else if typed, ok := err.(*itemError); !ok || typed.status != 413 {
		t.Fatalf("oversize descriptor error: %v", err)
	}
	position, err := large.Seek(0, io.SeekCurrent)
	if err != nil || position != textFileLimit+1 {
		t.Fatal("preparation read beyond its bound")
	}
}
