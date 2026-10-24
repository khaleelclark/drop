use super::*;
use std::{collections::HashMap, sync::Mutex, thread, time::Duration};
use zbus::{
    blocking::{Connection, MessageIterator},
    connection::Builder as AsyncBuilder,
    MatchRule,
};

const SERVICE: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const MAX_SHOWN: usize = 256;

pub(super) struct Notifier {
    client: Mutex<Option<Client>>,
    click: Click,
}
struct Shown {
    internal_id: i32,
    target: ArrivalTarget,
}
type ShownMap = Arc<Mutex<HashMap<(String, u32), Shown>>>;
struct Client {
    connection: Connection,
    shown: ShownMap,
}

impl Notifier {
    pub(super) fn new(click: Click) -> Result<Self> {
        Ok(Self {
            client: Mutex::new(None),
            click,
        })
    }
    pub(super) fn request_permission(&self) -> Result<()> {
        Ok(())
    }
    pub(super) fn post(&self, banner: ArrivalBanner) -> Result<()> {
        let mut client = self.client.lock().map_err(|e| e.to_string())?;
        if client.is_none() {
            *client = Some(Client::connect(self.click.clone())?);
        }
        client.as_ref().unwrap().post(banner)
    }
}
impl Client {
    fn connect(click: Click) -> Result<Self> {
        Self::connect_with(AsyncBuilder::session().map_err(|e| e.to_string())?, click)
    }
    fn connect_with(builder: AsyncBuilder<'_>, click: Click) -> Result<Self> {
        // The method timeout does not bound D-Bus authentication; cancel that future separately.
        let connection = async_io::block_on(futures_lite::future::or(
            async {
                builder
                    .method_timeout(Duration::from_secs(3))
                    .build()
                    .await
                    .map(Connection::from)
                    .map_err(|e| e.to_string())
            },
            async {
                async_io::Timer::after(Duration::from_secs(3)).await;
                Err("Notification bus connection timed out".into())
            },
        ))?;
        // Subscribe on the sending connection before Notify; even an immediate action is queued.
        let rule = MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .path(PATH)
            .map_err(|e| e.to_string())?
            .interface(SERVICE)
            .map_err(|e| e.to_string())?
            .build();
        let signals = MessageIterator::for_match_rule(rule, &connection, Some(512))
            .map_err(|e| e.to_string())?;
        let shown: ShownMap = Arc::new(Mutex::new(HashMap::new()));
        let entries = shown.clone();
        thread::Builder::new()
            .name("zing-arrival-actions".into())
            .spawn(move || {
                for signal in signals {
                    let Ok(signal) = signal else { break };
                    let header = signal.header();
                    let Some(sender) = header.sender() else {
                        continue;
                    };
                    let target = {
                        let Ok(mut entries) = entries.lock() else {
                            break;
                        };
                        match header.member().map(|v| v.as_str()) {
                            Some("ActionInvoked") => {
                                let Ok((id, action)) = signal.body().deserialize::<(u32, String)>()
                                else {
                                    continue;
                                };
                                if action != "default" {
                                    continue;
                                }
                                entries
                                    .get(&(sender.to_string(), id))
                                    .map(|v| v.target.clone())
                            }
                            Some("NotificationClosed") => {
                                if let Ok((id, _)) = signal.body().deserialize::<(u32, u32)>() {
                                    entries.remove(&(sender.to_string(), id));
                                }
                                None
                            }
                            _ => None,
                        }
                    };
                    // No map lock while the queue validates the current pairing/persists the target.
                    if let Some(target) = target {
                        click(target);
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { connection, shown })
    }
    fn post(&self, banner: ArrivalBanner) -> Result<()> {
        // Keep immediate signals behind the returned server-ID/target association.
        let mut shown = self.shown.lock().map_err(|e| e.to_string())?;
        let owner: String = self
            .connection
            .call_method(
                Some("org.freedesktop.DBus"),
                "/org/freedesktop/DBus",
                Some("org.freedesktop.DBus"),
                "GetNameOwner",
                &(SERVICE,),
            )
            .map_err(|e| e.to_string())?
            .body()
            .deserialize()
            .map_err(|e| e.to_string())?;
        shown.retain(|(sender, _), _| sender == &owner);
        // Reuse only an actual receipt from this live server, for this exact batch and target.
        let replaces = shown
            .iter()
            .find(|(_, v)| v.internal_id == banner.id && v.target == banner.target)
            .map(|((_, id), _)| *id)
            .unwrap_or(0);
        if replaces == 0 && shown.len() >= MAX_SHOWN {
            return Err("Close old Drop alerts before retrying arrivals".into());
        }
        let hints: HashMap<&str, zbus::zvariant::Value<'_>> = HashMap::new();
        let reply = self
            .connection
            .call_method(
                Some(owner.as_str()),
                PATH,
                Some(SERVICE),
                "Notify",
                &(
                    "Drop",
                    replaces,
                    "household-share",
                    "Drop",
                    body(banner.multiple),
                    vec!["default", "Open Drop"],
                    hints,
                    -1i32,
                ),
            )
            .map_err(|e| e.to_string())?;
        let id: u32 = reply.body().deserialize().map_err(|e| e.to_string())?;
        if id == 0 {
            return Err("Notification server returned an invalid ID".into());
        }
        if reply.header().sender().map(|v| v.as_str()) != Some(owner.as_str()) {
            return Err("Notification receipt belongs to another server".into());
        }
        // Never use the stable hash as replaces_id: server IDs belong to this connection/owner.
        shown.insert(
            (owner, id),
            Shown {
                internal_id: banner.id,
                target: banner.target,
            },
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use household_native::{Config, Queue};
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        process::{Child, Command, Stdio},
        sync::{
            atomic::{AtomicBool, AtomicU32, Ordering},
            mpsc,
        },
    };
    use zbus::blocking::connection::Builder;

    struct Bus {
        daemon: Child,
        address: String,
    }
    impl Bus {
        fn new() -> Self {
            let mut daemon = Command::new("dbus-daemon")
                .args(["--session", "--nofork", "--print-address=1"])
                .stdout(Stdio::piped())
                .spawn()
                .expect("dbus-daemon is required for boundary tests");
            let mut address = String::new();
            BufReader::new(daemon.stdout.take().unwrap())
                .read_line(&mut address)
                .unwrap();
            Self {
                daemon,
                address: address.trim().into(),
            }
        }
        fn builder(&self) -> Builder<'_> {
            Builder::address(self.address.as_str()).unwrap()
        }
    }
    impl Drop for Bus {
        fn drop(&mut self) {
            let _ = self.daemon.kill();
            let _ = self.daemon.wait();
        }
    }
    #[derive(Default)]
    struct ServiceState {
        reject: AtomicBool,
        zero: AtomicBool,
        slow: AtomicBool,
        next_id: AtomicU32,
        requests: Mutex<Vec<(String, u32, String, String, Vec<String>)>>,
    }
    struct Service(Arc<ServiceState>);
    #[zbus::interface(name = "org.freedesktop.Notifications")]
    impl Service {
        #[allow(clippy::too_many_arguments)]
        fn notify(
            &self,
            app: String,
            replaces: u32,
            _icon: String,
            summary: String,
            body: String,
            actions: Vec<String>,
            _hints: HashMap<String, zbus::zvariant::OwnedValue>,
            _timeout: i32,
            #[zbus(connection)] connection: &zbus::Connection,
        ) -> zbus::fdo::Result<u32> {
            self.0
                .requests
                .lock()
                .unwrap()
                .push((app, replaces, summary, body, actions));
            if self.0.reject.load(Ordering::SeqCst) {
                return Err(zbus::fdo::Error::Failed("OS refused handoff".into()));
            }
            if self.0.slow.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_secs(4));
            }
            if self.0.zero.load(Ordering::SeqCst) {
                return Ok(0);
            }
            let id = if replaces != 0 {
                replaces
            } else {
                73 + self.0.next_id.fetch_add(1, Ordering::SeqCst)
            };
            // Deliberately emit before the method reply, exercising subscribe-before-post.
            zbus::blocking::Connection::from(connection.clone())
                .emit_signal(
                    None::<&str>,
                    PATH,
                    SERVICE,
                    "ActionInvoked",
                    &(id, "default"),
                )
                .unwrap();
            Ok(id)
        }
    }
    fn service(bus: &Bus, state: Arc<ServiceState>) -> Connection {
        bus.builder()
            .name(SERVICE)
            .unwrap()
            .serve_at(PATH, Service(state))
            .unwrap()
            .build()
            .unwrap()
    }
    fn notifier(bus: &Bus, click: Click) -> ArrivalNotifier {
        let client = Client::connect_with(
            AsyncBuilder::address(bus.address.as_str()).unwrap(),
            click.clone(),
        )
        .unwrap();
        ArrivalNotifier(Notifier {
            client: Mutex::new(Some(client)),
            click,
        })
    }
    fn banner() -> ArrivalBanner {
        ArrivalBanner {
            id: 999,
            target: ArrivalTarget {
                base_url: "https://household.test".into(),
                item_id: "0123456789abcdef0123456789abcdef".into(),
            },
            multiple: false,
        }
    }

    // Small real HTTP peer for the queue's registration/arrival/ACK protocol.
    struct Feed {
        config: Config,
        stop: Arc<AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
        acks: Arc<Mutex<Vec<String>>>,
    }
    impl Feed {
        fn new() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let config = Config {
                base_url: format!("http://{}", listener.local_addr().unwrap()),
                token: "private-test-token".into(),
                source_device: "private-device-name".into(),
            };
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = stop.clone();
            let acks = Arc::new(Mutex::new(Vec::new()));
            let acked = acks.clone();
            let thread = thread::spawn(move || {
                for stream in listener.incoming() {
                    let mut stream = stream.unwrap();
                    if stopped.load(Ordering::SeqCst) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    let path = line.split_whitespace().nth(1).unwrap().to_string();
                    let mut length = 0;
                    loop {
                        line.clear();
                        reader.read_line(&mut line).unwrap();
                        if line == "\r\n" {
                            break;
                        }
                        if let Some((name, value)) = line.split_once(':') {
                            if name.eq_ignore_ascii_case("content-length") {
                                length = value.trim().parse().unwrap();
                            }
                        }
                    }
                    let mut body = vec![0; length];
                    reader.read_exact(&mut body).unwrap();
                    let response = if path == "/api/devices/register" {
                        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
                        serde_json::json!({"device":{"id":value["id"]}})
                    } else if path.ends_with("/ack") {
                        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
                        acked.lock().unwrap().push(value["through"].as_str().unwrap().into());
                        serde_json::json!({"ackCursor":value["through"]})
                    } else {
                        let done = path.contains("after=3&");
                        serde_json::json!({"notifications":if done { vec![] } else {vec![serde_json::json!({"sequence":"3","itemId":banner().target.item_id})]},
                            "nextCursor":"3","ackCursor":"0","hasMore":false})
                    }.to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        response.len(),
                        response
                    )
                    .unwrap();
                }
            });
            Self {
                config,
                stop,
                thread: Some(thread),
                acks,
            }
        }
    }
    impl Drop for Feed {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            let _ =
                std::net::TcpStream::connect(self.config.base_url.trim_start_matches("http://"));
            self.thread.take().unwrap().join().unwrap();
        }
    }

    #[test]
    fn rejected_os_handoff_keeps_cursor_no_ack_and_replays_after_restart() {
        let bus = Bus::new();
        let state = Arc::new(ServiceState::default());
        state.reject.store(true, Ordering::SeqCst);
        let _service = service(&bus, state.clone());
        let (tx, rx) = mpsc::channel();
        let adapter = notifier(
            &bus,
            Arc::new(move |target| {
                tx.send(target).unwrap();
            }),
        );
        let feed = Feed::new();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let q = Queue::open(root.clone()).unwrap();
        q.configure(feed.config.clone()).unwrap();
        q.set_arrival_enabled(true).unwrap();
        assert!(q.poll_arrivals(|b| adapter.post(b)).is_err());
        assert!(feed.acks.lock().unwrap().is_empty());
        assert!(q
            .arrival_settings()
            .unwrap()
            .last_error
            .unwrap()
            .contains("handoff"));
        let store: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("devices.json")).unwrap()).unwrap();
        assert_eq!(store["origins"][&feed.config.base_url]["cursor"], "0");
        drop(q);
        let q = Queue::open(root.clone()).unwrap();
        assert!(q.arrival_settings().unwrap().last_error.is_some());
        state.reject.store(false, Ordering::SeqCst);
        q.poll_arrivals(|b| adapter.post(b)).unwrap();
        let target = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(target.base_url, feed.config.base_url);
        assert_eq!(target.item_id, banner().target.item_id);
        q.record_arrival_click(target.clone()).unwrap();
        assert!(q.arrival_settings().unwrap().last_error.is_none());
        assert_eq!(*feed.acks.lock().unwrap(), vec!["3"]);
        q.poll_arrivals(|_| panic!("must not repost saved progress"))
            .unwrap();
        drop(q);
        let q = Queue::open(root).unwrap();
        assert_eq!(q.take_arrival_target().unwrap(), Some(target));
        assert_eq!(q.take_arrival_target().unwrap(), None);
        let requests = state.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[1],
            (
                "Drop".into(),
                0,
                "Drop".into(),
                "New share available".into(),
                vec!["default".into(), "Open Drop".into()]
            )
        );
    }

    #[test]
    fn immediate_click_uses_receipt_owner_and_exact_payload_rejects_forged_signals() {
        let bus = Bus::new();
        let state = Arc::new(ServiceState::default());
        let service = service(&bus, state.clone());
        let (tx, rx) = mpsc::channel();
        let adapter = notifier(
            &bus,
            Arc::new(move |target| {
                tx.send(target).unwrap();
            }),
        );
        adapter.post(banner()).unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            banner().target
        );
        adapter.post(banner()).unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            banner().target
        );
        assert_eq!(
            state
                .requests
                .lock()
                .unwrap()
                .iter()
                .map(|v| v.1)
                .collect::<Vec<_>>(),
            vec![0, 73],
            "retry replaces only its own server-issued receipt, never internal hash 999"
        );
        let attacker = bus.builder().build().unwrap();
        attacker
            .emit_signal(
                None::<&str>,
                PATH,
                SERVICE,
                "ActionInvoked",
                &(73u32, "default"),
            )
            .unwrap();
        service
            .emit_signal(
                None::<&str>,
                PATH,
                SERVICE,
                "ActionInvoked",
                &(73u32, "evil"),
            )
            .unwrap();
        service
            .emit_signal(
                None::<&str>,
                PATH,
                SERVICE,
                "ActionInvoked",
                &(999u32, "default"),
            )
            .unwrap();
        service
            .emit_signal(
                None::<&str>,
                PATH,
                SERVICE,
                "NotificationClosed",
                &(73u32, 2u32),
            )
            .unwrap();
        service
            .emit_signal(
                None::<&str>,
                PATH,
                SERVICE,
                "ActionInvoked",
                &(73u32, "default"),
            )
            .unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(150)).is_err());
        let mut invalid = banner();
        invalid.target.item_id = "../remote".into();
        assert!(adapter.post(invalid).is_err());
    }

    #[test]
    fn zero_receipt_and_slow_reply_are_errors_not_queued_success() {
        let bus = Bus::new();
        let state = Arc::new(ServiceState::default());
        let _service = service(&bus, state.clone());
        let adapter = notifier(&bus, Arc::new(|_| {}));
        state.zero.store(true, Ordering::SeqCst);
        assert!(adapter.post(banner()).unwrap_err().contains("invalid ID"));
        state.slow.store(true, Ordering::SeqCst);
        let started = std::time::Instant::now();
        assert!(adapter.post(banner()).is_err());
        assert!(started.elapsed() >= Duration::from_secs(2));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn replacement_receipt_never_crosses_notification_server_ownership() {
        let bus = Bus::new();
        let old = service(&bus, Arc::new(ServiceState::default()));
        let (tx, rx) = mpsc::channel();
        let adapter = notifier(
            &bus,
            Arc::new(move |target| {
                tx.send(target).unwrap();
            }),
        );
        adapter.post(banner()).unwrap();
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        old.release_name(SERVICE).unwrap();
        let state = Arc::new(ServiceState::default());
        let _new = service(&bus, state.clone());
        adapter.post(banner()).unwrap();
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(
            state.requests.lock().unwrap()[0].1,
            0,
            "old owner's ID must not replace a new owner's notification"
        );
        old.emit_signal(
            None::<&str>,
            PATH,
            SERVICE,
            "ActionInvoked",
            &(73u32, "default"),
        )
        .unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(150)).is_err());
    }

    #[test]
    fn stalled_bus_authentication_is_bounded_without_detached_retry_threads() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("stalled-bus");
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        let address = format!("unix:path={}", path.display());
        let (tx, rx) = mpsc::channel();
        let peer = thread::spawn(move || {
            let _socket = listener.accept().unwrap();
            let _ = rx.recv_timeout(Duration::from_secs(5));
        });
        let started = std::time::Instant::now();
        let outcome = Client::connect_with(
            AsyncBuilder::address(address.as_str()).unwrap(),
            Arc::new(|_| {}),
        );
        tx.send(()).unwrap();
        peer.join().unwrap();
        assert!(matches!(outcome, Err(e) if e.contains("connection timed out")));
        assert!(started.elapsed() >= Duration::from_secs(2));
        assert!(started.elapsed() < Duration::from_secs(4));
    }
}
