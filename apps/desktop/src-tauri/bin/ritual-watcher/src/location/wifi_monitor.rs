//! Wi-Fi fingerprint reader for macOS.
//!
//! Reads the currently-connected SSID and BSSID via the macOS `networksetup`
//! and `airport` command-line tools. This is the simplest approach that
//! avoids Core WLAN bindings (which require Location authorization on
//! macOS 14+ anyway).
//!
//! Note: as of macOS 14+, even these CLI tools may return masked BSSIDs
//! (e.g. all zeros) unless the calling process has Location permission.
//! The user grants Location to the Ritual app once; the watcher inherits
//! the permission via app group / parent process. If BSSIDs come back null
//! consistently, that's the most likely cause.

use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WifiFingerprint {
    pub ssid: Option<String>,
    pub bssid: Option<String>,
}

/// Read the current Wi-Fi fingerprint. Returns None if Wi-Fi is off or
/// disconnected. Returns Some with null fields if reads fail.
pub fn current_fingerprint() -> Option<WifiFingerprint> {
    // Approach 1: `networksetup -getairportnetwork en0` returns the SSID.
    // Approach 2: `system_profiler SPAirPortDataType` includes BSSID but is slow.
    // Approach 3: `/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I`
    //             is fast and returns both SSID and BSSID, but Apple may remove it in future macOS.
    //
    // We try airport first (fastest), then fall back to networksetup for SSID.

    if let Some(fp) = read_via_airport() {
        return Some(fp);
    }

    let ssid = read_ssid_via_networksetup();
    if ssid.is_none() {
        return None;
    }
    Some(WifiFingerprint { ssid, bssid: None })
}

fn read_via_airport() -> Option<WifiFingerprint> {
    let output = Command::new("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport")
        .arg("-I")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ssid: Option<String> = None;
    let mut bssid: Option<String> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("SSID:") {
            let v = rest.trim();
            if !v.is_empty() {
                ssid = Some(v.to_string());
            }
        } else if let Some(rest) = trimmed.strip_prefix("BSSID:") {
            let v = rest.trim();
            // Apple returns 0:0:0:0:0:0 when permission is denied
            if !v.is_empty() && v != "0:0:0:0:0:0" {
                bssid = Some(v.to_string());
            }
        }
    }

    if ssid.is_none() && bssid.is_none() {
        return None;
    }
    Some(WifiFingerprint { ssid, bssid })
}

fn read_ssid_via_networksetup() -> Option<String> {
    let output = Command::new("/usr/sbin/networksetup")
        .args(&["-getairportnetwork", "en0"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Output is like: "Current Wi-Fi Network: MyNetwork"
    let line = stdout.trim();
    if let Some(rest) = line.strip_prefix("Current Wi-Fi Network:") {
        let v = rest.trim();
        if v.is_empty() {
            return None;
        }
        return Some(v.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_struct_equality_works() {
        let a = WifiFingerprint {
            ssid: Some("Home".into()),
            bssid: Some("aa:bb:cc:dd:ee:ff".into()),
        };
        let b = a.clone();
        assert_eq!(a, b);

        let c = WifiFingerprint {
            ssid: Some("Home".into()),
            bssid: Some("11:22:33:44:55:66".into()),
        };
        assert_ne!(a, c);
    }

    #[test]
    fn current_fingerprint_returns_either_some_or_none_no_panic() {
        // This is an integration-style smoke test — actual values depend on
        // the host's Wi-Fi state. We just ensure the function doesn't panic
        // and the result type matches.
        let _ = current_fingerprint();
    }
}
