//! Real HTTP integration tests: bounded chunks, restart, source identity and range safety.
use household_native::{Config, Queue};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

const CHUNK: usize = 8 * 1024 * 1024;
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}
fn read_request(stream: &mut TcpStream) -> Request {
    // macOS inherits the listener's nonblocking mode on accepted sockets.
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        let mut b = [0];
        stream.read_exact(&mut b).unwrap();
        header.push(b[0]);
        assert!(header.len() < 16384);
    }
    let text = String::from_utf8(header).unwrap();
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap().split(' ');
    let method = first.next().unwrap().into();
    let path = first.next().unwrap().into();
    let headers: HashMap<_, _> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.to_lowercase(), v.trim().to_owned()))
        .collect();
    let size = headers
        .get("content-length")
        .map(|s| s.parse::<usize>().unwrap())
        .unwrap_or(0);
    let mut body = vec![0; size];
    stream.read_exact(&mut body).unwrap();
    Request {
        method,
        path,
        headers,
        body,
    }
}
fn reply(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(&str, String)],
    body: &[u8],
    head: bool,
) {
    write!(stream, "HTTP/1.1 {status}\r\nConnection: close\r\n").unwrap();
    if !headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("content-length"))
    {
        write!(stream, "Content-Length: {}\r\n", body.len()).unwrap();
    }
    for (k, v) in headers {
        write!(stream, "{k}: {v}\r\n").unwrap();
    }
    write!(stream, "\r\n").unwrap();
    if !head {
        let _ = stream.write_all(body);
    }
}
#[derive(Default)]
struct State {
    length: usize,
    bytes: Vec<u8>,
    chunks: Vec<usize>,
    gets: Vec<u64>,
    bad_range: bool,
    changed_etag: bool,
    etag: Option<String>,
    delete: bool,
    validation: Option<String>,
    reject_final: bool,
    drop_final_ack: bool,
    ready_conflict: bool,
}
struct Server {
    url: String,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(State::default()));
        let shared = state.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let end = stop.clone();
        let worker = thread::spawn(move || {
            while !end.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(x) => x,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                let req = read_request(&mut stream);
                assert_eq!(
                    req.headers.get("authorization").unwrap(),
                    "Bearer test-token"
                );
                let mut s = shared.lock().unwrap();
                match (req.method.as_str(), req.path.as_str()) {
                    ("POST", "/api/uploads/") => {
                        s.length = req.headers["upload-length"].parse().unwrap();
                        reply(
                            &mut stream,
                            "201 Created",
                            &[
                                ("Location", "/api/uploads/test".into()),
                                ("X-Item-ID", "item".into()),
                                ("Upload-Offset", "0".into()),
                            ],
                            b"",
                            false,
                        )
                    }
                    ("HEAD", "/api/uploads/test") => reply(
                        &mut stream,
                        "200 OK",
                        &[
                            ("Upload-Offset", s.bytes.len().to_string()),
                            ("Upload-Length", s.length.to_string()),
                        ],
                        b"",
                        true,
                    ),
                    ("PATCH", "/api/uploads/test") => {
                        assert_eq!(
                            req.headers["upload-offset"].parse::<usize>().unwrap(),
                            s.bytes.len()
                        );
                        assert!(req.body.len() <= CHUNK);
                        s.chunks.push(req.body.len());
                        s.bytes.extend_from_slice(&req.body);
                        if s.bytes.len() == s.length && s.drop_final_ack {
                            s.drop_final_ack = false;
                            continue;
                        }
                        if s.bytes.len() == s.length && s.reject_final {
                            s.validation = Some("failed".into());
                            reply(&mut stream, "422 Unprocessable Entity", &[], b"", false);
                            continue;
                        }
                        reply(
                            &mut stream,
                            "204 No Content",
                            &[("Upload-Offset", s.bytes.len().to_string())],
                            b"",
                            false,
                        );
                    }
                    ("DELETE", "/api/uploads/test") => {
                        if s.ready_conflict && s.bytes.len() == s.length {
                            reply(&mut stream, "409 Conflict", &[], b"", false);
                            continue;
                        }
                        s.delete = true;
                        reply(&mut stream, "204 No Content", &[], b"", false)
                    }
                    ("HEAD", "/api/items/item/download") => reply(
                        &mut stream,
                        "200 OK",
                        &[
                            ("Content-Length", s.bytes.len().to_string()),
                            (
                                "ETag",
                                s.etag.clone().unwrap_or_else(|| "\"original\"".into()),
                            ),
                        ],
                        b"",
                        true,
                    ),
                    ("GET", "/api/items/item/download") => {
                        let range = req.headers["range"].strip_prefix("bytes=").unwrap();
                        let (from, to) = range.split_once('-').unwrap();
                        let from: usize = from.parse().unwrap();
                        let to: usize = to.parse().unwrap();
                        s.gets.push(from as u64);
                        let offset = if s.bad_range { from + 1 } else { from };
                        let etag = if s.changed_etag {
                            "\"changed\""
                        } else {
                            s.etag.as_deref().unwrap_or("\"original\"")
                        };
                        reply(
                            &mut stream,
                            "206 Partial Content",
                            &[
                                (
                                    "Content-Range",
                                    format!("bytes {offset}-{to}/{}", s.bytes.len()),
                                ),
                                ("ETag", etag.into()),
                            ],
                            &s.bytes[from..=to],
                            false,
                        );
                    }
                    ("GET", "/api/items/item") => {
                        let status = s.validation.clone().unwrap_or_else(|| {
                            if s.bytes.len() == s.length {
                                "ready"
                            } else {
                                "uploading"
                            }
                            .into()
                        });
                        let body=serde_json::to_vec(&serde_json::json!({"item":{"id":"item","size":s.length,"status":status}})).unwrap();
                        reply(&mut stream, "200 OK", &[], &body, false);
                    }
                    ("GET", "/api/items/item/text") => reply(
                        &mut stream,
                        "200 OK",
                        &[("Content-Length", (8 * 1024 * 1024 + 1).to_string())],
                        b"",
                        false,
                    ),
                    _ => panic!("Unexpected {} {}", req.method, req.path),
                }
            }
        });
        Self {
            url,
            state,
            stop,
            worker: Some(worker),
        }
    }
    fn config(&self) -> Config {
        Config {
            base_url: self.url.clone(),
            token: "test-token".into(),
            source_device: "test".into(),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.worker.take() {
            if let Err(panic) = h.join() {
                if !thread::panicking() {
                    std::panic::resume_unwind(panic);
                }
            }
        }
    }
}
#[test]
fn request_reader_handles_nonblocking_stream_and_fragmented_body() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (mut stream, _) = listener.accept().unwrap();
    stream.set_nonblocking(true).unwrap();
    client
        .write_all(b"PATCH /api/uploads/test HTTP/1.1\r\nContent-Length: 4\r\n\r\nte")
        .unwrap();
    let worker = thread::spawn(move || read_request(&mut stream));
    thread::sleep(Duration::from_millis(20));
    client.write_all(b"xt").unwrap();
    let req = worker.join().unwrap();
    assert_eq!(req.method, "PATCH");
    assert_eq!(req.path, "/api/uploads/test");
    assert_eq!(req.body, b"text");
}
#[test]
fn server_worker_panic_fails_without_double_panic_during_cleanup() {
    for unwinding in [false, true] {
        let server = Server {
            url: String::new(),
            state: Default::default(),
            stop: Default::default(),
            worker: Some(thread::spawn(|| panic!("worker failure"))),
        };
        let failure = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _server = server;
            if unwinding {
                panic!("test failure");
            }
        }))
        .unwrap_err();
        assert_eq!(
            failure.downcast_ref::<&str>(),
            Some(&if unwinding {
                "test failure"
            } else {
                "worker failure"
            })
        );
    }
}
fn data() -> Vec<u8> {
    (0..CHUNK + 7321).map(|i| (i % 251) as u8).collect()
}

