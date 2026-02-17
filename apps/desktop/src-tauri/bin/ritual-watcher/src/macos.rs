//! macOS-specific window tracking implementation
//!
//! Uses NSWorkspace for active app detection and Accessibility API for window titles.
//! Inspired by ActivityWatch's aw-watcher-window implementation.

#![allow(dead_code)] // Public API - some functions used externally
#![allow(non_upper_case_globals)] // macOS API constants use camelCase

use std::ptr;

use core_foundation::base::{CFRelease, TCFType};
use core_foundation::string::{CFString, CFStringRef};

/// Information about the currently active window
#[derive(Debug, Clone)]
pub struct ActiveWindowInfo {
    /// Bundle identifier (e.g., "com.apple.Safari")
    pub bundle_id: String,
    /// Application name (e.g., "Safari")
    pub app_name: String,
    /// Window title (if accessible)
    pub window_title: Option<String>,
    /// Process ID
    pub pid: Option<i32>,
}

/// Get information about the currently active window
pub fn get_active_window_info() -> Result<Option<ActiveWindowInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        get_active_window_info_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("This platform is not supported".to_string())
    }
}

#[cfg(target_os = "macos")]
fn get_active_window_info_macos() -> Result<Option<ActiveWindowInfo>, String> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};

    unsafe {
        // Get the shared workspace
        let workspace = NSWorkspace::sharedWorkspace();

        // Get the frontmost application
        let frontmost_app: Option<Retained<NSRunningApplication>> =
            workspace.frontmostApplication();

        let app = match frontmost_app {
            Some(app) => app,
            None => return Ok(None),
        };

        // Get bundle identifier
        let bundle_id: String = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".to_string());

        // Get application name
        let app_name: String = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "Unknown".to_string());

        // Get process ID using the raw method
        // NSRunningApplication.processIdentifier returns pid_t (i32)
        let pid: i32 = {
            use objc2::msg_send;
            msg_send![&app, processIdentifier]
        };

        // Get window title using Accessibility API
        let window_title = get_window_title_ax(pid);

        Ok(Some(ActiveWindowInfo {
            bundle_id,
            app_name,
            window_title,
            pid: Some(pid),
        }))
    }
}

#[cfg(target_os = "macos")]
fn get_window_title_ax(pid: i32) -> Option<String> {
    use core_foundation::array::CFArray;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_graphics::display::CGWindowListCopyWindowInfo;
    use core_graphics::display::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };

    unsafe {
        // Try Accessibility API first (more reliable but requires permissions)
        if let Some(title) = get_window_title_accessibility(pid) {
            return Some(title);
        }

        // Fallback to CGWindowList (doesn't require Accessibility permissions but less reliable)
        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;

        let window_list = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
        if window_list.is_null() {
            return None;
        }

        let windows: CFArray<CFDictionary<CFString, *const std::ffi::c_void>> =
            CFArray::wrap_under_get_rule(window_list as _);

        for window in windows.iter() {
            // Get owner PID
            let owner_pid_key = CFString::new("kCGWindowOwnerPID");
            if let Some(pid_ref) = window.find(&owner_pid_key) {
                // Use wrap_under_get_rule instead of from_void
                let pid_num = CFNumber::wrap_under_get_rule(*pid_ref as _);
                if let Some(window_pid) = pid_num.to_i32() {
                    if window_pid == pid {
                        // Get window name
                        let name_key = CFString::new("kCGWindowName");
                        if let Some(name_ref) = window.find(&name_key) {
                            let name = CFString::wrap_under_get_rule(*name_ref as _);
                            let title = name.to_string();
                            if !title.is_empty() {
                                return Some(title);
                            }
                        }
                    }
                }
            }
        }

        None
    }
}

#[cfg(target_os = "macos")]
fn get_window_title_accessibility(pid: i32) -> Option<String> {
    // Accessibility API types
    #[repr(C)]
    struct __AXUIElement(std::ffi::c_void);
    type AXUIElementRef = *mut __AXUIElement;
    type AXError = i32;

    const kAXErrorSuccess: AXError = 0;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut *const std::ffi::c_void,
        ) -> AXError;
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe {
        // Check if we have accessibility permissions
        if !AXIsProcessTrusted() {
            return None;
        }

        // Create an accessibility element for the application
        let app_element = AXUIElementCreateApplication(pid);
        if app_element.is_null() {
            return None;
        }

        // Get the focused window
        let focused_window_attr = CFString::new("AXFocusedWindow");
        let mut window_value: *const std::ffi::c_void = ptr::null();

        let result = AXUIElementCopyAttributeValue(
            app_element,
            focused_window_attr.as_concrete_TypeRef(),
            &mut window_value,
        );

        CFRelease(app_element as *const _);

        if result != kAXErrorSuccess || window_value.is_null() {
            return None;
        }

        let window_element = window_value as AXUIElementRef;

        // Get the window title
        let title_attr = CFString::new("AXTitle");
        let mut title_value: *const std::ffi::c_void = ptr::null();

        let result = AXUIElementCopyAttributeValue(
            window_element,
            title_attr.as_concrete_TypeRef(),
            &mut title_value,
        );

        CFRelease(window_element as *const _);

        if result != kAXErrorSuccess || title_value.is_null() {
            return None;
        }

        // Convert CFString to Rust String
        let title_cf = CFString::wrap_under_create_rule(title_value as CFStringRef);
        Some(title_cf.to_string())
    }
}

/// Check if accessibility permissions are granted
#[cfg(target_os = "macos")]
pub fn check_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe { AXIsProcessTrusted() }
}

/// Prompt user to grant accessibility permissions
#[cfg(target_os = "macos")]
pub fn prompt_accessibility_permission() {
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    }

    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::true_value();

        let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);

        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _);
    }
}
