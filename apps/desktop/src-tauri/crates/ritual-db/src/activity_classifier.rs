//! Activity Classification Module
//!
//! Classifies screen recording frames into activity types based on:
//! - App bundle ID / app name
//! - Window title patterns
//! - OCR text keywords
//!
//! This is a fast, rule-based classifier that runs locally without ML models.
//! It provides useful filtering and categorization for search.

/// Activity types that can be detected
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum ActivityType {
    /// Writing/editing code in an IDE or editor
    Coding = 0,
    /// Using a web browser
    Browsing = 1,
    /// Email or calendar applications
    Communication = 2,
    /// Messaging apps (Slack, Discord, Messages, etc.)
    Messaging = 3,
    /// Document editing (Word, Google Docs, Notion, etc.)
    Documents = 4,
    /// Video calls and meetings
    VideoCall = 5,
    /// Terminal/command line usage
    Terminal = 6,
    /// Design tools (Figma, Sketch, etc.)
    Design = 7,
    /// Media consumption (videos, music, etc.)
    Media = 8,
    /// File management (Finder, file browsers)
    FileManagement = 9,
    /// System settings and preferences
    System = 10,
    /// Reading (PDFs, ebooks, articles)
    Reading = 11,
    /// Spreadsheets and data analysis
    Spreadsheets = 12,
    /// Unknown or unclassified activity
    Other = 255,
}

impl ActivityType {
    /// Get the string representation of the activity type
    pub fn as_str(&self) -> &'static str {
        match self {
            ActivityType::Coding => "coding",
            ActivityType::Browsing => "browsing",
            ActivityType::Communication => "communication",
            ActivityType::Messaging => "messaging",
            ActivityType::Documents => "documents",
            ActivityType::VideoCall => "video_call",
            ActivityType::Terminal => "terminal",
            ActivityType::Design => "design",
            ActivityType::Media => "media",
            ActivityType::FileManagement => "file_management",
            ActivityType::System => "system",
            ActivityType::Reading => "reading",
            ActivityType::Spreadsheets => "spreadsheets",
            ActivityType::Other => "other",
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "coding" => ActivityType::Coding,
            "browsing" => ActivityType::Browsing,
            "communication" => ActivityType::Communication,
            "messaging" => ActivityType::Messaging,
            "documents" => ActivityType::Documents,
            "video_call" => ActivityType::VideoCall,
            "terminal" => ActivityType::Terminal,
            "design" => ActivityType::Design,
            "media" => ActivityType::Media,
            "file_management" => ActivityType::FileManagement,
            "system" => ActivityType::System,
            "reading" => ActivityType::Reading,
            "spreadsheets" => ActivityType::Spreadsheets,
            _ => ActivityType::Other,
        }
    }

    /// Get a human-readable label
    pub fn label(&self) -> &'static str {
        match self {
            ActivityType::Coding => "Coding",
            ActivityType::Browsing => "Browsing",
            ActivityType::Communication => "Email & Calendar",
            ActivityType::Messaging => "Messaging",
            ActivityType::Documents => "Documents",
            ActivityType::VideoCall => "Video Calls",
            ActivityType::Terminal => "Terminal",
            ActivityType::Design => "Design",
            ActivityType::Media => "Media",
            ActivityType::FileManagement => "Files",
            ActivityType::System => "System",
            ActivityType::Reading => "Reading",
            ActivityType::Spreadsheets => "Spreadsheets",
            ActivityType::Other => "Other",
        }
    }
}

/// Classification result with confidence
#[derive(Debug, Clone)]
pub struct ClassificationResult {
    /// Primary detected activity type
    pub activity_type: ActivityType,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
    /// Secondary activity types that were also detected
    pub secondary_types: Vec<ActivityType>,
    /// Specific subcategory (e.g., "github" for browsing, "react" for coding)
    pub subcategory: Option<String>,
}

