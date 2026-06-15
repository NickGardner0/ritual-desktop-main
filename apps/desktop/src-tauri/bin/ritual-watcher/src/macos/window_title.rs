//! Window title capture via Accessibility API and CGWindowList fallback.

use super::accessibility::{is_browser_context, is_high_risk_desktop_shell};
use super::env_flag_enabled;
use super::workspace::cf_string_from_get_rule;
use core_foundation::base::{CFRelease, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation_sys::base::{CFGetTypeID, CFTypeRef};
use core_foundation_sys::string::CFStringGetTypeID;
use std::ptr;

#[cfg(target_os = "macos")]
unsafe fn cf_string_from_create_rule(value: *const std::ffi::c_void) -> Option<String> {
    if value.is_null() {
        return None;
    }
    if CFGetTypeID(value as CFTypeRef) != CFStringGetTypeID() {
        CFRelease(value as *const _);
        return None;
    }
    let cf = CFString::wrap_under_create_rule(value as CFStringRef);
    let text = cf.to_string();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(target_os = "macos")]
fn ax_window_title_high_risk_bundle(bundle_id: &str) -> bool {
    is_high_risk_desktop_shell(Some(bundle_id))
}

#[cfg(target_os = "macos")]
pub(crate) fn ax_window_title_capture_enabled_for_bundle(bundle_id: &str) -> bool {
    if env_flag_enabled("RITUAL_DISABLE_AX_WINDOW_TITLES") {
        return false;
    }
    if env_flag_enabled("RITUAL_ENABLE_AX_WINDOW_TITLES") {
        return true;
    }

    !is_browser_context(Some(bundle_id), None) && !ax_window_title_high_risk_bundle(bundle_id)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn ax_window_title_capture_enabled_for_bundle(_bundle_id: &str) -> bool {
    false
}

#[cfg(target_os = "macos")]
pub(crate) fn get_window_title_ax(pid: i32) -> Option<String> {
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
                            if let Some(title) = cf_string_from_get_rule(*name_ref as _) {
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

        cf_string_from_create_rule(title_value)
    }
}
