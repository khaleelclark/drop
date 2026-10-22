//! Opt-in test of the production native queue against a real running server.
//! Credentials are environment variables, never process arguments.
use household_native::{Config, Queue};
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
fn digest(path: &Path) -> String {
    let mut file = File::open(path).unwrap();
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).unwrap();
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    format!("{:x}", hash.finalize())
}
fn restart_barrier(phase: &str) {
    if let Ok(dir) = env::var("HOUSEHOLD_NATIVE_TEST_RESTART_DIR") {
        let ack = PathBuf::from(dir).join(format!("{phase}.ack"));
        println!("REQUEST_SERVER_RESTART {phase}");
        std::io::stdout().flush().unwrap();
        let start = Instant::now();
        while !ack.exists() {
            assert!(
                start.elapsed() < Duration::from_secs(60),
                "Server restart acknowledgement timed out"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }
}
fn main() {
    let args: Vec<_> = env::args().collect();
    assert_eq!(
        args.len(),
        4,
        "Usage: live_roundtrip <source> <destination> <isolated-queue-dir>"
    );
    let source = PathBuf::from(&args[1]);
    let destination = PathBuf::from(&args[2]);
    let root = PathBuf::from(&args[3]);
    let start = Instant::now();
    let mut q = Queue::open(root.clone()).unwrap();
    q.configure(Config {
        base_url: env::var("HOUSEHOLD_NATIVE_TEST_ORIGIN").unwrap(),
        token: env::var("HOUSEHOLD_NATIVE_TEST_TOKEN").unwrap(),
        source_device: "Native engine integration test".into(),
    })
    .unwrap();
    q.enqueue_upload(&source, "file").unwrap();
    q.tick().unwrap();
    let first = q.list().unwrap()[0].clone();
    let upload = first.id.clone();
    if first.offset < first.size {
        q.control(&upload, "pause").unwrap();
        assert!(!q.tick().unwrap());
        drop(q);
        restart_barrier("upload");
        q = Queue::open(root.clone()).unwrap();
        assert_eq!(q.list().unwrap()[0].status, "paused");
        q.control(&upload, "resume").unwrap();
        println!("Upload pause/restart/resume at {} bytes", first.offset);
    }
    let mut last = 0;
    loop {
        let t = q
            .list()
            .unwrap()
            .into_iter()
            .find(|t| t.id == upload)
            .unwrap();
        assert_ne!(t.status, "error", "{:?}", t);
        if t.status == "complete" {
            break;
        }
        q.tick().unwrap();
        if t.offset - last >= 1024 * 1024 * 1024 {
            last = t.offset;
            println!("Upload confirmed {}/{}", t.offset, t.size);
        }
    }
    let t = q
        .list()
        .unwrap()
        .into_iter()
        .find(|t| t.id == upload)
        .unwrap();
    let item = t.item_id.unwrap();
    let mut ready = false;
    for _ in 0..1000 {
        let response = q.api("GET", &format!("/api/items/{item}"), None).unwrap();
        let value: serde_json::Value = serde_json::from_str(&response.body).unwrap();
        if value["item"]["status"] == "ready" {
            ready = true;
            break;
        }
        assert_ne!(value["item"]["status"], "failed");
        thread::sleep(Duration::from_millis(200));
    }
    assert!(ready, "Server did not become ready");
    let download = q
        .download(item.clone(), "roundtrip.bin".into(), destination.clone())
        .unwrap();
    q.tick().unwrap();
    let first = q
        .list()
        .unwrap()
        .into_iter()
        .find(|t| t.id == download)
        .unwrap();
    if first.offset < first.size {
        q.control(&download, "pause").unwrap();
        drop(q);
        restart_barrier("download");
        q = Queue::open(root).unwrap();
        q.control(&download, "resume").unwrap();
        println!("Download pause/restart/resume at {} bytes", first.offset);
    }
    last = 0;
    loop {
        let t = q
            .list()
            .unwrap()
            .into_iter()
            .find(|t| t.id == download)
            .unwrap();
        assert_ne!(t.status, "error", "{:?}", t);
        if t.status == "complete" {
            break;
        }
        q.tick().unwrap();
        if t.offset - last >= 1024 * 1024 * 1024 {
            last = t.offset;
            println!("Download confirmed {}/{}", t.offset, t.size);
        }
    }
    let original = digest(&source);
    assert_eq!(digest(&destination), original);
    assert_eq!(
        File::open(&source).unwrap().metadata().unwrap().len(),
        File::open(&destination).unwrap().metadata().unwrap().len()
    );
    let deleted = q
        .api("DELETE", &format!("/api/items/{item}"), None)
        .unwrap();
    assert_eq!(deleted.status, 204);
    println!("PASS: {} bytes, source/download SHA-256 {}, elapsed {:.2}s; both queues paused/reopened/resumed",first.size,original,start.elapsed().as_secs_f64());
}
