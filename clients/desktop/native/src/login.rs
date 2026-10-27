//! One app-owned per-user launchd entry. No launchctl or current-process side effects.
use crate::{err, Result};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const NAME: &str = "net.household.share.login.plist";
const LIMIT: u64 = 16 * 1024;
const PREFIX: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<!-- Drop Open at login v1 -->\n<plist version=\"1.0\"><dict>\n<key>Label</key><string>net.household.share.login</string>\n<key>ProgramArguments</key><array><string>";
const SUFFIX: &str = "</string><string>--background</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n";
static NEXT: AtomicU64 = AtomicU64::new(0);

fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn document(exe: &Path) -> Result<String> {
    let path = exe
        .to_str()
        .ok_or("The installed app path must be valid UTF-8")?;
    Ok(format!("{PREFIX}{}{SUFFIX}", xml(path)))
}
fn installed_path(home: &Path, exe: &Path) -> Result<()> {
    if !exe.is_absolute()
        || exe
            .components()
            .any(|p| !matches!(p, Component::RootDir | Component::Normal(_)))
        || exe.to_str().is_none_or(|p| p.chars().any(char::is_control))
    {
        return Err("Invalid installed app path".into());
    }
    let relative = exe
        .strip_prefix(home.join("Applications"))
        .or_else(|_| exe.strip_prefix("/Applications"))
        .map_err(|_| "Move Drop into Applications before enabling Open at login")?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 4
        || !parts[0].as_os_str().to_string_lossy().ends_with(".app")
        || parts[1].as_os_str() != "Contents"
        || parts[2].as_os_str() != "MacOS"
        || parts[3].as_os_str() != "household-share"
    {
        return Err("Open at login requires the installed Drop app executable".into());
    }
    Ok(())
}
fn no_symlinks(path: &Path) -> Result<()> {
    let mut prefix = PathBuf::new();
    for component in path.components() {
        prefix.push(component);
        if fs::symlink_metadata(&prefix)
            .map_err(err)?
            .file_type()
            .is_symlink()
        {
            return Err("Open at login cannot use symbolic links".into());
        }
    }
    Ok(())
}
fn directory(home: &Path, create: bool) -> Result<Option<PathBuf>> {
    no_symlinks(home)?;
    let uid = fs::metadata(home).map_err(err)?.uid();
    let mut dir = home.to_path_buf();
    for name in ["Library", "LaunchAgents"] {
        dir.push(name);
        match fs::symlink_metadata(&dir) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if !create {
                    return Ok(None);
                }
                fs::create_dir(&dir).map_err(err)?;
            }
            Err(e) => return Err(err(e)),
            Ok(_) => {}
        }
        let meta = fs::symlink_metadata(&dir).map_err(err)?;
        if !meta.is_dir()
            || meta.file_type().is_symlink()
            || meta.uid() != uid
            || meta.mode() & 0o022 != 0
        {
            return Err(
                "The login configuration directory is not a safe user-owned directory".into(),
            );
        }
    }
    Ok(Some(dir))
}
fn saved(home: &Path, path: &Path) -> Result<Option<Vec<u8>>> {
    let meta = match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(err(e)),
        Ok(meta) => meta,
    };
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || meta.nlink() != 1
        || meta.uid() != fs::metadata(home).map_err(err)?.uid()
        || meta.mode() & 0o022 != 0
        || meta.len() > LIMIT
    {
        return Err("The existing login entry is unsafe; it was not changed".into());
    }
    let file = File::open(path).map_err(err)?;
    let opened = file.metadata().map_err(err)?;
    if opened.ino() != meta.ino() || opened.dev() != meta.dev() {
        return Err("The login entry changed; try again".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(err)?;
    let value =
        std::str::from_utf8(&bytes).map_err(|_| "The existing login entry is not owned by Drop")?;
    let encoded = value
        .strip_prefix(PREFIX)
        .and_then(|p| p.strip_suffix(SUFFIX))
        .ok_or("The existing login entry is not owned by Drop; it was not changed")?;
    // Accept only our canonical document, including the exact keys and background argument.
    let decoded = encoded
        .replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .replace("&amp;", "&");
    let exe = Path::new(&decoded);
    installed_path(home, exe)?;
    if document(exe)?.as_bytes() != bytes {
        return Err("The existing login entry is not owned by Drop".into());
    }
    Ok(Some(bytes))
}
pub fn enabled(home: &Path) -> Result<bool> {
    match directory(home, false)? {
        Some(dir) => Ok(saved(home, &dir.join(NAME))?.is_some()),
        None => Ok(false),
    }
}
pub fn set_enabled(home: &Path, exe: &Path, enable: bool) -> Result<bool> {
    if enable {
        installed_path(home, exe)?;
        no_symlinks(exe)?;
        let meta = fs::metadata(exe).map_err(err)?;
        if !meta.is_file() || meta.mode() & 0o111 == 0 {
            return Err("The installed Drop executable is unavailable".into());
        }
    }
    let Some(dir) = directory(home, enable)? else {
        return Ok(false);
    };
    let path = dir.join(NAME);
    let before = saved(home, &path)?;
    if !enable {
        if before.is_some() {
            fs::remove_file(&path).map_err(err)?;
            File::open(&dir).and_then(|f| f.sync_all()).map_err(err)?;
        }
        return enabled(home);
    }
    let bytes = document(exe)?;
    if bytes.len() as u64 > LIMIT {
        return Err("The installed app path is too long".into());
    }
    let temporary = dir.join(format!(
        ".drop-login-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(err)?;
    let result = (|| {
        file.write_all(bytes.as_bytes()).map_err(err)?;
        file.sync_all().map_err(err)?;
        if saved(home, &path)? != before {
            return Err("The login entry changed; try again".into());
        }
        fs::rename(&temporary, &path).map_err(err)?;
        File::open(&dir).and_then(|f| f.sync_all()).map_err(err)?;
        enabled(home)
    })();
    drop(file);
    let _ = fs::remove_file(&temporary);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    fn setup() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let exe = temp
            .path()
            .join("Applications/Drop & '测试'.app/Contents/MacOS/household-share");
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, "test executable").unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o700)).unwrap();
        (temp, exe)
    }
    #[test]
    fn login_round_trip_is_explicit_exact_and_reversible() {
        let (home, exe) = setup();
        assert!(!enabled(home.path()).unwrap());
        assert!(!home.path().join("Library").exists());
        assert!(set_enabled(home.path(), &exe, true).unwrap());
        let path = home.path().join("Library/LaunchAgents").join(NAME);
        assert_eq!(fs::read_to_string(&path).unwrap(), document(&exe).unwrap());
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert!(!document(&exe).unwrap().contains("KeepAlive"));
        assert!(set_enabled(home.path(), &exe, true).unwrap());
        // An owned entry can still be disabled after the old app is moved/deleted.
        fs::remove_file(&exe).unwrap();
        assert!(!set_enabled(home.path(), &exe, false).unwrap());
        assert!(!enabled(home.path()).unwrap());
    }
    #[test]
    fn login_refuses_foreign_linked_oversized_and_invalid_paths() {
        let (home, exe) = setup();
        assert!(set_enabled(home.path(), &home.path().join("dev/household-share"), true).is_err());
        assert!(!home.path().join("Library").exists());
        set_enabled(home.path(), &exe, true).unwrap();
        let path = home.path().join("Library/LaunchAgents").join(NAME);
        let original = fs::read(&path).unwrap();
        for bytes in [
            b"foreign entry".to_vec(),
            vec![b'X'; LIMIT as usize + 1],
            document(Path::new("/tmp/foreign.app/Contents/MacOS/household-share"))
                .unwrap()
                .into_bytes(),
            original
                .iter()
                .copied()
                .chain(b"extra".iter().copied())
                .collect(),
        ] {
            fs::write(&path, &bytes).unwrap();
            assert!(enabled(home.path()).is_err());
            assert!(set_enabled(home.path(), &exe, true).is_err());
            assert!(set_enabled(home.path(), &exe, false).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(&path).unwrap();
        let foreign = home.path().join("foreign");
        fs::write(&foreign, &original).unwrap();
        symlink(&foreign, &path).unwrap();
        assert!(set_enabled(home.path(), &exe, false).is_err());
        fs::remove_file(&path).unwrap();
        fs::hard_link(&foreign, &path).unwrap();
        assert!(set_enabled(home.path(), &exe, true).is_err());
        assert_eq!(fs::read(&foreign).unwrap(), original);
    }
    #[test]
    fn login_refuses_symlinked_directory_or_executable() {
        let (home, exe) = setup();
        let alternate = home.path().join("alternate");
        fs::create_dir(&alternate).unwrap();
        symlink(&alternate, home.path().join("Library")).unwrap();
        assert!(set_enabled(home.path(), &exe, true).is_err());
        fs::remove_file(home.path().join("Library")).unwrap();
        let real = exe.with_file_name("real");
        fs::rename(&exe, &real).unwrap();
        symlink(&real, &exe).unwrap();
        assert!(set_enabled(home.path(), &exe, true).is_err());
        assert!(!home.path().join("Library").exists());
    }
}
