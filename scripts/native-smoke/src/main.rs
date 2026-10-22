//! Real Go-server integration for the native queue, including durable reopen.
use household_native::{Config, Queue};
use sha2::{Digest, Sha256};
use std::{env, fs::{self, File}, io::{self, Read}, path::{Path, PathBuf}, process, thread, time::{Duration, Instant}};

fn digest(path: &Path) -> Result<String, String> {
    let mut source = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let origin = args.next().ok_or("server origin required")?;
    let root = PathBuf::from(args.next().ok_or("disposable test directory required")?);
    let bytes: u64 = args.next().unwrap_or_else(|| "33554432".into()).parse().map_err(|_| "invalid size")?;
    if bytes < 16 * 1024 * 1024 || bytes > 20 * 1024 * 1024 * 1024 { return Err("Test size must be 16 MiB through 20 GiB".into()); }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let source = root.join("native-integration.bin");
    if source.exists() { return Err("Use a new disposable test directory".into()); }
    File::create(&source).and_then(|file| file.set_len(bytes)).map_err(|e| e.to_string())?;
    let expected = digest(&source)?;
    let mut token = String::new();
    io::stdin().take(65537).read_to_string(&mut token).map_err(|e| e.to_string())?;
    let state = root.join("queue");
    let mut queue = Queue::open(state.clone())?;
    queue.configure(Config { base_url: origin, token: token.trim().into(), source_device: "Native integration test".into() })?;
    queue.enqueue_upload(&source, "file")?;
    let upload_id = queue.list()?.into_iter().find(|row| row.direction == "upload").ok_or("missing upload")?.id;
    let deadline = Instant::now() + Duration::from_secs(7200);
    let mut reopened_upload = false;
    let mut reported = 0;
    let item_id = loop {
        if Instant::now() > deadline { return Err("Native upload timed out".into()); }
        queue.tick()?;
        let row = queue.list()?.into_iter().find(|row| row.id == upload_id).ok_or("lost upload")?;
        if row.status == "error" { return Err(row.error.unwrap_or_else(|| "native upload failed".into())); }
        if !reopened_upload && row.offset >= 8 * 1024 * 1024 && row.offset < bytes {
            let offset = row.offset;
            queue.control(&upload_id, "pause")?; queue.shutdown()?; drop(queue);
            queue = Queue::open(state.clone())?;
            let saved = queue.list()?.into_iter().find(|row| row.id == upload_id).ok_or("lost upload after reopen")?;
            if saved.offset != offset || saved.status != "paused" { return Err("Upload pause/offset did not survive queue reopen".into()); }
            queue.control(&upload_id, "resume")?;
            reopened_upload = true;
            println!("Native upload pause/reopen preserved offset {offset}");
        }
        if row.offset / (1024 * 1024 * 1024) > reported { reported = row.offset / (1024 * 1024 * 1024); println!("Native upload {reported}GiB"); }
        if row.status == "complete" { break row.item_id.ok_or("completed upload lacks item id")?; }
        thread::sleep(Duration::from_millis(1));
    };
    if !reopened_upload { return Err("Upload did not exercise pause/reopen".into()); }
    let ready_deadline = Instant::now() + Duration::from_secs(180);
    loop {
        let result = queue.api("GET", &format!("/api/items/{item_id}"), None)?;
        if result.status != 200 { return Err(format!("Cannot read native upload item: {}", result.status)); }
        let value: serde_json::Value = serde_json::from_str(&result.body).map_err(|e| e.to_string())?;
        if value["item"]["status"] == "ready" { break; }
        if value["item"]["status"] == "failed" || Instant::now() > ready_deadline { return Err("Native upload did not become ready".into()); }
        thread::sleep(Duration::from_millis(100));
    }
    let destination = root.join("native-downloaded.bin");
    let download_id = queue.download(item_id.clone(), "native-downloaded.bin".into(), destination.clone())?;
    let mut reopened_download = false;
    reported = 0;
    loop {
        if Instant::now() > deadline { return Err("Native download timed out".into()); }
        queue.tick()?;
        let row = queue.list()?.into_iter().find(|row| row.id == download_id).ok_or("lost download")?;
        if row.status == "error" { return Err(row.error.unwrap_or_else(|| "native download failed".into())); }
        if !reopened_download && row.offset >= 8 * 1024 * 1024 && row.offset < bytes {
            let offset = row.offset;
            queue.control(&download_id, "pause")?; queue.shutdown()?; drop(queue);
            queue = Queue::open(state.clone())?;
            let saved = queue.list()?.into_iter().find(|row| row.id == download_id).ok_or("lost download after reopen")?;
            if saved.offset != offset || saved.status != "paused" { return Err("Download pause/offset did not survive queue reopen".into()); }
            queue.control(&download_id, "resume")?;
            reopened_download = true;
            println!("Native download pause/reopen preserved offset {offset}");
        }
        if row.offset / (1024 * 1024 * 1024) > reported { reported = row.offset / (1024 * 1024 * 1024); println!("Native download {reported}GiB"); }
        if row.status == "complete" { break; }
        thread::sleep(Duration::from_millis(1));
    }
    if !reopened_download { return Err("Download did not exercise pause/reopen".into()); }
    if fs::metadata(&destination).map_err(|e| e.to_string())?.len() != bytes || digest(&destination)? != expected { return Err("Native round-trip length/SHA256 mismatch".into()); }
    let result = queue.api("DELETE", &format!("/api/items/{item_id}"), None)?;
    if result.status != 204 { return Err("Could not clean server test item".into()); }
    queue.shutdown()?; drop(queue);
    fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    println!("PASS: native upload and download of {bytes} bytes with durable pause/reopen, real-server ranges, exact length and matching SHA256");
    Ok(())
}

fn main() { if let Err(error) = run() { eprintln!("{error}"); process::exit(1); } }
