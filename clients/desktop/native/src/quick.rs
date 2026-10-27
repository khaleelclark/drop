//! Menu-bar intake reuses the resident queue and its immutable send context.
use super::*;

#[derive(Serialize, Deserialize)]
pub struct QuickDevice {
    id: String,
    label: String,
    platform: String,
}
fn registry(value: serde_json::Value) -> Result<Vec<QuickDevice>> {
    let devices: Vec<QuickDevice> = serde_json::from_value(
        value
            .get("devices")
            .cloned()
            .ok_or("Missing device registry")?,
    )
    .map_err(err)?;
    let mut ids = HashSet::new();
    if devices.len() > 64
        || devices.iter().any(|d| {
            !devices::valid_id(&d.id)
                || !ids.insert(&d.id)
                || d.label.trim().is_empty()
                || d.label.len() > 128
                || d.label.chars().any(char::is_control)
                || !matches!(
                    d.platform.as_str(),
                    "macos" | "linux" | "android" | "browser"
                )
        })
    {
        return Err("The device list is invalid; open Drop Settings and refresh".into());
    }
    Ok(devices)
}
fn targets_valid(id: &str, targets: &[String], devices: &[QuickDevice]) -> Result<()> {
    let mut seen = HashSet::new();
    if targets.len() > 64
        || targets.iter().any(|target| {
            target == id || !seen.insert(target) || !devices.iter().any(|d| &d.id == target)
        })
    {
        return Err("A selected device is no longer available. Choose its destination again; nothing was sent".into());
    }
    Ok(())
}
impl Queue {
    fn quick_devices(&self, config: &Config, id: &str) -> Result<Vec<QuickDevice>> {
        self.ensure_registration(config, id)?;
        registry(self.device_request(config, reqwest::Method::GET, "/api/devices", None)?)
    }
    pub fn quick_context(&self) -> Result<serde_json::Value> {
        let _pairing = self.pairing_lock.lock().map_err(err)?;
        let _config = config_lock(&self.root)?;
        let config = read_config(&self.root)?;
        let id = devices::identity(&self.root, &config.base_url)?.id;
        let devices = self.quick_devices(&config, &id)?;
        Ok(
            serde_json::json!({"baseUrl": config.base_url, "sourceDevice": config.source_device, "sourceDeviceId": id, "devices": devices}),
        )
    }
    fn quick_snapshot(&self, origin: &str, id: &str, targets: &[String]) -> Result<Config> {
        let config = read_config(&self.root)?;
        if origin != config.base_url
            || !devices::valid_id(id)
            || devices::identity(&self.root, &config.base_url)?.id != id
        {
            return Err("The connection or sender changed. Open Drop Settings, then choose the destination again; nothing was sent".into());
        }
        targets_valid(id, targets, &self.quick_devices(&config, id)?)?;
        Ok(config)
    }
    /// Capture before showing a picker or accepting dropped paths. The existing spool owns durability.
    pub fn quick_prepare(
        &self,
        origin: &str,
        id: &str,
        targets: Vec<String>,
    ) -> Result<SendContext> {
        let _pairing = self.pairing_lock.lock().map_err(err)?;
        let _config = config_lock(&self.root)?;
        let config = self.quick_snapshot(origin, id, &targets)?;
        devices::prepare_snapshot(&self.root, config, id.into(), targets)
    }
    pub fn quick_send_text(
        &self,
        origin: &str,
        id: &str,
        targets: Vec<String>,
        text: String,
    ) -> Result<String> {
        if text.is_empty() || text.len() as u64 > TEXT_LIMIT {
            return Err(
                "Paste or type text up to 8 MiB, or use Send Files for a larger text file".into(),
            );
        }
        // Keep pairing fixed through the single non-idempotent request; never automatically retry.
        let _pairing = self.pairing_lock.lock().map_err(err)?;
        let _config = config_lock(&self.root)?;
        let config = self.quick_snapshot(origin, id, &targets)?;
        let context =
            devices::prepare_snapshot(&self.root, config.clone(), id.into(), targets.clone())?;
        let body = serde_json::to_vec(
            &serde_json::json!({"text":text,"sourceDeviceId":id,"targetDeviceIds":targets}),
        )
        .map_err(err)?;
        if body.len() as u64 > API_LIMIT {
            return Err("Encoded text exceeds the request budget; use Send Files".into());
        }
        let attempt = (|| {
            let response = self
                .request(reqwest::Method::POST, config.api("/api/text")?, &config)
                .timeout(Duration::from_secs(30))
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .map_err(err)?;
            if response.status().as_u16() != 201 {
                return Err("The server did not confirm text creation".into());
            }
            let mut bytes = Vec::new();
            response.take(65537).read_to_end(&mut bytes).map_err(err)?;
            if bytes.len() > 65536 {
                return Err("Text receipt exceeds the response budget".into());
            }
            let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(err)?;
            let item = &value["item"];
            let item_id = item["id"]
                .as_str()
                .filter(|id| devices::valid_id(id))
                .ok_or("Invalid text receipt")?;
            if item["status"] != "ready" || item["kind"] != "text" {
                return Err("The text receipt is not ready".into());
            }
            Ok(item_id.to_owned())
        })();
        drop(context);
        attempt.map_err(|_: String| "Text could not be confirmed. It may already have been shared. Your draft is retained; check Open Drop before explicitly trying again".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quick_registry_and_stale_targets_are_bounded_and_never_broadcast() {
        let id = "a".repeat(32);
        let receiver = "b".repeat(32);
        let devices = registry(
            serde_json::json!({"devices":[{"id":receiver,"label":"My Mac","platform":"macos"}]}),
        )
        .unwrap();
        assert!(targets_valid(&id, &[], &devices).is_ok());
        assert!(targets_valid(&id, &[receiver.clone()], &devices).is_ok());
        for targets in [
            vec![id.clone()],
            vec!["c".repeat(32)],
            vec![receiver.clone(), receiver.clone()],
            vec![receiver; 65],
        ] {
            assert!(targets_valid(&id, &targets, &devices).is_err());
        }
        for value in [
            serde_json::json!({"devices":[{"id":"bad","label":"Mac","platform":"macos"}]}),
            serde_json::json!({"devices":[{"id":id,"label":"\n","platform":"macos"}]}),
            serde_json::json!({"devices":[{"id":id,"label":"Mac","platform":"unknown"}]}),
        ] {
            assert!(registry(value).is_err());
        }
        let row = serde_json::json!({"id":"a".repeat(32),"label":"Mac","platform":"macos"});
        assert!(registry(serde_json::json!({"devices":[row.clone(),row.clone()]})).is_err());
        assert!(registry(serde_json::json!({"devices":vec![row;65]})).is_err());
    }
    #[test]
    fn quick_scope_and_text_limits_fail_before_network_or_intake() {
        let temp = tempfile::tempdir().unwrap();
        let q = Queue::open(temp.path().into()).unwrap();
        q.configure(Config {
            base_url: "http://127.0.0.1:9".into(),
            token: "private".into(),
            source_device: "Mac".into(),
        })
        .unwrap();
        let id = q.connection().unwrap().device_id.unwrap();
        assert!(q
            .quick_prepare("https://wrong.example", &id, vec![])
            .is_err());
        assert!(q
            .quick_prepare("http://127.0.0.1:9", &"f".repeat(32), vec![])
            .is_err());
        for text in [String::new(), "x".repeat(TEXT_LIMIT as usize + 1)] {
            assert!(q
                .quick_send_text("http://127.0.0.1:9", &id, vec![], text)
                .is_err());
        }
        assert!(q.list().unwrap().is_empty());
        assert!(!temp.path().join("intake").exists());
    }
}
