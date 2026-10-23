package share

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config deliberately has no public-bind override. Put Tailscale Serve in front
// of the loopback listener, and do not enable Funnel.
type Config struct {
	Addr            string
	DataDir         string
	WebDir          string
	Origin          string
	AuthMode        string // empty retains token mode for existing callers
	Token           string
	Dev             bool
	MaxFileBytes    int64
	MaxTextBytes    int64
	MaxStorageBytes int64 // zero means no application quota
	MinFreeBytes    int64
	UploadTTL       time.Duration // incomplete/failed items only; zero disables expiry
}

func DefaultConfig() Config {
	return Config{Addr: "127.0.0.1:8787", DataDir: "./data", Origin: "http://127.0.0.1:8787", AuthMode: "token", MaxFileBytes: 20 << 30, MaxTextBytes: 32 << 20, MinFreeBytes: 256 << 20, UploadTTL: 7 * 24 * time.Hour}
}

func ConfigFromEnv() (Config, error) {
	c := DefaultConfig()
	for key, target := range map[string]*string{"HOUSEHOLD_ADDR": &c.Addr, "HOUSEHOLD_DATA_DIR": &c.DataDir, "HOUSEHOLD_WEB_DIR": &c.WebDir, "HOUSEHOLD_PUBLIC_URL": &c.Origin, "HOUSEHOLD_AUTH_MODE": &c.AuthMode, "HOUSEHOLD_TOKEN": &c.Token} {
		if value, ok := os.LookupEnv(key); ok {
			*target = value
		}
	}
	c.Dev = os.Getenv("HOUSEHOLD_DEV") == "1"
	for key, target := range map[string]*int64{"HOUSEHOLD_MAX_FILE_BYTES": &c.MaxFileBytes, "HOUSEHOLD_MAX_TEXT_BYTES": &c.MaxTextBytes, "HOUSEHOLD_MAX_STORAGE_BYTES": &c.MaxStorageBytes, "HOUSEHOLD_MIN_FREE_BYTES": &c.MinFreeBytes} {
		if raw, ok := os.LookupEnv(key); ok {
			n, err := strconv.ParseInt(raw, 10, 64)
			if err != nil {
				return c, fmt.Errorf("%s must be an integer byte count", key)
			}
			*target = n
		}
	}
	if raw, ok := os.LookupEnv("HOUSEHOLD_UPLOAD_TTL"); ok {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return c, errors.New("HOUSEHOLD_UPLOAD_TTL must be a duration")
		}
		c.UploadTTL = d
	}
	return c, c.Validate()
}

func (c Config) Validate() error {
	if c.AuthMode != "" && c.AuthMode != "token" && c.AuthMode != "tailscale" {
		return errors.New("HOUSEHOLD_AUTH_MODE must be token or tailscale")
	}
	host, _, err := net.SplitHostPort(c.Addr)
	if err != nil {
		return errors.New("HOUSEHOLD_ADDR must be a loopback IP and port")
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("server must bind an explicit loopback IP")
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("HOUSEHOLD_PUBLIC_URL must be an exact http(s) origin without a trailing slash")
	}
	if u.Scheme != "https" && (!c.Dev || c.AuthMode == "tailscale") {
		return errors.New("HTTPS origin required outside explicit development mode")
	}
	if c.Dev && u.Scheme == "http" {
		originIP := net.ParseIP(u.Hostname())
		if u.Hostname() != "localhost" && (originIP == nil || !originIP.IsLoopback()) {
			return errors.New("HTTP development origin must be loopback")
		}
	}
	if c.Token == "" && !c.Dev && c.AuthMode != "tailscale" {
		return errors.New("HOUSEHOLD_TOKEN is required outside explicit development mode")
	}
	if c.Token != "" && (len(c.Token) < 16 || len(c.Token) > 4096 || strings.TrimSpace(c.Token) != c.Token) {
		return errors.New("HOUSEHOLD_TOKEN must contain 16 to 4096 non-padded bytes")
	}
	// Keep all wire integers within the JavaScript safe integer range and bound
	// JSON text buffering independently of the streamed file limit.
	if c.MaxFileBytes < 1 || c.MaxFileBytes > (1<<53)-1 || c.MaxTextBytes < 1 || c.MaxTextBytes > 128<<20 || c.MaxStorageBytes < 0 || c.MaxStorageBytes > (1<<53)-1 || c.MinFreeBytes < 0 || c.UploadTTL < 0 {
		return errors.New("invalid storage limits (JSON text limit must be 1 byte to 128 MiB)")
	}
	if c.DataDir == "" {
		return errors.New("data directory required")
	}
	return nil
}
