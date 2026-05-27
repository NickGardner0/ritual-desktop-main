//! Minimal protobuf decoder for Biome App.InFocus records.
//!
//! The message fields we need are small and stable enough to parse directly:
//! bundle id, foreground flag, CFAbsoluteTime, transition reason, app
//! version/build, and platform flag. This avoids a Python/protoc runtime in the
//! watcher process.

#[derive(Debug, Clone, PartialEq)]
pub struct AppInFocusEvent {
    pub transition_reason: Option<String>,
    pub kind: Option<u64>,
    pub in_foreground: bool,
    pub cf_absolute_time: Option<f64>,
    pub bundle_id: Option<String>,
    pub app_version: Option<String>,
    pub app_build: Option<String>,
    pub platform_flag: Option<u64>,
}

impl Default for AppInFocusEvent {
    fn default() -> Self {
        Self {
            transition_reason: None,
            kind: None,
            in_foreground: false,
            cf_absolute_time: None,
            bundle_id: None,
            app_version: None,
            app_build: None,
            platform_flag: None,
        }
    }
}

pub fn parse_app_in_focus_event(data: &[u8]) -> Option<AppInFocusEvent> {
    let mut event = AppInFocusEvent::default();
    let mut offset = 0usize;

    while offset < data.len() {
        let key = read_varint(data, &mut offset)?;
        let field = key >> 3;
        let wire_type = key & 0x07;

        match (field, wire_type) {
            (1, 2) => event.transition_reason = read_string(data, &mut offset),
            (2, 0) => event.kind = read_varint(data, &mut offset),
            (3, 0) => event.in_foreground = read_varint(data, &mut offset).unwrap_or(0) != 0,
            (4, 1) => event.cf_absolute_time = read_fixed64_as_f64(data, &mut offset),
            (6, 2) => event.bundle_id = read_string(data, &mut offset),
            (9, 2) => event.app_version = read_string(data, &mut offset),
            (10, 2) => event.app_build = read_string(data, &mut offset),
            (13, 0) => event.platform_flag = read_varint(data, &mut offset),
            (_, _) => skip_field(data, &mut offset, wire_type)?,
        }
    }

    if event.bundle_id.is_none() || event.cf_absolute_time.is_none() {
        return None;
    }
    Some(event)
}

fn read_varint(data: &[u8], offset: &mut usize) -> Option<u64> {
    let mut result = 0u64;
    let mut shift = 0u32;
    while *offset < data.len() && shift < 64 {
        let byte = data[*offset];
        *offset += 1;
        result |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(result);
        }
        shift += 7;
    }
    None
}

fn read_len(data: &[u8], offset: &mut usize) -> Option<usize> {
    usize::try_from(read_varint(data, offset)?).ok()
}

fn read_string(data: &[u8], offset: &mut usize) -> Option<String> {
    let len = read_len(data, offset)?;
    let end = offset.checked_add(len)?;
    if end > data.len() {
        return None;
    }
    let value = std::str::from_utf8(&data[*offset..end]).ok()?.to_string();
    *offset = end;
    Some(value)
}

fn read_fixed64_as_f64(data: &[u8], offset: &mut usize) -> Option<f64> {
    let end = offset.checked_add(8)?;
    if end > data.len() {
        return None;
    }
    let bytes: [u8; 8] = data[*offset..end].try_into().ok()?;
    *offset = end;
    Some(f64::from_le_bytes(bytes))
}

fn skip_field(data: &[u8], offset: &mut usize, wire_type: u64) -> Option<()> {
    match wire_type {
        0 => {
            read_varint(data, offset)?;
        }
        1 => *offset = offset.checked_add(8)?,
        2 => {
            let len = read_len(data, offset)?;
            *offset = offset.checked_add(len)?;
        }
        5 => *offset = offset.checked_add(4)?,
        _ => return None,
    }
    if *offset > data.len() {
        return None;
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_varint(mut value: u64, out: &mut Vec<u8>) {
        while value >= 0x80 {
            out.push((value as u8 & 0x7f) | 0x80);
            value >>= 7;
        }
        out.push(value as u8);
    }

    fn put_string(field: u64, value: &str, out: &mut Vec<u8>) {
        put_varint((field << 3) | 2, out);
        put_varint(value.len() as u64, out);
        out.extend_from_slice(value.as_bytes());
    }

    #[test]
    fn parses_app_in_focus_payload() {
        let mut bytes = Vec::new();
        put_string(1, "app-switch", &mut bytes);
        put_varint(2 << 3, &mut bytes);
        put_varint(1, &mut bytes);
        put_varint(3 << 3, &mut bytes);
        put_varint(1, &mut bytes);
        put_varint((4 << 3) | 1, &mut bytes);
        bytes.extend_from_slice(&123.5f64.to_le_bytes());
        put_string(6, "com.apple.MobileSMS", &mut bytes);
        put_string(9, "1.2.3", &mut bytes);
        put_string(10, "456", &mut bytes);
        put_varint(13 << 3, &mut bytes);
        put_varint(1, &mut bytes);

        let parsed = parse_app_in_focus_event(&bytes).expect("parse payload");
        assert!(parsed.in_foreground);
        assert_eq!(parsed.bundle_id.as_deref(), Some("com.apple.MobileSMS"));
        assert_eq!(parsed.transition_reason.as_deref(), Some("app-switch"));
        assert_eq!(parsed.app_version.as_deref(), Some("1.2.3"));
        assert_eq!(parsed.app_build.as_deref(), Some("456"));
        assert_eq!(parsed.cf_absolute_time, Some(123.5));
    }
}
