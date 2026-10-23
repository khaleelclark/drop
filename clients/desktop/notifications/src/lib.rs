use household_native::{ArrivalBanner, ArrivalTarget};
use std::sync::Arc;

type Result<T> = std::result::Result<T, String>;
type Click = Arc<dyn Fn(ArrivalTarget) + Send + Sync>;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
use linux::Notifier;
#[cfg(target_os = "macos")]
use macos::Notifier;

/// Returns success only after the platform accepts the request, never on thread dispatch.
pub struct ArrivalNotifier(Notifier);
impl ArrivalNotifier {
    pub fn new(click: impl Fn(ArrivalTarget) + Send + Sync + 'static) -> Result<Self> {
        Ok(Self(Notifier::new(Arc::new(click))?))
    }
    /// Called only by the visible Enable command. Linux has no permission prompt API.
    pub fn request_permission(&self) -> Result<()> {
        self.0.request_permission()
    }
    pub fn post(&self, banner: ArrivalBanner) -> Result<()> {
        if banner.id < 0
            || banner.target.base_url.len() > 8192
            || banner.target.item_id.len() != 32
            || !banner
                .target
                .item_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("Invalid arrival target".into());
        }
        self.0.post(banner)
    }
}

#[cfg(target_os = "linux")]
fn body(multiple: bool) -> &'static str {
    if multiple {
        "New shares available"
    } else {
        "New share available"
    }
}