#[test]
fn upload_and_download_resume_across_queue_restart() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let source = temp.path().join("source.bin");
    let bytes = data();
    fs::write(&source, &bytes).unwrap();
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    q.enqueue_upload(&source, "file").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].offset, CHUNK as u64);
    drop(q);
    let q = Queue::open(root.clone()).unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "complete");
    assert_eq!(server.state.lock().unwrap().bytes, bytes);
    assert_eq!(server.state.lock().unwrap().chunks, vec![CHUNK, 7321]);
    let destination = temp.path().join("download.bin");
    let id = q
        .download("item".into(), "download.bin".into(), destination.clone())
        .unwrap();
    q.tick().unwrap();
    assert!(!destination.exists());
    q.control(&id, "pause").unwrap();
    assert!(!q.tick().unwrap());
    drop(q);
    let q = Queue::open(root).unwrap();
    q.control(&id, "resume").unwrap();
    q.tick().unwrap();
    assert_eq!(fs::read(destination).unwrap(), bytes);
    assert_eq!(server.state.lock().unwrap().gets, vec![0, CHUNK as u64]);
}
#[test]
fn source_change_blocks_network_and_cancel_terminates_remote() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let q = Queue::open(temp.path().join("queue")).unwrap();
    q.configure(server.config()).unwrap();
    let path = temp.path().join("file.bin");
    fs::write(&path, data()).unwrap();
    q.enqueue_upload(&path, "file").unwrap();
    q.tick().unwrap();
    let id = q.list().unwrap()[0].id.clone();
    fs::write(&path, b"changed source").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "error");
    assert_eq!(server.state.lock().unwrap().chunks.len(), 1);
    q.control(&id, "cancel").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "cancelled");
    assert!(server.state.lock().unwrap().delete);
}
#[test]
fn changed_etag_and_bad_range_never_publish() {
    for changed_etag in [false, true] {
        let server = Server::new();
        {
            let mut s = server.state.lock().unwrap();
            s.bytes = data();
            s.bad_range = !changed_etag;
            s.changed_etag = changed_etag;
        }
        let temp = tempfile::tempdir().unwrap();
        let q = Queue::open(temp.path().join("queue")).unwrap();
        q.configure(server.config()).unwrap();
        let destination = temp.path().join("saved.bin");
        q.download("item".into(), "saved.bin".into(), destination.clone())
            .unwrap();
        q.tick().unwrap();
        assert_eq!(q.list().unwrap()[0].status, "error");
        assert!(!destination.exists());
    }
}
#[test]
fn explicit_quit_persists_pause_and_existing_target_is_safe() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    let path = temp.path().join("file.bin");
    fs::write(&path, b"keep").unwrap();
    assert!(q
        .download("item".into(), "file.bin".into(), path.clone())
        .is_err());
    q.enqueue_upload(&path, "file").unwrap();
    q.shutdown().unwrap();
    drop(q);
    let q = Queue::open(root).unwrap();
    assert_eq!(q.list().unwrap()[0].status, "paused");
    assert!(!q.tick().unwrap());
    assert_eq!(fs::read(path).unwrap(), b"keep");
}