/// Classify activity based on app, window title, and OCR text
pub fn classify_activity(
    app_bundle_id: &str,
    app_name: &str,
    window_title: Option<&str>,
    ocr_text: Option<&str>,
) -> ClassificationResult {
    let mut scores: Vec<(ActivityType, f64)> = Vec::new();
    let mut subcategory: Option<String> = None;

    let bundle_lower = app_bundle_id.to_lowercase();
    let app_lower = app_name.to_lowercase();
    let title_lower = window_title.map(|t| t.to_lowercase()).unwrap_or_default();
    let ocr_lower = ocr_text.map(|t| t.to_lowercase()).unwrap_or_default();

    // ==== Coding Detection ====
    let coding_score = detect_coding(&bundle_lower, &app_lower, &title_lower, &ocr_lower);
    if coding_score > 0.0 {
        scores.push((ActivityType::Coding, coding_score));

        // Detect language/framework subcategory
        subcategory = detect_coding_subcategory(&title_lower, &ocr_lower);
    }

    // ==== Terminal Detection ====
    let terminal_score = detect_terminal(&bundle_lower, &app_lower, &title_lower);
    if terminal_score > 0.0 {
        scores.push((ActivityType::Terminal, terminal_score));
    }

    // ==== Browsing Detection ====
    let browsing_score = detect_browsing(&bundle_lower, &app_lower);
    if browsing_score > 0.0 {
        scores.push((ActivityType::Browsing, browsing_score));

        // Detect website subcategory
        if subcategory.is_none() {
            subcategory = detect_browsing_subcategory(&title_lower);
        }
    }

    // ==== Communication Detection (Email/Calendar) ====
    let comm_score = detect_communication(&bundle_lower, &app_lower, &title_lower);
    if comm_score > 0.0 {
        scores.push((ActivityType::Communication, comm_score));
    }

    // ==== Messaging Detection ====
    let messaging_score = detect_messaging(&bundle_lower, &app_lower, &title_lower);
    if messaging_score > 0.0 {
        scores.push((ActivityType::Messaging, messaging_score));
    }

    // ==== Video Call Detection ====
    let video_score = detect_video_call(&bundle_lower, &app_lower, &title_lower);
    if video_score > 0.0 {
        scores.push((ActivityType::VideoCall, video_score));
    }

    // ==== Documents Detection ====
    let docs_score = detect_documents(&bundle_lower, &app_lower, &title_lower);
    if docs_score > 0.0 {
        scores.push((ActivityType::Documents, docs_score));
    }

    // ==== Spreadsheets Detection ====
    let spreadsheet_score = detect_spreadsheets(&bundle_lower, &app_lower, &title_lower);
    if spreadsheet_score > 0.0 {
        scores.push((ActivityType::Spreadsheets, spreadsheet_score));
    }

    // ==== Design Detection ====
    let design_score = detect_design(&bundle_lower, &app_lower, &title_lower);
    if design_score > 0.0 {
        scores.push((ActivityType::Design, design_score));
    }

    // ==== Media Detection ====
    let media_score = detect_media(&bundle_lower, &app_lower, &title_lower);
    if media_score > 0.0 {
        scores.push((ActivityType::Media, media_score));
    }

    // ==== File Management Detection ====
    let files_score = detect_file_management(&bundle_lower, &app_lower);
    if files_score > 0.0 {
        scores.push((ActivityType::FileManagement, files_score));
    }

    // ==== System Detection ====
    let system_score = detect_system(&bundle_lower, &app_lower, &title_lower);
    if system_score > 0.0 {
        scores.push((ActivityType::System, system_score));
    }

    // ==== Reading Detection ====
    let reading_score = detect_reading(&bundle_lower, &app_lower, &title_lower);
    if reading_score > 0.0 {
        scores.push((ActivityType::Reading, reading_score));
    }

    // Sort by score descending
    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Get primary type (highest score)
    let (primary_type, confidence) = scores
        .first()
        .cloned()
        .unwrap_or((ActivityType::Other, 0.0));

    // Get secondary types (other high-scoring types)
    let secondary_types: Vec<ActivityType> = scores
        .iter()
        .skip(1)
        .filter(|(_, score)| *score >= 0.3)
        .map(|(t, _)| *t)
        .collect();

    ClassificationResult {
        activity_type: primary_type,
        confidence,
        secondary_types,
        subcategory,
    }
}

// ==== Detection Functions ====

