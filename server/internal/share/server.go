package share

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/tus/tusd/v2/pkg/handler"
	"github.com/tus/tusd/v2/pkg/memorylocker"
	_ "modernc.org/sqlite"
)

type Server struct {
	cfg          Config
	db           *sql.DB
	lockFile     *os.File
	locker       *memorylocker.MemoryLocker
	tus          http.Handler
	mux          *http.ServeMux
	budgetMu     sync.Mutex
	editFault    func(string) error // package tests inject durability-boundary failures
	lastCreated  time.Time
	eventsBroker broker
	done         chan struct{}
	workers      sync.WaitGroup
	closeOnce    sync.Once
	doneOnce     sync.Once
}

// Open takes a process-wide advisory lock for this data directory. The custom
// tusd datastore stores protocol metadata in SQLite and byte offsets on disk.
// Do not share the directory between processes or modify blob files externally.
func Open(cfg Config) (_ *Server, err error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	cfg.DataDir, err = filepath.Abs(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{cfg.DataDir, filepath.Join(cfg.DataDir, "blobs")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		if err := os.Chmod(dir, 0700); err != nil {
			return nil, err
		}
	}
	s := &Server{cfg: cfg, done: make(chan struct{}), locker: memorylocker.New(), eventsBroker: broker{subs: make(map[*subscriber]struct{})}}
	defer func() {
		if err != nil {
			s.Close()
		}
	}()
	s.lockFile, err = os.OpenFile(filepath.Join(cfg.DataDir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(s.lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil, errors.New("data directory is already in use")
	}
	databaseURL := url.URL{Scheme: "file", Path: filepath.Join(cfg.DataDir, "metadata.sqlite")}
	databaseURL.RawQuery = url.Values{"_pragma": {"foreign_keys(1)", "busy_timeout(5000)", "synchronous(FULL)"}}.Encode()
	s.db, err = sql.Open("sqlite", databaseURL.String())
	if err != nil {
		return nil, err
	}
	s.db.SetMaxOpenConns(1)
	if err = s.migrate(); err != nil {
		return nil, err
	}
	if err = os.Chmod(filepath.Join(cfg.DataDir, "metadata.sqlite"), 0600); err != nil {
		return nil, err
	}
	var last sql.NullString
	if err = s.db.QueryRow(`SELECT MAX(created_at) FROM items`).Scan(&last); err != nil {
		return nil, err
	}
	if last.Valid {
		s.lastCreated, err = time.Parse(timestampFormat, last.String)
		if err != nil {
			return nil, err
		}
	}
	if err = s.recover(); err != nil {
		return nil, fmt.Errorf("recover storage: %w", err)
	}
	composer := handler.NewStoreComposer()
	store := &uploadStore{s}
	composer.UseCore(store)
	composer.UseTerminater(store)
	s.locker.UseIn(composer)
	tus, err := handler.NewHandler(handler.Config{
		BasePath: "/api/uploads/", StoreComposer: composer, MaxSize: cfg.MaxFileBytes,
		DisableDownload: true, RespectForwardedHeaders: false,
		Cors: &handler.CorsConfig{Disable: true},
		PreUploadCreateCallback: func(hook handler.HookEvent) (handler.HTTPResponse, handler.FileInfoChanges, error) {
			id, err := newID()
			return handler.HTTPResponse{Header: handler.HTTPHeader{"X-Item-ID": id, "Upload-Offset": "0"}}, handler.FileInfoChanges{ID: id}, err
		},
	})
	if err != nil {
		return nil, err
	}
	s.tus = http.StripPrefix("/api/uploads/", tus)
	s.routes()
	if cfg.UploadTTL > 0 {
		s.workers.Add(1)
		go s.cleanupLoop()
	}
	return s, nil
}

// Close must be called after the HTTP server has stopped accepting requests.
func (s *Server) Close() error {
	var err error
	s.closeOnce.Do(func() {
		s.BeginShutdown()
		s.workers.Wait()
		if s.db != nil {
			err = s.db.Close()
		}
		if s.lockFile != nil {
			_ = syscall.Flock(int(s.lockFile.Fd()), syscall.LOCK_UN)
			if e := s.lockFile.Close(); err == nil {
				err = e
			}
		}
	})
	return err
}

// BeginShutdown releases long-lived SSE requests before HTTP Shutdown waits.
func (s *Server) BeginShutdown() { s.doneOnce.Do(func() { close(s.done) }) }

func (s *Server) blob(id string) string { return filepath.Join(s.cfg.DataDir, "blobs", id) }

func (s *Server) withItemLock(ctx context.Context, id string, f func() error) error {
	lock, err := s.locker.NewLock(id)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err = lock.Lock(ctx, func() {}); err != nil {
		return err
	}
	defer lock.Unlock()
	return f()
}

func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serveHTTP) }

func (s *Server) routes() {
	s.mux = http.NewServeMux()
	s.mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			methodError(w)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok", "version": "0.1.0"})
	})
	s.mux.HandleFunc("/api/session", s.session)
	s.mux.HandleFunc("/api/items", s.items)
	s.mux.HandleFunc("/api/items/", s.item)
	s.mux.HandleFunc("/api/text", s.text)
	s.mux.HandleFunc("/api/storage", s.storage)
	s.mux.HandleFunc("/api/events", s.events)
	s.mux.HandleFunc("/api/devices", s.devices)
	s.mux.HandleFunc("/api/devices/register", s.registerDevice)
	s.mux.HandleFunc("/api/devices/", s.device)
	s.mux.HandleFunc("/api/uploads/", s.uploads)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeError(w, 404, "not_found", "Endpoint not found") })
	if s.cfg.WebDir != "" {
		s.mux.Handle("/", http.FileServer(http.Dir(s.cfg.WebDir)))
	} else {
		s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	}
}
