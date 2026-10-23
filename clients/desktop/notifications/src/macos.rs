use super::*;
use std::{
    ffi::{CStr, CString},
    os::raw::c_char,
    sync::OnceLock,
};

static CLICK: OnceLock<Click> = OnceLock::new();
extern "C" {
    fn zing_notifications_init(click: extern "C" fn(*const c_char, *const c_char)) -> i32;
    fn zing_notifications_permission() -> i32;
    fn zing_notifications_post(
        id: *const c_char,
        origin: *const c_char,
        item: *const c_char,
        multiple: bool,
    ) -> i32;
}
extern "C" fn clicked(origin: *const c_char, item: *const c_char) {
    if origin.is_null() || item.is_null() {
        return;
    }
    // Both strings are owned, NUL-terminated NSString UTF8String values during this callback.
    let target = unsafe {
        let (Ok(base_url), Ok(item_id)) = (
            CStr::from_ptr(origin).to_str(),
            CStr::from_ptr(item).to_str(),
        ) else {
            return;
        };
        ArrivalTarget {
            base_url: base_url.into(),
            item_id: item_id.into(),
        }
    };
    if let Some(click) = CLICK.get() {
        // Never unwind through Objective-C; the queue also validates origin/item before persisting.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| click(target)));
    }
}
pub(super) struct Notifier {
    ready: bool,
}
impl Notifier {
    pub(super) fn new(click: Click) -> Result<Self> {
        CLICK
            .set(click)
            .map_err(|_| "Notification listener already registered")?;
        // An unavailable notification center must not prevent opening the feed or transfers.
        Ok(Self {
            ready: unsafe { zing_notifications_init(clicked) } == 1,
        })
    }
    pub(super) fn request_permission(&self) -> Result<()> {
        if !self.ready {
            return Err("macOS notifications require an installed app bundle".into());
        }
        match unsafe { zing_notifications_permission() } {
            1 => Ok(()),
            0 => Err("Allow Zing notifications in System Settings, then enable again".into()),
            _ => Err("Notification permission request failed or timed out; try again".into()),
        }
    }
    pub(super) fn post(&self, banner: ArrivalBanner) -> Result<()> {
        if !self.ready {
            return Err("macOS notification center is unavailable".into());
        }
        let id = CString::new(format!("zing-{}-{}", banner.id, banner.target.item_id))
            .map_err(|e| e.to_string())?;
        let origin = CString::new(banner.target.base_url).map_err(|e| e.to_string())?;
        let item = CString::new(banner.target.item_id).map_err(|e| e.to_string())?;
        if unsafe {
            zing_notifications_post(id.as_ptr(), origin.as_ptr(), item.as_ptr(), banner.multiple)
        } == 1
        {
            Ok(())
        } else {
            Err("macOS did not confirm notification acceptance; will retry".into())
        }
    }
}
