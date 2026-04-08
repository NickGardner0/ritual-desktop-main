#![allow(dead_code)]

use clap::Parser;
use serde_json::to_string_pretty;

mod macos;

#[derive(Parser, Debug)]
#[command(name = "ritual-ax-dump")]
#[command(about = "Dump macOS accessibility structure for a running app/window")]
struct Args {
    /// Process ID to inspect. Defaults to the current frontmost app.
    #[arg(long)]
    pid: Option<i32>,

    /// Max descendant depth to include in the dump.
    #[arg(long, default_value = "2")]
    depth: usize,

    /// Max children/siblings to include per level.
    #[arg(long, default_value = "8")]
    max_children: usize,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ritual_ax_dump=info".parse().unwrap()),
        )
        .init();

    let args = Args::parse();

    let active = macos::get_active_window_info()
        .map_err(|err| format!("Failed to resolve frontmost app: {}", err))
        .ok()
        .flatten();

    let pid = args
        .pid
        .or_else(|| active.as_ref().and_then(|info| info.pid))
        .unwrap_or_else(|| {
            eprintln!("No pid provided and no frontmost app pid available");
            std::process::exit(1);
        });

    let bundle_id = active
        .as_ref()
        .and_then(|info| (info.pid == Some(pid)).then_some(info.bundle_id.as_str()));
    let window_title = active
        .as_ref()
        .and_then(|info| (info.pid == Some(pid)).then_some(info.window_title.as_deref()))
        .flatten();

    match macos::dump_accessibility_context(
        pid,
        bundle_id,
        window_title,
        args.depth,
        args.max_children,
    ) {
        Ok(dump) => {
            println!(
                "{}",
                to_string_pretty(&dump).unwrap_or_else(|_| "{}".to_string())
            );
        }
        Err(err) => {
            eprintln!("{}", err);
            std::process::exit(1);
        }
    }
}
