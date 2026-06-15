//! NSWorkspace and CGWindowList metadata for the frontmost app.

use super::window_title::{ax_window_title_capture_enabled_for_bundle, get_window_title_ax};
use super::{ActiveWindowBounds, ActiveWindowInfo};
use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation_sys::base::{CFGetTypeID, CFTypeRef};
use core_foundation_sys::string::CFStringGetTypeID;

#[cfg(target_os = "macos")]
pub(crate) unsafe fn cf_string_from_get_rule(value: *const std::ffi::c_void) -> Option<String> {
    if value.is_null() || CFGetTypeID(value as CFTypeRef) != CFStringGetTypeID() {
        return None;
    }
    let cf = CFString::wrap_under_get_rule(value as CFStringRef);
    let text = cf.to_string();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn get_active_window_info_macos() -> Result<Option<ActiveWindowInfo>, String> {
    use objc2::exception;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};

    let result = unsafe {
        exception::catch(|| {
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

            let (cg_window_title, window_bounds) = get_frontmost_window_metadata(pid);

            // Default to the safer no-title path for the beta watcher. AX window-title
            // capture can be re-enabled explicitly once the callback crash surface is
            // isolated.
            let window_title = if ax_window_title_capture_enabled_for_bundle(&bundle_id) {
                get_window_title_ax(pid).or(cg_window_title)
            } else {
                cg_window_title
            };

            Ok(Some(ActiveWindowInfo {
                bundle_id,
                app_name,
                window_title,
                pid: Some(pid),
                bounds: window_bounds,
            }))
        })
    };

    match result {
        Ok(value) => value,
        Err(Some(exception)) => Err(format!(
            "Objective-C exception during active window lookup: {:?}",
            exception
        )),
        Err(None) => Err("Objective-C exception during active window lookup: <nil>".to_string()),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn get_frontmost_window_metadata(pid: i32) -> (Option<String>, Option<ActiveWindowBounds>) {
    use core_foundation::array::CFArray;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_graphics::display::CGWindowListCopyWindowInfo;
    use core_graphics::display::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };

    unsafe fn dict_number_i32(
        dict: &CFDictionary<CFString, *const std::ffi::c_void>,
        key: &str,
    ) -> Option<i32> {
        let key = CFString::new(key);
        let value_ref = dict.find(&key)?;
        let number = CFNumber::wrap_under_get_rule(*value_ref as _);
        number.to_i32()
    }

    unsafe fn dict_number_f64(
        dict: &CFDictionary<CFString, *const std::ffi::c_void>,
        key: &str,
    ) -> Option<f64> {
        let key = CFString::new(key);
        let value_ref = dict.find(&key)?;
        let number = CFNumber::wrap_under_get_rule(*value_ref as _);
        number.to_f64()
    }

    unsafe fn dict_string(
        dict: &CFDictionary<CFString, *const std::ffi::c_void>,
        key: &str,
    ) -> Option<String> {
        let key = CFString::new(key);
        let value_ref = dict.find(&key)?;
        cf_string_from_get_rule(*value_ref as _)
    }

    unsafe fn dict_bounds(
        dict: &CFDictionary<CFString, *const std::ffi::c_void>,
    ) -> Option<ActiveWindowBounds> {
        let key = CFString::new("kCGWindowBounds");
        let value_ref = dict.find(&key)?;
        let bounds_dict: CFDictionary<CFString, *const std::ffi::c_void> =
            CFDictionary::wrap_under_get_rule(*value_ref as _);
        let x = dict_number_f64(&bounds_dict, "X")?;
        let y = dict_number_f64(&bounds_dict, "Y")?;
        let width = dict_number_f64(&bounds_dict, "Width")?;
        let height = dict_number_f64(&bounds_dict, "Height")?;
        Some(ActiveWindowBounds {
            x,
            y,
            width,
            height,
        })
    }

    unsafe {
        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_list = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
        if window_list.is_null() {
            return (None, None);
        }

        let windows: CFArray<CFDictionary<CFString, *const std::ffi::c_void>> =
            CFArray::wrap_under_get_rule(window_list as _);
        let mut fallback_title = None;
        let mut fallback_bounds = None;

        for window in windows.iter() {
            if dict_number_i32(&window, "kCGWindowOwnerPID") != Some(pid) {
                continue;
            }

            let title = dict_string(&window, "kCGWindowName");
            let bounds = dict_bounds(&window);

            if fallback_title.is_none() {
                fallback_title = title.clone();
            }
            if fallback_bounds.is_none() {
                fallback_bounds = bounds;
            }

            let layer = dict_number_i32(&window, "kCGWindowLayer").unwrap_or_default();
            let alpha = dict_number_f64(&window, "kCGWindowAlpha").unwrap_or(1.0);
            let Some(bounds) = bounds else {
                continue;
            };

            if layer == 0 && alpha > 0.01 && bounds.width >= 40.0 && bounds.height >= 40.0 {
                return (title, Some(bounds));
            }
        }

        (fallback_title, fallback_bounds)
    }
}
