package share

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const senderID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const recipientID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const otherID = "cccccccccccccccccccccccccccccccc"
const absentID = "dddddddddddddddddddddddddddddddd"

func jsonRequest(s *Server, method, path string, body any) *httptest.ResponseRecorder {
	encoded, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return request(s, method, path, bytes.NewReader(encoded), map[string]string{"Content-Type": "application/json"})
}
func register(t *testing.T, s *Server, id, label string) Device {
	t.Helper()
	w := jsonRequest(s, "POST", "/api/devices/register", map[string]string{"id": id, "label": label, "platform": "linux"})
	requireStatus(t, w, 200)
	var body struct {
		Device Device `json:"device"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Device
}
func sendText(t *testing.T, s *Server, source string, targets []string) Item {
	t.Helper()
	body := map[string]any{"text": "exact \t\r\n🏡 漢字", "sourceDevice": "caller label"}
	if source != "" {
		body["sourceDeviceId"] = source
	}
	if targets != nil {
		body["targetDeviceIds"] = targets
	}
	w := jsonRequest(s, "POST", "/api/text", body)
	requireStatus(t, w, 201)
	var response struct {
		Item Item `json:"item"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Item
}

type arrivalPage struct {
	Notifications []notification `json:"notifications"`
	NextCursor    string         `json:"nextCursor"`
	AckCursor     string         `json:"ackCursor"`
	HasMore       bool           `json:"hasMore"`
}

func arrivals(t *testing.T, s *Server, id, query string) arrivalPage {
	t.Helper()
	w := request(s, "GET", "/api/devices/"+id+"/notifications"+query, nil, nil)
	requireStatus(t, w, 200)
	var page arrivalPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}
func arrivalIDs(t *testing.T, s *Server, id string) []string {
	t.Helper()
	page := arrivals(t, s, id, "?after=0&limit=100")
	ids := make([]string, 0, len(page.Notifications))
	for _, n := range page.Notifications {
		ids = append(ids, n.ItemID)
	}
	return ids
}
func ack(t *testing.T, s *Server, id, through string) string {
	t.Helper()
	w := jsonRequest(s, "POST", "/api/devices/"+id+"/notifications/ack", map[string]string{"through": through})
	requireStatus(t, w, 200)
	var response struct {
		AckCursor string `json:"ackCursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.AckCursor
}
func routedUpload(t *testing.T, s *Server, size int64, kind, source string, targets []string) (string, string) {
	t.Helper()
	meta := metadata("shared.bin", kind, map[bool]string{true: "text/plain", false: "application/octet-stream"}[kind == "text"])
	encode := func(v string) string { return base64.StdEncoding.EncodeToString([]byte(v)) }
	if source != "" {
		meta += ",sourceDeviceId " + encode(source)
	}
	if targets != nil {
		raw, _ := json.Marshal(targets)
		meta += ",targetDeviceIds " + encode(string(raw))
	}
	w := request(s, "POST", "/api/uploads/", nil, map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": strconv.FormatInt(size, 10), "Upload-Metadata": meta})
	requireStatus(t, w, 201)
	return w.Header().Get("Location"), w.Header().Get("X-Item-ID")
}

func TestDeviceRegistryLifecycleAndLimits(t *testing.T) {
	s := openTest(t, testConfig(t))
	first := register(t, s, senderID, "Office 🏡")
	register(t, s, recipientID, "Office 🏡")
	sendText(t, s, recipientID, []string{senderID})
	high := arrivals(t, s, senderID, "").NextCursor
	ack(t, s, senderID, high)
	renamed := register(t, s, senderID, "Renamed")
	if first.CreatedAt != renamed.CreatedAt || renamed.Label != "Renamed" || arrivals(t, s, senderID, "").AckCursor != high {
		t.Fatal("registration reset identity, creation or ACK")
	}
	for i := 2; i < 64; i++ {
		register(t, s, fmt.Sprintf("%032x", i), "Device")
	}
	w := jsonRequest(s, "POST", "/api/devices/register", map[string]string{"id": otherID, "label": "New", "platform": "browser"})
	requireStatus(t, w, 409)
	if !strings.Contains(w.Body.String(), `"device_limit"`) {
		t.Fatal("wrong capacity error")
	}
	register(t, s, senderID, "At capacity")
	w = request(s, "GET", "/api/devices", nil, nil)
	requireStatus(t, w, 200)
	var body struct {
		Devices []Device `json:"devices"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Devices) != 64 {
		t.Fatal("registry lost entries")
	}
	targets := make([]string, 0, 63)
	for _, d := range body.Devices {
		if d.ID != senderID {
			targets = append(targets, d.ID)
		}
	}
	_, itemID := routedUpload(t, s, 0, "file", senderID, targets)
	if item := getItem(t, s, itemID); item.Status != "ready" || len(item.TargetDeviceIDs) != 63 {
		t.Fatal("largest valid explicit fanout lost recipients")
	}
	for _, invalid := range []map[string]string{
		{"id": "ABC", "label": "Test", "platform": "linux"},
		{"id": otherID, "label": "bad\nlabel", "platform": "linux"},
		{"id": otherID, "label": strings.Repeat("é", 65), "platform": "linux"},
		{"id": otherID, "label": "", "platform": "linux"},
		{"id": otherID, "label": "Test", "platform": "windows"},
	} {
		requireStatus(t, jsonRequest(s, "POST", "/api/devices/register", invalid), 400)
	}
	requireStatus(t, jsonRequest(s, "POST", "/api/devices/register", map[string]string{"id": otherID, "label": strings.Repeat("x", 17000), "platform": "linux"}), 413)
	for i := 0; i < 2; i++ {
		requireStatus(t, request(s, "DELETE", "/api/devices/"+senderID, nil, nil), 204)
	}
	requireStatus(t, request(s, "GET", "/api/devices/"+senderID+"/notifications", nil, nil), 404)
	register(t, s, senderID, "Registered again")
	if p := arrivals(t, s, senderID, ""); p.AckCursor != "0" || len(p.Notifications) != 0 {
		t.Fatal("forgotten registry retained arrivals/ACK")
	}
}

func TestDeviceEnsureRegistrationPreservesRename(t *testing.T) {
	s := openTest(t, testConfig(t))
	stale := map[string]any{"id": senderID, "label": "Old queued name", "platform": "browser", "preserveExisting": true}
	ensure := func() Device {
		t.Helper()
		w := jsonRequest(s, "POST", "/api/devices/register", stale)
		requireStatus(t, w, 200)
		var body struct {
			Device Device `json:"device"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Device
	}
	created := ensure()
	if created.Label != "Old queued name" || created.Platform != "browser" {
		t.Fatal("ensure did not create missing device")
	}
	register(t, s, recipientID, "Sender")
	sendText(t, s, recipientID, []string{senderID})
	high := arrivals(t, s, senderID, "").NextCursor
	ack(t, s, senderID, high)
	renamed := register(t, s, senderID, "Current user name")
	if got := ensure(); got != renamed || got.CreatedAt != created.CreatedAt {
		t.Fatal("stale registration overwrote current label/platform or identity")
	}
	// A background ensure racing an explicit rename must never win that rename.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := jsonRequest(s, "POST", "/api/devices/register", stale)
			if w.Code != 200 {
				t.Errorf("background registration: %d %s", w.Code, w.Body.String())
			}
		}()
	}
	latest := register(t, s, senderID, "Newest explicit name")
	wg.Wait()
	if got := ensure(); got != latest {
		t.Fatal("concurrent background ensure undid explicit rename")
	}
	if got := arrivals(t, s, senderID, "").AckCursor; got != high {
		t.Fatal("ensure reset acknowledgement")
	}
	item := sendText(t, s, senderID, []string{recipientID})
	if item.SourceDevice != "Newest explicit name" {
		t.Fatal("saved send label changed authoritative registry label")
	}
}

func TestTextRoutingAndLegacyCompatibility(t *testing.T) {
	s := openTest(t, testConfig(t))
	old := postText(t, s, "before registry")
	register(t, s, senderID, "Sender")
	register(t, s, recipientID, "Recipient")
	register(t, s, otherID, "Other")
	targeted := sendText(t, s, senderID, []string{recipientID})
	everyone := sendText(t, s, senderID, []string{})
	legacy := sendText(t, s, "", nil)
	if targeted.SourceDevice != "Sender" || targeted.SourceDeviceID != senderID || len(targeted.TargetDeviceIDs) != 1 || targeted.TargetDeviceIDs[0] != recipientID {
		t.Fatal("routing or source snapshot missing")
	}
	register(t, s, senderID, "New sender label")
	if getItem(t, s, targeted.ID).SourceDevice != "Sender" {
		t.Fatal("sender label changed retroactively")
	}
	for id, want := range map[string][]string{
		senderID: {legacy.ID}, recipientID: {targeted.ID, everyone.ID, legacy.ID}, otherID: {everyone.ID, legacy.ID},
	} {
		if got := arrivalIDs(t, s, id); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("%s arrivals %v want %v", id, got, want)
		}
	}
	register(t, s, absentID, "New after ready")
	if len(arrivalIDs(t, s, absentID)) != 0 {
		t.Fatal("registered device received retroactive arrivals")
	}
	// Routing never restricts access to the common feed or exact content.
	for _, item := range []Item{old, targeted, everyone, legacy} {
		requireStatus(t, request(s, "GET", "/api/items/"+item.ID+"/text", nil, nil), 200)
	}
}

func TestInvalidRoutingDoesNotReserveBytes(t *testing.T) {
	s := openTest(t, testConfig(t))
	register(t, s, senderID, "Sender")
	register(t, s, recipientID, "Recipient")
	cases := []map[string]any{
		{"sourceDeviceId": "bad"}, {"sourceDeviceId": ""}, {"sourceDeviceId": nil}, {"sourceDeviceId": absentID},
		{"targetDeviceIds": []string{recipientID}},
		{"sourceDeviceId": senderID, "targetDeviceIds": []string{senderID}},
		{"sourceDeviceId": senderID, "targetDeviceIds": []string{recipientID, recipientID}},
		{"sourceDeviceId": senderID, "targetDeviceIds": []string{absentID}},
		{"sourceDeviceId": senderID, "targetDeviceIds": []string{"BAD"}},
		{"sourceDeviceId": senderID, "targetDeviceIds": nil},
		{"sourceDeviceId": senderID, "targetDeviceIds": "not an array"},
		{"sourceDeviceId": senderID, "targetDeviceIds": make([]string, 65)},
	}
	for i, body := range cases {
		body["text"] = "must not be reserved"
		requireStatus(t, jsonRequest(s, "POST", "/api/text", body), 400)
		meta := metadata("invalid.bin", "file", "application/octet-stream")
		for _, key := range []string{"sourceDeviceId", "targetDeviceIds"} {
			if v, ok := body[key]; ok {
				raw, _ := json.Marshal(v)
				if key == "sourceDeviceId" {
					if value, ok := v.(string); ok {
						raw = []byte(value)
					}
				}
				meta += "," + key + " " + base64.StdEncoding.EncodeToString(raw)
			}
		}
		w := request(s, "POST", "/api/uploads/", strings.NewReader("unaccepted bytes"), map[string]string{"Tus-Resumable": "1.0.0", "Upload-Length": "100", "Upload-Metadata": meta})
		if w.Code != 400 {
			t.Fatalf("case %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM items`).Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid routing reserved metadata")
	}
	files, err := os.ReadDir(filepath.Join(s.cfg.DataDir, "blobs"))
	if err != nil || len(files) != 0 {
		t.Fatal("invalid routing created blob")
	}
}

func TestUploadArrivalSnapshotReadyGatingAndRecovery(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	register(t, s, senderID, "Sender")
	register(t, s, recipientID, "Recipient")
	register(t, s, otherID, "Other")
	location, id := routedUpload(t, s, 3, "file", senderID, []string{recipientID})
	broadcastLocation, broadcastID := routedUpload(t, s, 1, "file", senderID, nil)
	if len(arrivalIDs(t, s, recipientID)) != 0 {
		t.Fatal("uploading bytes produced arrival")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+id+"/download", nil, nil), 409)
	info, err := (&upload{s, id}).GetInfo(context.Background())
	if err != nil || info.MetaData["sourceDeviceId"] != senderID || info.MetaData["targetDeviceIds"] != `["`+recipientID+`"]` {
		t.Fatalf("lost tus metadata: %+v %v", info, err)
	}
	requireStatus(t, request(s, "DELETE", "/api/devices/"+recipientID, nil, nil), 204)
	register(t, s, absentID, "Registered during upload")
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	requireStatus(t, patch(s, location, 0, strings.NewReader("abc")), 204)
	for _, device := range []string{senderID, otherID, absentID} {
		if len(arrivalIDs(t, s, device)) != 0 {
			t.Fatal("deleted explicit target became broadcast")
		}
	}
	requireStatus(t, patch(s, broadcastLocation, 0, strings.NewReader("b")), 204)
	for _, device := range []string{otherID, absentID} {
		if got := arrivalIDs(t, s, device); len(got) != 1 || got[0] != broadcastID {
			t.Fatal("broadcast did not snapshot registry at ready")
		}
	}
	if len(arrivalIDs(t, s, senderID)) != 0 {
		t.Fatal("broadcast notified sender")
	}
	for i := 0; i < 3; i++ {
		requireStatus(t, request(s, "HEAD", broadcastLocation, nil, map[string]string{"Tus-Resumable": "1.0.0"}), 200)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	if len(arrivalIDs(t, s, otherID)) != 1 {
		t.Fatal("HEAD/recovery duplicated arrival")
	}
	// Empty files become ready; invalid UTF-8 and unfinished/terminated uploads never arrive.
	_, zeroID := routedUpload(t, s, 0, "file", senderID, []string{otherID})
	if getItem(t, s, zeroID).Status != "ready" {
		t.Fatal("zero-byte item did not finalize")
	}
	badLocation, badID := routedUpload(t, s, 1, "text", senderID, []string{otherID})
	requireStatus(t, patch(s, badLocation, 0, bytes.NewReader([]byte{0xff})), 422)
	if getItem(t, s, badID).Status != "failed" || len(arrivalIDs(t, s, otherID)) != 2 {
		t.Fatal("invalid text produced arrival")
	}
	pendingLocation, _ := routedUpload(t, s, 2, "file", senderID, []string{otherID})
	requireStatus(t, request(s, "DELETE", pendingLocation, nil, map[string]string{"Tus-Resumable": "1.0.0"}), 204)
	requireStatus(t, request(s, "DELETE", "/api/items/"+zeroID, nil, nil), 204)
	if got := arrivalIDs(t, s, otherID); len(got) != 1 || got[0] != broadcastID {
		t.Fatal("delete/terminate retained arrival")
	}
}

func TestAtomicArrivalsAndTransientTextFinalization(t *testing.T) {
	for _, fault := range []string{"ready", "arrival"} {
		t.Run(fault, func(t *testing.T) {
			cfg := testConfig(t)
			s := openTest(t, cfg)
			register(t, s, senderID, "Sender")
			register(t, s, recipientID, "Recipient")
			register(t, s, otherID, "Other")
			sub := &subscriber{make(chan event, 32), make(chan struct{})}
			s.eventsBroker.subs[sub] = struct{}{}
			trigger := `CREATE TRIGGER injected BEFORE UPDATE OF status ON items WHEN NEW.status='ready' BEGIN SELECT RAISE(FAIL,'temporary ready failure'); END`
			if fault == "arrival" {
				trigger = `CREATE TRIGGER injected BEFORE INSERT ON notifications WHEN NEW.device_id='` + recipientID + `' BEGIN SELECT RAISE(FAIL,'temporary arrival failure'); END`
			}
			if _, err := s.db.Exec(trigger); err != nil {
				t.Fatal(err)
			}
			w := jsonRequest(s, "POST", "/api/text", map[string]string{"text": "exact\t\r\n🏡", "sourceDeviceId": senderID})
			requireStatus(t, w, 500)
			var id, status string
			if err := s.db.QueryRow(`SELECT id,status FROM items`).Scan(&id, &status); err != nil || status != "uploading" {
				t.Fatal("transient text error permanently failed item")
			}
			var count int
			if err := s.db.QueryRow(`SELECT COUNT(*) FROM notifications`).Scan(&count); err != nil || count != 0 {
				t.Fatal("partial arrivals committed")
			}
			if len(sub.events) != 1 || (<-sub.events).Type != "created" {
				t.Fatal("ready SSE emitted before commit")
			}
			if len(arrivalIDs(t, s, recipientID)) != 0 {
				t.Fatal("unready arrival was visible")
			}
			if _, err := s.db.Exec(`DROP TRIGGER injected`); err != nil {
				t.Fatal(err)
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			s = openTest(t, cfg)
			if getItem(t, s, id).Status != "ready" {
				t.Fatal("startup did not retry text finalization")
			}
			for _, device := range []string{recipientID, otherID} {
				if got := arrivalIDs(t, s, device); len(got) != 1 || got[0] != id {
					t.Fatal("recovery missed arrival")
				}
			}
			content := request(s, "GET", "/api/items/"+id+"/text", nil, nil)
			requireStatus(t, content, 200)
			if content.Body.String() != "exact\t\r\n🏡" {
				t.Fatal("text recovery changed bytes")
			}
			for i := 0; i < 2; i++ {
				if err := s.withItemLock(context.Background(), id, func() error { return s.complete(id) }); err != nil {
					t.Fatal(err)
				}
			}
			if len(arrivalIDs(t, s, recipientID)) != 1 {
				t.Fatal("retry duplicated arrivals")
			}
		})
	}
}

func TestNotificationPagingAckReplayAndHighWater(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	register(t, s, senderID, "Sender")
	register(t, s, recipientID, "Recipient")
	if p := arrivals(t, s, recipientID, ""); len(p.Notifications) != 0 || p.NextCursor != "0" || p.AckCursor != "0" || p.HasMore {
		t.Fatal("bad empty page")
	}
	items := make([]Item, 0, 4)
	for i := 0; i < 4; i++ {
		items = append(items, sendText(t, s, senderID, []string{recipientID}))
	}
	page := arrivals(t, s, recipientID, "?after=0&limit=2")
	if len(page.Notifications) != 2 || !page.HasMore || page.Notifications[0].ItemID != items[0].ID || page.Notifications[1].ItemID != items[1].ID {
		t.Fatal("wrong first arrival page")
	}
	if got := ack(t, s, recipientID, page.NextCursor); got != page.NextCursor {
		t.Fatal("ACK not advanced")
	}
	rest := arrivals(t, s, recipientID, "")
	if len(rest.Notifications) != 2 || rest.HasMore || rest.Notifications[0].ItemID != items[2].ID {
		t.Fatal("default cursor ignored ACK")
	}
	high := rest.NextCursor
	var wg sync.WaitGroup
	for _, cursor := range []string{high, page.NextCursor, "0", high} {
		wg.Add(1)
		go func(cursor string) { defer wg.Done(); ack(t, s, recipientID, cursor) }(cursor)
	}
	wg.Wait()
	if p := arrivals(t, s, recipientID, ""); len(p.Notifications) != 0 || p.AckCursor != high || p.NextCursor != high {
		t.Fatal("concurrent/out-of-order ACK moved backward")
	}
	if len(arrivals(t, s, recipientID, "?after=0").Notifications) != 4 {
		t.Fatal("ACK discarded replay/history")
	}
	for _, bad := range []string{"", "-1", "+1", "01", "1.0", " 1", "9223372036854775808", "999"} {
		requireStatus(t, request(s, "GET", "/api/devices/"+recipientID+"/notifications?after="+url.QueryEscape(bad), nil, nil), 400)
		requireStatus(t, jsonRequest(s, "POST", "/api/devices/"+recipientID+"/notifications/ack", map[string]string{"through": bad}), 400)
	}
	requireStatus(t, jsonRequest(s, "POST", "/api/devices/"+recipientID+"/notifications/ack", map[string]any{"through": 1}), 400)
	for _, limit := range []string{"", "0", "101", "x"} {
		requireStatus(t, request(s, "GET", "/api/devices/"+recipientID+"/notifications?limit="+limit, nil, nil), 400)
	}
	for _, item := range items {
		requireStatus(t, request(s, "DELETE", "/api/items/"+item.ID, nil, nil), 204)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	// All arrival rows are gone, but a previously issued cursor remains valid.
	if p := arrivals(t, s, recipientID, "?after="+high); len(p.Notifications) != 0 || p.NextCursor != high {
		t.Fatal("deletion lost global high-water")
	}
	ack(t, s, recipientID, high)
	next := sendText(t, s, senderID, []string{recipientID})
	p := arrivals(t, s, recipientID, "")
	if len(p.Notifications) != 1 || p.Notifications[0].ItemID != next.ID {
		t.Fatal("new arrival was hidden after deletions")
	}
	oldSequence, _ := parseSequence(high)
	newSequence, _ := parseSequence(p.NextCursor)
	if newSequence <= oldSequence {
		t.Fatal("global sequence was reused")
	}
}

func TestForYouSearchPaginationAndReadyOnly(t *testing.T) {
	s := openTest(t, testConfig(t))
	register(t, s, senderID, "Sender")
	register(t, s, recipientID, "Recipient")
	register(t, s, otherID, "Other")
	wanted := map[string]bool{}
	for i := 0; i < 5; i++ {
		item := sendText(t, s, senderID, []string{recipientID})
		wanted[item.ID] = true
	}
	sendText(t, s, senderID, []string{otherID})
	_, pendingID := routedUpload(t, s, 2, "file", senderID, []string{recipientID})
	if _, err := s.db.Exec(`UPDATE items SET created_at=?`, now()); err != nil {
		t.Fatal(err)
	}
	ack(t, s, recipientID, arrivals(t, s, recipientID, "").NextCursor)
	seen := map[string]bool{}
	path := "/api/items?forDevice=" + recipientID + "&limit=2&q=" + url.QueryEscape("漢字")
	for {
		w := request(s, "GET", path, nil, nil)
		requireStatus(t, w, 200)
		var page struct {
			Items      []Item  `json:"items"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		for _, item := range page.Items {
			if !wanted[item.ID] || seen[item.ID] || item.Status != "ready" {
				t.Fatal("wrong/duplicate For you item")
			}
			seen[item.ID] = true
		}
		if page.NextCursor == nil {
			break
		}
		path = "/api/items?forDevice=" + recipientID + "&limit=2&q=" + url.QueryEscape("漢字") + "&before=" + *page.NextCursor
	}
	if len(seen) != 5 {
		t.Fatal("For you pagination lost ready/ACKed items")
	}
	requireStatus(t, request(s, "GET", "/api/items/"+pendingID, nil, nil), 200)
	for _, id := range []string{"", "BAD"} {
		requireStatus(t, request(s, "GET", "/api/items?forDevice="+id, nil, nil), 400)
	}
	requireStatus(t, request(s, "GET", "/api/items?forDevice="+absentID, nil, nil), 404)
	// A persisted arrival must never expose subsequently failed or deleting items.
	for id := range wanted {
		if _, err := s.db.Exec(`UPDATE items SET status='failed' WHERE id=?`, id); err != nil {
			t.Fatal(err)
		}
		break
	}
	w := request(s, "GET", "/api/items?forDevice="+recipientID, nil, nil)
	requireStatus(t, w, 200)
	var body struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Items) != 4 {
		t.Fatal("For you returned failed content")
	}
	if len(arrivalIDs(t, s, recipientID)) != 4 {
		t.Fatal("arrival query returned failed content")
	}
}

func TestDeviceEndpointsAuthenticationAndOrigins(t *testing.T) {
	s := openTest(t, testConfig(t))
	register(t, s, senderID, "Sender")
	paths := []struct{ method, path, body string }{
		{"GET", "/api/devices", ""}, {"POST", "/api/devices/register", `{"id":"` + senderID + `","label":"Test","platform":"linux"}`},
		{"DELETE", "/api/devices/" + senderID, ""}, {"GET", "/api/devices/" + senderID + "/notifications", ""},
		{"POST", "/api/devices/" + senderID + "/notifications/ack", `{"through":"0"}`},
		{"GET", "/api/items?forDevice=" + senderID, ""},
	}
	for _, tc := range paths {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		requireStatus(t, w, 401)
		if tc.method == "GET" {
			continue
		}
		r.Header.Set("Authorization", "Bearer "+testToken)
		r.Header.Set("Origin", "https://foreign.test")
		w = httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		requireStatus(t, w, 403)
		r = httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: cookieName, Value: s.sessionValue(time.Now().Add(time.Hour).Unix())})
		w = httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		requireStatus(t, w, 403)
	}
	for _, path := range []string{"/api/devices/bad", "/api/devices/bad/notifications", "/api/devices/bad/notifications/ack"} {
		requireStatus(t, request(s, "DELETE", path, nil, nil), 400)
	}
	requireStatus(t, request(s, "GET", "/api/devices/"+absentID+"/notifications", nil, nil), 404)
	requireStatus(t, jsonRequest(s, "POST", "/api/devices/"+absentID+"/notifications/ack", map[string]string{"through": "0"}), 404)
}

func TestSchemaV1MigrationAndNoBackfill(t *testing.T) {
	cfg := testConfig(t)
	if err := os.Mkdir(filepath.Join(cfg.DataDir, "blobs"), 0700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(cfg.DataDir, "metadata.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE items (
 id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>=0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL,preview TEXT NOT NULL DEFAULT '',
 pinned INTEGER NOT NULL DEFAULT 0,source_device TEXT NOT NULL DEFAULT '',mime_type TEXT NOT NULL DEFAULT '',
 checksum TEXT NOT NULL DEFAULT '',is_upload INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX items_created ON items(created_at DESC,id DESC); PRAGMA user_version=1;`)
	if err != nil {
		t.Fatal(err)
	}
	for id, status := range map[string]string{senderID: "ready", recipientID: "uploading"} {
		_, err = db.Exec(`INSERT INTO items(id,kind,name,size,created_at,updated_at,status,is_upload) VALUES(?,'text','old.txt',3,?,?,?,?)`, id, now(), now(), status, id == senderID)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(cfg.DataDir, "blobs", id), []byte("old"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	s := openTest(t, cfg)
	var version int
	if err = s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 3 {
		t.Fatal("schema did not migrate")
	}
	legacy, err := s.get(senderID, false)
	if err != nil || legacy.BlobID != senderID || legacy.UploadLength != 3 {
		t.Fatal("v1 migration lost blob pointer/original upload length")
	}
	register(t, s, otherID, "New device")
	for _, id := range []string{senderID, recipientID} {
		if getItem(t, s, id).Status != "ready" {
			t.Fatal("migration lost legacy/recoverable item")
		}
	}
	if len(arrivalIDs(t, s, otherID)) != 0 {
		t.Fatal("migration/registration backfilled old content")
	}
	sendText(t, s, "", nil)
	if len(arrivalIDs(t, s, otherID)) != 1 {
		t.Fatal("legacy new send failed to fan out")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	if len(arrivalIDs(t, s, otherID)) != 1 {
		t.Fatal("migration rerun duplicated arrivals")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = sql.Open("sqlite", filepath.Join(cfg.DataDir, "metadata.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`PRAGMA user_version=4`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if newer, err := Open(cfg); err == nil {
		newer.Close()
		t.Fatal("accepted unsupported newer schema")
	}
}

func TestNotificationSequencesBeyondJavaScriptAndDeviceDeletion(t *testing.T) {
	cfg := testConfig(t)
	s := openTest(t, cfg)
	register(t, s, senderID, "Sender")
	register(t, s, recipientID, "Recipient")
	sendText(t, s, senderID, []string{recipientID})
	if _, err := s.db.Exec(`UPDATE sqlite_sequence SET seq=9007199254740991 WHERE name='notifications'`); err != nil {
		t.Fatal(err)
	}
	item := sendText(t, s, senderID, []string{recipientID})
	page := arrivals(t, s, recipientID, "?after=9007199254740991")
	if page.NextCursor != "9007199254740992" || len(page.Notifications) != 1 || page.Notifications[0].ItemID != item.ID {
		t.Fatal("large sequence lost decimal precision")
	}
	ack(t, s, recipientID, page.NextCursor)
	requireStatus(t, request(s, "DELETE", "/api/devices/"+recipientID, nil, nil), 204)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, cfg)
	register(t, s, recipientID, "Registered again")
	ack(t, s, recipientID, page.NextCursor)
	next := sendText(t, s, senderID, []string{recipientID})
	page = arrivals(t, s, recipientID, "")
	if page.NextCursor != "9007199254740993" || len(page.Notifications) != 1 || page.Notifications[0].ItemID != next.ID {
		t.Fatal("forgetting every arrival lost high-water")
	}
	if n, err := parseSequence("9223372036854775807"); err != nil || n != int64(9223372036854775807) {
		t.Fatal("valid signed SQLite limit rejected")
	}
}

func TestMigrationFailureRollsBackAndReleasesStore(t *testing.T) {
	cfg := testConfig(t)
	db, err := sql.Open("sqlite", filepath.Join(cfg.DataDir, "metadata.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	// Existing v1 data plus a conflicting table forces failure after both ALTERs.
	_, err = db.Exec(`CREATE TABLE items (
 id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL,preview TEXT NOT NULL DEFAULT '',
 pinned INTEGER NOT NULL DEFAULT 0,source_device TEXT NOT NULL DEFAULT '',mime_type TEXT NOT NULL DEFAULT '',
 checksum TEXT NOT NULL DEFAULT '',is_upload INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE devices(id TEXT PRIMARY KEY); PRAGMA user_version=1;`)
	if err != nil {
		t.Fatal(err)
	}
	if broken, err := Open(cfg); err == nil {
		broken.Close()
		t.Fatal("conflicting migration unexpectedly succeeded")
	}
	var version int
	if err = db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 1 {
		t.Fatal("failed migration changed version")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('items') WHERE name IN ('source_device_id','target_device_ids')`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed migration left partial columns")
	}
	if _, err = db.Exec(`DROP TABLE devices`); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	s := openTest(t, cfg)
	register(t, s, senderID, "After repair")
}