fn detect_coding(bundle: &str, app: &str, title: &str, ocr: &str) -> f64 {
    let ide_bundles = [
        "com.microsoft.vscode",
        "com.cursor",
        "com.jetbrains",
        "com.apple.dt.xcode",
        "com.sublimetext",
        "com.vim",
        "org.vim",
        "com.neovim",
        "io.neovim",
        "com.github.atom",
        "com.googlecode.iterm2",
        "com.apple.terminal",
    ];

    let ide_apps = [
        "code",
        "cursor",
        "intellij",
        "pycharm",
        "webstorm",
        "goland",
        "clion",
        "rider",
        "phpstorm",
        "rubymine",
        "datagrip",
        "xcode",
        "sublime",
        "atom",
        "vim",
        "neovim",
        "emacs",
        "android studio",
        "visual studio",
    ];

    // Strong match: IDE bundle
    for b in ide_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    // Strong match: IDE app name
    for a in ide_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    let code_title_patterns = [
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".swift", ".kt", ".rb", ".php",
        ".cpp", ".c", ".h", ".cs", ".vue", ".svelte", ".html", ".css", ".scss", ".json", ".yaml",
        ".toml", ".md", ".sql", "main.rs", "index.ts", "app.tsx",
    ];

    for pattern in code_title_patterns {
        if title.contains(pattern) {
            return 0.85;
        }
    }

    // OCR patterns (code-like content)
    let code_ocr_patterns = [
        "function ",
        "const ",
        "let ",
        "var ",
        "import ",
        "export ",
        "class ",
        "struct ",
        "impl ",
        "fn ",
        "def ",
        "async ",
        "await",
        "return ",
        "if (",
        "for (",
        "while (",
        "=>",
        "->",
        "::",
        "pub fn",
        "pub struct",
        "pub enum",
        "interface ",
        "type ",
    ];

    for pattern in code_ocr_patterns {
        if ocr.contains(pattern) {
            return 0.75;
        }
    }

    0.0
}

fn detect_coding_subcategory(title: &str, ocr: &str) -> Option<String> {
    let combined = format!("{} {}", title, ocr);

    // Language detection
    if combined.contains(".rs") || combined.contains("rust") || combined.contains("cargo") {
        return Some("rust".to_string());
    }
    if combined.contains(".tsx") || combined.contains(".ts") || combined.contains("typescript") {
        return Some("typescript".to_string());
    }
    if combined.contains("react") || combined.contains(".jsx") {
        return Some("react".to_string());
    }
    if combined.contains(".py") || combined.contains("python") {
        return Some("python".to_string());
    }
    if combined.contains(".go") || combined.contains("golang") {
        return Some("go".to_string());
    }
    if combined.contains(".swift") || combined.contains("swiftui") {
        return Some("swift".to_string());
    }

    None
}

fn detect_terminal(bundle: &str, app: &str, title: &str) -> f64 {
    let terminal_bundles = [
        "com.apple.terminal",
        "com.googlecode.iterm2",
        "net.kovidgoyal.kitty",
        "com.github.wez.wezterm",
        "co.zeit.hyper",
        "io.alacritty",
    ];

    for b in terminal_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let terminal_apps = [
        "terminal",
        "iterm",
        "kitty",
        "wezterm",
        "hyper",
        "alacritty",
    ];
    for a in terminal_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns for terminal
    if title.contains("bash")
        || title.contains("zsh")
        || title.contains("fish")
        || title.contains("~$")
        || title.contains("ssh ")
    {
        return 0.85;
    }

    0.0
}

fn detect_browsing(bundle: &str, app: &str) -> f64 {
    let browser_bundles = [
        "com.google.chrome",
        "com.apple.safari",
        "org.mozilla.firefox",
        "com.microsoft.edgemac",
        "com.brave.browser",
        "com.operasoftware.opera",
        "com.vivaldi.vivaldi",
        "company.thebrowser.browser",
    ];

    for b in browser_bundles {
        if bundle.contains(b) {
            return 0.9;
        }
    }

    let browser_apps = [
        "chrome", "safari", "firefox", "edge", "brave", "opera", "vivaldi", "arc",
    ];
    for a in browser_apps {
        if app.contains(a) {
            return 0.85;
        }
    }

    0.0
}

fn detect_browsing_subcategory(title: &str) -> Option<String> {
    // Social media
    if title.contains("twitter") || title.contains("x.com") {
        return Some("twitter".to_string());
    }
    if title.contains("linkedin") {
        return Some("linkedin".to_string());
    }
    if title.contains("facebook") || title.contains("meta") {
        return Some("facebook".to_string());
    }

    // Dev sites
    if title.contains("github") {
        return Some("github".to_string());
    }
    if title.contains("stackoverflow") || title.contains("stack overflow") {
        return Some("stackoverflow".to_string());
    }

    // Docs
    if title.contains("documentation") || title.contains("docs.") {
        return Some("documentation".to_string());
    }

    // News
    if title.contains("news") || title.contains("hn ") || title.contains("hacker news") {
        return Some("news".to_string());
    }

    None
}

