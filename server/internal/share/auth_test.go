package share

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAuthModeConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, mode, token, origin, addr string
		dev, valid                      bool
	}{
		{"legacy default", "", testToken, "https://household.test", "127.0.0.1:8787", false, true},
		{"token", "token", testToken, "https://household.test", "[::1]:8787", false, true},
		{"token required", "token", "", "https://household.test", "127.0.0.1:8787", false, false},
		{"legacy dev", "", "", "http://localhost:8787", "127.0.0.1:8787", true, true},
		{"tailscale", "tailscale", "", "https://household.test", "127.0.0.1:8787", false, true},
		{"fallback", "tailscale", testToken, "https://household.test", "[::1]:8787", false, true},
		{"bad fallback", "tailscale", "short", "https://household.test", "127.0.0.1:8787", false, false},
		{"tailscale dev HTTPS", "tailscale", "", "https://household.test", "127.0.0.1:8787", true, true},
		{"tailscale dev HTTP", "tailscale", "", "http://127.0.0.1:8787", "127.0.0.1:8787", true, false},
		{"tailscale HTTP", "tailscale", testToken, "http://127.0.0.1:8787", "127.0.0.1:8787", false, false},
		{"public bind", "tailscale", "", "https://household.test", "0.0.0.0:8787", false, false},
		{"implicit bind", "tailscale", "", "https://household.test", ":8787", true, false},
		{"hostname bind", "tailscale", "", "https://household.test", "localhost:8787", false, false},
		{"origin path", "tailscale", "", "https://household.test/", "127.0.0.1:8787", false, false},
		{"origin credentials", "tailscale", "", "https://user@household.test", "127.0.0.1:8787", false, false},
		{"unknown", "proxy", testToken, "https://household.test", "127.0.0.1:8787", false, false},
		{"case", "Tailscale", testToken, "https://household.test", "127.0.0.1:8787", true, false},
		{"padded", " tailscale", testToken, "https://household.test", "127.0.0.1:8787", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := testConfig(t)
			cfg.AuthMode, cfg.Token, cfg.Origin, cfg.Addr, cfg.Dev = tc.mode, tc.token, tc.origin, tc.addr, tc.dev
			if err := cfg.Validate(); (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
		})
	}
	t.Setenv("HOUSEHOLD_PUBLIC_URL", "https://household.test")
	t.Setenv("HOUSEHOLD_TOKEN", testToken)
	t.Setenv("HOUSEHOLD_DEV", "0")
	t.Setenv("HOUSEHOLD_AUTH_MODE", "")
	if err := os.Unsetenv("HOUSEHOLD_AUTH_MODE"); err != nil {
		t.Fatal(err)
	}
	cfg, err := ConfigFromEnv()
	if err != nil || cfg.AuthMode != "token" {
		t.Fatalf("absent mode changed defaults: %+v %v", cfg, err)
	}
	t.Setenv("HOUSEHOLD_AUTH_MODE", "tailscale")
	t.Setenv("HOUSEHOLD_TOKEN", "")
	cfg, err = ConfigFromEnv()
	if err != nil || cfg.AuthMode != "tailscale" || cfg.Token != "" {
		t.Fatalf("environment mode not applied: %+v %v", cfg, err)
	}
	t.Setenv("HOUSEHOLD_AUTH_MODE", "unknown")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("accepted unknown environment auth mode")
	}
}

func proxyRequest(s *Server, method, path, body string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:43210"
	r.Header.Set("Tailscale-User-Login", "alice@example.com")
	r.Header.Set("Content-Type", "application/json")
	return r
}

