import Foundation

struct CLIArgs {
    let inputPath: String
    let appBundleId: String?
    let appName: String?
    let windowTitle: String?
    let maxElements: Int
}

private func value(after index: Int, in args: [String], flag: String) throws -> String {
    let nextIndex = index + 1
    guard nextIndex < args.count else {
        throw NSError(domain: "ritual.vision", code: 10, userInfo: [
            NSLocalizedDescriptionKey: "Missing value for \(flag)"
        ])
    }
    return args[nextIndex]
}

func parseArgs() throws -> CLIArgs {
    let args = Array(CommandLine.arguments.dropFirst())
    var inputPath: String?
    var appBundleId: String?
    var appName: String?
    var windowTitle: String?
    var maxElements = 128

    var index = 0
    while index < args.count {
        switch args[index] {
        case "--input":
            inputPath = try value(after: index, in: args, flag: "--input")
            index += 2
        case "--app-bundle-id":
            appBundleId = try value(after: index, in: args, flag: "--app-bundle-id")
            index += 2
        case "--app-name":
            appName = try value(after: index, in: args, flag: "--app-name")
            index += 2
        case "--window-title":
            windowTitle = try value(after: index, in: args, flag: "--window-title")
            index += 2
        case "--max-elements":
            let raw = try value(after: index, in: args, flag: "--max-elements")
            maxElements = max(1, min(256, Int(raw) ?? 128))
            index += 2
        default:
            throw NSError(domain: "ritual.vision", code: 11, userInfo: [
                NSLocalizedDescriptionKey: "Unknown argument \(args[index])"
            ])
        }
    }

    guard let inputPath, !inputPath.isEmpty else {
        throw NSError(domain: "ritual.vision", code: 12, userInfo: [
            NSLocalizedDescriptionKey: "Missing required --input argument"
        ])
    }

    return CLIArgs(
        inputPath: inputPath,
        appBundleId: appBundleId,
        appName: appName,
        windowTitle: windowTitle,
        maxElements: maxElements
    )
}

func main() throws {
    let cliArgs = try parseArgs()
    let imageURL = URL(fileURLWithPath: cliArgs.inputPath)
    let result = try performVisionOCR(imageURL: imageURL, maxElements: cliArgs.maxElements)
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    let data = try encoder.encode(result)
    if let output = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(output.data(using: .utf8)!)
    }
}

do {
    try main()
} catch {
    fputs("ritual-vision-helper error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
