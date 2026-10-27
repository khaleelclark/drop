use super::*;

pub(crate) fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}
pub(crate) fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn sequence(value: &str) -> Result<i64> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("Invalid arrival cursor".into());
    }
    value.parse::<i64>().map_err(err)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Routing {
    pub source_device_id: String,
    pub target_device_ids: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct DeviceState {
    pub id: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default = "zero")]
    cursor: String,
    #[serde(default)]
    last_error: Option<String>,
}
fn zero() -> String {
    "0".into()
}
#[derive(Default, Serialize, Deserialize)]
struct DeviceStore {
    origins: HashMap<String, DeviceState>,
    target: Option<ArrivalTarget>,
}
// A separate lock lets Finder/CLI capture share identity without owning the queue.
fn store<T>(root: &Path, change: impl FnOnce(&mut DeviceStore) -> Result<T>) -> Result<T> {
    private_dir(root)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("devices.lock"))
        .map_err(err)?;
    lock.lock_exclusive().map_err(err)?;
    let path = root.join("devices.json");
    let mut state: DeviceStore = if path.exists() {
        read_json(&path)?
    } else {
        DeviceStore::default()
    };
    let result = change(&mut state)?;
    atomic_json(&path, &state)?;
    Ok(result)
}
pub(crate) fn identity(root: &Path, origin: &str) -> Result<DeviceState> {
    store(root, |s| {
        let d = s
            .origins
            .entry(origin.into())
            .or_insert_with(|| DeviceState {
                id: uuid::Uuid::new_v4().simple().to_string(),
                enabled: false,
                cursor: zero(),
                last_error: None,
            });
        if !valid_id(&d.id) {
            return Err("Invalid saved device identity".into());
        }
        sequence(&d.cursor)?;
        Ok(d.clone())
    })
}

