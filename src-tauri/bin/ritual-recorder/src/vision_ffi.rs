//! Vision Framework FFI Bindings
//!
//! Provides Rust bindings to Apple's Vision framework for OCR text recognition.
//! Uses objc2 for safe Objective-C interop.
//!
//! # Safety
//!
//! All Vision framework calls are unsafe FFI. This module encapsulates the
//! unsafe code and provides a safe Rust API.

#![allow(non_snake_case)]
#![allow(dead_code)]

use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::AnyObject;
use objc2::{class, msg_send, msg_send_id};
use objc2::encode::Encode;
use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSString};
use tracing::{debug, trace};

/// CGRect-compatible struct for receiving bounding box from Vision
/// We define our own to avoid version conflicts with core-graphics crate
#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

// Implement Encode for our CGRect to use with msg_send
// Safety: These are identical to the Apple CoreGraphics types
unsafe impl Encode for CGRect {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGRect",
        &[CGPoint::ENCODING, CGSize::ENCODING],
    );
}

unsafe impl Encode for CGPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGPoint",
        &[f64::ENCODING, f64::ENCODING],
    );
}

unsafe impl Encode for CGSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGSize",
        &[f64::ENCODING, f64::ENCODING],
    );
}

/// Recognition level for text recognition requests
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i64)]
pub enum VNRequestTextRecognitionLevel {
    /// Fast recognition with lower accuracy
    Fast = 0,
    /// Accurate recognition with slower speed
    Accurate = 1,
}

/// Result from a text recognition operation
#[derive(Debug, Clone)]
pub struct VisionOcrResult {
    /// Recognized text (all observations concatenated with newlines)
    pub text: String,
    /// Average confidence across all observations (0.0-1.0)
    pub confidence: f32,
    /// Individual text observations with bounding boxes
    pub observations: Vec<TextObservation>,
}

/// A single text observation from Vision
#[derive(Debug, Clone)]
pub struct TextObservation {
    /// The recognized text string
    pub text: String,
    /// Confidence score (0.0-1.0)
    pub confidence: f32,
    /// Bounding box in normalized coordinates (x, y, width, height)
    /// Origin is bottom-left, values are 0.0-1.0
    pub bounding_box: (f64, f64, f64, f64),
}

impl Default for VisionOcrResult {
    fn default() -> Self {
        Self {
            text: String::new(),
            confidence: 0.0,
            observations: Vec::new(),
        }
    }
}

/// Minimum confidence threshold for including text observations
/// Observations below this threshold are filtered out to reduce noise
/// and improve embedding quality
pub const MIN_OBSERVATION_CONFIDENCE: f32 = 0.5;

/// Perform OCR on image data using Vision framework
///
/// # Arguments
/// * `image_data` - PNG or JPEG image data as bytes
/// * `level` - Recognition level (Fast or Accurate)
///
/// # Returns
/// OCR result with extracted text and confidence scores
///
/// # Safety
/// This function performs FFI calls to the Vision framework.
/// It is memory-safe due to objc2's reference counting.
#[cfg(target_os = "macos")]
pub fn recognize_text(
    image_data: &[u8],
    level: VNRequestTextRecognitionLevel,
) -> Result<VisionOcrResult, String> {
    autoreleasepool(|_pool| {
        unsafe { recognize_text_impl(image_data, level) }
    })
}

#[cfg(target_os = "macos")]
unsafe fn recognize_text_impl(
    image_data: &[u8],
    level: VNRequestTextRecognitionLevel,
) -> Result<VisionOcrResult, String> {
    // Create NSData from image bytes
    let ns_data = create_nsdata_from_bytes(image_data)?;
    
    // Create VNImageRequestHandler
    let handler = create_image_request_handler(&ns_data)?;
    
    // Create VNRecognizeTextRequest
    let request = create_text_request(level)?;
    
    // Perform the request
    perform_request(&handler, &request)?;
    
    // Extract results
    extract_results(&request)
}

