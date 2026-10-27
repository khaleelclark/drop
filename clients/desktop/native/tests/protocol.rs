//! Real HTTP integration tests: bounded chunks, restart, source identity and range safety.
use base64::{engine::general_purpose::STANDARD, Engine as _};
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
    item_deleted: bool,
    validation: Option<String>,
    reject_final: bool,
    drop_final_ack: bool,
    ready_conflict: bool,
    registration: Option<serde_json::Value>,
    registration_requests: Vec<serde_json::Value>,
    upload_metadata: String,
    upload_kind: String,
    item_override: Option<serde_json::Value>,
    arrivals: Vec<serde_json::Value>,
    ack: u64,
    ack_lost: bool,
    ack_calls: Vec<String>,
    arrival_queries: Vec<String>,
    arrival_metadata: Option<serde_json::Value>,
    metadata_status: Option<&'static str>,
    metadata_queries: Vec<String>,
    metadata_gate: Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
    bad_cursor: bool,
    drop_creation: bool,
    creation_status: Option<u16>,
    creations: u32,
    quick_devices: Vec<serde_json::Value>,
    quick_texts: Vec<serde_json::Value>,
    drop_quick_text: bool,
    invalid_quick_receipt: bool,
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
                    ("GET", "/api/devices") => {
                        let mut devices = s.quick_devices.clone();
                        devices.extend(s.registration.clone());
                        reply(
                            &mut stream,
                            "200 OK",
                            &[],
                            &serde_json::to_vec(&serde_json::json!({"devices":devices})).unwrap(),
                            false,
                        );
                    }
                    ("POST", "/api/text") => {
                        s.quick_texts
                            .push(serde_json::from_slice(&req.body).unwrap());
                        if s.drop_quick_text {
                            continue;
                        }
                        let receipt = if s.invalid_quick_receipt {
                            serde_json::json!({"item":{"id":"b".repeat(32),"kind":"text","status":"uploading"}})
                        } else {
                            serde_json::json!({"item":{"id":"b".repeat(32),"kind":"text","status":"ready"}})
                        };
                        reply(
                            &mut stream,
                            "201 Created",
                            &[],
                            &serde_json::to_vec(&receipt).unwrap(),
                            false,
                        );
                    }
                    ("POST", "/api/devices/register") => {
                        let device: serde_json::Value = serde_json::from_slice(&req.body).unwrap();
                        s.registration_requests.push(device.clone());
                        if device["preserveExisting"] != true || s.registration.is_none() {
                            s.registration = Some(
                                serde_json::json!({"id": device["id"], "label": device["label"], "platform": device["platform"]}),
                            );
                        }
                        reply(
                            &mut stream,
                            "200 OK",
                            &[],
                            &serde_json::to_vec(&serde_json::json!({"device":s.registration}))
                                .unwrap(),
                            false,
                        );
                    }
                    ("GET", path) if path.contains("/notifications?") => {
                        s.arrival_queries.push(path.into());
                        let cursor = path
                            .split("after=")
                            .nth(1)
                            .unwrap()
                            .split('&')
                            .next()
                            .unwrap()
                            .parse::<u64>()
                            .unwrap();
                        let matching: Vec<_> = s
                            .arrivals
                            .iter()
                            .filter(|n| {
                                n["sequence"].as_str().unwrap().parse::<u64>().unwrap() > cursor
                            })
                            .take(50)
                            .cloned()
                            .collect();
                        let next = if s.bad_cursor {
                            "9223372036854775808".into()
                        } else {
                            matching
                                .last()
                                .map(|n| n["sequence"].as_str().unwrap().to_string())
                                .unwrap_or(cursor.to_string())
                        };
                        let body = serde_json::json!({"notifications": matching,"nextCursor":next,"ackCursor":s.ack.to_string(),"hasMore":false});
                        reply(
                            &mut stream,
                            "200 OK",
                            &[],
                            &serde_json::to_vec(&body).unwrap(),
                            false,
                        );
                    }
                    ("POST", path) if path.ends_with("/notifications/ack") => {
                        let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap();
                        let cursor = body["through"].as_str().unwrap();
                        s.ack_calls.push(cursor.into());
                        s.ack = s.ack.max(cursor.parse().unwrap());
                        if s.ack_lost {
                            s.ack_lost = false;
                            continue;
                        }
                        let bytes =
                            serde_json::to_vec(&serde_json::json!({"ackCursor":s.ack.to_string()}))
                                .unwrap();
                        reply(&mut stream, "200 OK", &[], &bytes, false);
                    }
                    ("POST", "/api/uploads/") => {
                        s.creations += 1;
                        if s.drop_creation {
                            continue;
                        }
                        if let Some(status) = s.creation_status {
                            reply(
                                &mut stream,
                                &format!("{status} Test rejection"),
                                &[],
                                b"",
                                false,
                            );
                            continue;
                        }
                        s.upload_metadata = req.headers["upload-metadata"].clone();
                        let kind = s
                            .upload_metadata
                            .split(',')
                            .find_map(|field| field.strip_prefix("kind "))
                            .unwrap();
                        s.upload_kind = String::from_utf8(STANDARD.decode(kind).unwrap()).unwrap();
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
                    ("DELETE", "/api/items/item") => {
                        assert!(req.body.is_empty());
                        s.item_deleted = true;
                        stream
                            .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                            .unwrap();
                    }
                    ("GET", "/api/items/item") if s.item_deleted => {
                        reply(
                            &mut stream,
                            "404 Not Found",
                            &[],
                            br#"{"error":{"code":"not_found","message":"Item not found"}}"#,
                            false,
                        );
                    }
                    ("GET", "/api/items/item") => {
                        if let Some((entered, release)) = &s.metadata_gate {
                            entered.send(()).unwrap();
                            release.recv_timeout(Duration::from_secs(5)).unwrap();
                        }
                        let status = s.validation.clone().unwrap_or_else(|| {
                            if s.bytes.len() == s.length {
                                "ready"
                            } else {
                                "uploading"
                            }
                            .into()
                        });
                        let item = s.item_override.clone().unwrap_or_else(|| {
                            serde_json::json!({"id":"item","kind":s.upload_kind,"size":s.length,"status":status})
                        });
                        let body = serde_json::to_vec(&serde_json::json!({"item":item})).unwrap();
                        reply(&mut stream, "200 OK", &[], &body, false);
                    }
                    ("GET", "/api/items/item/text") => reply(
                        &mut stream,
                        "200 OK",
                        &[("Content-Length", (8 * 1024 * 1024 + 1).to_string())],
                        b"",
                        false,
                    ),
                    ("GET", path) if path.starts_with("/api/items/") && path.len() == 43 => {
                        s.metadata_queries.push(path.into());
                        if let Some((entered, release)) = &s.metadata_gate {
                            entered.send(()).unwrap();
                            release.recv_timeout(Duration::from_secs(5)).unwrap();
                        }
                        let status = s
                            .metadata_status
                            .unwrap_or(if s.arrival_metadata.is_some() {
                                "200 OK"
                            } else {
                                "404 Not Found"
                            });
                        let body = serde_json::to_vec(&s.arrival_metadata).unwrap();
                        reply(&mut stream, status, &[], &body, false);
                    }
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
#[test]
fn quick_text_exact_routing_confirmation_and_no_automatic_retry() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let q = Queue::open(temp.path().join("queue")).unwrap();
    q.configure(server.config()).unwrap();
    let id = q.connection().unwrap().device_id.unwrap();
    let receiver = "c".repeat(32);
    server
        .state
        .lock()
        .unwrap()
        .quick_devices
        .push(serde_json::json!({"id":receiver,"label":"Phone","platform":"android"}));
    let context = q.quick_context().unwrap();
    assert_eq!(context["baseUrl"], server.url);
    assert_eq!(context["sourceDeviceId"], id);
    let text = " \r\n <script>inert</script>\t🦊\n\n";
    assert_eq!(
        q.quick_send_text(&server.url, &id, vec![receiver.clone()], text.into())
            .unwrap(),
        "b".repeat(32)
    );
    assert_eq!(
        server.state.lock().unwrap().quick_texts[0],
        serde_json::json!({"text":text,"sourceDeviceId":id,"targetDeviceIds":[receiver]})
    );
    q.quick_send_text(&server.url, &id, vec![], "   ".into())
        .unwrap();
    assert_eq!(
        server.state.lock().unwrap().quick_texts[1]["targetDeviceIds"],
        serde_json::json!([])
    );
    for lost in [false, true] {
        let before = server.state.lock().unwrap().quick_texts.len();
        {
            let mut s = server.state.lock().unwrap();
            s.invalid_quick_receipt = !lost;
            s.drop_quick_text = lost;
        }
        let error = q
            .quick_send_text(&server.url, &id, vec![], text.into())
            .unwrap_err();
        assert!(error.contains("may already have been shared"));
        assert_eq!(server.state.lock().unwrap().quick_texts.len(), before + 1);
    }
    assert!(q.list().unwrap().is_empty());
    assert_eq!(
        fs::read_dir(temp.path().join("queue/intake"))
            .unwrap()
            .count(),
        0
    );
}
#[test]
fn quick_stale_destinations_fail_and_file_snapshot_survives_reconfiguration() {
    let server = Server::new();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    let id = q.connection().unwrap().device_id.unwrap();
    let receiver = "c".repeat(32);
    let device = serde_json::json!({"id":receiver,"label":"Phone","platform":"android"});
    server
        .state
        .lock()
        .unwrap()
        .quick_devices
        .push(device.clone());
    let source = temp.path().join("file.bin");
    fs::write(&source, b"unchanged").unwrap();
    let context = q
        .quick_prepare(&server.url, &id, vec![receiver.clone()])
        .unwrap();
    server.state.lock().unwrap().quick_devices.clear();
    assert!(q
        .quick_prepare(&server.url, &id, vec![receiver.clone()])
        .is_err());
    assert!(q
        .quick_send_text(&server.url, &id, vec![receiver.clone()], "unsent".into())
        .is_err());
    assert!(server.state.lock().unwrap().quick_texts.is_empty());
    q.configure(Config {
        base_url: "https://different.example".into(),
        token: "next-token".into(),
        source_device: "New name".into(),
    })
    .unwrap();
    q.enqueue_prepared(&source, "file", &context).unwrap();
    let disk: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("queue.json")).unwrap()).unwrap();
    let transfer = &disk["transfers"][0];
    assert_eq!(transfer["config"]["baseUrl"], server.url);
    assert_eq!(transfer["routing"]["sourceDeviceId"], id);
    assert_eq!(
        transfer["routing"]["targetDeviceIds"],
        serde_json::json!([receiver])
    );
    assert!(q.quick_prepare(&server.url, &id, vec![]).is_err());
    drop(context);
    drop(q);
    let reopened = Queue::open(root).unwrap();
    assert_eq!(reopened.list().unwrap().len(), 1);
    assert_eq!(reopened.list().unwrap()[0].status, "paused");
}
fn data() -> Vec<u8> {
    (0..CHUNK + 7321).map(|i| (i % 251) as u8).collect()
}

