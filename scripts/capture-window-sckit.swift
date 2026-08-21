import AppKit
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

enum CaptureError: Error, CustomStringConvertible {
    case missingArguments
    case invalidWindowID(String)
    case windowNotFound(CGWindowID)
    case noPixelData(String)
    case blackCapture(Double)

    var description: String {
        switch self {
        case .missingArguments:
            return "usage: capture-window-sckit <window-id> <output.png>"
        case let .invalidWindowID(value):
            return "invalid window id: \(value)"
        case let .windowNotFound(windowID):
            return "ScreenCaptureKit could not find window id \(windowID)"
        case let .noPixelData(path):
            return "could not read captured PNG pixel data: \(path)"
        case let .blackCapture(luma):
            return "ScreenCaptureKit returned a black capture; average luminance \(String(format: "%.2f", luma))"
        }
    }
}

@main
struct CaptureWindow {
    static func main() async {
        do {
            try await run()
        } catch {
            fputs("\(error)\n", stderr)
            exit(1)
        }
    }

    private static func run() async throws {
        guard CommandLine.arguments.count == 3 else {
            throw CaptureError.missingArguments
        }

        guard let rawID = UInt32(CommandLine.arguments[1]) else {
            throw CaptureError.invalidWindowID(CommandLine.arguments[1])
        }

        let windowID = CGWindowID(rawID)
        let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
        NSApplication.shared.setActivationPolicy(.prohibited)
        fputs("sckit: loading shareable content\n", stderr)
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        fputs("sckit: found \(content.windows.count) windows\n", stderr)
        guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
            throw CaptureError.windowNotFound(windowID)
        }

        fputs("sckit: creating window filter\n", stderr)
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = CGFloat(filter.pointPixelScale > 0 ? filter.pointPixelScale : 2)
        let width = max(1, Int((filter.contentRect.width * scale).rounded()))
        let height = max(1, Int((filter.contentRect.height * scale).rounded()))

        fputs("sckit: configuring \(width)x\(height)\n", stderr)
        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.scalesToFit = false
        configuration.showsCursor = false
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        if #available(macOS 15.0, *) {
            configuration.captureDynamicRange = .SDR
        }

        fputs("sckit: capturing image\n", stderr)
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        fputs("sckit: writing png\n", stderr)
        try writePng(image: image, outputURL: outputURL)

        fputs("sckit: validating pixels\n", stderr)
        let averageLuma = try averageLuminance(image: image)
        guard averageLuma > 8 else {
            throw CaptureError.blackCapture(averageLuma)
        }
    }

    private static func writePng(image: CGImage, outputURL: URL) throws {
        guard let destination = CGImageDestinationCreateWithURL(
            outputURL as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else {
            throw CaptureError.noPixelData(outputURL.path)
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw CaptureError.noPixelData(outputURL.path)
        }
    }

    private static func averageLuminance(image: CGImage) throws -> Double {
        let width = image.width
        let height = image.height
        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw CaptureError.noPixelData("CGContext")
        }

        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        var total = 0.0
        var count = 0
        let step = max(1, min(width, height) / 80)
        for y in stride(from: 0, to: height, by: step) {
            for x in stride(from: 0, to: width, by: step) {
                let index = y * bytesPerRow + x * bytesPerPixel
                let red = Double(pixels[index])
                let green = Double(pixels[index + 1])
                let blue = Double(pixels[index + 2])
                total += 0.2126 * red + 0.7152 * green + 0.0722 * blue
                count += 1
            }
        }
        return total / Double(count)
    }
}
