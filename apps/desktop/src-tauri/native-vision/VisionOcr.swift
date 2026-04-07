import AppKit
import Foundation
import Vision

struct VisionCaptureBBox: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct VisionCaptureElement: Codable {
    let text: String
    let confidence: Double?
    let bbox: VisionCaptureBBox
}

struct VisionCaptureOutput: Codable {
    let schemaVersion: Int
    let engine: String
    let visibleTextRaw: String
    let overallConfidence: Double?
    let elements: [VisionCaptureElement]
}

private func loadCGImage(from imageURL: URL) throws -> CGImage {
    guard let nsImage = NSImage(contentsOf: imageURL) else {
        throw NSError(domain: "ritual.vision", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Unable to load image at \(imageURL.path)"
        ])
    }
    var proposedRect = CGRect(origin: .zero, size: nsImage.size)
    guard let cgImage = nsImage.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
        throw NSError(domain: "ritual.vision", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "Unable to create CGImage for \(imageURL.path)"
        ])
    }
    return cgImage
}

func performVisionOCR(imageURL: URL, maxElements: Int) throws -> VisionCaptureOutput {
    let cgImage = try loadCGImage(from: imageURL)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .fast
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.012
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
    var elements: [VisionCaptureElement] = []
    var textParts: [String] = []
    var totalConfidence = 0.0
    var confidenceCount = 0.0

    for observation in observations.prefix(maxElements) {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            continue
        }
        let bbox = observation.boundingBox
        elements.append(
            VisionCaptureElement(
                text: text,
                confidence: Double(candidate.confidence),
                bbox: VisionCaptureBBox(
                    x: Double(bbox.origin.x),
                    y: Double(bbox.origin.y),
                    width: Double(bbox.size.width),
                    height: Double(bbox.size.height)
                )
            )
        )
        textParts.append(text)
        totalConfidence += Double(candidate.confidence)
        confidenceCount += 1.0
    }

    return VisionCaptureOutput(
        schemaVersion: 1,
        engine: "apple_vision",
        visibleTextRaw: textParts.joined(separator: "\n"),
        overallConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : nil,
        elements: elements
    )
}