#[test]
fn native_api_delete_accepts_204_without_a_body() {
    let server = Server::new();
    let tmp = tempfile::tempdir().unwrap();
    let q = Queue::open(tmp.path().into()).unwrap();
    q.configure(server.config()).unwrap();
    let response = q.api("DELETE", "/api/items/item", None).unwrap();
    assert_eq!(response.status, 204);
    assert!(response.body.is_empty());
    assert!(!response.headers.contains_key("content-type"));
    assert!(!response.headers.contains_key("content-length"));
    assert!(server.state.lock().unwrap().item_deleted);
    let follow_up = q.api("GET", "/api/items/item", None).unwrap();
    assert_eq!(follow_up.status, 404);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&follow_up.body).unwrap()["error"]["code"],
        "not_found"
    );
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

#[test]
fn edited_ready_text_reconciles_without_reupload_or_retained_stage() {
    use household_native::spool_text;
    let original = b"original text";
    for path in ["final_ack", "validation", "lost_final_ack", "cancel"] {
        for edited_size in [original.len() + 23, 4, 0] {
            let server = Server::new();
            {
                let mut s = server.state.lock().unwrap();
                s.drop_final_ack = matches!(path, "lost_final_ack" | "cancel");
                s.ready_conflict = path == "cancel";
                s.validation = Some("uploading".into());
                if path == "final_ack" {
                    s.item_override = Some(serde_json::json!({
                        "id":"item", "kind":"text", "status":"ready", "size":edited_size
                    }));
                }
            }
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("queue");
            let q = Queue::open(root.clone()).unwrap();
            q.configure(server.config()).unwrap();
            spool_text(&root, &mut original.as_slice()).unwrap();
            q.tick().unwrap();
            let first = q.list().unwrap()[0].clone();
            if path != "final_ack" {
                assert_eq!(
                    first.status,
                    if path == "validation" {
                        "validating"
                    } else {
                        "queued"
                    }
                );
                assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 1);
            }
            drop(q);
            server.state.lock().unwrap().item_override = Some(serde_json::json!({
                "id":"item", "kind":"text", "status":"ready", "size":edited_size
            }));
            let q = Queue::open(root.clone()).unwrap();
            if path != "final_ack" {
                q.control(&first.id, "resume").unwrap();
                if path == "cancel" {
                    q.control(&first.id, "cancel").unwrap();
                }
                assert!(q.tick().unwrap());
            }
            let transfers = q.list().unwrap();
            assert_eq!(transfers.len(), 1);
            let t = &transfers[0];
            assert_eq!(t.id, first.id);
            assert_eq!(t.item_id.as_deref(), Some("item"));
            assert_eq!(
                t.status, "complete",
                "{path}, edited size {edited_size}: {t:?}"
            );
            assert_eq!(t.size, original.len() as u64);
            assert_eq!(t.offset, t.size);
            assert!(t.error.is_none());
            assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
            assert!(!q.tick().unwrap());
            let s = server.state.lock().unwrap();
            assert_eq!(s.bytes, original);
            assert_eq!(s.length, original.len());
            assert_eq!(s.chunks, vec![original.len()]);
            assert_eq!(s.creations, 1);
            assert!(!s.delete);
        }
    }
}