func serveRequest(s *Server, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestTailscaleIdentityBoundary(t *testing.T) {
	cfg := testConfig(t)
	cfg.AuthMode, cfg.Token = "tailscale", ""
	s := openTest(t, cfg)
	for _, tc := range []struct {
		name, peer string
		values     []string
		status     int
	}{
		{"IPv4", "127.0.0.1:1234", []string{"alice@example.com"}, 200},
		{"loopback subnet", "127.24.1.3:1234", []string{"alice@example.com"}, 200},
		{"IPv6", "[::1]:1234", []string{"alice@example.com"}, 200},
		{"mapped IPv4", "[::ffff:127.0.0.1]:1234", []string{"alice@example.com"}, 200},
		{"encoded identity", "127.0.0.1:1234", []string{"=?utf-8?q?Ferris_B=C3=BCller?="}, 200},
		{"bounded identity", "127.0.0.1:1234", []string{strings.Repeat("a", 1024)}, 200},
		{"missing or tagged", "127.0.0.1:1234", nil, 401},
		{"empty", "127.0.0.1:1234", []string{""}, 401},
		{"blank", "127.0.0.1:1234", []string{"   "}, 401},
		{"duplicate", "127.0.0.1:1234", []string{"alice@example.com", "alice@example.com"}, 401},
		{"duplicate different", "127.0.0.1:1234", []string{"alice@example.com", "bob@example.com"}, 401},
		{"oversize", "127.0.0.1:1234", []string{strings.Repeat("a", 1025)}, 401},
		{"NUL", "127.0.0.1:1234", []string{"alice\x00@example.com"}, 401},
		{"tab", "127.0.0.1:1234", []string{"alice\t@example.com"}, 401},
		{"CRLF", "127.0.0.1:1234", []string{"alice\r\n@example.com"}, 401},
		{"DEL", "127.0.0.1:1234", []string{"alice\x7f@example.com"}, 401},
		{"Unicode control", "127.0.0.1:1234", []string{"alice\u0085@example.com"}, 401},
		{"invalid UTF8", "127.0.0.1:1234", []string{"alice\xff@example.com"}, 401},
		{"tailnet peer", "100.100.100.100:1234", []string{"alice@example.com"}, 401},
		{"LAN peer", "192.168.1.5:1234", []string{"alice@example.com"}, 401},
		{"remote IPv6", "[2001:db8::1]:1234", []string{"alice@example.com"}, 401},
		{"hostname peer", "localhost:1234", []string{"alice@example.com"}, 401},
		{"no TCP port", "127.0.0.1", []string{"alice@example.com"}, 401},
		{"empty peer", "", []string{"alice@example.com"}, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := proxyRequest(s, "GET", "/api/storage", "")
			r.RemoteAddr = tc.peer
			r.Header.Del("Tailscale-User-Login")
			for _, value := range tc.values {
				r.Header.Add("Tailscale-User-Login", value)
			}
			// None of these attacker-supplied hints may replace the TCP peer/login.
			r.Host = "household.test"
			r.Header.Set("Forwarded", "for=127.0.0.1;proto=https;host=household.test")
			r.Header.Set("X-Forwarded-For", "127.0.0.1")
			r.Header.Set("X-Forwarded-Host", "household.test")
			r.Header.Set("X-Forwarded-Proto", "https")
			r.Header.Set("Tailscale-User-Name", "Alice")
			requireStatus(t, serveRequest(s, r), tc.status)
		})
	}
	for _, mode := range []string{"", "token"} {
		s.cfg.AuthMode = mode
		requireStatus(t, serveRequest(s, proxyRequest(s, "GET", "/api/items", "")), 401)
	}
	s.cfg.AuthMode, s.cfg.Dev = "tailscale", true
	r := proxyRequest(s, "GET", "/api/items", "")
	r.Header.Del("Tailscale-User-Login")
	r.AddCookie(&http.Cookie{Name: cookieName, Value: s.sessionValue(time.Now().Add(time.Hour).Unix())})
	requireStatus(t, serveRequest(s, r), 401)
}

func TestTailscaleMutationOriginsAndFallback(t *testing.T) {
	cfg := testConfig(t)
	cfg.AuthMode = "tailscale"
	s := openTest(t, cfg)
	for _, auth := range []string{"proxy", "bearer", "cookie"} {
		for _, tc := range []struct {
			name   string
			origin []string
			fetch  string
			status int
		}{
			{"exact", []string{cfg.Origin}, "Sec-Fetch-Site", 201},
			{"native", nil, "", 201},
			{"foreign", []string{"https://foreign.test"}, "", 403},
			{"null", []string{"null"}, "", 403},
			{"empty", []string{""}, "", 403},
			{"duplicate", []string{cfg.Origin, cfg.Origin}, "", 403},
			{"missing browser origin", nil, "Sec-Fetch-Site", 403},
			{"other fetch metadata", nil, "Sec-Fetch-Mode", 403},
			{"empty fetch metadata", nil, "Sec-Fetch-Dest", 403},
		} {
			t.Run(auth+"/"+tc.name, func(t *testing.T) {
				r := proxyRequest(s, "POST", "/api/text", `{"text":"inert proxy share"}`)
				if auth != "proxy" {
					r.Header.Del("Tailscale-User-Login")
					if auth == "bearer" {
						r.Header.Set("Authorization", "Bearer "+testToken)
					} else {
						r.AddCookie(&http.Cookie{Name: cookieName, Value: s.sessionValue(time.Now().Add(time.Hour).Unix())})
					}
				}
				for _, origin := range tc.origin {
					r.Header.Add("Origin", origin)
				}
				if tc.fetch != "" {
					r.Header.Set(tc.fetch, "")
				}
				status := tc.status
				if auth == "cookie" && tc.origin == nil {
					status = 403
				}
				// Retain the existing explicit bearer/native exception.
				if auth == "bearer" && tc.origin == nil {
					status = 201
				}
				requireStatus(t, serveRequest(s, r), status)
			})
		}
	}
}

