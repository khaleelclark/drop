use household_native::{data_dir, spool_text, spool_upload, Config, Queue};
use std::{
    env,
    io::{self, Read},
    path::PathBuf,
    process::{self, Command},
};

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command=args.next().ok_or("Usage: household-share-cli enqueue <paths...> | text | configure <https-origin> [device] | list | run")?;
    let root = data_dir()?;
    match command.as_str() {
        "enqueue" => {
            let paths: Vec<_> = args.collect();
            if paths.is_empty() {
                return Err("Specify one or more file paths".into());
            }
            for path in paths {
                println!(
                    "Queued {}",
                    spool_upload(&root, &PathBuf::from(path), "file")?
                );
            }
            launch();
        }
        "text" => {
            println!("Queued {}", spool_text(&root, &mut io::stdin().lock())?);
            launch();
        }
        "configure" => {
            let base_url = args
                .next()
                .ok_or("Specify HTTPS server origin; token is read from stdin")?;
            let source_device = args.next().unwrap_or_else(|| "Desktop".into());
            let mut token = String::new();
            io::stdin()
                .take(65537)
                .read_to_string(&mut token)
                .map_err(|e| e.to_string())?;
            if token.len() > 65536 {
                return Err("Token is too long".into());
            }
            let q = Queue::open(root)?;
            q.configure(Config {
                base_url,
                token: token.trim_end_matches(['\r', '\n']).into(),
                source_device,
            })?;
            println!("Configured. Credentials are private to this user's queue directory.");
        }
        "list" => {
            // Read-only output deliberately strips credentials. For a running GUI use its queue view.
            let q = Queue::open(root)?;
            q.consume_spool()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&q.list()?).map_err(|e| e.to_string())?
            );
        }
        "run" => {
            let q = Queue::open(root)?;
            // Foreground headless worker. Ctrl-C/process death leaves resumable state.
            loop {
                if let Err(e) = q.tick() {
                    eprintln!("Queue: {e}");
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        }
        _ => return Err("Unknown command".into()),
    }
    Ok(())
}
fn launch() {
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open")
        .args(["-g", "-b", "net.household.share", "--args", "--background"])
        .spawn();
    #[cfg(not(target_os = "macos"))]
    let result = {
        let executable = env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("household-share")))
            .unwrap_or_else(|| PathBuf::from("household-share"));
        Command::new(executable).arg("--background").spawn()
    };
    if let Err(e) = result {
        eprintln!("Capture is safely queued. Open Drop to process it ({e}).");
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        process::exit(1);
    }
}