#[test]
fn upload_reconciliation_rejects_invalid_item_metadata_and_retains_stage() {
    use household_native::spool_text;
    for cancel in [false, true] {
        for (field, invalid) in [
            ("id", serde_json::json!("another-item")),
            ("kind", serde_json::json!("file")),
            ("status", serde_json::json!("unexpected")),
            ("status", serde_json::json!("failed")),
            ("size", serde_json::json!("4")),
            ("size", serde_json::json!(-1)),
            ("uploading_size", serde_json::json!(5)),
        ] {
            let server = Server::new();
            let mut item = serde_json::json!({
                "id":"item", "kind":"text", "status":"ready", "size":4
            });
            if field == "uploading_size" {
                item["status"] = serde_json::json!("uploading");
                item["size"] = invalid;
            } else {
                item[field] = invalid;
            }
            {
                let mut s = server.state.lock().unwrap();
                s.item_override = Some(item);
                s.drop_final_ack = cancel;
                s.ready_conflict = cancel;
            }
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("queue");
            let q = Queue::open(root.clone()).unwrap();
            q.configure(server.config()).unwrap();
            spool_text(&root, &mut &b"text"[..]).unwrap();
            q.tick().unwrap();
            let first = q.list().unwrap()[0].clone();
            if cancel {
                assert_eq!(first.status, "queued");
                q.control(&first.id, "resume").unwrap();
                q.control(&first.id, "cancel").unwrap();
                q.tick().unwrap();
            }
            let t = q.list().unwrap()[0].clone();
            assert_eq!(t.status, "error", "{field}, cancel {cancel}: {t:?}");
            assert!(t.error.is_some());
            assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 1);
            assert!(!q.tick().unwrap());
            let s = server.state.lock().unwrap();
            assert_eq!(s.creations, 1);
            assert!(!s.delete);
        }
    }
}

