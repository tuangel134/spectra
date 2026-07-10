// Spectra native desktop shell.
//
// A tiny native window that renders Spectra's desktop-first UI using the
// operating system WebView. The Node engine is started by `spectra desktop`
// and passes a loopback URL via SPECTRA_URL.
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
        || std::env::var("SPECTRA_ALLOW_REMOTE").as_deref() == Ok("1")
}

fn main() -> wry::Result<()> {
    let url = std::env::var("SPECTRA_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4123/desktop".to_string());
    if !is_allowed_url(&url) {
        eprintln!("Spectra Desktop refused a non-loopback URL. Set SPECTRA_ALLOW_REMOTE=1 only if you understand the risk.");
        std::process::exit(2);
    }

    let title = std::env::var("SPECTRA_TITLE").unwrap_or_else(|_| "Spectra Desktop".to_string());
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(960.0, 640.0))
        .build(&event_loop)
        .expect("failed to create window");

    let _webview = WebViewBuilder::new(&window).with_url(&url).build()?;

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
