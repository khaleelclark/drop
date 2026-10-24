//! Folder intake writes one private, finished ZIP before the ordinary tus queue sees bytes.
use super::*;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const MAX_ENTRIES: usize = 10_000;
const MAX_NAMES: usize = 1024 * 1024;
const MAX_DEPTH: usize = 64;
const RESERVE: u64 = 64 * 1024 * 1024;
const BUFFER: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct FolderSource {
    pub path: PathBuf,
    device: u64,
    inode: u64,
}
impl FolderSource {
    pub fn inspect(path: &Path) -> Result<Self> {
        let metadata = fs::symlink_metadata(path).map_err(err)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(format!("Unsupported folder source: {}", path.display()));
        }
        let path = path.canonicalize().map_err(err)?;
        folder_name(&path)?;
        let identity = stamp(&metadata)?;
        Ok(Self {
            path,
            device: identity.2,
            inode: identity.3,
        })
    }
    fn verify(&self) -> Result<()> {
        let other = Self::inspect(&self.path)?;
        if self.device != other.device || self.inode != other.inode {
            return Err(format!(
                "Selected folder was replaced: {}",
                self.path.display()
            ));
        }
        Ok(())
    }
}

fn component(name: &str) -> Result<()> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', ':'])
        || name.chars().any(char::is_control)
        || name.ends_with(['.', ' '])
    {
        return Err(format!("Unsupported archive entry name: {name:?}"));
    }
    Ok(())
}
pub(super) fn folder_name(path: &Path) -> Result<String> {
    let name = path
        .file_name()
        .and_then(|x| x.to_str())
        .ok_or_else(|| format!("Unsupported non-UTF-8 folder name: {}", path.display()))?;
    component(name)?;
    Ok(name.into())
}
#[derive(Debug, PartialEq)]
struct Entry {
    path: PathBuf,
    name: String,
    directory: bool,
    stamp: (u64, u128, u64, u64),
    source: Option<Source>,
}
fn stamp(m: &fs::Metadata) -> Result<(u64, u128, u64, u64)> {
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        (m.dev(), m.ino())
    };
    #[cfg(not(unix))]
    let identity = (0, 0);
    Ok((
        m.len(),
        m.modified()
            .map_err(err)?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        identity.0,
        identity.1,
    ))
}
fn scan(root: &Path, check: &mut impl FnMut(u64, u64) -> Result<()>) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    let mut pending = vec![(root.to_owned(), folder_name(root)?, 0)];
    let mut names = HashSet::new();
    let mut names_len = 0;
    let mut pending_names = folder_name(root)?.len();
    let mut total = 0u64;
    while let Some((path, name, depth)) = pending.pop() {
        pending_names -= name.len();
        check(0, 0)?;
        let m = fs::symlink_metadata(&path).map_err(|e| format!("Cannot read {name}: {e}"))?;
        if m.file_type().is_symlink() || !(m.is_file() || m.is_dir()) {
            return Err(format!("Unsupported symlink or special entry: {name}"));
        }
        if depth > MAX_DEPTH {
            return Err(format!("Folder nesting exceeds {MAX_DEPTH}: {name}"));
        }
        if !path.canonicalize().map_err(err)?.starts_with(root) {
            return Err(format!("Entry moved outside selected folder: {name}"));
        }
        if !names.insert(name.clone()) {
            return Err(format!("Duplicate archive entry: {name}"));
        }
        names_len += name.len();
        if names.len() > MAX_ENTRIES || names_len > MAX_NAMES || name.len() > 4096 {
            return Err(format!("Folder exceeds entry/name budget at: {name}"));
        }
        let source = if m.is_file() {
            total = total.checked_add(m.len()).ok_or("Folder size overflow")?;
            if total > MAX_FILE {
                return Err(format!("Folder exceeds 20 GiB at: {name}"));
            }
            Some(Source::inspect(&path).map_err(|e| format!("Cannot read {name}: {e}"))?)
        } else {
            // Bound pending paths too; never collect an unbounded directory listing.
            for child in fs::read_dir(&path).map_err(|e| format!("Cannot list {name}: {e}"))? {
                check(0, 0)?;
                let child = child.map_err(err)?;
                let leaf = child
                    .file_name()
                    .into_string()
                    .map_err(|_| format!("Unsupported non-UTF-8 entry in: {name}"))?;
                component(&leaf).map_err(|e| format!("{e} in {name}"))?;
                let child_name = format!("{name}/{leaf}");
                if entries.len() + pending.len() + 1 >= MAX_ENTRIES
                    || names_len + pending_names + child_name.len() > MAX_NAMES
                {
                    return Err(format!("Folder exceeds entry/name budget at: {child_name}"));
                }
                pending_names += child_name.len();
                pending.push((child.path(), child_name, depth + 1));
            }
            None
        };
        entries.push(Entry {
            path,
            name,
            directory: m.is_dir(),
            stamp: stamp(&m)?,
            source,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}
fn digest(source: &Source, check: &mut impl FnMut(u64, u64) -> Result<()>) -> Result<String> {
    source.verify()?;
    let mut input = File::open(&source.path).map_err(err)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; BUFFER];
    let mut total = 0;
    loop {
        check(0, 0)?;
        let n = input.read(&mut buffer).map_err(err)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > source.len {
            return Err("Folder source changed while checking".into());
        }
        hash.update(&buffer[..n]);
    }
    source.verify()?;
    if total != source.len {
        return Err("Folder source changed while checking".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn prepare(
    root: &Path,
    folder: &FolderSource,
    id: &str,
    mut progress: impl FnMut(u64, u64) -> Result<()>,
) -> Result<Source> {
    let dir = root.join("staging");
    private_dir(&dir)?;
    let partial = dir.join(format!("{id}.zip.part"));
    let ready = dir.join(format!("{id}.zip"));
    // No persisted source means a prior preparation never committed: restart, never append.
    for path in [&partial, &ready] {
        remove_managed_file(path)?;
    }
    let result = (|| {
        folder.verify()?;
        let folder = folder.path.clone();
        if dir.canonicalize().map_err(err)?.starts_with(&folder) {
            return Err("Selected folder contains Drop's private queue; choose a subfolder".into());
        }
        let entries = scan(&folder, &mut progress)?;
        let total: u64 = entries
            .iter()
            .filter_map(|e| e.source.as_ref())
            .map(|s| s.len)
            .sum();
        let overhead: u64 = entries
            .iter()
            .map(|e| (2 * e.name.len() + 256) as u64)
            .sum::<u64>()
            + 1024;
        let needed = total.checked_add(overhead).ok_or("Folder size overflow")?;
        if needed > MAX_FILE {
            return Err("Folder plus ZIP metadata exceeds 20 GiB; select a smaller folder".into());
        }
        if fs2::available_space(&dir).map_err(err)? < needed + RESERVE {
            return Err("Not enough local space to prepare folder ZIP (64 MiB reserve)".into());
        }
        // Hash before writing and compare while writing, including middle-byte changes.
        let mut hashes = Vec::with_capacity(entries.len());
        for entry in &entries {
            hashes.push(match &entry.source {
                Some(source) => Some(
                    digest(source, &mut progress).map_err(|e| format!("{e}: {}", entry.name))?,
                ),
                None => None,
            });
        }
        let mut writer = ZipWriter::new(private_new(&partial)?);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .large_file(true);
        let mut done = 0u64;
        progress(done, total)?;
        let mut buffer = [0; BUFFER];
        for (entry, expected) in entries.iter().zip(&hashes) {
            progress(done, total)?;
            if entry.directory {
                writer
                    .add_directory(format!("{}/", entry.name), options)
                    .map_err(err)?;
                continue;
            }
            let source = entry.source.as_ref().ok_or("Missing folder file source")?;
            source
                .verify()
                .map_err(|e| format!("{e}: {}", entry.name))?;
            let mut input =
                File::open(&entry.path).map_err(|e| format!("Cannot read {}: {e}", entry.name))?;
            if stamp(&input.metadata().map_err(err)?)? != entry.stamp {
                return Err(format!("Folder source changed: {}", entry.name));
            }
            writer.start_file(&entry.name, options).map_err(err)?;
            let mut hash = Sha256::new();
            let mut length = 0;
            loop {
                progress(done, total)?;
                let n = input
                    .read(&mut buffer)
                    .map_err(|e| format!("Cannot read {}: {e}", entry.name))?;
                if n == 0 {
                    break;
                }
                length += n as u64;
                if length > source.len {
                    return Err(format!("Folder source grew: {}", entry.name));
                }
                if fs2::available_space(&dir).map_err(err)? < RESERVE + n as u64 {
                    return Err("Local storage reserve reached preparing folder ZIP".into());
                }
                writer.write_all(&buffer[..n]).map_err(err)?;
                hash.update(&buffer[..n]);
                done += n as u64;
            }
            if length != source.len || Some(format!("{:x}", hash.finalize())) != *expected {
                return Err(format!("Folder source bytes changed: {}", entry.name));
            }
            source
                .verify()
                .map_err(|e| format!("{e}: {}", entry.name))?;
        }
        // Membership, directories and file identities must still match the planned tree.
        if scan(&folder, &mut |_, _| progress(done, total))? != entries {
            return Err("Folder contents changed during ZIP preparation; retry when stable".into());
        }
        let file = writer.finish().map_err(err)?;
        let mut permissions = file.metadata().map_err(err)?.permissions();
        permissions.set_readonly(true);
        file.set_permissions(permissions).map_err(err)?;
        file.sync_all().map_err(err)?;
        if file.metadata().map_err(err)?.len() > MAX_FILE {
            return Err("ZIP exceeds 20 GiB".into());
        }
        progress(done, total)?;
        drop(file);
        fs::rename(&partial, &ready).map_err(err)?;
        sync_dir(&dir)?;
        Source::inspect(&ready)
    })();
    if let Err(original) = result {
        let failures: Vec<_> = [&partial, &ready]
            .into_iter()
            .filter_map(|p| remove_managed_file(p).err())
            .collect();
        return Err(if failures.is_empty() {
            original
        } else {
            format!("{original}; {}", failures.join("; "))
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("家 folder");
        let root = temp.path().join("queue");
        fs::create_dir_all(folder.join("nested/empty")).unwrap();
        fs::write(folder.join("nested/noextension"), [0, 255, 128, 13, 10]).unwrap();
        fs::write(folder.join("雪.txt"), "Unicode 🏠\n").unwrap();
        fs::write(folder.join("zero"), []).unwrap();
        (temp, root, folder)
    }
    #[test]
    fn folder_archive_roundtrip_and_forced_zip64_headers() {
        let (_temp, root, folder) = fixture();
        let mut max_delta = 0;
        let mut last = 0;
        let source = prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "roundtrip",
            |done, total| {
                assert!(done <= total);
                max_delta = max_delta.max(done.saturating_sub(last));
                last = done;
                Ok(())
            },
        )
        .unwrap();
        assert!(max_delta <= BUFFER as u64);
        assert!(!root.join("staging/roundtrip.zip.part").exists());
        let mut zip = zip::ZipArchive::new(File::open(&source.path).unwrap()).unwrap();
        assert_eq!(zip.len(), 6);
        for (name, expected) in [
            ("家 folder/nested/noextension", vec![0, 255, 128, 13, 10]),
            ("家 folder/雪.txt", "Unicode 🏠\n".as_bytes().to_vec()),
            ("家 folder/zero", vec![]),
        ] {
            let mut file = zip.by_name(name).unwrap();
            assert_eq!(file.compression(), CompressionMethod::Stored);
            let start = file.header_start() as usize;
            let mut bytes = vec![];
            file.read_to_end(&mut bytes).unwrap();
            assert_eq!(bytes, expected);
            // Even this small fixture uses the same ZIP64 file-header option as large inputs.
            let raw = fs::read(&source.path).unwrap();
            let names =
                u16::from_le_bytes(raw[start + 26..start + 28].try_into().unwrap()) as usize;
            let extras =
                u16::from_le_bytes(raw[start + 28..start + 30].try_into().unwrap()) as usize;
            let extra = &raw[start + 30 + names..start + 30 + names + extras];
            assert_eq!(&extra[..4], &[1, 0, 16, 0]);
            assert_eq!(
                u64::from_le_bytes(extra[4..12].try_into().unwrap()),
                expected.len() as u64
            );
        }
        assert!(zip.by_name("家 folder/nested/empty/").unwrap().is_dir());
        assert!(zip.by_name("家 folder/").unwrap().is_dir());
    }
    #[test]
    fn folder_archive_cancel_and_middle_change_remove_partial_output() {
        let (_temp, root, folder) = fixture();
        let path = folder.join("big");
        fs::write(&path, vec![5; 3 * BUFFER]).unwrap();
        let result = prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "cancel",
            |done, _| {
                if done > 0 {
                    Err("cancelled".into())
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(result.unwrap_err(), "cancelled");
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
        let old_time = fs::metadata(&path).unwrap().modified().unwrap();
        let mut changed = false;
        let result = prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "changed",
            |_, total| {
                if total > 0 && !changed {
                    let mut file = OpenOptions::new().write(true).open(&path).unwrap();
                    file.seek(SeekFrom::Start(BUFFER as u64 + 1)).unwrap();
                    file.write_all(b"x").unwrap();
                    file.set_times(fs::FileTimes::new().set_modified(old_time))
                        .unwrap();
                    changed = true;
                }
                Ok(())
            },
        );
        assert!(result
            .unwrap_err()
            .contains("source bytes changed: 家 folder/big"));
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
    }
    #[test]
    fn folder_archive_rejects_traversal_special_and_resource_budgets() {
        for name in [
            "",
            ".",
            "..",
            "../bad",
            "x/y",
            "x\\y",
            "C:bad",
            "bad\0name",
            "bad\nname",
            "trailing.",
        ] {
            assert!(component(name).is_err(), "{name:?}");
        }
        let (_temp, root, folder) = fixture();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&folder, folder.join("cycle")).unwrap();
            let error = prepare(
                &root,
                &FolderSource::inspect(&folder).unwrap(),
                "cycle",
                |_, _| Ok(()),
            )
            .unwrap_err();
            assert!(error.contains("cycle"), "{error}");
            fs::remove_file(folder.join("cycle")).unwrap();
        }
        let huge = File::create(folder.join("huge")).unwrap();
        huge.set_len(MAX_FILE).unwrap(); // Sparse metadata budget check, no large read/transfer.
        assert!(prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "budget",
            |_, _| Ok(())
        )
        .unwrap_err()
        .contains("20 GiB"));
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
        fs::remove_file(folder.join("huge")).unwrap();
        let mut nested = folder.clone();
        for _ in 0..=MAX_DEPTH {
            nested.push("d");
            fs::create_dir(&nested).unwrap();
        }
        assert!(prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "depth",
            |_, _| Ok(())
        )
        .unwrap_err()
        .contains("nesting"));
        assert!(prepare(
            &root,
            &FolderSource::inspect(root.parent().unwrap()).unwrap(),
            "self",
            |_, _| Ok(())
        )
        .unwrap_err()
        .contains("private queue"));
    }
    #[test]
    fn folder_archive_changed_membership_and_restart_discard_uncommitted_bytes() {
        let (_temp, root, folder) = fixture();
        private_dir(&root.join("staging")).unwrap();
        fs::write(root.join("staging/restart.zip.part"), b"interrupted bytes").unwrap();
        fs::write(root.join("staging/restart.zip"), b"uncommitted bytes").unwrap();
        let mut changed = false;
        let error = prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "restart",
            |_, total| {
                if total > 0 && !changed {
                    fs::write(folder.join("new"), b"changed").unwrap();
                    changed = true;
                }
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.contains("contents changed"));
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
        let source = prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "restart",
            |_, _| Ok(()),
        )
        .unwrap();
        let mut zip = zip::ZipArchive::new(File::open(source.path).unwrap()).unwrap();
        assert!(zip.by_name("家 folder/new").is_ok());
    }
    #[test]
    fn folder_cleanup_failure_preserves_preparation_error_and_can_retry() {
        let (_temp, root, folder) = fixture();
        let partial = root.join("staging/cleanup.zip.part");
        let error = prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "cleanup",
            |_, total| {
                if total > 0 {
                    fs::remove_file(&partial).unwrap();
                    fs::create_dir(&partial).unwrap();
                    Err("Injected preparation failure".into())
                } else {
                    Ok(())
                }
            },
        )
        .unwrap_err();
        assert!(error.contains("Injected preparation failure"));
        assert!(error.contains("Local cleanup failed for cleanup.zip.part"));
        assert!(partial.is_dir());
        fs::remove_dir(&partial).unwrap();
        prepare(
            &root,
            &FolderSource::inspect(&folder).unwrap(),
            "cleanup",
            |_, _| Ok(()),
        )
        .unwrap();
        assert!(!partial.exists());
    }
}