#[test]
fn edited_ready_text_does_not_bypass_original_tus_completion_checks() {
    use household_native::spool_text;
    for bad_offset in [false, true] {
        let server = Server::new();
        server.state.lock().unwrap().drop_final_ack = true;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let q = Queue::open(root.clone()).unwrap();
        q.configure(server.config()).unwrap();
        spool_text(&root, &mut &b"text"[..]).unwrap();
        q.tick().unwrap();
        let first = q.list().unwrap()[0].clone();
        assert_eq!(first.status, "queued");
        drop(q);
        {
            let mut s = server.state.lock().unwrap();
            s.item_override = Some(serde_json::json!({
                "id":"item", "kind":"text", "status":"ready", "size":0
            }));
            if bad_offset {
                s.bytes.push(b'!');
            } else {
                s.length += 1;
            }
        }
        let q = Queue::open(root.clone()).unwrap();
        q.control(&first.id, "resume").unwrap();
        q.tick().unwrap();
        let t = q.list().unwrap()[0].clone();
        assert_eq!(t.status, "error");
        assert!(t
            .error
            .unwrap()
            .contains("Invalid server upload length or offset"));
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 1);
        assert_eq!(server.state.lock().unwrap().creations, 1);
    }
}

#[test]
fn recipients_source_and_registration_survive_picker_pairing_and_restart() {
    let server = Server::new();
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    let source = q.connection().unwrap().device_id.unwrap();
    let target = "b".repeat(32);
    let context = q.prepare_send(None, Some(vec![target.clone()])).unwrap();
    let file = tmp.path().join("file.txt");
    fs::write(&file, b"test bytes").unwrap();
    q.configure(Config {
        base_url: "https://different.example".into(),
        ..server.config()
    })
    .unwrap();
    q.enqueue_prepared(&file, "file", &context).unwrap();
    assert_eq!(q.list().unwrap()[0].status, "paused");
    let transfer = q.list().unwrap()[0].id.clone();
    drop(context);
    drop(q);
    let q = Queue::open(root).unwrap();
    q.configure(Config {
        source_device: "Later label".into(),
        ..server.config()
    })
    .unwrap();
    q.control(&transfer, "resume").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "complete");
    let s = server.state.lock().unwrap();
    assert_eq!(s.registration.as_ref().unwrap()["id"], source);
    assert_eq!(s.registration.as_ref().unwrap()["label"], "test");
    assert!(s
        .upload_metadata
        .contains(&format!("sourceDeviceId {}", STANDARD.encode(source))));
    assert!(s.upload_metadata.contains(&format!(
        "targetDeviceIds {}",
        STANDARD.encode(serde_json::to_vec(&vec![target]).unwrap())
    )));
}

