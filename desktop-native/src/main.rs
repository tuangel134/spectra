// Spectra 1.0 native desktop shell with a self-starting local engine.
use std::{
    env,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

fn is_allowed_url(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:")
        || url.starts_with("http://localhost:")
        || url.starts_with("http://[::1]:")
        || env::var("SPECTRA_ALLOW_REMOTE").as_deref() == Ok("1")
}

fn engine_candidates(exe: &Path) -> Vec<PathBuf> {
    let parent = exe.parent().unwrap_or_else(|| Path::new("."));
    vec![
        parent.join("dist").join("cli.js"),
        parent.join("resources").join("dist").join("cli.js"),
        parent
            .join("..")
            .join("Resources")
            .join("dist")
            .join("cli.js"),
        parent
            .join("..")
            .join("lib")
            .join("spectra")
            .join("dist")
            .join("cli.js"),
        PathBuf::from("/usr/lib/spectra/dist/cli.js"),
        PathBuf::from("/usr/lib/Spectra/dist/cli.js"),
    ]
}

fn core_ready(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok()
}

fn start_packaged_engine(port: u16) {
    if core_ready(port) {
        return;
    }
    let Ok(exe) = env::current_exe() else { return };
    let Some(engine) = engine_candidates(&exe)
        .into_iter()
        .find(|path| path.is_file())
    else {
        return;
    };
    let runtime_name = if cfg!(windows) { "node.exe" } else { "node" };
    let parent = exe.parent().unwrap_or_else(|| Path::new("."));
    let bundled_runtime = [
        parent.join("runtime").join(runtime_name),
        parent.join("resources").join("runtime").join(runtime_name),
        parent
            .join("..")
            .join("Resources")
            .join("runtime")
            .join(runtime_name),
        parent
            .join("..")
            .join("lib")
            .join("spectra")
            .join("runtime")
            .join(runtime_name),
        PathBuf::from("/usr/lib/spectra/runtime").join(runtime_name),
    ]
    .into_iter()
    .find(|path| path.is_file());
    let node = env::var_os("SPECTRA_NODE")
        .map(PathBuf::from)
        .or(bundled_runtime)
        .unwrap_or_else(|| PathBuf::from(runtime_name));
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = Command::new(node)
        .arg(engine)
        .arg("core-daemon")
        .arg("--cwd")
        .arg(cwd)
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    for _ in 0..50 {
        if core_ready(port) {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn main() -> wry::Result<()> {
    let port = env::var("SPECTRA_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(4123);
    let url =
        env::var("SPECTRA_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{port}/desktop"));
    if !is_allowed_url(&url) {
        eprintln!("Spectra Desktop refused a non-loopback URL. Set SPECTRA_ALLOW_REMOTE=1 only if you understand the risk.");
        std::process::exit(2);
    }
    if env::var("SPECTRA_URL").is_err() {
        start_packaged_engine(port);
    }
    let title = env::var("SPECTRA_TITLE").unwrap_or_else(|_| "Spectra Desktop 1.0".to_string());
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(960.0, 640.0))
        .build(&event_loop)
        .expect("failed to create window");
    let _webview = WebViewBuilder::new(&window)
        .with_url(&url)
        .with_navigation_handler(|target| is_allowed_url(&target))
        .build()?;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