#[cfg(target_os = "macos")]
unsafe fn create_nsdata_from_bytes(bytes: &[u8]) -> Result<Retained<NSData>, String> {
    let data: Option<Retained<NSData>> = msg_send_id![
        class!(NSData),
        dataWithBytes: bytes.as_ptr(),
        length: bytes.len()
    ];
    data.ok_or_else(|| "Failed to create NSData from bytes".to_string())
}

#[cfg(target_os = "macos")]
unsafe fn create_image_request_handler(data: &NSData) -> Result<Retained<AnyObject>, String> {
    // Get VNImageRequestHandler class
    let cls = class!(VNImageRequestHandler);
    
    // Create empty options dictionary
    let options: Retained<NSDictionary> = msg_send_id![class!(NSDictionary), dictionary];
    
    // Allocate and init with data
    let handler: Option<Retained<AnyObject>> = msg_send_id![
        msg_send_id![cls, alloc],
        initWithData: data,
        options: &*options
    ];
    
    handler.ok_or_else(|| "Failed to create VNImageRequestHandler".to_string())
}

#[cfg(target_os = "macos")]
unsafe fn create_text_request(level: VNRequestTextRecognitionLevel) -> Result<Retained<AnyObject>, String> {
    // Get VNRecognizeTextRequest class
    let cls = class!(VNRecognizeTextRequest);
    
    // Allocate and init
    let request: Option<Retained<AnyObject>> = msg_send_id![
        msg_send_id![cls, alloc],
        init
    ];
    
    let request = request.ok_or_else(|| "Failed to create VNRecognizeTextRequest".to_string())?;
    
    // Set recognition level
    let _: () = msg_send![&*request, setRecognitionLevel: level as i64];
    
    // Enable language correction for better results
    let _: () = msg_send![&*request, setUsesLanguageCorrection: true];
    
    trace!("Created VNRecognizeTextRequest with level {:?}", level);
    
    Ok(request)
}

#[cfg(target_os = "macos")]
unsafe fn perform_request(
    handler: &AnyObject,
    request: &AnyObject,
) -> Result<(), String> {
    // Create NSArray with the single request
    let requests: Retained<NSArray<AnyObject>> = {
        let array: Option<Retained<NSArray<AnyObject>>> = msg_send_id![
            class!(NSArray),
            arrayWithObject: request
        ];
        array.ok_or_else(|| "Failed to create requests array".to_string())?
    };
    
    // Perform requests (synchronous)
    let mut error: *mut NSError = std::ptr::null_mut();
    let success: bool = msg_send![
        handler,
        performRequests: &*requests,
        error: &mut error as *mut *mut NSError
    ];
    
    if !success {
        if !error.is_null() {
            let error_desc: Option<Retained<NSString>> = msg_send_id![error, localizedDescription];
            let desc = error_desc
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown error".to_string());
            return Err(format!("Vision request failed: {}", desc));
        }
        return Err("Vision request failed with unknown error".to_string());
    }
    
    Ok(())
}

/// Extract bounding box from a VNRecognizedTextObservation
#[cfg(target_os = "macos")]
unsafe fn get_bounding_box(observation: &AnyObject) -> (f64, f64, f64, f64) {
    // boundingBox returns a CGRect in normalized coordinates (0.0-1.0)
    // Origin is bottom-left of the image
    let rect: CGRect = msg_send![observation, boundingBox];
    (rect.origin.x, rect.origin.y, rect.size.width, rect.size.height)
}