#[test]
fn queued_and_arrival_registration_preserve_explicit_device_rename() {
    let server = Server::new();
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    let id = q.connection().unwrap().device_id.unwrap();
    let file = tmp.path().join("old-capture.txt");
    fs::write(&file, b"queued before rename").unwrap();
    q.enqueue_upload(&file, "file").unwrap();
    q.api(
        "POST",
        "/api/devices/register",
        Some(serde_json::json!({
            "id":id, "label":"Current explicit name", "platform":"browser"
        })),
    )
    .unwrap();
    drop(q);
    let q = Queue::open(root).unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "complete");
    q.set_arrival_enabled(true).unwrap();
    q.poll_arrivals(|_| panic!("No new arrivals")).unwrap();
    let s = server.state.lock().unwrap();
    let device = s.registration.as_ref().unwrap();
    assert_eq!(device["id"], id);
    assert_eq!(device["label"], "Current explicit name");
    assert_eq!(device["platform"], "browser");
    assert_eq!(s.registration_requests.len(), 3);
    assert!(s.registration_requests[0].get("preserveExisting").is_none());
    for request in &s.registration_requests[1..] {
        assert_eq!(request["label"], "test", "Exercise stale saved labels");
        assert_eq!(request["preserveExisting"], true);
    }
}

fn arrival(sequence: u64) -> serde_json::Value {
    serde_json::json!({"sequence":sequence.to_string(), "itemId":format!("{sequence:032x}"), "createdAt":"2026-10-23T14:00:00Z"})
}
#[test]
fn arrival_batches_dedupe_after_lost_ack_and_restart_and_keep_for_you() {
    let server = Server::new();
    server.state.lock().unwrap().arrivals = vec![arrival(1), arrival(2)];
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("queue");
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    q.poll_arrivals(|_| panic!("disabled means no banner"))
        .unwrap();
    assert!(server.state.lock().unwrap().registration.is_none());
    q.set_arrival_enabled(true).unwrap();
    server.state.lock().unwrap().ack_lost = true;
    let mut posted = Vec::new();
    assert!(q
        .poll_arrivals(|b| {
            posted.push(b);
            Ok(())
        })
        .is_err());
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0].title, "Drop");
    assert_eq!(posted[0].body, "2 new shares available");
    assert_eq!(posted[0].target.item_id, format!("{:032x}", 2));
    q.record_arrival_click(posted[0].target.clone()).unwrap();
    drop(q);
    let q = Queue::open(root).unwrap();
    assert_eq!(
        q.take_arrival_target().unwrap(),
        Some(posted[0].target.clone())
    );
    q.poll_arrivals(|_| panic!("saved progress must prevent repeat after lost ACK"))
        .unwrap();
    let s = server.state.lock().unwrap();
    assert_eq!(s.arrivals.len(), 2, "ACK retains For you records");
    assert_eq!(s.ack, 2);
    assert_eq!(s.ack_calls, vec!["2", "2"]);
    assert!(s.arrival_queries.last().unwrap().contains("after=2"));
}
#[test]
fn arrival_failure_replays_stable_id_and_invalid_cursor_never_acks() {
    let server = Server::new();
    {
        let mut s = server.state.lock().unwrap();
        s.arrivals = vec![arrival(3)];
        s.arrival_metadata = Some(serde_json::json!({"item":{"id":format!("{:032x}",3),
            "kind":"file","status":"ready","sourceDevice":"Lassen","name":"private.zip","size":1024}}));
    }
    let tmp = tempfile::tempdir().unwrap();
    let q = Queue::open(tmp.path().into()).unwrap();
    q.configure(server.config()).unwrap();
    q.set_arrival_enabled(true).unwrap();
    let mut ids = Vec::new();
    assert!(q
        .poll_arrivals(|b| {
            assert_eq!(b.title, "Lassen shared file");
            assert_eq!(b.body, "private.zip · 1.0 KiB");
            ids.push(b.id);
            Err("OS preparation failure".into())
        })
        .is_err());
    assert!(server.state.lock().unwrap().ack_calls.is_empty());
    assert!(q.arrival_settings().unwrap().last_error.is_some());
    q.poll_arrivals(|b| {
        ids.push(b.id);
        Ok(())
    })
    .unwrap();
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0], ids[1]);
    assert!(q.arrival_settings().unwrap().last_error.is_none());
    server.state.lock().unwrap().bad_cursor = true;
    let before = server.state.lock().unwrap().ack_calls.len();
    assert!(q
        .poll_arrivals(|_| panic!("invalid page must not post"))
        .is_err());
    assert_eq!(
        server.state.lock().unwrap().ack_calls.len(),
        before + 1,
        "only retry saved ACK"
    );
    q.set_arrival_enabled(false).unwrap();
    let before = server.state.lock().unwrap().arrival_queries.len();
    q.poll_arrivals(|_| panic!("disabled")).unwrap();
    assert_eq!(server.state.lock().unwrap().arrival_queries.len(), before);
}
#[test]
fn arrival_singleflight_and_quit_stop_work() {
    let server = Server::new();
    server.state.lock().unwrap().arrivals = vec![arrival(1)];
    let tmp = tempfile::tempdir().unwrap();
    let q = Queue::open(tmp.path().into()).unwrap();
    q.configure(server.config()).unwrap();
    q.set_arrival_enabled(true).unwrap();
    q.poll_arrivals(|_| {
        q.poll_arrivals(|_| panic!("must not reenter processor"))
            .unwrap();
        Ok(())
    })
    .unwrap();
    assert_eq!(server.state.lock().unwrap().arrival_queries.len(), 1);
    q.shutdown().unwrap();
    q.poll_arrivals(|_| panic!("Quit stops arrivals")).unwrap();
    assert_eq!(server.state.lock().unwrap().arrival_queries.len(), 1);
}
#[test]
fn arrival_metadata_enriches_only_latest_and_unavailable_details_fall_back() {
    for status in ["200 OK", "404 Not Found", "503 Service Unavailable"] {
        let server = Server::new();
        {
            let mut s = server.state.lock().unwrap();
            s.arrivals = (1..=50).map(arrival).collect();
            s.metadata_status = Some(status);
            s.arrival_metadata = Some(serde_json::json!({"item":{"id":format!("{:032x}",50),
                "kind":"text","status":"ready","sourceDevice":"Lassen","preview":"Private\nTest"}}));
        }
        let tmp = tempfile::tempdir().unwrap();
        let q = Queue::open(tmp.path().into()).unwrap();
        q.configure(server.config()).unwrap();
        q.set_arrival_enabled(true).unwrap();
        q.poll_arrivals(|b| {
            assert_eq!(b.target.item_id, format!("{:032x}", 50));
            if status == "200 OK" {
                assert_eq!(b.title, "50 new shares");
                assert_eq!(b.body, "Lassen shared text: Private Test");
            } else {
                assert_eq!(b.title, "Drop");
                assert_eq!(b.body, "50 new shares available");
            }
            assert!(server.state.lock().unwrap().ack_calls.is_empty());
            Ok(())
        })
        .unwrap();
        q.poll_arrivals(|_| panic!("dedupe after accepted post"))
            .unwrap();
        let s = server.state.lock().unwrap();
        assert_eq!(s.metadata_queries, vec![format!("/api/items/{:032x}", 50)]);
        assert_eq!(s.ack_calls, vec!["50", "50"]);
        let persisted = fs::read_to_string(tmp.path().join("devices.json")).unwrap();
        for content in ["Lassen", "Private", "Test", "preview"] {
            assert!(!persisted.contains(content));
        }
    }
}
#[test]
fn arrival_cancelled_during_metadata_never_posts_saves_or_acks() {
    let server = Server::new();
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    {
        let mut s = server.state.lock().unwrap();
        s.arrivals = vec![arrival(1)];
        s.metadata_gate = Some((entered_tx, release_rx));
    }
    let tmp = tempfile::tempdir().unwrap();
    let q = Queue::open(tmp.path().into()).unwrap();
    q.configure(server.config()).unwrap();
    q.set_arrival_enabled(true).unwrap();
    let poll = q.clone();
    let worker =
        thread::spawn(move || poll.poll_arrivals(|_| panic!("cancelled metadata must not post")));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    q.shutdown().unwrap();
    release_tx.send(()).unwrap();
    worker.join().unwrap().unwrap();
    assert!(server.state.lock().unwrap().ack_calls.is_empty());
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(tmp.path().join("devices.json")).unwrap()).unwrap();
    assert_eq!(state["origins"][&server.url]["cursor"], "0");
}
#[test]
fn ambiguous_upload_creation_is_not_automatically_retried() {
    for status in [None, Some(400), Some(500)] {
        let server = Server::new();
        {
            let mut s = server.state.lock().unwrap();
            s.drop_creation = status.is_none();
            s.creation_status = status;
        }
        let tmp = tempfile::tempdir().unwrap();
        let q = Queue::open(tmp.path().join("queue")).unwrap();
        q.configure(server.config()).unwrap();
        let file = tmp.path().join("file");
        fs::write(&file, b"file").unwrap();
        q.enqueue_upload(&file, "file").unwrap();
        q.tick().unwrap();
        assert_eq!(q.list().unwrap()[0].status, "error");
        let prefix = if status == Some(400) {
            "Upload creation rejected"
        } else {
            "Upload creation outcome unknown"
        };
        assert!(q.list().unwrap()[0]
            .error
            .as_deref()
            .unwrap()
            .starts_with(prefix));
        assert!(!q.tick().unwrap());
        assert_eq!(server.state.lock().unwrap().creations, 1);
    }
}