/// A private, durable intent exists before a picker or streaming capture starts.
pub struct SendContext {
    pub(crate) config: Config,
    pub(crate) routing: Routing,
    intent: PathBuf,
}
impl Drop for SendContext {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.intent);
    }
}
pub(crate) fn prepare_send(
    root: &Path,
    label: Option<String>,
    targets: Option<Vec<String>>,
) -> Result<SendContext> {
    initialize_config(root, option_env!("HOUSEHOLD_DEFAULT_ORIGIN"))?;
    let mut config = read_config(root)?;
    if let Some(label) = label {
        config.source_device = label;
    }
    let id = identity(root, &config.base_url)?.id;
    let targets = targets.unwrap_or_default();
    prepare_snapshot(root, config, id, targets)
}
pub(crate) fn prepare_snapshot(
    root: &Path,
    mut config: Config,
    id: String,
    targets: Vec<String>,
) -> Result<SendContext> {
    let mut seen = HashSet::new();
    if targets.len() > 64
        || targets
            .iter()
            .any(|t| !valid_id(t) || t == &id || !seen.insert(t))
    {
        return Err("Choose up to 64 different recipient devices, excluding this device".into());
    }
    validate_label(&config.source_device)?;
    config.token.clear();
    let routing = Routing {
        source_device_id: id,
        target_device_ids: targets,
    };
    let dir = root.join("intake");
    private_dir(&dir)?;
    let intent = dir.join(format!("{}.json", uuid::Uuid::new_v4()));
    atomic_json(
        &intent,
        &serde_json::json!({"config": config, "routing": routing}),
    )?;
    Ok(SendContext {
        config,
        routing,
        intent,
    })
}
fn validate_label(label: &str) -> Result<()> {
    if label.trim().is_empty() || label.len() > 128 || label.chars().any(char::is_control) {
        return Err("Device name must be 1–128 UTF-8 bytes without control characters".into());
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArrivalTarget {
    pub base_url: String,
    pub item_id: String,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArrivalSettings {
    pub enabled: bool,
    pub permission: &'static str,
    pub mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}
pub struct ArrivalBanner {
    pub id: i32,
    pub target: ArrivalTarget,
    pub title: String,
    pub body: String,
}

// Plain bounded scalar values, including replacement of invisible formatting controls.
fn banner_string(value: &str, limit: usize) -> String {
    let mut result = String::new();
    let mut space = false;
    let mut count = 0;
    for c in value.chars() {
        if c.is_whitespace()
            || c.is_control()
            || matches!(c,
            '\u{ad}' | '\u{600}'..='\u{605}' | '\u{61c}' | '\u{6dd}' | '\u{70f}' |
            '\u{890}'..='\u{891}' | '\u{8e2}' | '\u{180e}' | '\u{200b}'..='\u{200f}' |
            '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}' |
            '\u{fff9}'..='\u{fffb}' | '\u{110bd}' | '\u{110cd}' | '\u{13430}'..='\u{1343f}' |
            '\u{1bca0}'..='\u{1bca3}' | '\u{1d173}'..='\u{1d17a}' |
            '\u{e0001}' | '\u{e0020}'..='\u{e007f}')
        {
            space = !result.is_empty();
            continue;
        }
        if count + usize::from(space) + 1 > limit {
            result.push('…');
            break;
        }
        if space {
            result.push(' ');
            count += 1;
            space = false;
        }
        result.push(c);
        count += 1;
    }
    result
}

fn arrival_copy(id: &str, count: usize, metadata: Option<&serde_json::Value>) -> (String, String) {
    let generic = || {
        (
            "Drop".into(),
            if count > 1 {
                format!("{count} new shares available")
            } else {
                "New share available".into()
            },
        )
    };
    let Some(item) = metadata.and_then(|v| v.get("item")) else {
        return generic();
    };
    if item["id"].as_str() != Some(id) || item["status"] != "ready" || !item["deletedAt"].is_null()
    {
        return generic();
    }
    let sender = banner_string(item["sourceDevice"].as_str().unwrap_or(""), 48);
    let sender = if sender.is_empty() {
        "Someone"
    } else {
        &sender
    };
    let (kind, detail) = match item["kind"].as_str() {
        Some("text") => {
            let preview = banner_string(item["preview"].as_str().unwrap_or(""), 160);
            (
                "text",
                if preview.is_empty() {
                    "Text share".into()
                } else {
                    preview
                },
            )
        }
        Some("file") => {
            let name = banner_string(item["name"].as_str().unwrap_or(""), 96);
            let Some(size) = item["size"]
                .as_u64()
                .filter(|n| *n <= 9_007_199_254_740_991)
            else {
                return generic();
            };
            if name.is_empty() {
                return generic();
            }
            let size = if size < 1024 {
                format!("{size} B")
            } else {
                let (unit, divisor) = if size < 1024 * 1024 {
                    ("KiB", 1024.)
                } else if size < 1024 * 1024 * 1024 {
                    ("MiB", 1048576.)
                } else {
                    ("GiB", 1073741824.)
                };
                format!("{:.1} {unit}", size as f64 / divisor)
            };
            ("file", format!("{name} · {size}"))
        }
        _ => return generic(),
    };
    if count > 1 {
        (
            format!("{count} new shares"),
            format!("{sender} shared {kind}: {detail}"),
        )
    } else {
        (format!("{sender} shared {kind}"), detail)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrivalPage {
    notifications: Vec<Arrival>,
    next_cursor: String,
    ack_cursor: String,
    has_more: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Arrival {
    sequence: String,
    item_id: String,
}
fn validate_page(page: &ArrivalPage, after: &str) -> Result<()> {
    let mut previous = sequence(after)?;
    sequence(&page.ack_cursor)?;
    if page.notifications.len() > 50 {
        return Err("Arrival page exceeds budget".into());
    }
    for n in &page.notifications {
        let current = sequence(&n.sequence)?;
        if current <= previous || !valid_id(&n.item_id) {
            return Err("Invalid arrival entry".into());
        }
        previous = current;
    }
    if sequence(&page.next_cursor)? != previous || (page.has_more && page.notifications.is_empty())
    {
        return Err("Invalid arrival page cursor".into());
    }
    Ok(())
}

impl Queue {
    pub fn rename_device(&self, source_device: &str) -> Result<()> {
        validate_label(source_device)?;
        let _config = config_lock(&self.root)?;
        let mut config = read_config(&self.root)?;
        config.source_device = source_device.into();
        atomic_json(&self.root.join("config.json"), &config)
    }
    pub(crate) fn device_request(
        &self,
        c: &Config,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let mut request = self
            .request(method, c.api(path)?, c)
            .timeout(Duration::from_secs(15));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = Self::checked(request.send())?;
        if response.content_length().unwrap_or(0) > 65536 {
            return Err("Device response exceeds budget".into());
        }
        let mut bytes = Vec::new();
        response.take(65537).read_to_end(&mut bytes).map_err(err)?;
        if bytes.len() > 65536 {
            return Err("Device response exceeds budget".into());
        }
        serde_json::from_slice(&bytes).map_err(err)
    }
    pub(crate) fn ensure_registration(&self, c: &Config, id: &str) -> Result<()> {
        if !valid_id(id) {
            return Err("Invalid source device identity".into());
        }
        validate_label(&c.source_device)?;
        let value = self.device_request(
            c,
            reqwest::Method::POST,
            "/api/devices/register",
            Some(serde_json::json!({"id": id, "label": c.source_device, "platform": platform(), "preserveExisting": true})),
        )?;
        if value["device"]["id"].as_str() != Some(id) {
            return Err("Registration identity mismatch".into());
        }
        Ok(())
    }
    pub fn arrival_settings(&self) -> Result<ArrivalSettings> {
        let config = self.connection()?;
        let d = if config.connected {
            Some(identity(&self.root, &config.base_url)?)
        } else {
            None
        };
        Ok(ArrivalSettings {
            enabled: d.as_ref().is_some_and(|d| d.enabled),
            // shortcut: no synchronous cross-platform OS permission query; validate each desktop.
            permission: "unknown",
            mode: "resident",
            last_error: d.and_then(|d| d.last_error),
        })
    }
    pub fn set_arrival_enabled(&self, enabled: bool) -> Result<ArrivalSettings> {
        // Wait for the bounded current cycle before returning Disabled.
        let _flight = self.arrival_flight.lock().map_err(err)?;
        let _pairing = self.pairing_lock.lock().map_err(err)?;
        let c = read_config(&self.root)?;
        identity(&self.root, &c.base_url)?;
        store(&self.root, |s| {
            let d = s.origins.get_mut(&c.base_url).ok_or("Missing device")?;
            d.enabled = enabled;
            d.last_error = None;
            Ok(())
        })?;
        self.arrival_settings()
    }
    pub(crate) fn clear_arrivals_on_disconnect(&self) -> Result<()> {
        store(&self.root, |s| {
            for d in s.origins.values_mut() {
                d.enabled = false;
                d.last_error = None;
            }
            s.target = None;
            Ok(())
        })
    }
    pub fn record_arrival_click(&self, target: ArrivalTarget) -> Result<()> {
        let _pairing = self.pairing_lock.lock().map_err(err)?;
        let c = read_config(&self.root)?;
        if target.base_url != c.base_url || !valid_id(&target.item_id) {
            return Err("This notification belongs to a different or invalid pairing".into());
        }
        store(&self.root, |s| {
            s.target = Some(target);
            Ok(())
        })
    }
    pub fn take_arrival_target(&self) -> Result<Option<ArrivalTarget>> {
        let _pairing = self.pairing_lock.lock().map_err(err)?;
        let config = self.connection()?;
        store(&self.root, |s| {
            Ok(s.target.take().filter(|t| {
                config.connected && t.base_url == config.base_url && valid_id(&t.item_id)
            }))
        })
    }
    fn arrival_current(&self, c: &Config, id: &str) -> Result<bool> {
        if self.stopping.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let current = read_config(&self.root)?;
        if current.base_url != c.base_url || current.token != c.token {
            return Ok(false);
        }
        let d = identity(&self.root, &c.base_url)?;
        Ok(d.enabled && d.id == id)
    }
    /// Single-flight, one 50-entry batch per cycle; ACK never removes For you.
    pub fn poll_arrivals(&self, post: impl FnOnce(ArrivalBanner) -> Result<()>) -> Result<()> {
        let _flight = match self.arrival_flight.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::WouldBlock) => return Ok(()),
            Err(e) => return Err(err(e)),
        };
        let c = match read_config(&self.root) {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };
        let d = identity(&self.root, &c.base_url)?;
        if !d.enabled || self.stopping.load(Ordering::SeqCst) {
            return Ok(());
        }
        let outcome = (|| {
            self.ensure_registration(&c, &d.id)?;
            // Retrying this saved checkpoint first also recovers a lost ACK response.
            if d.cursor != "0" {
                self.ack_arrivals(&c, &d.id, &d.cursor)?;
            }
            let value = self.device_request(
                &c,
                reqwest::Method::GET,
                &format!(
                    "/api/devices/{}/notifications?after={}&limit=50",
                    d.id, d.cursor
                ),
                None,
            )?;
            let page: ArrivalPage = serde_json::from_value(value).map_err(err)?;
            validate_page(&page, &d.cursor)?;
            if let Some(last) = page.notifications.last() {
                if !self.arrival_current(&c, &d.id)? {
                    return Ok(());
                }
                // Use only existing bounded authenticated metadata; failure must not block delivery.
                let metadata = self
                    .device_request(
                        &c,
                        reqwest::Method::GET,
                        &format!("/api/items/{}", last.item_id),
                        None,
                    )
                    .ok();
                let (title, body) =
                    arrival_copy(&last.item_id, page.notifications.len(), metadata.as_ref());
                let _pairing = self.pairing_lock.lock().map_err(err)?;
                if !self.arrival_current(&c, &d.id)? {
                    return Ok(());
                }
                let key = format!("{}:{}:{}", c.base_url, d.id, last.sequence);
                let digest = Sha256::digest(key.as_bytes());
                let id = i32::from_be_bytes(digest[..4].try_into().map_err(err)?) & i32::MAX;
                post(ArrivalBanner {
                    id,
                    target: ArrivalTarget {
                        base_url: c.base_url.clone(),
                        item_id: last.item_id.clone(),
                    },
                    title,
                    body,
                })?;
                // OS display and durable write cannot be atomic: a crash can repeat this stable ID.
                store(&self.root, |s| {
                    s.origins
                        .get_mut(&c.base_url)
                        .ok_or("Missing device")?
                        .cursor = page.next_cursor.clone();
                    Ok(())
                })?;
                drop(_pairing);
                self.ack_arrivals(&c, &d.id, &page.next_cursor)?;
            }
            Ok(())
        })();
        store(&self.root, |s| {
            // Error text deliberately omits URLs, response bodies and credentials.
            s.origins
                .get_mut(&c.base_url)
                .ok_or("Missing device")?
                .last_error = outcome.as_ref().err().map(|_| {
                "Arrival check or notification handoff failed; check pairing, Tailscale, server and notification settings".into()
            });
            Ok(())
        })?;
        outcome
    }
    fn ack_arrivals(&self, c: &Config, id: &str, cursor: &str) -> Result<()> {
        let value = self.device_request(
            c,
            reqwest::Method::POST,
            &format!("/api/devices/{id}/notifications/ack"),
            Some(serde_json::json!({"through":cursor})),
        )?;
        let ack = value["ackCursor"].as_str().ok_or("Missing ACK cursor")?;
        if sequence(ack)? < sequence(cursor)? {
            return Err("Arrival ACK moved backward".into());
        }
        Ok(())
    }
    pub fn start_arrivals(
        self: &Arc<Self>,
        post: impl Fn(ArrivalBanner) -> Result<()> + Send + Sync + 'static,
    ) {
        if self.arrival_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let q = self.clone();
        thread::spawn(move || {
            let mut delay = 5u64;
            while !q.stopping.load(Ordering::SeqCst) {
                if q.poll_arrivals(&post).is_err() {
                    delay = (delay * 2).min(60);
                } else {
                    delay = 5;
                }
                for _ in 0..delay * 4 {
                    if q.stopping.load(Ordering::SeqCst) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(250));
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arrival_copy_matches_shared_plain_metadata_fixture() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../shared/arrival-banner-fixture.json"))
                .unwrap();
        for case in cases.as_array().unwrap() {
            let (title, body) = arrival_copy(
                case["itemId"].as_str().unwrap(),
                case["count"].as_u64().unwrap() as usize,
                Some(&case["metadata"]),
            );
            assert_eq!(title, case["title"], "{}", case["name"]);
            assert_eq!(body, case["body"], "{}", case["name"]);
        }
    }
    #[test]
    fn arrival_copy_bounds_unicode_without_controls_or_partial_utf8() {
        let id = "3".repeat(32);
        let metadata = serde_json::json!({"item":{"id":id,"kind":"text","status":"ready",
            "sourceDevice":"🖥".repeat(100),"preview":"家👋".repeat(300)}});
        let (title, body) = arrival_copy(&id, 50, Some(&metadata));
        assert_eq!(title, "50 new shares");
        assert_eq!(
            body,
            format!("{}… shared text: {}…", "🖥".repeat(48), "家👋".repeat(80))
        );
        assert!(body.chars().count() <= 260);
        assert!(!body.chars().any(char::is_control));
        assert_eq!(banner_string(" a\0b\n\u{202e}c \t", 8), "a b c");
    }
    fn config(origin: &str) -> Config {
        Config {
            base_url: origin.into(),
            token: "private-token".into(),
            source_device: "Kitchen Mac".into(),
        }
    }
    #[test]
    fn rename_device_preserves_auth_identity_queue_and_capture_routing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let q = Queue::open(root.into()).unwrap();
        q.configure(config("https://one.example")).unwrap();
        let context = q.prepare_send(None, Some(vec!["b".repeat(32)])).unwrap();
        let file = root.join("source.txt");
        fs::write(&file, b"queued before rename").unwrap();
        for _ in 0..2 {
            q.enqueue_prepared(&file, "text", &context).unwrap();
        }
        q.state.lock().unwrap().transfers[1].status = "running".into();
        q.save().unwrap();
        let spool = spool_prepared(root, &file, "text", &context).unwrap();
        let paths = [
            root.join("queue.json"),
            root.join("devices.json"),
            context.intent.clone(),
            root.join("inbox").join(format!("{spool}.json")),
        ];
        let before: Vec<_> = paths.iter().map(|p| fs::read(p).unwrap()).collect();
        let memory = serde_json::to_value(&*q.state.lock().unwrap()).unwrap();
        let mut expected: serde_json::Value = read_json(&root.join("config.json")).unwrap();
        expected["sourceDevice"] = "Renamed Mac 🖥".into();
        q.rename_device("Renamed Mac 🖥").unwrap();
        assert_eq!(
            read_json::<serde_json::Value>(&root.join("config.json")).unwrap(),
            expected
        );
        for (path, bytes) in paths.iter().zip(before) {
            assert_eq!(fs::read(path).unwrap(), bytes, "{}", path.display());
        }
        assert_eq!(
            serde_json::to_value(&*q.state.lock().unwrap()).unwrap(),
            memory
        );
        let view = q.connection().unwrap();
        assert_eq!(
            view.device_id.as_deref(),
            Some(context.routing.source_device_id.as_str())
        );
        assert!(view.can_rename_device);
        assert_eq!(
            serde_json::to_value(&view).unwrap()["canRenameDevice"],
            true
        );
        drop(q);
        let q = Queue::open(root.into()).unwrap();
        assert_eq!(q.connection().unwrap().source_device, "Renamed Mac 🖥");
        assert_eq!(q.connection().unwrap().device_id, view.device_id);
        assert_eq!(read_config(root).unwrap().token, "private-token");
        assert_eq!(read_config(root).unwrap().base_url, "https://one.example");
        let next = q.prepare_send(None, None).unwrap();
        assert_eq!(next.config.source_device, "Renamed Mac 🖥");
        assert_eq!(
            next.routing.source_device_id,
            context.routing.source_device_id
        );
        for t in &q.state.lock().unwrap().transfers {
            assert_eq!(t.config.source_device, "Kitchen Mac");
            assert_eq!(t.config.token, "private-token");
            assert_eq!(
                t.routing.as_ref().unwrap().source_device_id,
                context.routing.source_device_id
            );
            assert_eq!(
                t.routing.as_ref().unwrap().target_device_ids,
                vec!["b".repeat(32)]
            );
        }
    }
    #[test]
    fn rename_device_validates_label_without_writing_on_rejection() {
        let tmp = tempfile::tempdir().unwrap();
        let q = Queue::open(tmp.path().into()).unwrap();
        q.configure(config("https://one.example")).unwrap();
        let path = tmp.path().join("config.json");
        let before = fs::read(&path).unwrap();
        for label in [
            "",
            "   ",
            "\t",
            "a\nb",
            "a\rb",
            "a\0b",
            "a\u{7f}b",
            "a\u{85}b",
            &"x".repeat(129),
            &"é".repeat(65),
        ] {
            assert!(q.rename_device(label).is_err(), "{label:?}");
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        for label in ["x".repeat(128), "é".repeat(64)] {
            q.rename_device(&label).unwrap();
            assert_eq!(read_config(tmp.path()).unwrap().source_device, label);
        }
    }
    #[test]
    fn rename_device_requires_connection_and_cannot_undo_disconnect() {
        for saved in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            let root = tmp.path();
            let q = Queue::open_with_default_origin(root.into(), None).unwrap();
            assert!(q.rename_device("Not paired").is_err());
            assert!(!root.join("config.json").exists());
            if saved {
                q.configure(config("https://one.example")).unwrap();
                q.rename_device("Before disconnect").unwrap();
            }
            q.disconnect().unwrap();
            let before = fs::read(root.join("config.json")).ok();
            assert!(q.rename_device("After disconnect").is_err());
            assert_eq!(fs::read(root.join("config.json")).ok(), before);
            assert!(root.join("disconnected").exists());
            assert!(!q.connection().unwrap().connected);
            drop(q);
            let q = Queue::open_with_default_origin(root.into(), Some("https://default.example"))
                .unwrap();
            assert!(q.rename_device("Still disconnected").is_err());
            assert!(!q.connection().unwrap().connected);
            q.configure(config("https://one.example")).unwrap();
            q.rename_device("Explicitly reconnected").unwrap();
            assert_eq!(
                q.connection().unwrap().source_device,
                "Explicitly reconnected"
            );
        }
    }
    #[test]
    fn rename_device_and_disconnect_share_the_config_lock() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let q = Queue::open(root.into()).unwrap();
        q.configure(config("https://one.example")).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let rename_queue = q.clone();
        let rename_barrier = barrier.clone();
        let rename = thread::spawn(move || {
            rename_barrier.wait();
            rename_queue.rename_device("Concurrent name")
        });
        barrier.wait();
        q.disconnect().unwrap();
        let renamed = rename.join().unwrap().is_ok();
        let saved: Config = read_json(&root.join("config.json")).unwrap();
        assert_eq!(
            saved.source_device,
            if renamed {
                "Concurrent name"
            } else {
                "Kitchen Mac"
            }
        );
        assert_eq!(saved.base_url, "https://one.example");
        assert!(saved.token.is_empty());
        assert!(root.join("disconnected").exists());
        assert!(!q.connection().unwrap().connected);
    }
    #[test]
    fn identity_settings_and_click_survive_restart_without_secrets() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let q = Queue::open(root.into()).unwrap();
        q.configure(config("https://ONE.example:443/")).unwrap();
        let id = q.connection().unwrap().device_id.unwrap();
        assert!(valid_id(&id));
        assert!(!q.arrival_settings().unwrap().enabled);
        assert_eq!(q.arrival_settings().unwrap().permission, "unknown");
        q.set_arrival_enabled(true).unwrap();
        let target = ArrivalTarget {
            base_url: "https://one.example".into(),
            item_id: "a".repeat(32),
        };
        q.record_arrival_click(target.clone()).unwrap();
        drop(q);
        let q = Queue::open(root.into()).unwrap();
        assert_eq!(
            q.connection().unwrap().device_id.as_deref(),
            Some(id.as_str())
        );
        assert!(q.arrival_settings().unwrap().enabled);
        assert_eq!(q.take_arrival_target().unwrap(), Some(target.clone()));
        assert_eq!(q.take_arrival_target().unwrap(), None);
        assert!(q
            .record_arrival_click(ArrivalTarget {
                item_id: "../wrong".into(),
                ..target.clone()
            })
            .is_err());
        q.record_arrival_click(target.clone()).unwrap();
        q.configure(config("https://two.example")).unwrap();
        assert_ne!(
            q.connection().unwrap().device_id.as_deref(),
            Some(id.as_str())
        );
        assert_eq!(q.take_arrival_target().unwrap(), None);
        assert!(q.record_arrival_click(target).is_err());
        q.configure(config("https://one.example")).unwrap();
        assert_eq!(
            q.connection().unwrap().device_id.as_deref(),
            Some(id.as_str())
        );
        q.disconnect().unwrap();
        q.configure(config("https://one.example")).unwrap();
        assert!(!q.arrival_settings().unwrap().enabled);
        assert_eq!(
            q.connection().unwrap().device_id.as_deref(),
            Some(id.as_str())
        );
        let disk = fs::read_to_string(root.join("devices.json")).unwrap();
        assert!(!disk.contains("private-token"));
    }
    #[test]
    fn immutable_intent_and_legacy_spool_and_queue_remain_compatible() {
        let tmp = tempfile::tempdir().unwrap();
        let q = Queue::open(tmp.path().into()).unwrap();
        q.configure(config("https://one.example")).unwrap();
        let source_id = q.connection().unwrap().device_id.unwrap();
        assert!(q.prepare_send(None, Some(vec![source_id.clone()])).is_err());
        assert!(q
            .prepare_send(None, Some(vec!["b".repeat(32), "b".repeat(32)]))
            .is_err());
        assert!(q.prepare_send(None, Some(vec!["wrong".into()])).is_err());
        let context = q
            .prepare_send(Some("Original label".into()), Some(vec!["b".repeat(32)]))
            .unwrap();
        assert!(context.intent.exists());
        assert!(!fs::read_to_string(&context.intent)
            .unwrap()
            .contains("private-token"));
        q.configure(config("https://two.example")).unwrap();
        let file = tmp.path().join("file.txt");
        fs::write(&file, "content").unwrap();
        q.enqueue_prepared(&file, "text", &context).unwrap();
        let disk: DiskState = read_json(&tmp.path().join("queue.json")).unwrap();
        let t = &disk.transfers[0];
        assert_eq!(t.config.base_url, "https://one.example");
        assert_eq!(t.config.source_device, "Original label");
        assert!(t.config.token.is_empty());
        assert_eq!(t.status, "paused");
        assert_eq!(t.routing.as_ref().unwrap().source_device_id, source_id);
        assert_eq!(
            t.routing.as_ref().unwrap().target_device_ids,
            vec!["b".repeat(32)]
        );
        // Old captures have no routing field; ingest them as legacy Everyone without inventing an ID.
        let mut legacy = serde_json::json!({"type":"upload", "source":Source::inspect(&file).unwrap(),
            "kind":"file","name":"legacy", "config":config("https://two.example")});
        legacy["config"]["token"] = "".into();
        atomic_json(&tmp.path().join("inbox/legacy.json"), &legacy).unwrap();
        q.consume_spool().unwrap();
        assert!(q
            .state
            .lock()
            .unwrap()
            .transfers
            .iter()
            .find(|t| t.id == "legacy")
            .unwrap()
            .routing
            .is_none());
        drop(context);
        assert_eq!(fs::read_dir(tmp.path().join("intake")).unwrap().count(), 0);
        // Old queue rows also deserialize without routing after a process restart.
        let mut disk: serde_json::Value = read_json(&tmp.path().join("queue.json")).unwrap();
        for row in disk["transfers"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("routing");
        }
        drop(q);
        atomic_json(&tmp.path().join("queue.json"), &disk).unwrap();
        let q = Queue::open(tmp.path().into()).unwrap();
        assert_eq!(q.list().unwrap().len(), 2);
        assert!(q
            .state
            .lock()
            .unwrap()
            .transfers
            .iter()
            .all(|t| t.routing.is_none()));
    }
    #[test]
    fn identity_lock_serializes_concurrent_capture_and_cursors_fail_closed() {
        let tmp = tempfile::tempdir().unwrap();
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let root = tmp.path().to_owned();
                thread::spawn(move || identity(&root, "https://one.example").unwrap().id)
            })
            .collect();
        let ids: HashSet<_> = workers.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(ids.len(), 1);
        for bad in ["", "01", "-1", "1.0", "9223372036854775808", "١"] {
            assert!(sequence(bad).is_err());
        }
        for good in ["0", "1", "9223372036854775807"] {
            assert!(sequence(good).is_ok());
        }
        let page: ArrivalPage = serde_json::from_value(serde_json::json!({"notifications":[
            {"sequence":"2","itemId":"a".repeat(32)}, {"sequence":"2","itemId":"b".repeat(32)}
        ],"nextCursor":"2","ackCursor":"0","hasMore":false}))
        .unwrap();
        assert!(validate_page(&page, "0").is_err());
        fs::write(tmp.path().join("devices.json"), "broken").unwrap();
        assert!(identity(tmp.path(), "https://one.example").is_err());
    }
}