#[cfg(target_os = "macos")]
unsafe fn extract_results(request: &AnyObject) -> Result<VisionOcrResult, String> {
    // Get results array
    let results: Option<Retained<NSArray<AnyObject>>> = msg_send_id![request, results];
    
    let results = match results {
        Some(r) => r,
        None => {
            debug!("No results from VNRecognizeTextRequest");
            return Ok(VisionOcrResult::default());
        }
    };
    
    let count: usize = msg_send![&*results, count];
    if count == 0 {
        debug!("Empty results array from VNRecognizeTextRequest");
        return Ok(VisionOcrResult::default());
    }
    
    trace!("Processing {} text observations", count);
    
    let mut all_text = Vec::new();
    let mut total_confidence: f32 = 0.0;
    let mut observations = Vec::new();
    let mut filtered_count: usize = 0;
    
    for i in 0..count {
        let observation: Option<Retained<AnyObject>> = msg_send_id![&*results, objectAtIndex: i];
        let observation = match observation {
            Some(o) => o,
            None => continue,
        };
        
        // Get top candidate (best recognition result)
        let candidates: Option<Retained<NSArray<AnyObject>>> = msg_send_id![
            &*observation,
            topCandidates: 1usize
        ];
        
        let candidates = match candidates {
            Some(c) => c,
            None => continue,
        };
        
        let candidate_count: usize = msg_send![&*candidates, count];
        if candidate_count == 0 {
            continue;
        }
        
        let candidate: Option<Retained<AnyObject>> = msg_send_id![&*candidates, objectAtIndex: 0usize];
        let candidate = match candidate {
            Some(c) => c,
            None => continue,
        };
        
        // Get string from candidate
        let text_string: Option<Retained<NSString>> = msg_send_id![&*candidate, string];
        let text = match text_string {
            Some(s) => s.to_string(),
            None => continue,
        };
        
        if text.is_empty() {
            continue;
        }
        
        // Get confidence from candidate
        let confidence: f32 = msg_send![&*candidate, confidence];
        
        // Filter out low-confidence observations to reduce noise
        // This significantly improves embedding quality by removing garbage text
        if confidence < MIN_OBSERVATION_CONFIDENCE {
            filtered_count += 1;
            trace!(
                "Skipping low-confidence observation ({:.2} < {:.2}): {}",
                confidence,
                MIN_OBSERVATION_CONFIDENCE,
                if text.len() > 50 { &text[..50] } else { &text }
            );
            continue;
        }
        
        // Get bounding box from observation
        // We extract values using NSValue since CGRect has version conflicts
        // boundingBox returns CGRect which we'll extract as raw values
        let bbox = get_bounding_box(&observation);
        
        all_text.push(text.clone());
        total_confidence += confidence;
        observations.push(TextObservation {
            text,
            confidence,
            bounding_box: bbox,
        });
    }
    
    let combined_text = all_text.join("\n");
    let avg_confidence = if !observations.is_empty() {
        total_confidence / observations.len() as f32
    } else {
        0.0
    };
    
    if filtered_count > 0 {
        debug!(
            "Vision OCR: {} chars, {} observations (filtered {} low-confidence), avg confidence {:.2}",
            combined_text.len(),
            observations.len(),
            filtered_count,
            avg_confidence
        );
    } else {
        debug!(
            "Vision OCR extracted {} chars, {} observations, avg confidence {:.2}",
            combined_text.len(),
            observations.len(),
            avg_confidence
        );
    }
    
    Ok(VisionOcrResult {
        text: combined_text,
        confidence: avg_confidence,
        observations,
    })
}

/// Check if Vision framework is available on this system
#[cfg(target_os = "macos")]
pub fn is_vision_available() -> bool {
    // class! macro will panic if class doesn't exist, so we use get() instead
    use objc2::runtime::AnyClass;
    AnyClass::get("VNRecognizeTextRequest").is_some()
}

#[cfg(not(target_os = "macos"))]
pub fn is_vision_available() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn recognize_text(
    _image_data: &[u8],
    _level: VNRequestTextRecognitionLevel,
) -> Result<VisionOcrResult, String> {
    Err("Vision framework is only available on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_vision_available() {
        // This should return true on macOS
        #[cfg(target_os = "macos")]
        assert!(is_vision_available());
        
        #[cfg(not(target_os = "macos"))]
        assert!(!is_vision_available());
    }
    
    #[test]
    fn test_empty_result_default() {
        let result = VisionOcrResult::default();
        assert!(result.text.is_empty());
        assert_eq!(result.confidence, 0.0);
        assert!(result.observations.is_empty());
    }
}