#[test]
fn restored_timestamp_does_not_hide_middle_source_changes_after_restart() {
    use std::fs::{FileTimes, OpenOptions};
    use std::io::{Seek, SeekFrom};
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let path = temp.path().join("source.bin");
    fs::write(&path, data()).unwrap();
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    q.enqueue_upload(&path, "file").unwrap();
    q.tick().unwrap();
    drop(q);
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut file = OpenOptions::new().write(true).open(&path).unwrap();
    file.seek(SeekFrom::Start(1024 * 1024)).unwrap();
    file.write_all(b"!").unwrap();
    file.sync_all().unwrap();
    file.set_times(FileTimes::new().set_modified(modified))
        .unwrap();
    drop(file);
    let q = Queue::open(root).unwrap();
    q.tick().unwrap();
    let view = q.list().unwrap();
    assert_eq!(view[0].status, "error");
    assert!(view[0]
        .error
        .as_ref()
        .unwrap()
        .contains("Source bytes changed"));
    assert_eq!(server.state.lock().unwrap().chunks.len(), 1);
}

#[test]
fn available_server_checksum_is_verified_before_publication() {
    use sha2::{Digest, Sha256};
    for valid in [false, true] {
        let server = Server::new();
        let bytes = b"server bytes";
        {
            let mut s = server.state.lock().unwrap();
            s.bytes = bytes.to_vec();
            s.etag = Some(format!(
                "\"sha256-{:x}\"",
                Sha256::digest(if valid {
                    bytes.as_slice()
                } else {
                    b"corrupt".as_slice()
                })
            ));
        }
        let temp = tempfile::tempdir().unwrap();
        let q = Queue::open(temp.path().join("queue")).unwrap();
        q.configure(server.config()).unwrap();
        let path = temp.path().join("result.bin");
        q.download("item".into(), "result.bin".into(), path.clone())
            .unwrap();
        q.tick().unwrap();
        if valid {
            assert_eq!(q.list().unwrap()[0].status, "complete");
            assert_eq!(fs::read(path).unwrap(), bytes);
        } else {
            assert_eq!(q.list().unwrap()[0].status, "error");
            assert!(!path.exists());
        }
    }
}
#[test]
fn native_text_budget_and_disconnect_clear_all_saved_credentials() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    assert!(q
        .api("GET", "/api/items/item/text", None)
        .unwrap_err()
        .contains("preparation budget"));
    let source = temp.path().join("original.bin");
    fs::write(&source, b"bytes").unwrap();
    q.enqueue_upload(&source, "file").unwrap();
    q.disconnect().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "paused");
    assert!(!fs::read_to_string(root.join("queue.json"))
        .unwrap()
        .contains("test-token"));
    assert!(!fs::read_to_string(root.join("config.json"))
        .unwrap()
        .contains("test-token"));
    assert_eq!(q.connection().unwrap().base_url, server.url);
    assert!(!q.connection().unwrap().connected);
}
#[test]
fn zero_byte_upload_and_download_complete_without_range_request() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let q = Queue::open(temp.path().join("queue")).unwrap();
    q.configure(server.config()).unwrap();
    let source = temp.path().join("empty.bin");
    fs::write(&source, b"").unwrap();
    q.enqueue_upload(&source, "file").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "complete");
    let destination = temp.path().join("saved-empty.bin");
    q.download("item".into(), "empty.bin".into(), destination.clone())
        .unwrap();
    q.tick().unwrap();
    assert_eq!(fs::metadata(destination).unwrap().len(), 0);
    assert!(server.state.lock().unwrap().gets.is_empty());
}