fn detect_communication(bundle: &str, app: &str, title: &str) -> f64 {
    let email_bundles = [
        "com.apple.mail",
        "com.microsoft.outlook",
        "com.google.gmail",
        "com.readdle.smartemail",
        "com.freron.mailmate",
        "com.superhuman",
    ];

    for b in email_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let email_apps = ["mail", "outlook", "gmail", "superhuman", "spark", "airmail"];
    for a in email_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Calendar
    let calendar_bundles = ["com.apple.ical", "com.flexibits.fantastical"];
    for b in calendar_bundles {
        if bundle.contains(b) {
            return 0.9;
        }
    }

    if app.contains("calendar") || app.contains("fantastical") {
        return 0.85;
    }

    // Title patterns
    if title.contains("inbox") || title.contains("compose") || title.contains("email") {
        return 0.75;
    }

    0.0
}

fn detect_messaging(bundle: &str, app: &str, title: &str) -> f64 {
    let messaging_bundles = [
        "com.tinyspeck.slackmacgap",
        "com.discord",
        "com.hnc.discord",
        "com.apple.imessage",
        "com.apple.messages",
        "com.whatsapp",
        "org.telegram.desktop",
        "com.microsoft.teams",
    ];

    for b in messaging_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let messaging_apps = [
        "slack", "discord", "messages", "imessage", "whatsapp", "telegram", "teams", "signal",
    ];
    for a in messaging_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains("slack -") || title.contains("discord -") || title.contains("#") {
        return 0.8;
    }

    0.0
}

fn detect_video_call(bundle: &str, app: &str, title: &str) -> f64 {
    let video_bundles = [
        "us.zoom.xos",
        "com.google.chrome.app.zoom",
        "com.microsoft.teams",
        "com.apple.facetime",
        "com.loom",
        "com.webex",
    ];

    for b in video_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let video_apps = ["zoom", "facetime", "meet", "webex", "loom"];
    for a in video_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains("meeting") || title.contains("call with") || title.contains("video call") {
        return 0.75;
    }

    0.0
}

fn detect_documents(bundle: &str, app: &str, title: &str) -> f64 {
    let doc_bundles = [
        "com.microsoft.word",
        "com.apple.pages",
        "com.notion",
        "md.obsidian",
        "com.craft.craft",
        "com.notion.id",
    ];

    for b in doc_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let doc_apps = [
        "word", "pages", "notion", "obsidian", "craft", "bear", "ulysses",
    ];
    for a in doc_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains(".doc") || title.contains("google docs") || title.contains("notion -") {
        return 0.8;
    }

    0.0
}

fn detect_spreadsheets(bundle: &str, app: &str, title: &str) -> f64 {
    let sheet_bundles = ["com.microsoft.excel", "com.apple.numbers", "com.airtable"];

    for b in sheet_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let sheet_apps = ["excel", "numbers", "sheets", "airtable"];
    for a in sheet_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains(".xlsx") || title.contains(".csv") || title.contains("google sheets") {
        return 0.8;
    }

    0.0
}

fn detect_design(bundle: &str, app: &str, title: &str) -> f64 {
    let design_bundles = [
        "com.figma.desktop",
        "com.bohemiancoding.sketch3",
        "com.adobe.photoshop",
        "com.adobe.illustrator",
        "com.adobe.xd",
        "com.canva",
    ];

    for b in design_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let design_apps = [
        "figma",
        "sketch",
        "photoshop",
        "illustrator",
        "xd",
        "canva",
        "affinity",
        "pixelmator",
        "procreate",
    ];
    for a in design_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains(".psd") || title.contains(".sketch") || title.contains(".fig") {
        return 0.8;
    }

    0.0
}

fn detect_media(bundle: &str, app: &str, title: &str) -> f64 {
    let media_bundles = [
        "com.spotify.client",
        "com.apple.music",
        "com.apple.quicktimeplayer",
        "org.videolan.vlc",
        "com.colliderli.iina",
        "com.netflix",
        "com.apple.tv",
        "com.youtube",
    ];

    for b in media_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let media_apps = [
        "spotify",
        "music",
        "vlc",
        "iina",
        "quicktime",
        "netflix",
        "youtube",
        "plex",
        "infuse",
    ];
    for a in media_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains("- youtube") || title.contains("netflix") || title.contains("now playing") {
        return 0.75;
    }

    0.0
}

