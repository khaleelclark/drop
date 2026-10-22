//! Durable, single-worker transfer engine. No UI, WebView or async runtime required.
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use fs2::FileExt;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

pub type Result<T> = std::result::Result<T, String>;
const CHUNK: u64 = 8 * 1024 * 1024;
const MAX_FILE: u64 = 20 * 1024 * 1024 * 1024;
const API_LIMIT: u64 = 40 * 1024 * 1024;
const TEXT_LIMIT: u64 = 8 * 1024 * 1024;
const METADATA_LIMIT: u64 = 2 * 1024 * 1024;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub base_url: String,
    pub token: String,
    pub source_device: String,
}
impl Config {
    pub fn validate(mut self) -> Result<Self> {
        let u = Url::parse(&self.base_url).map_err(err)?;
        let loopback = matches!(
            u.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        );
        if !(u.scheme() == "https" || (u.scheme() == "http" && loopback))
            || u.host_str().is_none()
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.path() != "/"
        {
            return Err(
                "Use an HTTPS server origin, or explicit HTTP loopback for development".into(),
            );
        }
        if self.token.len() > 65536
            || self.token.contains(['\r', '\n'])
            || self.source_device.len() > 256
        {
            return Err("Invalid configuration".into());
        }
        self.base_url = u.as_str().trim_end_matches('/').to_owned();
        Ok(self)
    }
    fn api(&self, path: &str) -> Result<Url> {
        if !path.starts_with("/api/") || path.contains(['\\', '#']) {
            return Err("Only /api/ paths are allowed".into());
        }
        let base = Url::parse(&self.base_url).map_err(err)?;
        let target = base.join(path).map_err(err)?;
        if target.origin() != base.origin() || !target.path().starts_with("/api/") {
            return Err("Invalid API path".into());
        }
        Ok(target)
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Source {
    path: PathBuf,
    len: u64,
    modified_ns: u64,
    sample: String,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    inode: u64,
    #[serde(default)]
    device: u64,
}
impl Source {
    fn inspect(path: &Path) -> Result<Self> {
        let path = path.canonicalize().map_err(err)?;
        let mut file = File::open(&path).map_err(err)?;
        let m = file.metadata().map_err(err)?;
        if !m.is_file() || m.len() > MAX_FILE {
            return Err("Source must be a regular file, at most 20 GiB".into());
        }
        let mut hash = Sha256::new();
        let mut bytes = vec![0; 64 * 1024];
        let n = file.read(&mut bytes).map_err(err)?;
        hash.update(&bytes[..n]);
        if m.len() > bytes.len() as u64 {
            file.seek(SeekFrom::Start(m.len() - bytes.len() as u64))
                .map_err(err)?;
            let n = file.read(&mut bytes).map_err(err)?;
            hash.update(&bytes[..n]);
        }
        #[cfg(unix)]
        let (inode, device) = {
            use std::os::unix::fs::MetadataExt;
            (m.ino(), m.dev())
        };
        #[cfg(not(unix))]
        let (inode, device) = (0, 0);
        Ok(Self {
            path,
            len: m.len(),
            modified_ns: m
                .modified()
                .map_err(err)?
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
                .try_into()
                .map_err(|_| "Source timestamp is outside supported range")?,
            sample: format!("{:x}", hash.finalize()),
            sha256: None,
            inode,
            device,
        })
    }
    fn verify(&self) -> Result<()> {
        let other = Self::inspect(&self.path)?;
        if self.len != other.len
            || self.modified_ns != other.modified_ns
            || self.sample != other.sample
            || self.inode != other.inode
            || self.device != other.device
        {
            return Err("Source changed; cancel and enqueue the new source".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Transfer {
    id: String,
    direction: String,
    name: String,
    kind: String,
    size: u64,
    offset: u64,
    status: String,
    error: Option<String>,
    config: Config,
    source: Option<Source>,
    upload_url: Option<String>,
    item_id: Option<String>,
    destination: Option<PathBuf>,
    etag: Option<String>,
    #[serde(default)]
    retries: u32,
    #[serde(default)]
    retry_at: u64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransferView {
    pub id: String,
    pub direction: String,
    pub name: String,
    pub size: u64,
    pub offset: u64,
    pub status: String,
    pub error: Option<String>,
    pub item_id: Option<String>,
}
impl From<&Transfer> for TransferView {
    fn from(t: &Transfer) -> Self {
        Self {
            id: t.id.clone(),
            direction: t.direction.clone(),
            name: t.name.clone(),
            size: t.size,
            offset: t.offset,
            status: t.status.clone(),
            error: t.error.clone(),
            item_id: t.item_id.clone(),
        }
    }
}
#[derive(Default, Serialize, Deserialize)]
struct DiskState {
    transfers: Vec<Transfer>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbox {
    Upload {
        source: Source,
        kind: String,
        name: String,
        #[serde(default)]
        source_device: Option<String>,
        config: Config,
    },
    Text {
        source: Source,
        name: String,
        config: Config,
    },
}

pub fn data_dir() -> Result<PathBuf> {
    directories::ProjectDirs::from("net", "household", "HouseholdShare")
        .map(|p| p.data_local_dir().to_owned())
        .ok_or("No user data directory".into())
}
fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(err)?;
    }
    Ok(())
}
fn private_new(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(err)
}
fn sync_dir(path: &Path) -> Result<()> {
    File::open(path).and_then(|f| f.sync_all()).map_err(err)
}
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    let tmp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut f = private_new(&tmp)?;
    if let Err(e) = (|| -> Result<()> {
        serde_json::to_writer(&mut f, value).map_err(err)?;
        f.sync_all().map_err(err)?;
        fs::rename(&tmp, path).map_err(err)?;
        sync_dir(parent)
    })() {
        let _ = fs::remove_file(tmp);
        return Err(e);
    }
    Ok(())
}
fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    serde_json::from_reader(File::open(path).map_err(err)?).map_err(err)
}
fn read_config(root: &Path) -> Result<Config> {
    if root.join("disconnected").exists() {
        return Err("Configure the household server before sharing".into());
    }
    let c: Config = read_json(&root.join("config.json"))?;
    c.validate()
}

/// CLI capture is a durable local spool write. No transfer lock or blocking HTTP.
pub fn spool_upload(root: &Path, path: &Path, kind: &str) -> Result<String> {
    spool_upload_as(root, path, kind, None)
}
fn spool_upload_as(
    root: &Path,
    path: &Path,
    kind: &str,
    source_device: Option<String>,
) -> Result<String> {
    let mut config = read_config(root)?;
    config.token.clear();
    if source_device.as_ref().is_some_and(|s| s.len() > 256) {
        return Err("Device name is too long".into());
    }
    if kind != "file" && kind != "text" {
        return Err("Invalid item kind".into());
    }
    let source = Source::inspect(path)?;
    let name = source
        .path
        .file_name()
        .ok_or("Source has no filename")?
        .to_string_lossy()
        .to_string();
    let dir = root.join("inbox");
    private_dir(&dir)?;
    let id = uuid::Uuid::new_v4().to_string();
    atomic_json(
        &dir.join(format!("{id}.json")),
        &Inbox::Upload {
            source,
            kind: kind.to_owned(),
            name,
            source_device,
            config,
        },
    )?;
    Ok(id)
}
/// Streams stdin to one owned staging file. Text is not copied into CLI arguments.
pub fn spool_text(root: &Path, reader: &mut impl Read) -> Result<String> {
    let mut config = read_config(root)?;
    config.token.clear();
    let dir = root.join("staging");
    private_dir(&dir)?;
    let path = dir.join(format!("{}.txt", uuid::Uuid::new_v4()));
    let mut out = private_new(&path)?;
    let captured = (|| -> Result<()> {
        let mut total = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let n = reader.read(&mut buffer).map_err(err)?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_FILE {
                return Err("Text exceeds 20 GiB".into());
            }
            if fs2::available_space(&dir).map_err(err)? < n as u64 + 16 * 1024 * 1024 {
                return Err("Insufficient space to capture text".into());
            }
            out.write_all(&buffer[..n]).map_err(err)?;
        }
        out.sync_all().map_err(err)?;
        sync_dir(&dir)
    })();
    if let Err(e) = captured {
        drop(out);
        let _ = fs::remove_file(&path);
        return Err(e);
    }
    let source = Source::inspect(&path)?;
    let inbox = root.join("inbox");
    private_dir(&inbox)?;
    let id = uuid::Uuid::new_v4().to_string();
    atomic_json(
        &inbox.join(format!("{id}.json")),
        &Inbox::Text {
            source,
            name: "Shared text.txt".into(),
            config,
        },
    )?;
    Ok(id)
}

pub struct Queue {
    root: PathBuf,
    state: Mutex<DiskState>,
    client: Client,
    stopping: AtomicBool,
    verified: Mutex<HashSet<String>>,
    api_cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    _lock: File,
}
impl Queue {
    pub fn open(root: PathBuf) -> Result<Arc<Self>> {
        private_dir(&root)?;
        private_dir(&root.join("inbox"))?;
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(root.join("queue.lock"))
            .map_err(err)?;
        lock.try_lock_exclusive()
            .map_err(|_| "Household Share queue is already running".to_string())?;
        let path = root.join("queue.json");
        // A corrupt queue is an error. Never silently discard resumable transfers.
        let mut state: DiskState = if path.exists() {
            read_json(&path)?
        } else {
            DiskState::default()
        };
        for t in &mut state.transfers {
            if t.status == "running" || t.status == "checking" {
                t.status = "queued".into();
            }
        }
        let q = Arc::new(Self {
            root,
            state: Mutex::new(state),
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(120))
                .build()
                .map_err(err)?,
            stopping: AtomicBool::new(false),
            verified: Mutex::new(HashSet::new()),
            api_cancellations: Mutex::new(HashMap::new()),
            _lock: lock,
        });
        q.save()?;
        Ok(q)
    }
    pub fn connection(&self) -> Result<ConnectionView> {
        let present = self.root.join("config.json").exists();
        let config: Config = if present {
            read_json(&self.root.join("config.json"))?
        } else {
            Config {
                base_url: String::new(),
                token: String::new(),
                source_device: "Desktop".into(),
            }
        };
        Ok(ConnectionView {
            base_url: config.base_url,
            source_device: config.source_device,
            connected: present && !self.root.join("disconnected").exists(),
        })
    }
    pub fn cancel_api(&self, request_id: &str) -> Result<()> {
        if let Some(flag) = self.api_cancellations.lock().map_err(err)?.get(request_id) {
            flag.store(true, Ordering::SeqCst);
        }
        Ok(())
    }
    pub fn disconnect(&self) -> Result<()> {
        self.ingest()?;
        if self.root.join("config.json").exists() {
            let mut config = read_config(&self.root)?;
            config.token.clear();
            atomic_json(&self.root.join("config.json"), &config)?;
        }
        if !self.root.join("disconnected").exists() {
            private_new(&self.root.join("disconnected"))?
                .sync_all()
                .map_err(err)?;
            sync_dir(&self.root)?;
        }
        let mut state = self.state.lock().map_err(err)?;
        for t in &mut state.transfers {
            t.config.token.clear();
            if matches!(
                t.status.as_str(),
                "queued" | "running" | "checking" | "validating"
            ) {
                t.status = "paused".into();
            }
        }
        self.save_locked(&state)
    }
    pub fn configure(&self, config: Config) -> Result<()> {
        let config = config.validate()?;
        atomic_json(&self.root.join("config.json"), &config)?;
        if self.root.join("disconnected").exists() {
            fs::remove_file(self.root.join("disconnected")).map_err(err)?;
            sync_dir(&self.root)?;
        }
        let mut state = self.state.lock().map_err(err)?;
        for t in &mut state.transfers {
            if t.config.base_url == config.base_url {
                t.config = config.clone();
            }
        }
        self.save_locked(&state)
    }
    fn save_locked(&self, state: &DiskState) -> Result<()> {
        atomic_json(&self.root.join("queue.json"), state)
    }
    fn save(&self) -> Result<()> {
        let state = self.state.lock().map_err(err)?;
        self.save_locked(&state)
    }
    pub fn list(&self) -> Result<Vec<TransferView>> {
        Ok(self
            .state
            .lock()
            .map_err(err)?
            .transfers
            .iter()
            .map(TransferView::from)
            .collect())
    }
    pub fn enqueue_upload(&self, path: &Path, kind: &str) -> Result<()> {
        self.enqueue_upload_as(path, kind, None)
    }
    pub fn enqueue_upload_as(
        &self,
        path: &Path,
        kind: &str,
        source_device: Option<String>,
    ) -> Result<()> {
        spool_upload_as(&self.root, path, kind, source_device)?;
        self.ingest()
    }
    pub fn consume_spool(&self) -> Result<()> {
        self.ingest()
    }
    fn ingest(&self) -> Result<()> {
        for entry in fs::read_dir(self.root.join("inbox")).map_err(err)? {
            let path = entry.map_err(err)?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let id = path
                .file_stem()
                .ok_or("Invalid inbox filename")?
                .to_string_lossy()
                .to_string();
            let mut state = self.state.lock().map_err(err)?;
            if state.transfers.iter().any(|t| t.id == id) {
                fs::remove_file(&path).map_err(err)?;
                continue;
            }
            let message: Inbox = read_json(&path)?;
            let (source, kind, name, source_device, config) = match message {
                Inbox::Upload {
                    source,
                    kind,
                    name,
                    source_device,
                    config,
                } => (source, kind, name, source_device, config),
                Inbox::Text {
                    source,
                    name,
                    config,
                } => (source, "text".into(), name, None, config),
            };
            let mut config = config.validate()?;
            // Captures never inherit a newly paired server or persist a token in the spool.
            let paired = read_config(&self.root)
                .ok()
                .filter(|c| c.base_url == config.base_url);
            let bound = paired.is_some();
            if let Some(current) = paired {
                config.token = current.token;
            }
            if let Some(device) = source_device {
                config.source_device = device;
            }
            let t = Transfer {
                id,
                direction: "upload".into(),
                name,
                kind,
                size: source.len,
                offset: 0,
                status: if bound { "queued" } else { "paused" }.into(),
                error: if bound {
                    None
                } else {
                    Some("Reconnect the captured household server, then Resume".into())
                },
                config,
                source: Some(source),
                upload_url: None,
                item_id: None,
                destination: None,
                etag: None,
                retries: 0,
                retry_at: 0,
            };
            state.transfers.push(t);
            self.save_locked(&state)?;
            fs::remove_file(&path).map_err(err)?;
            sync_dir(&self.root.join("inbox"))?;
        }
        Ok(())
    }
    pub fn download(&self, item_id: String, name: String, destination: PathBuf) -> Result<String> {
        if item_id.is_empty()
            || !item_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Invalid item identifier".into());
        }
        if destination.exists() {
            return Err("Destination exists; choose a new filename".into());
        }
        let parent = destination
            .parent()
            .ok_or("Invalid destination")?
            .canonicalize()
            .map_err(err)?;
        let destination = parent.join(
            destination
                .file_name()
                .ok_or("Missing destination filename")?,
        );
        let id = uuid::Uuid::new_v4().to_string();
        let t = Transfer {
            id: id.clone(),
            direction: "download".into(),
            name,
            kind: "file".into(),
            size: 0,
            offset: 0,
            status: "queued".into(),
            error: None,
            config: read_config(&self.root)?,
            source: None,
            upload_url: None,
            item_id: Some(item_id),
            destination: Some(destination),
            etag: None,
            retries: 0,
            retry_at: 0,
        };
        let mut state = self.state.lock().map_err(err)?;
        state.transfers.push(t);
        self.save_locked(&state)?;
        Ok(id)
    }
    pub fn control(&self, id: &str, action: &str) -> Result<()> {
        let mut state = self.state.lock().map_err(err)?;
        let t = state
            .transfers
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or("Unknown transfer")?;
        if t.status == "complete" || t.status == "cancelled" {
            return Err("Transfer already finished".into());
        }
        match action {
            "pause" => t.status = "paused".into(),
            "resume" => {
                t.status = "queued".into();
                t.error = None;
                t.retries = 0;
                t.retry_at = 0;
            }
            // Worker performs DELETE after any in-flight PATCH; never race termination.
            "cancel" => t.status = "cancelling".into(),
            _ => return Err("Invalid action".into()),
        }
        self.save_locked(&state)
    }
    pub fn start(self: &Arc<Self>) {
        let q = self.clone();
        thread::spawn(move || {
            while !q.stopping.load(Ordering::SeqCst) {
                if let Err(e) = q.tick() {
                    eprintln!("Native queue: {e}");
                }
                thread::sleep(Duration::from_millis(250));
            }
        });
    }
    /// Pause persisted work before explicit Quit. A lost in-flight ACK is reconciled by HEAD.
    pub fn shutdown(&self) -> Result<()> {
        self.stopping.store(true, Ordering::SeqCst);
        let mut state = self.state.lock().map_err(err)?;
        for t in &mut state.transfers {
            if matches!(
                t.status.as_str(),
                "running" | "checking" | "queued" | "validating"
            ) {
                t.status = "paused".into();
            }
        }
        self.save_locked(&state)
    }
    /// One bounded transfer step, exposed for deterministic headless protocol tests.
    pub fn tick(&self) -> Result<bool> {
        self.ingest()?;
        let mut t = {
            let mut state = self.state.lock().map_err(err)?;
            let Some(t) = state.transfers.iter_mut().find(|t| {
                (t.status == "queued"
                    || t.status == "running"
                    || t.status == "validating"
                    || t.status == "cancelling")
                    && t.retry_at <= now()
            }) else {
                return Ok(false);
            };
            if t.status != "cancelling" {
                t.status = "running".into();
            }
            let t = t.clone();
            self.save_locked(&state)?;
            t
        };
        let cancellation = t.status == "cancelling";
        let outcome = if cancellation {
            self.cancel_step(&mut t)
        } else if t.direction == "upload" {
            self.upload_step(&mut t)
        } else {
            self.download_step(&mut t)
        };
        if let Err(e) = outcome {
            t.error = Some(e.clone());
            // Retry transport/server failures, retain all source and protocol errors for review.
            if (e.starts_with("Network:") || e.starts_with("HTTP 5") || e.starts_with("HTTP 429"))
                && t.retries < 8
            {
                t.retries += 1;
                t.retry_at = now() + ((1u64 << t.retries.min(5)) * 1000);
                t.status = if cancellation { "cancelling" } else { "queued" }.into();
            } else {
                t.status = "error".into();
            }
        } else {
            t.retries = 0;
            if t.status != "validating" && t.status != "cancelling" {
                t.retry_at = 0;
            }
            t.error = None;
        }
        let mut state = self.state.lock().map_err(err)?;
        let current = state
            .transfers
            .iter_mut()
            .find(|x| x.id == t.id)
            .ok_or("Transfer disappeared")?;
        // A UI pause/cancel wins over an in-flight successful step. Preserve confirmed offset.
        if (current.status == "paused" || current.status == "cancelling")
            && current.status
                != if cancellation {
                    "cancelling"
                } else {
                    "running"
                }
            && t.status != "complete"
            && t.status != "cancelled"
        {
            t.status = current.status.clone();
        }
        t.config = current.config.clone();
        *current = t.clone();
        self.save_locked(&state)?;
        if t.status == "complete" && t.direction == "upload" {
            self.cleanup_staged(&t);
        }
        Ok(true)
    }
    fn request(
        &self,
        method: reqwest::Method,
        url: Url,
        c: &Config,
    ) -> reqwest::blocking::RequestBuilder {
        let request = self.client.request(method, url);
        if c.token.is_empty() {
            request
        } else {
            request.bearer_auth(&c.token)
        }
    }
    fn checked(response: std::result::Result<Response, reqwest::Error>) -> Result<Response> {
        let response = response.map_err(|e| format!("Network: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }
        Ok(response)
    }
    fn tus_url(t: &Transfer) -> Result<Url> {
        let base = Url::parse(&t.config.base_url).map_err(err)?;
        let url = base
            .join(t.upload_url.as_deref().ok_or("Missing upload URL")?)
            .map_err(err)?;
        if url.origin() != base.origin()
            || !url.path().starts_with("/api/uploads/")
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Unsafe server upload location".into());
        }
        Ok(url)
    }
    fn checkpoint(&self, t: &Transfer) -> Result<()> {
        let mut state = self.state.lock().map_err(err)?;
        let current = state
            .transfers
            .iter_mut()
            .find(|x| x.id == t.id)
            .ok_or("Transfer missing")?;
        let status = current.status.clone();
        let config = current.config.clone();
        *current = t.clone();
        current.config = config;
        if status == "paused" || status == "cancelling" {
            current.status = status;
        }
        self.save_locked(&state)
    }
    fn verify_upload_source(&self, t: &mut Transfer) -> Result<()> {
        if self.verified.lock().map_err(err)?.contains(&t.id) {
            return Ok(());
        }
        let source = t.source.as_ref().ok_or("Missing source")?.clone();
        source.verify()?;
        t.status = "checking".into();
        self.checkpoint(t)?;
        let mut file = File::open(&source.path).map_err(err)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        let mut length = 0u64;
        loop {
            if self.stopping.load(Ordering::SeqCst) {
                return Err("Source verification paused".into());
            }
            {
                let state = self.state.lock().map_err(err)?;
                if state
                    .transfers
                    .iter()
                    .find(|x| x.id == t.id)
                    .is_some_and(|x| x.status == "paused" || x.status == "cancelling")
                {
                    return Err("Source verification paused".into());
                }
            }
            let n = file.read(&mut buffer).map_err(err)?;
            if n == 0 {
                break;
            }
            length += n as u64;
            hasher.update(&buffer[..n]);
        }
        source.verify()?;
        if length != source.len {
            return Err("Source length changed during verification".into());
        }
        let digest = format!("{:x}", hasher.finalize());
        if source
            .sha256
            .as_ref()
            .is_some_and(|original| original != &digest)
        {
            return Err("Source bytes changed; cancel and enqueue the new source".into());
        }
        t.source.as_mut().ok_or("Missing source")?.sha256 = Some(digest);
        t.status = "running".into();
        self.checkpoint(t)?;
        self.verified.lock().map_err(err)?.insert(t.id.clone());
        Ok(())
    }
    fn reconcile_upload(&self, t: &mut Transfer) -> Result<()> {
        let id = t
            .item_id
            .as_deref()
            .ok_or("Missing application item identity; cannot confirm validation")?;
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Invalid application item identity".into());
        }
        let response = Self::checked(
            self.request(
                reqwest::Method::GET,
                t.config.api(&format!("/api/items/{id}"))?,
                &t.config,
            )
            .send(),
        )?;
        if response.content_length().unwrap_or(0) > 65536 {
            return Err("Invalid application item response length".into());
        }
        let mut bytes = Vec::new();
        response.take(65537).read_to_end(&mut bytes).map_err(err)?;
        if bytes.len() > 65536 {
            return Err("Invalid application item response length".into());
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(err)?;
        let item = &value["item"];
        if item["id"].as_str() != Some(id) || item["size"].as_u64() != Some(t.size) {
            return Err("Application item does not match this upload".into());
        }
        match item["status"].as_str() {
            Some("ready") => {
                t.offset = t.size;
                t.status = "complete".into();
            }
            Some("failed") => {
                return Err("Server rejected upload validation; original source retained".into())
            }
            Some("uploading") => {
                t.status = "validating".into();
                t.retry_at = now() + 1000;
            }
            _ => return Err("Invalid application upload state".into()),
        }
        Ok(())
    }
    fn upload_step(&self, t: &mut Transfer) -> Result<()> {
        if t.upload_url.is_some() && t.offset == t.size {
            return self.reconcile_upload(t);
        }
        if t.upload_url.is_none() {
            self.verify_upload_source(t)?;
            let meta = format!(
                "filename {},filetype {},kind {},sourceDevice {}",
                B64.encode(t.name.as_bytes()),
                B64.encode(if t.kind == "text" {
                    "text/plain"
                } else {
                    "application/octet-stream"
                }),
                B64.encode(t.kind.as_bytes()),
                B64.encode(t.config.source_device.as_bytes())
            );
            let response = Self::checked(
                self.request(
                    reqwest::Method::POST,
                    t.config.api("/api/uploads/")?,
                    &t.config,
                )
                .header("Tus-Resumable", "1.0.0")
                .header("Upload-Length", t.size)
                .header("Upload-Metadata", meta)
                .header("Content-Length", 0)
                .send(),
            )?;
            if response.status().as_u16() != 201 {
                return Err("Upload creation did not return 201".into());
            }
            let location = response
                .headers()
                .get("Location")
                .ok_or("Missing upload location")?
                .to_str()
                .map_err(err)?;
            // Relative locations are resolved against the creation endpoint, per HTTP.
            t.upload_url = Some(
                t.config
                    .api("/api/uploads/")?
                    .join(location)
                    .map_err(err)?
                    .to_string(),
            );
            t.item_id = response
                .headers()
                .get("X-Item-ID")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            Self::tus_url(t)?;
            self.checkpoint(t)?;
        }
        let url = Self::tus_url(t)?;
        let head = Self::checked(
            self.request(reqwest::Method::HEAD, url.clone(), &t.config)
                .header("Tus-Resumable", "1.0.0")
                .send(),
        )?;
        let offset = header_u64(&head, "Upload-Offset")?;
        if header_u64(&head, "Upload-Length")? != t.size || offset > t.size {
            return Err("Invalid server upload length or offset".into());
        }
        t.offset = offset;
        if offset == t.size {
            return self.reconcile_upload(t);
        }
        self.verify_upload_source(t)?;
        let source = t.source.as_ref().ok_or("Missing source")?.clone();
        source.verify()?;
        let mut file = File::open(&source.path).map_err(err)?;
        file.seek(SeekFrom::Start(offset)).map_err(err)?;
        let len = (t.size - offset).min(CHUNK) as usize;
        let mut chunk = vec![0; len];
        file.read_exact(&mut chunk).map_err(err)?;
        source.verify()?;
        let response = Self::checked(
            self.request(reqwest::Method::PATCH, url, &t.config)
                .header("Tus-Resumable", "1.0.0")
                .header("Upload-Offset", offset)
                .header("Content-Type", "application/offset+octet-stream")
                .body(chunk)
                .send(),
        )?;
        if response.status().as_u16() != 204
            || header_u64(&response, "Upload-Offset")? != offset + len as u64
        {
            return Err("Invalid upload acknowledgement; resume reconciles HEAD".into());
        }
        t.offset = offset + len as u64;
        if t.offset == t.size {
            self.reconcile_upload(t)?;
        }
        Ok(())
    }
    fn cleanup_staged(&self, t: &Transfer) {
        if let Some(source) = &t.source {
            if source.path.parent() == Some(self.root.join("staging").as_path()) {
                let _ = fs::remove_file(&source.path);
            }
        }
    }
    fn partial(t: &Transfer) -> Result<PathBuf> {
        Ok(t.destination
            .as_ref()
            .ok_or("Missing destination")?
            .with_file_name(format!(".household-{}.part", t.id)))
    }
    fn download_step(&self, t: &mut Transfer) -> Result<()> {
        let url = t.config.api(&format!(
            "/api/items/{}/download",
            t.item_id.as_ref().ok_or("Missing item")?
        ))?;
        if t.etag.is_none() {
            let response = Self::checked(
                self.request(reqwest::Method::HEAD, url.clone(), &t.config)
                    .send(),
            )?;
            t.size = header_u64(&response, "Content-Length")?;
            if t.size > MAX_FILE {
                return Err("Download exceeds configured 20 GiB client limit".into());
            }
            let etag = response
                .headers()
                .get("ETag")
                .ok_or("Server omitted ETag")?
                .to_str()
                .map_err(err)?
                .to_owned();
            if etag.starts_with("W/") {
                return Err("Resumable download needs a strong ETag".into());
            }
            t.etag = Some(etag);
            self.checkpoint(t)?;
        }
        let part = Self::partial(t)?;
        if !part.exists() {
            private_new(&part)?.sync_all().map_err(err)?;
        }
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&part)
            .map_err(err)?;
        let local = file.metadata().map_err(err)?.len();
        if local > t.size {
            return Err("Partial download is larger than remote file".into());
        }
        // File bytes are synced before queue state; disk length is authoritative after a crash.
        t.offset = local;
        if t.offset < t.size {
            let end = (t.offset + CHUNK - 1).min(t.size - 1);
            let expected = end - t.offset + 1;
            if fs2::available_space(part.parent().ok_or("Missing directory")?).map_err(err)?
                < expected + 16 * 1024 * 1024
            {
                return Err("Insufficient destination disk space".into());
            }
            let mut response = Self::checked(
                self.request(reqwest::Method::GET, url, &t.config)
                    .header("Range", format!("bytes={}-{}", t.offset, end))
                    .header("If-Range", t.etag.as_ref().ok_or("Missing ETag")?)
                    .send(),
            )?;
            let remote_etag = response.headers().get("ETag").and_then(|v| v.to_str().ok());
            if response.status().as_u16() == 200
                || (remote_etag.is_some() && remote_etag != t.etag.as_deref())
            {
                file.set_len(0).map_err(err)?;
                file.sync_all().map_err(err)?;
                t.offset = 0;
                t.size = 0;
                t.etag = None;
                self.checkpoint(t)?;
                return Err(
                    "Remote file changed; partial invalidated. Resume to start cleanly".into(),
                );
            }
            let range = format!("bytes {}-{}/{}", t.offset, end, t.size);
            if response.status().as_u16() != 206
                || response
                    .headers()
                    .get("Content-Range")
                    .and_then(|v| v.to_str().ok())
                    != Some(range.as_str())
                || response.headers().get("ETag").and_then(|v| v.to_str().ok()) != t.etag.as_deref()
            {
                return Err(
                    "Remote file changed or invalid range response; refusing to append".into(),
                );
            }
            if header_u64(&response, "Content-Length")? != expected {
                return Err("Invalid range length".into());
            }
            file.seek(SeekFrom::Start(t.offset)).map_err(err)?;
            let copied = std::io::copy(&mut (&mut response).take(expected), &mut file)
                .map_err(|e| format!("Network: {e}"))?;
            file.sync_all().map_err(err)?;
            if copied != expected {
                return Err("Network: truncated download; will resume disk offset".into());
            }
            t.offset += copied;
        }
        if t.offset == t.size {
            file.sync_all().map_err(err)?;
            if let Some(expected) = t
                .etag
                .as_deref()
                .and_then(|e| e.strip_prefix("\"sha256-"))
                .and_then(|e| e.strip_suffix('"'))
                .filter(|e| e.len() == 64 && e.bytes().all(|b| b.is_ascii_hexdigit()))
                .map(str::to_owned)
            {
                t.status = "checking".into();
                self.checkpoint(t)?;
                file.seek(SeekFrom::Start(0)).map_err(err)?;
                let mut hash = Sha256::new();
                let mut buffer = [0u8; 65536];
                loop {
                    if self.stopping.load(Ordering::SeqCst) {
                        return Err("Verification paused".into());
                    }
                    {
                        let state = self.state.lock().map_err(err)?;
                        if state
                            .transfers
                            .iter()
                            .find(|x| x.id == t.id)
                            .is_some_and(|x| x.status == "paused" || x.status == "cancelling")
                        {
                            return Err("Verification paused".into());
                        }
                    }
                    let n = file.read(&mut buffer).map_err(err)?;
                    if n == 0 {
                        break;
                    }
                    hash.update(&buffer[..n]);
                }
                if format!("{:x}", hash.finalize()) != expected.to_ascii_lowercase() {
                    return Err("Downloaded SHA-256 mismatch; cancel and download again".into());
                }
            }
            let destination = t.destination.as_ref().ok_or("Missing destination")?;
            // Hard-link publication is atomic and refuses to overwrite an existing user file.
            // Keep the part until the complete checkpoint so a crash cannot lose resume state.
            if let Err(e) = fs::hard_link(&part, destination) {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    let a = fs::metadata(&part).map_err(err)?;
                    let b = fs::metadata(destination).map_err(err)?;
                    if a.dev() != b.dev() || a.ino() != b.ino() {
                        return Err(err(e));
                    }
                }
                #[cfg(not(unix))]
                {
                    return Err(err(e));
                }
            }
            sync_dir(
                destination
                    .parent()
                    .ok_or("Missing destination directory")?,
            )?;
            t.status = "complete".into();
            self.checkpoint(t)?;
            fs::remove_file(part).map_err(err)?;
        }
        Ok(())
    }
    fn cancel_step(&self, t: &mut Transfer) -> Result<()> {
        if t.direction == "upload" {
            if t.upload_url.is_some() {
                let response = self
                    .request(reqwest::Method::DELETE, Self::tus_url(t)?, &t.config)
                    .header("Tus-Resumable", "1.0.0")
                    .send()
                    .map_err(|e| format!("Network: {e}"))?;
                if response.status().as_u16() == 409 {
                    self.reconcile_upload(t)?;
                    if t.status != "complete" {
                        t.status = "cancelling".into();
                        t.retry_at = now() + 1000;
                    }
                    return Ok(());
                }
                if !response.status().is_success()
                    && response.status().as_u16() != 404
                    && response.status().as_u16() != 410
                {
                    return Err(format!("HTTP {}", response.status().as_u16()));
                }
            }
            self.cleanup_staged(t);
        } else {
            let path = Self::partial(t)?;
            if path.exists() {
                fs::remove_file(path).map_err(err)?;
            }
        }
        t.status = "cancelled".into();
        Ok(())
    }
    /// Bounded metadata/text proxy; huge downloads must use the transfer queue.
    pub fn api(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<ApiResponse> {
        self.api_with_id(method, path, body, None)
    }
    pub fn api_with_id(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
        request_id: Option<String>,
    ) -> Result<ApiResponse> {
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Some(id) = &request_id {
            if id.len() > 128 {
                return Err("Invalid request identifier".into());
            }
            self.api_cancellations
                .lock()
                .map_err(err)?
                .insert(id.clone(), cancelled.clone());
        }
        let result = (|| -> Result<ApiResponse> {
            let config = read_config(&self.root)?;
            let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(err)?;
            let url = config.api(path)?;
            if !matches!(method.as_str(), "GET" | "POST" | "PATCH" | "DELETE")
                || url.path().contains("/download")
                || url.path().starts_with("/api/uploads")
                || url.path().starts_with("/api/events")
            {
                return Err("Use native queue for large bodies and poll feed metadata".into());
            }
            let response_limit = if url.path().ends_with("/text") {
                TEXT_LIMIT
            } else {
                METADATA_LIMIT
            };
            let mut request = self.request(method, url, &config);
            if let Some(body) = body {
                let encoded = match body {
                    serde_json::Value::String(text) => text.into_bytes(),
                    other => serde_json::to_vec(&other).map_err(err)?,
                };
                if encoded.len() as u64 > API_LIMIT {
                    return Err("Request body is too large; upload a text file instead".into());
                }
                request = request
                    .header("Content-Type", "application/json")
                    .body(encoded);
            }
            if cancelled.load(Ordering::SeqCst) {
                return Err("Request cancelled".into());
            }
            let mut response = request.send().map_err(|e| format!("Network: {e}"))?;
            let status = response.status().as_u16();
            if response.content_length().unwrap_or(0) > response_limit {
                return Err("Response exceeds client preparation budget; use Download".into());
            }
            let headers = ["content-type", "content-length", "etag"]
                .into_iter()
                .filter_map(|name| {
                    response
                        .headers()
                        .get(name)
                        .and_then(|v| v.to_str().ok())
                        .map(|v| (name.to_owned(), v.to_owned()))
                })
                .collect();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 65536];
            loop {
                if cancelled.load(Ordering::SeqCst) {
                    return Err("Request cancelled".into());
                }
                let n = response.read(&mut buffer).map_err(err)?;
                if n == 0 {
                    break;
                }
                if bytes.len() as u64 + n as u64 > response_limit {
                    return Err("Response exceeds client preparation budget; use Download".into());
                }
                bytes.extend_from_slice(&buffer[..n]);
            }
            Ok(ApiResponse {
                status,
                body: String::from_utf8(bytes).map_err(err)?,
                headers,
            })
        })();
        if let Some(id) = request_id {
            self.api_cancellations.lock().map_err(err)?.remove(&id);
        }
        result
    }
}
fn header_u64(response: &Response, name: &str) -> Result<u64> {
    response
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing {name}"))?
        .to_str()
        .map_err(err)?
        .parse()
        .map_err(err)
}
#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    pub base_url: String,
    pub source_device: String,
    pub connected: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_private_transport() {
        for url in [
            "https://box.tailnet.ts.net",
            "http://127.0.0.1:8080",
            "http://[::1]:8080",
        ] {
            assert!(Config {
                base_url: url.into(),
                token: "".into(),
                source_device: "test".into()
            }
            .validate()
            .is_ok());
        }
        for url in [
            "http://public.example",
            "https://x.example/prefix",
            "https://u:p@x.example",
            "file:///tmp/a",
            "https://x.example/?token=x",
        ] {
            assert!(Config {
                base_url: url.into(),
                token: "".into(),
                source_device: "test".into()
            }
            .validate()
            .is_err());
        }
    }
    #[test]
    fn durable_spool_and_source_change() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let q = Queue::open(root.clone()).unwrap();
        q.configure(Config {
            base_url: "http://127.0.0.1:1".into(),
            token: "secret".into(),
            source_device: "test".into(),
        })
        .unwrap();
        let path = temp.path().join("spaces $() ; unicode 🏠.txt");
        fs::write(&path, b"original").unwrap();
        let source = Source::inspect(&path).unwrap();
        spool_upload(&root, &path, "file").unwrap();
        q.ingest().unwrap();
        assert_eq!(q.list().unwrap().len(), 1);
        let id = q.list().unwrap()[0].id.clone();
        q.control(&id, "pause").unwrap();
        drop(q);
        let q = Queue::open(root).unwrap();
        assert_eq!(q.list().unwrap()[0].status, "paused");
        fs::write(&path, b"modified").unwrap();
        assert!(source.verify().is_err());
        assert!(!serde_json::to_string(&q.list().unwrap())
            .unwrap()
            .contains("secret"));
    }
    #[test]
    fn captured_destination_is_immutable_and_spool_has_no_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let q = Queue::open(root.clone()).unwrap();
        let a = Config {
            base_url: "http://127.0.0.1:1".into(),
            token: "server-a-secret".into(),
            source_device: "A".into(),
        };
        let b = Config {
            base_url: "http://127.0.0.1:2".into(),
            token: "server-b-secret".into(),
            source_device: "B".into(),
        };
        q.configure(a.clone()).unwrap();
        let path = temp.path().join("file.bin");
        fs::write(&path, b"file").unwrap();
        spool_upload(&root, &path, "file").unwrap();
        spool_text(&root, &mut &b"text"[..]).unwrap();
        for entry in fs::read_dir(root.join("inbox")).unwrap() {
            assert!(!fs::read_to_string(entry.unwrap().path())
                .unwrap()
                .contains("server-a-secret"));
        }
        q.configure(b).unwrap();
        q.consume_spool().unwrap();
        for transfer in &q.state.lock().unwrap().transfers {
            assert_eq!(transfer.config.base_url, a.base_url);
            assert!(transfer.config.token.is_empty());
            assert_eq!(transfer.status, "paused");
        }
        q.configure(a).unwrap();
        for transfer in &q.state.lock().unwrap().transfers {
            assert_eq!(transfer.config.token, "server-a-secret");
        }
        q.disconnect().unwrap();
        assert!(spool_upload(&root, &path, "file").is_err());
    }
    #[test]
    fn lock_and_corrupt_state_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let q = Queue::open(temp.path().to_owned()).unwrap();
        assert!(Queue::open(temp.path().to_owned()).is_err());
        drop(q);
        fs::write(temp.path().join("queue.json"), b"broken").unwrap();
        assert!(Queue::open(temp.path().to_owned()).is_err());
    }
}
