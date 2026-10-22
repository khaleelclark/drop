package share

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type event struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}
type subscriber struct {
	events   chan event
	overflow chan struct{}
}
type broker struct {
	mu   sync.Mutex
	subs map[*subscriber]struct{}
}

func (b *broker) publish(kind, id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for sub := range b.subs {
		select {
		case sub.events <- event{kind, id}:
		default:
			// Force a refresh through reconnect instead of silently losing events.
			close(sub.overflow)
			delete(b.subs, sub)
		}
	}
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodError(w)
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		writeError(w, 500, "stream_unavailable", "Streaming unavailable")
		return
	}
	sub := &subscriber{make(chan event, 32), make(chan struct{})}
	s.eventsBroker.mu.Lock()
	if len(s.eventsBroker.subs) >= 128 {
		s.eventsBroker.mu.Unlock()
		writeError(w, 503, "connection_limit", "Too many event streams")
		return
	}
	s.eventsBroker.subs[sub] = struct{}{}
	s.eventsBroker.mu.Unlock()
	defer func() { s.eventsBroker.mu.Lock(); delete(s.eventsBroker.subs, sub); s.eventsBroker.mu.Unlock() }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	send := func(data string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, data); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	if !send(": connected; refresh feed\n\n") {
		return
	}
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case e := <-sub.events:
			body, _ := json.Marshal(e)
			if !send("event: items\ndata: " + string(body) + "\n\n") {
				return
			}
		case <-ticker.C:
			if !send(": heartbeat\n\n") {
				return
			}
		case <-sub.overflow:
			return
		case <-r.Context().Done():
			return
		case <-s.done:
			return
		}
	}
}
