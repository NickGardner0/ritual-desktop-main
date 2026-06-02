//! Minimal SEGB v1/v2 reader for Apple's Biome stream files.

use std::fs;
use std::path::Path;

use super::protobuf::{parse_app_in_focus_event, AppInFocusEvent};

const SEGB_MAGIC: &[u8; 4] = b"SEGB";
const V1_HEADER_LEN: usize = 56;
const V1_RECORD_HEADER_LEN: usize = 32;
const V2_HEADER_LEN: usize = 32;
const V2_TRAILER_ENTRY_LEN: usize = 16;
const V2_ENTRY_HEADER_LEN: usize = 8;

#[derive(Debug, Clone)]
pub struct ParsedFocusRecord {
    pub event: AppInFocusEvent,
}

pub fn read_app_in_focus_records(path: &Path) -> Result<Vec<ParsedFocusRecord>, String> {
    let bytes = fs::read(path).map_err(|error| format!("read SEGB file: {error}"))?;
    if bytes.len() >= V1_HEADER_LEN && &bytes[V1_HEADER_LEN - 4..V1_HEADER_LEN] == SEGB_MAGIC {
        return read_v1_records(&bytes);
    }
    if bytes.len() >= V2_HEADER_LEN && &bytes[0..4] == SEGB_MAGIC {
        return read_v2_records(&bytes);
    }
    Err("not a supported SEGB file".to_string())
}

fn read_v1_records(bytes: &[u8]) -> Result<Vec<ParsedFocusRecord>, String> {
    let end_of_data = u32_at(bytes, 0)? as usize;
    let end_of_data = end_of_data.min(bytes.len());
    let mut offset = V1_HEADER_LEN;
    let mut records = Vec::new();

    while offset + V1_RECORD_HEADER_LEN <= end_of_data {
        let record_length = i32_at(bytes, offset)? as isize;
        let entry_state = i32_at(bytes, offset + 4)?;
        offset += V1_RECORD_HEADER_LEN;
        if record_length < 0 {
            break;
        }
        let record_length = record_length as usize;
        let data_end = offset.saturating_add(record_length);
        if data_end > bytes.len() {
            break;
        }
        if entry_state == 1 {
            if let Some(event) = parse_app_in_focus_event(&bytes[offset..data_end]) {
                records.push(ParsedFocusRecord { event });
            }
        }
        offset = align(data_end, 8);
    }

    Ok(records)
}

fn read_v2_records(bytes: &[u8]) -> Result<Vec<ParsedFocusRecord>, String> {
    let entries_count = i32_at(bytes, 4)?;
    if entries_count <= 0 {
        return Ok(Vec::new());
    }
    let entries_count = entries_count as usize;
    let trailer_len = V2_TRAILER_ENTRY_LEN
        .checked_mul(entries_count)
        .ok_or_else(|| "SEGB trailer length overflow".to_string())?;
    if trailer_len > bytes.len().saturating_sub(V2_HEADER_LEN) {
        return Err("SEGB v2 trailer extends beyond file".to_string());
    }
    let trailer_start = bytes.len() - trailer_len;
    let mut metadata = Vec::with_capacity(entries_count);
    for index in 0..entries_count {
        let offset = trailer_start + index * V2_TRAILER_ENTRY_LEN;
        let end_offset = i32_at(bytes, offset)?;
        let state = i32_at(bytes, offset + 4)?;
        if end_offset >= 0 {
            metadata.push((end_offset as usize, state));
        }
    }
    metadata.sort_by_key(|(end_offset, _)| *end_offset);

    let mut cursor = V2_HEADER_LEN;
    let mut records = Vec::new();
    for (end_offset, state) in metadata {
        if state == 4 {
            continue;
        }
        let entry_end = end_offset.saturating_add(V2_HEADER_LEN);
        if entry_end <= cursor || entry_end > bytes.len() {
            continue;
        }
        let entry_raw = &bytes[cursor..entry_end];
        if state == 1 && entry_raw.len() > V2_ENTRY_HEADER_LEN {
            if let Some(event) = parse_app_in_focus_event(&entry_raw[V2_ENTRY_HEADER_LEN..]) {
                records.push(ParsedFocusRecord { event });
            }
        }
        cursor = align(entry_end, 4);
        if cursor > bytes.len() {
            break;
        }
    }

    Ok(records)
}

fn align(value: usize, alignment: usize) -> usize {
    let remainder = value % alignment;
    if remainder == 0 {
        value
    } else {
        value + (alignment - remainder)
    }
}

fn i32_at(bytes: &[u8], offset: usize) -> Result<i32, String> {
    let end = offset
        .checked_add(4)
        .ok_or_else(|| "offset overflow".to_string())?;
    let slice = bytes
        .get(offset..end)
        .ok_or_else(|| "unexpected end of SEGB file".to_string())?;
    Ok(i32::from_le_bytes(slice.try_into().map_err(|_| "bad i32".to_string())?))
}

fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let end = offset
        .checked_add(4)
        .ok_or_else(|| "offset overflow".to_string())?;
    let slice = bytes
        .get(offset..end)
        .ok_or_else(|| "unexpected end of SEGB file".to_string())?;
    Ok(u32::from_le_bytes(slice.try_into().map_err(|_| "bad u32".to_string())?))
}
