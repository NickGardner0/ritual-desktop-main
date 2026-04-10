import Foundation

/// Renders filename + folder templates with date tokens and sanitizes the
/// result so user input cannot escape the export destination directory.
///
/// Supported tokens (all optional):
///   {date}    → yyyy-MM-dd
///   {year}    → yyyy
///   {month}   → MM
///   {day}     → dd
///   {weekday} → EEEE (locale-independent English)
///   {iso}     → yyyy-MM-dd (alias for {date}, matches common note-taker conventions)
///
/// Sanitization rules (applied to each path component, never across):
///   - Reject `..` segments (path traversal)
///   - Reject absolute paths (leading `/`)
///   - Strip reserved characters: `:` `\` `|` `?` `*` `<` `>` `"` and control chars
///   - Collapse whitespace runs to single space, trim
///   - Empty components after sanitization fall back to `{date}`
enum FilenameTemplate {

    /// Render a template into a single filename stem (no extension, no folders).
    /// Any `/` in the template is treated as literal and stripped.
    static func renderFilename(_ template: String, date: Date, calendar: Calendar = .current) -> String {
        let rendered = applyTokens(template, date: date, calendar: calendar)
        let flattened = rendered.replacingOccurrences(of: "/", with: "-")
        let sanitized = sanitizeComponent(flattened)
        if sanitized.isEmpty {
            return isoDate(date, calendar: calendar)
        }
        return sanitized
    }

    /// Render a folder-structure template into an ordered list of sanitized
    /// path components. Empty or purely whitespace components are dropped.
    /// Any component that sanitizes to empty, `.`, or `..` is rejected (returns nil).
    static func renderFolderComponents(_ template: String, date: Date, calendar: Calendar = .current) -> [String]? {
        let rendered = applyTokens(template, date: date, calendar: calendar)
        guard !rendered.isEmpty else { return [] }
        if rendered.hasPrefix("/") { return nil }

        var components: [String] = []
        for raw in rendered.split(separator: "/", omittingEmptySubsequences: true) {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            if trimmed == "." || trimmed == ".." { return nil }
            let cleaned = sanitizeComponent(trimmed)
            if cleaned.isEmpty { return nil }
            if cleaned == "." || cleaned == ".." { return nil }
            components.append(cleaned)
        }
        return components
    }

    // MARK: - Internals

    private static func applyTokens(_ template: String, date: Date, calendar: Calendar) -> String {
        guard !template.isEmpty else { return "" }

        let isoFormatter = DateFormatter()
        isoFormatter.calendar = calendar
        isoFormatter.locale = Locale(identifier: "en_US_POSIX")
        isoFormatter.timeZone = calendar.timeZone

        var output = template

        isoFormatter.dateFormat = "yyyy-MM-dd"
        let isoString = isoFormatter.string(from: date)
        output = output.replacingOccurrences(of: "{date}", with: isoString)
        output = output.replacingOccurrences(of: "{iso}", with: isoString)

        isoFormatter.dateFormat = "yyyy"
        output = output.replacingOccurrences(of: "{year}", with: isoFormatter.string(from: date))

        isoFormatter.dateFormat = "MM"
        output = output.replacingOccurrences(of: "{month}", with: isoFormatter.string(from: date))

        isoFormatter.dateFormat = "dd"
        output = output.replacingOccurrences(of: "{day}", with: isoFormatter.string(from: date))

        isoFormatter.dateFormat = "EEEE"
        output = output.replacingOccurrences(of: "{weekday}", with: isoFormatter.string(from: date))

        return output
    }

    /// Reserved characters that are unsafe on iOS/macOS/Windows file systems.
    /// `/` is intentionally NOT in this set — folder renderer splits on `/` first.
    private static let reservedCharacters: Set<Character> = [":", "\\", "|", "?", "*", "<", ">", "\""]

    private static func sanitizeComponent(_ input: String) -> String {
        var scalars = String.UnicodeScalarView()
        var lastWasSpace = false

        for scalar in input.unicodeScalars {
            let char = Character(scalar)

            if scalar.value < 0x20 || scalar.value == 0x7F {
                continue // drop control chars
            }
            if reservedCharacters.contains(char) {
                continue
            }
            if scalar == " " {
                if lastWasSpace { continue }
                lastWasSpace = true
                scalars.append(scalar)
                continue
            }
            lastWasSpace = false
            scalars.append(scalar)
        }

        let trimmed = String(scalars).trimmingCharacters(in: .whitespaces)
        // Defense-in-depth: even if a caller hands us a raw ".." after token expansion,
        // never return it as-is.
        if trimmed == "." || trimmed == ".." { return "" }
        return trimmed
    }

    private static func isoDate(_ date: Date, calendar: Calendar) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
