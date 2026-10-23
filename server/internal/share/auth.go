package share

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const cookieName = "household_session"

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func methodError(w http.ResponseWriter) {
	writeError(w, 405, "method_not_allowed", "Method not allowed")
}

func secureEqual(a, b string) bool {
	aa, bb := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aa[:], bb[:]) == 1
}

func (s *Server) sessionValue(expiry int64) string {
	message := strconv.FormatInt(expiry, 10)
	mac := hmac.New(sha256.New, []byte(s.cfg.Token))
	_, _ = io.WriteString(mac, "household-session-v1:"+message)
	return message + "." + hex.EncodeToString(mac.Sum(nil))
}

// Serve strips caller identity headers; only its local TCP hop is trusted.
func (s *Server) tailscaleAuthenticated(r *http.Request) bool {
	if s.cfg.AuthMode != "tailscale" {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return false
	}
	values := r.Header.Values("Tailscale-User-Login")
	if len(values) != 1 || len(values[0]) > 1024 || strings.TrimSpace(values[0]) == "" || !utf8.ValidString(values[0]) {
		return false
	}
	for _, ch := range values[0] {
		if unicode.IsControl(ch) {
			return false
		}
	}
	return true
}

func (s *Server) authenticated(r *http.Request) (ok, native bool) {
	if value := r.Header.Get("Authorization"); value != "" {
		if s.cfg.Token == "" {
			return false, false
		}
		if !strings.HasPrefix(value, "Bearer ") {
			return false, false
		}
		return secureEqual(strings.TrimPrefix(value, "Bearer "), s.cfg.Token), true
	}
	if s.tailscaleAuthenticated(r) {
		for key := range r.Header {
			if strings.HasPrefix(strings.ToLower(key), "sec-fetch-") {
				return true, false
			}
		}
		return true, true
	}
	if s.cfg.AuthMode != "tailscale" && s.cfg.Dev && s.cfg.Token == "" {
		return true, true
	}
	if s.cfg.Token == "" {
		return false, false
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return false, false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return false, false
	}
	expiry, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || expiry <= time.Now().Unix() || expiry > time.Now().Add(31*24*time.Hour).Unix() {
		return false, false
	}
	return secureEqual(cookie.Value, s.sessionValue(expiry)), false
}

func (s *Server) originAllowed(r *http.Request, native bool) bool {
	origins := r.Header.Values("Origin")
	if len(origins) == 0 {
		return native
	}
	return len(origins) == 1 && origins[0] == s.cfg.Origin
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	scriptSources := "'self'"
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		// The bundled incremental upload hasher compiles WebAssembly. Permit
		// that operation on the static app without enabling JavaScript eval.
		scriptSources += " 'wasm-unsafe-eval'"
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src "+scriptSources+"; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path != "/api/health" && r.URL.Path != "/api/session" {
			ok, native := s.authenticated(r)
			if !ok {
				writeError(w, 401, "unauthorized", "Authentication required")
				return
			}
			mutating := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
			if mutating && !s.originAllowed(r, native) {
				writeError(w, 403, "origin_denied", "Request origin not allowed")
				return
			}
		}
	}
	s.mux.ServeHTTP(w, r)
}

// decodeJSON bounds the encoded request as well as the decoded text limit.
// Escaped JSON can use six wire bytes per stored byte; uploads avoid JSON.
func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, dest any) bool {
	if typ := strings.Split(r.Header.Get("Content-Type"), ";")[0]; typ != "application/json" {
		writeError(w, 415, "content_type", "Expected application/json")
		return false
	}
	if r.ContentLength > limit {
		writeError(w, 413, "request_too_large", "JSON request exceeds the configured limit")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, 413, "request_too_large", "JSON request exceeds the configured limit")
		} else {
			writeError(w, 400, "invalid_json", "Invalid JSON request")
		}
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, 413, "request_too_large", "JSON request exceeds the configured limit")
		} else {
			writeError(w, 400, "invalid_json", "Expected one JSON value")
		}
		return false
	}
	return true
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" && r.Method != "DELETE" {
		methodError(w)
		return
	}
	// Token entry is a browser operation. A missing Origin may not mint a cookie.
	if !s.originAllowed(r, false) {
		writeError(w, 403, "origin_denied", "Request origin not allowed")
		return
	}
	if r.Method == "DELETE" {
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/api", HttpOnly: true, Secure: strings.HasPrefix(s.cfg.Origin, "https://"), SameSite: http.SameSiteStrictMode, MaxAge: -1})
		w.WriteHeader(204)
		return
	}
	if s.tailscaleAuthenticated(r) {
		w.WriteHeader(204)
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if !decodeJSON(w, r, 16<<10, &body) {
		return
	}
	if s.cfg.Token == "" || !secureEqual(body.Token, s.cfg.Token) {
		writeError(w, 401, "unauthorized", "Invalid token")
		return
	}
	expiry := time.Now().Add(30 * 24 * time.Hour)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: s.sessionValue(expiry.Unix()), Path: "/api", HttpOnly: true, Secure: strings.HasPrefix(s.cfg.Origin, "https://"), SameSite: http.SameSiteStrictMode, MaxAge: 30 * 24 * 60 * 60, Expires: expiry})
	w.WriteHeader(204)
}

func safeInternal(w http.ResponseWriter, err error) {
	// Never include OS paths or SQL details in responses.
	log.Printf("API operation failed: %v", err)
	writeError(w, 500, "internal", "The operation could not be completed")
}