func TestTailscaleSessionAndEmptyKeys(t *testing.T) {
	cfg := testConfig(t)
	cfg.AuthMode = "tailscale"
	s := openTest(t, cfg)
	r := proxyRequest(s, "POST", "/api/session", "")
	r.Header.Set("Origin", cfg.Origin)
	w := serveRequest(s, r)
	requireStatus(t, w, 204)
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("proxy login minted a cookie")
	}
	for _, origins := range [][]string{nil, {"null"}, {"https://foreign.test"}, {cfg.Origin, cfg.Origin}} {
		r = proxyRequest(s, "POST", "/api/session", `{"token":"`+testToken+`"}`)
		for _, origin := range origins {
			r.Header.Add("Origin", origin)
		}
		requireStatus(t, serveRequest(s, r), 403)
	}
	r = proxyRequest(s, "POST", "/api/session", `{"token":"`+testToken+`"}`)
	r.Header.Del("Tailscale-User-Login")
	r.Header.Set("Origin", cfg.Origin)
	w = serveRequest(s, r)
	requireStatus(t, w, 204)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/api" || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("fallback cookie attributes changed")
	}
	r = proxyRequest(s, "GET", "/api/items", "")
	r.Header.Del("Tailscale-User-Login")
	r.AddCookie(cookies[0])
	requireStatus(t, serveRequest(s, r), 200)
	s.cfg.Token = testToken + "rotated"
	requireStatus(t, serveRequest(s, r), 401)
	r = proxyRequest(s, "DELETE", "/api/session", "")
	r.Header.Set("Origin", cfg.Origin)
	w = serveRequest(s, r)
	requireStatus(t, w, 204)
	cookies = w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge != -1 || cookies[0].Path != "/api" || !cookies[0].Secure {
		t.Fatal("logout failed to clear legacy cookie")
	}
	requireStatus(t, serveRequest(s, proxyRequest(s, "GET", "/api/items", "")), 200)
	for _, mode := range []string{"token", "tailscale"} {
		s.cfg.AuthMode, s.cfg.Token, s.cfg.Dev = mode, "", true
		r = proxyRequest(s, "POST", "/api/session", `{"token":""}`)
		r.Header.Del("Tailscale-User-Login")
		r.Header.Set("Origin", cfg.Origin)
		w = serveRequest(s, r)
		requireStatus(t, w, 401)
		if len(w.Result().Cookies()) != 0 {
			t.Fatal("empty signing key minted a cookie")
		}
		r = proxyRequest(s, "GET", "/api/items", "")
		r.Header.Del("Tailscale-User-Login")
		r.AddCookie(&http.Cookie{Name: cookieName, Value: s.sessionValue(time.Now().Add(time.Hour).Unix())})
		if ok, _ := s.authenticated(r); ok != (mode == "token") {
			t.Fatal("anonymous dev mode escaped token mode or legacy dev stopped working")
		}
	}
}

func TestTailscalePrivateRoutesAndTus(t *testing.T) {
	cfg := testConfig(t)
	cfg.AuthMode, cfg.Token = "tailscale", ""
	s := openTest(t, cfg)
	for _, path := range []string{"/api/items", "/api/storage", "/api/events", "/api/uploads/", "/api/uploads/" + senderID, "/api/devices", "/api/devices/register", "/api/devices/" + senderID + "/notifications", "/api/devices/" + senderID + "/notifications/ack", "/api/items/" + senderID + "/download", "/api/items/" + senderID + "/text", "/api/items?forDevice=" + senderID} {
		r := proxyRequest(s, "GET", path, "")
		r.Header.Del("Tailscale-User-Login")
		requireStatus(t, serveRequest(s, r), 401)
	}
	r := proxyRequest(s, "GET", "/api/health", "")
	r.Header.Del("Tailscale-User-Login")
	requireStatus(t, serveRequest(s, r), 200)
	r = proxyRequest(s, "POST", "/api/uploads/", "")
	r.Header.Set("Tus-Resumable", "1.0.0")
	r.Header.Set("Upload-Length", "3")
	r.Header.Set("Upload-Metadata", metadata("proxy.txt", "text", "text/plain"))
	w := serveRequest(s, r)
	requireStatus(t, w, 201)
	location, id := w.Header().Get("Location"), w.Header().Get("X-Item-ID")
	r = proxyRequest(s, "PATCH", location, "abc")
	r.Header.Set("Content-Type", "application/offset+octet-stream")
	r.Header.Set("Tus-Resumable", "1.0.0")
	r.Header.Set("Upload-Offset", "0")
	requireStatus(t, serveRequest(s, r), 204)
	r = proxyRequest(s, "HEAD", location, "")
	r.Header.Set("Tus-Resumable", "1.0.0")
	w = serveRequest(s, r)
	requireStatus(t, w, 200)
	if w.Header().Get("Upload-Offset") != "3" {
		t.Fatal("proxy tus offset changed")
	}
	w = serveRequest(s, proxyRequest(s, "GET", "/api/items/"+id+"/download", ""))
	requireStatus(t, w, 200)
	if w.Body.String() != "abc" {
		t.Fatal("proxy download changed bytes")
	}
	registration, _ := json.Marshal(map[string]string{"id": senderID, "label": "Proxy", "platform": "linux"})
	requireStatus(t, serveRequest(s, proxyRequest(s, "POST", "/api/devices/register", string(registration))), 200)
	r = proxyRequest(s, "GET", "/api/events", "")
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	w = serveRequest(s, r.WithContext(ctx))
	requireStatus(t, w, 200)
	if w.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatal("proxy events did not authenticate")
	}
}
