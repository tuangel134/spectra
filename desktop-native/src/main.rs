// Spectra native desktop shell.
//
// A tiny native window that renders Spectra's web UI using the operating
// system's WebView — WebView2 on Windows, WKWebView on macOS, WebKitGTK on
// Linux — with no bundled Chromium. The Node engine is started by the
// `spectra desktop` launcher, which passes the local URL via the SPECTRA_URL
// environment variable.
//
// Build:  npm run desktop:build   (requires Rust; see desktop-native/README.md
//         for the per-OS WebView prerequisites)
// Result: desktop-native/target/release/spectra-desktop[.exe]  (a few MB)

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

fn main() -> wry::Result<()> {
    let url = std::env::var("SPECTRA_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4123".to_string());

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Spectra")
        .with_inner_size(LogicalSize::new(1180.0, 760.0))
        .with_min_inner_size(LogicalSize::new(720.0, 480.0))
        .build(&event_loop)
        .expect("failed to create window");

    let _webview = WebViewBuilder::new(&window)
        .with_url(&url)
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