#[cfg(test)]
mod queue_tests {
    use super::*;
    #[test]
    fn folder_cleanup_confirmed_outcome_survives_failure_restart_and_local_only_retry() {
        for terminal in ["complete", "cancelled"] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("queue");
            let folder = temp.path().join("folder");
            fs::create_dir(&folder).unwrap();
            fs::write(folder.join("data"), b"bytes").unwrap();
            let q = Queue::open(root.clone()).unwrap();
            q.configure(Config {
                base_url: "http://127.0.0.1:1".into(),
                token: "test".into(),
                source_device: "Saved".into(),
            })
            .unwrap();
            q.enqueue_upload(&folder, "file").unwrap();
            q.tick().unwrap();
            let id = q.list().unwrap()[0].id.clone();
            let part = root.join("staging").join(format!("{id}.zip.part"));
            fs::create_dir(&part).unwrap();
            {
                let mut state = q.state.lock().unwrap();
                state.transfers[0].cleanup_status = Some(terminal.into());
                q.save_locked(&state).unwrap();
            }
            q.tick().unwrap();
            assert_eq!(q.list().unwrap()[0].status, "error");
            assert!(q.list().unwrap()[0]
                .error
                .as_ref()
                .unwrap()
                .contains("Local cleanup failed"));
            assert!(!q.tick().unwrap());
            q.control(&id, "pause").unwrap();
            drop(q);
            let q = Queue::open(root.clone()).unwrap();
            assert_eq!(q.list().unwrap()[0].status, "error");
            assert_eq!(
                q.state.lock().unwrap().transfers[0]
                    .cleanup_status
                    .as_deref(),
                Some(terminal)
            );
            q.disconnect().unwrap();
            fs::remove_dir(&part).unwrap();
            q.control(&id, "resume").unwrap();
            q.tick().unwrap();
            assert_eq!(q.list().unwrap()[0].status, terminal);
            assert!(q.state.lock().unwrap().transfers[0]
                .cleanup_status
                .is_none());
            assert!(!q.tick().unwrap());
            assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
        }
    }
    #[test]
    fn folder_queue_pause_restart_stable_source_and_cancel_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let folder = temp.path().join("original");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("data"), [0, 128, 255]).unwrap();
        let q = Queue::open(root.clone()).unwrap();
        q.configure(Config {
            base_url: "http://127.0.0.1:1".into(),
            token: "test".into(),
            source_device: "Saved".into(),
        })
        .unwrap();
        assert!(q.enqueue_upload(&folder, "text").is_err());
        let id = spool_upload(&root, &folder, "file").unwrap();
        q.consume_spool().unwrap();
        q.control(&id, "pause").unwrap();
        private_dir(&root.join("staging")).unwrap();
        let partial = root.join("staging").join(format!("{id}.zip.part"));
        fs::write(&partial, b"interrupted").unwrap();
        assert!(!q.tick().unwrap());
        drop(q);
        let q = Queue::open(root.clone()).unwrap();
        assert!(!partial.exists());
        assert_eq!(q.list().unwrap()[0].status, "paused");
        q.control(&id, "resume").unwrap();
        q.tick().unwrap(); // Folder preparation only; no HTTP is attempted.
        let source = q.state.lock().unwrap().transfers[0].source.clone().unwrap();
        let bytes = fs::read(&source.path).unwrap();
        assert_eq!(q.list().unwrap()[0].status, "queued");
        assert_eq!(q.list().unwrap()[0].offset, 0);
        fs::remove_dir_all(&folder).unwrap();
        drop(q);
        let q = Queue::open(root.clone()).unwrap();
        assert_eq!(fs::read(&source.path).unwrap(), bytes);
        source.verify().unwrap();
        q.control(&id, "cancel").unwrap();
        q.tick().unwrap();
        assert_eq!(q.list().unwrap()[0].status, "cancelled");
        assert!(!source.path.exists());
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
    }
    #[test]
    fn folder_queue_rejects_replaced_selected_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let folder = temp.path().join("original");
        fs::create_dir(&folder).unwrap();
        let q = Queue::open(root.clone()).unwrap();
        q.configure(Config {
            base_url: "http://127.0.0.1:1".into(),
            token: "test".into(),
            source_device: "Saved".into(),
        })
        .unwrap();
        q.enqueue_upload(&folder, "file").unwrap();
        fs::rename(&folder, temp.path().join("moved")).unwrap();
        fs::create_dir(&folder).unwrap();
        q.tick().unwrap();
        let row = q.list().unwrap().remove(0);
        assert_eq!(row.status, "error");
        assert!(row.error.unwrap().contains("folder was replaced"));
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
    }
    #[test]
    fn folder_queue_named_error_recovers_without_uploading_partial() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("queue");
        let folder = temp.path().join("original");
        fs::create_dir(&folder).unwrap();
        let bad = folder.join("unsafe\\name");
        fs::write(&bad, b"file").unwrap();
        let q = Queue::open(root.clone()).unwrap();
        q.configure(Config {
            base_url: "http://127.0.0.1:1".into(),
            token: "test".into(),
            source_device: "Saved".into(),
        })
        .unwrap();
        q.enqueue_upload(&folder, "file").unwrap();
        let id = q.list().unwrap()[0].id.clone();
        q.tick().unwrap();
        assert_eq!(q.list().unwrap()[0].status, "error");
        assert!(q.list().unwrap()[0]
            .error
            .as_ref()
            .unwrap()
            .contains("unsafe"));
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
        fs::rename(bad, folder.join("safe")).unwrap();
        q.control(&id, "resume").unwrap();
        q.tick().unwrap();
        assert!(q.state.lock().unwrap().transfers[0].source.is_some());
        q.control(&id, "cancel").unwrap();
        q.tick().unwrap();
    }
}