#[test]
fn folder_archive_loopback_routing_restart_resume_and_confirmed_cleanup() {
    let server = Server::new();
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("queue");
    let folder = tmp.path().join("家 folder");
    fs::create_dir_all(folder.join("nested/empty")).unwrap();
    let binary = data();
    fs::write(folder.join("nested/noextension"), &binary).unwrap();
    fs::write(folder.join("zero.bin"), []).unwrap();
    fs::write(folder.join("雪.md"), "text 🏠\n").unwrap();
    let q = Queue::open(root.clone()).unwrap();
    q.configure(server.config()).unwrap();
    let sender = q.connection().unwrap().device_id.unwrap();
    let target = "b".repeat(32);
    let context = q.prepare_send(None, Some(vec![target.clone()])).unwrap();
    q.configure(Config {
        base_url: "https://different.example".into(),
        ..server.config()
    })
    .unwrap();
    q.enqueue_prepared(&folder, "file", &context).unwrap();
    let id = q.list().unwrap()[0].id.clone();
    assert_eq!(q.list().unwrap()[0].status, "paused");
    drop(q);
    let q = Queue::open(root.clone()).unwrap();
    q.configure(Config {
        source_device: "Later name".into(),
        ..server.config()
    })
    .unwrap();
    q.control(&id, "resume").unwrap();
    q.tick().unwrap(); // Archive commits before any upload request.
    assert_eq!(server.state.lock().unwrap().creations, 0);
    let archive_path = root.join("staging").join(format!("{id}.zip"));
    let archive_bytes = fs::read(&archive_path).unwrap();
    assert_eq!(q.list().unwrap()[0].name, "家 folder.zip");
    assert_eq!(q.list().unwrap()[0].size, archive_bytes.len() as u64);
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].offset, CHUNK as u64);
    q.control(&id, "pause").unwrap();
    assert!(archive_path.exists());
    fs::remove_dir_all(&folder).unwrap(); // Committed ZIP is now the immutable source.
    drop(q);
    let q = Queue::open(root.clone()).unwrap();
    assert_eq!(fs::read(&archive_path).unwrap(), archive_bytes);
    q.control(&id, "resume").unwrap();
    q.tick().unwrap();
    assert_eq!(q.list().unwrap()[0].status, "complete");
    assert!(!archive_path.exists());
    {
        let state = server.state.lock().unwrap();
        assert_eq!(state.bytes, archive_bytes);
        assert!(state
            .upload_metadata
            .contains(&format!("filetype {}", STANDARD.encode("application/zip"))));
        assert!(state
            .upload_metadata
            .contains(&format!("kind {}", STANDARD.encode("file"))));
        assert!(state
            .upload_metadata
            .contains(&format!("sourceDeviceId {}", STANDARD.encode(sender))));
        assert!(state.upload_metadata.contains(&format!(
            "targetDeviceIds {}",
            STANDARD.encode(serde_json::to_vec(&vec![target]).unwrap())
        )));
        assert_eq!(state.registration.as_ref().unwrap()["label"], "test");
        assert!(state.chunks.iter().all(|n| *n <= CHUNK));
    }
    let destination = tmp.path().join("received.zip");
    q.download("item".into(), "家 folder.zip".into(), destination.clone())
        .unwrap();
    q.tick().unwrap();
    q.tick().unwrap();
    assert_eq!(fs::read(&destination).unwrap(), archive_bytes);
    let mut zip = zip::ZipArchive::new(fs::File::open(destination).unwrap()).unwrap();
    assert_eq!(zip.len(), 6);
    assert!(zip.by_name("家 folder/nested/empty/").unwrap().is_dir());
    let mut received = vec![];
    zip.by_name("家 folder/nested/noextension")
        .unwrap()
        .read_to_end(&mut received)
        .unwrap();
    assert_eq!(received, binary);
    assert_eq!(zip.by_name("家 folder/zero.bin").unwrap().size(), 0);
    let mut text = String::new();
    zip.by_name("家 folder/雪.md")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert_eq!(text, "text 🏠\n");
}

