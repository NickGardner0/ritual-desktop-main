use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Default)]
pub struct SidebarGlassState {
    #[cfg(target_os = "macos")]
    view: std::sync::Mutex<Option<usize>>,
}

#[tauri::command]
pub fn sync_sidebar_glass_width(app: AppHandle, width: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    apply_sidebar_glass_width(&app, width);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, width);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn install_clipped(window: &WebviewWindow, app: &AppHandle) {
    install(window, Some(app), true);
}

#[cfg(target_os = "macos")]
pub fn install_full_window(window: &WebviewWindow) {
    install(window, None, false);
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn install(window: &WebviewWindow, app: Option<&AppHandle>, clip_to_sidebar: bool) {
    use cocoa::base::{id, nil, NO, YES};
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{msg_send, sel, sel_impl};

    let Ok(raw_window) = window.ns_window() else {
        eprintln!("❌ NSWindow handle not available for sidebar glass");
        return;
    };

    unsafe {
        let ns_win: id = raw_window as id;
        let content_view: id = msg_send![ns_win, contentView];
        if content_view.is_null() {
            eprintln!("❌ contentView is null, cannot clip sidebar glass");
            return;
        }

        let bounds: NSRect = msg_send![content_view, bounds];
        let frame = if clip_to_sidebar {
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, bounds.size.height))
        } else {
            bounds
        };

        let glass_view = match create_glass_view(frame) {
            Some(view) => view,
            None => {
                eprintln!("❌ Failed to create clipped sidebar glass view");
                return;
            }
        };

        // Height only when clipped so window resize does not stretch glass
        // across the chat pane. Full-window (detached sidebar) tracks both axes.
        // NSViewHeightSizable = 16, NSViewWidthSizable = 2.
        let autoresize: u64 = if clip_to_sidebar { 16 } else { 18 };
        let _: () = msg_send![glass_view, setAutoresizingMask: autoresize];
        if clip_to_sidebar {
            let _: () = msg_send![glass_view, setHidden: YES];
        }

        let below: i64 = -1;
        let _: () = msg_send![
            content_view,
            addSubview: glass_view
            positioned: below
            relativeTo: nil
        ];

        if clip_to_sidebar {
            if let Some(app) = app {
                store_glass_view(app, glass_view as usize);
            }
            println!("✅ Sidebar glass clipped to native sidebar column");
        } else {
            let _: () = msg_send![glass_view, setHidden: NO];
            println!("✅ Sidebar glass applied to full detached sidebar window");
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn apply_sidebar_glass_width(app: &AppHandle, width: f64) {
    use cocoa::base::{id, NO, YES};
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::{msg_send, sel, sel_impl};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(ptr) = load_glass_view(app) else {
        return;
    };
    let Ok(raw_window) = window.ns_window() else {
        return;
    };

    unsafe {
        let view = ptr as id;
        if view.is_null() {
            return;
        }
        let ns_win: id = raw_window as id;
        let content_view: id = msg_send![ns_win, contentView];
        if content_view.is_null() {
            return;
        }
        let bounds: NSRect = msg_send![content_view, bounds];
        let hidden = width < 0.5;
        let _: () = msg_send![view, setHidden: if hidden { YES } else { NO }];
        if hidden {
            return;
        }
        let frame = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(width.max(0.0), bounds.size.height),
        );
        let _: () = msg_send![view, setFrame: frame];
    }
}

#[cfg(target_os = "macos")]
fn store_glass_view(app: &AppHandle, ptr: usize) {
    let glass_state = app.state::<SidebarGlassState>();
    let mut slot = match glass_state.view.lock() {
        Ok(slot) => slot,
        Err(_) => return,
    };
    *slot = Some(ptr);
}

#[cfg(target_os = "macos")]
fn load_glass_view(app: &AppHandle) -> Option<usize> {
    let glass_state = app.state::<SidebarGlassState>();
    let slot = glass_state.view.lock().ok()?;
    *slot
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
unsafe fn create_glass_view(frame: cocoa::foundation::NSRect) -> Option<cocoa::base::id> {
    use cocoa::appkit::NSColor;
    use cocoa::base::{id, nil};
    use objc::{msg_send, sel, sel_impl};

    if let Some(cls) = objc::runtime::Class::get("NSGlassEffectView") {
        let alloc: id = msg_send![cls, alloc];
        if !alloc.is_null() {
            let view: id = msg_send![alloc, initWithFrame: frame];
            if !view.is_null() {
                // Style 16 = Sidebar (NSGlassEffectViewStyle::Sidebar)
                let _: () = msg_send![view, setStyle: 16_isize];
                let tint: id = NSColor::colorWithRed_green_blue_alpha_(nil, 1.0, 1.0, 1.0, 0.0);
                let _: () = msg_send![view, setTintColor: tint];
                println!(
                    "✅ Apple Liquid Glass applied (NSGlassEffectView, style=Sidebar, clipped)"
                );
                return Some(view);
            }
        }
        eprintln!("⚠️ NSGlassEffectView init failed, falling back to NSVisualEffectView");
    } else {
        println!("⚠️ NSGlassEffectView not available, falling back to NSVisualEffectView");
    }

    let Some(cls) = objc::runtime::Class::get("NSVisualEffectView") else {
        return None;
    };
    let alloc: id = msg_send![cls, alloc];
    if alloc.is_null() {
        return None;
    }
    let view: id = msg_send![alloc, initWithFrame: frame];
    if view.is_null() {
        return None;
    }
    // NSVisualEffectMaterial::Sidebar = 7
    let _: () = msg_send![view, setMaterial: 7_isize];
    // NSVisualEffectBlendingMode::BehindWindow = 0
    let _: () = msg_send![view, setBlendingMode: 0_isize];
    // NSVisualEffectState::Active = 1
    let _: () = msg_send![view, setState: 1_isize];
    println!("✅ Fallback: clipped NSVisualEffectView vibrancy applied (Sidebar material)");
    Some(view)
}