fn detect_file_management(bundle: &str, app: &str) -> f64 {
    let file_bundles = ["com.apple.finder", "com.panic.transmit", "app.cyberduck"];

    for b in file_bundles {
        if bundle.contains(b) {
            return 0.9;
        }
    }

    let file_apps = ["finder", "transmit", "cyberduck", "forklift", "pathfinder"];
    for a in file_apps {
        if app.contains(a) {
            return 0.85;
        }
    }

    0.0
}

fn detect_system(bundle: &str, app: &str, title: &str) -> f64 {
    let system_bundles = [
        "com.apple.systempreferences",
        "com.apple.systemsettings",
        "com.apple.activitymonitor",
        "com.apple.console",
    ];

    for b in system_bundles {
        if bundle.contains(b) {
            return 0.95;
        }
    }

    let system_apps = [
        "system preferences",
        "system settings",
        "activity monitor",
        "console",
    ];
    for a in system_apps {
        if app.contains(a) {
            return 0.9;
        }
    }

    // Title patterns
    if title.contains("preferences") || title.contains("settings") {
        return 0.6;
    }

    0.0
}

fn detect_reading(bundle: &str, app: &str, title: &str) -> f64 {
    let reading_bundles = [
        "com.apple.preview",
        "com.apple.books",
        "com.readdle.pdfexpert",
        "com.adobe.reader",
        "com.kindle",
    ];

    for b in reading_bundles {
        if bundle.contains(b) {
            return 0.9;
        }
    }

    let reading_apps = ["preview", "books", "kindle", "pdf expert", "adobe reader"];
    for a in reading_apps {
        if app.contains(a) {
            return 0.85;
        }
    }

    // Title patterns
    if title.contains(".pdf") || title.contains(".epub") {
        return 0.8;
    }

    0.0
}

/// Get all activity types for filtering UI
pub fn all_activity_types() -> Vec<ActivityType> {
    vec![
        ActivityType::Coding,
        ActivityType::Browsing,
        ActivityType::Communication,
        ActivityType::Messaging,
        ActivityType::Documents,
        ActivityType::VideoCall,
        ActivityType::Terminal,
        ActivityType::Design,
        ActivityType::Media,
        ActivityType::FileManagement,
        ActivityType::System,
        ActivityType::Reading,
        ActivityType::Spreadsheets,
        ActivityType::Other,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_coding_vscode() {
        let result = classify_activity(
            "com.microsoft.VSCode",
            "Code",
            Some("main.rs - ritual-desktop"),
            Some("fn main() { println!(\"Hello\"); }"),
        );

        assert_eq!(result.activity_type, ActivityType::Coding);
        assert!(result.confidence > 0.8);
    }

    #[test]
    fn test_classify_coding_cursor() {
        let result = classify_activity(
            "com.todesktop.230313mzl4w4u92",
            "Cursor",
            Some("vector.rs - ritual-db"),
            None,
        );

        // Cursor's bundle ID is unusual, but title has .rs
        assert_eq!(result.activity_type, ActivityType::Coding);
    }

    #[test]
    fn test_classify_browsing_chrome() {
        let result = classify_activity(
            "com.google.Chrome",
            "Google Chrome",
            Some("GitHub - ritual-desktop"),
            None,
        );

        assert_eq!(result.activity_type, ActivityType::Browsing);
        assert!(result.confidence > 0.8);
        assert_eq!(result.subcategory, Some("github".to_string()));
    }

    #[test]
    fn test_classify_messaging_slack() {
        let result = classify_activity(
            "com.tinyspeck.slackmacgap",
            "Slack",
            Some("ritual-team - Slack"),
            None,
        );

        assert_eq!(result.activity_type, ActivityType::Messaging);
        assert!(result.confidence > 0.9);
    }

    #[test]
    fn test_classify_video_call_zoom() {
        let result = classify_activity("us.zoom.xos", "zoom.us", Some("Meeting with team"), None);

        assert_eq!(result.activity_type, ActivityType::VideoCall);
    }

    #[test]
    fn test_activity_type_roundtrip() {
        for activity_type in all_activity_types() {
            let s = activity_type.as_str();
            let parsed = ActivityType::from_str(s);
            assert_eq!(activity_type, parsed);
        }
    }
}