#[test]
fn rejected_final_text_never_becomes_complete_on_retry() {
    use household_native::spool_text;
    let server = Server::new();
    server.state.lock().unwrap().reject_final = true;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    spool_text(&root, &mut &b"\xff\xfe"[..]).unwrap();
    q.tick().unwrap();
    let id = q.list().unwrap()[0].id.clone();
    assert_eq!(q.list().unwrap()[0].status, "error");
    q.control(&id, "resume").unwrap();
    q.tick().unwrap();
    let t = q.list().unwrap()[0].clone();
    assert_eq!(t.status, "error");
    assert!(t.error.unwrap().contains("rejected upload validation"));
    assert_eq!(
        fs::read_dir(root.join("staging")).unwrap().count(),
        1,
        "Rejected source must remain available"
    );
}
#[test]
fn lost_final_ack_then_cancel_settles_to_already_ready() {
    let server = Server::new();
    {
        let mut s = server.state.lock().unwrap();
        s.drop_final_ack = true;
        s.ready_conflict = true;
    }
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let q = Queue::open(root).unwrap();
    q.configure(server.config()).unwrap();
    let source = temp.path().join("source.bin");
    fs::write(&source, b"all bytes").unwrap();
    q.enqueue_upload(&source, "file").unwrap();
    q.tick().unwrap();
    let first = q.list().unwrap()[0].clone();
    assert_eq!(first.status, "queued");
    assert!(first.error.unwrap().starts_with("Network:"));
    q.control(&first.id, "resume").unwrap();
    q.control(&first.id, "cancel").unwrap();
    q.tick().unwrap();
    let t = q.list().unwrap()[0].clone();
    assert_eq!(t.status, "complete");
    assert_eq!(t.offset, t.size);
    assert!(!server.state.lock().unwrap().delete);
}
#[test]
fn pending_validation_retains_stage_and_can_resume_after_restart() {
    use household_native::spool_text;
    let server = Server::new();
    server.state.lock().unwrap().validation = Some("uploading".into());
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    #[cfg(unix)]
    {
        let physical_root = temp.path().join("physical-queue");
        fs::create_dir(&physical_root).unwrap();
        std::os::unix::fs::symlink(physical_root, &root).unwrap();
    }
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    spool_text(&root, &mut &b"text"[..]).unwrap();
    q.tick().unwrap();
    let first = q.list().unwrap()[0].clone();
    assert_eq!(first.status, "validating");
    assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 1);
    drop(q);
    let q = Queue::open(root.clone()).unwrap();
    server.state.lock().unwrap().validation = Some("ready".into());
    q.control(&first.id, "resume").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "complete");
    assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
}