#[test]
fn folder_release_ordinary_files_stay_opaque_for_every_extension() {
    let server = Server::new();
    let tmp = tempfile::tempdir().unwrap();
    let q = Queue::open(tmp.path().join("queue")).unwrap();
    q.configure(server.config()).unwrap();
    let bytes = [0, 255, 128, 254, 13, 10, 0];
    for name in [
        "noextension",
        "installer.exe",
        "code.rs",
        "unknown.custom",
        "invalid-utf8.txt",
    ] {
        let source = tmp.path().join(name);
        fs::write(&source, bytes).unwrap();
        q.enqueue_upload(&source, "file").unwrap();
        q.tick().unwrap();
        assert_eq!(q.list().unwrap().last().unwrap().status, "complete");
        let state = server.state.lock().unwrap();
        assert_eq!(state.bytes, bytes);
        assert_eq!(state.upload_kind, "file");
        assert!(state
            .upload_metadata
            .contains(&format!("filename {}", STANDARD.encode(name))));
    }
}

#[test]
fn folder_cleanup_failure_after_remote_confirmation_retries_without_network() {
    for terminal in ["complete", "cancelled"] {
        let server = Server::new();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let folder = temp.path().join("folder");
        fs::create_dir(&folder).unwrap();
        fs::write(
            folder.join("file"),
            if terminal == "complete" {
                b"bytes".to_vec()
            } else {
                data()
            },
        )
        .unwrap();
        let q = Queue::open(root.clone()).unwrap();
        q.configure(server.config()).unwrap();
        q.enqueue_upload(&folder, "file").unwrap();
        q.tick().unwrap();
        let id = q.list().unwrap()[0].id.clone();
        let part = root.join("staging").join(format!("{id}.zip.part"));
        if terminal == "complete" {
            let (entered_tx, entered_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            server.state.lock().unwrap().metadata_gate = Some((entered_tx, release_rx));
            let worker = q.clone();
            let tick = thread::spawn(move || worker.tick().unwrap());
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            fs::create_dir(&part).unwrap();
            release_tx.send(()).unwrap();
            assert!(tick.join().unwrap());
        } else {
            q.tick().unwrap();
            assert_eq!(q.list().unwrap()[0].offset, CHUNK as u64);
            fs::create_dir(&part).unwrap();
            q.control(&id, "cancel").unwrap();
            q.tick().unwrap();
        }
        assert_eq!(q.list().unwrap()[0].status, "error");
        assert!(q.list().unwrap()[0]
            .error
            .as_ref()
            .unwrap()
            .contains("Local cleanup failed"));
        {
            let state = server.state.lock().unwrap();
            assert_eq!(state.creations, 1);
            assert_eq!(state.delete, terminal == "cancelled");
        }
        drop(server); // Any repeated upload, metadata request or DELETE now fails.
        drop(q);
        let q = Queue::open(root.clone()).unwrap();
        assert_eq!(q.list().unwrap()[0].status, "error");
        fs::remove_dir(&part).unwrap();
        q.control(&id, "resume").unwrap();
        q.tick().unwrap();
        assert_eq!(q.list().unwrap()[0].status, terminal);
        assert!(!q.tick().unwrap());
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
    }
}
