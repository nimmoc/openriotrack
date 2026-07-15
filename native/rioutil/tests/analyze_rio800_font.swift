import AppKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fputs("usage: analyze_rio800_font <2048-byte-header> <four-character-title>\n", stderr)
    exit(2)
}

let header = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
guard header.count == 2048 else {
    fputs("header must be exactly 2048 bytes\n", stderr)
    exit(2)
}

let width = 56
let height = 11
let glyphDataOffset = 0x200
var expected = Array(repeating: false, count: width * height)

for x in 0..<width {
    let offset = glyphDataOffset + x * 2
    let column = UInt16(header[offset]) | (UInt16(header[offset + 1]) << 8)
    for y in 0..<height {
        expected[y * width + x] = column & (1 << (height - 1 - y)) != 0
    }
}

func render(title: String, fontName: String, fontSize: CGFloat, xOffset: CGFloat, yOffset: CGFloat) -> [Bool]? {
    guard let font = NSFont(name: fontName, size: fontSize),
          let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: width,
            pixelsHigh: height,
            bitsPerSample: 8,
            samplesPerPixel: 1,
            hasAlpha: false,
            isPlanar: false,
            colorSpaceName: .deviceWhite,
            bytesPerRow: width,
            bitsPerPixel: 8
          ),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        return nil
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.shouldAntialias = false
    context.cgContext.setShouldAntialias(false)
    context.cgContext.setAllowsAntialiasing(false)
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()

    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.black
    ]
    (title as NSString).draw(at: NSPoint(x: xOffset, y: yOffset), withAttributes: attributes)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    var pixels = Array(repeating: false, count: width * height)
    for y in 0..<height {
        for x in 0..<width {
            let sourceY = height - 1 - y
            pixels[y * width + x] = (bitmap.colorAt(x: x, y: sourceY)?.whiteComponent ?? 1) < 0.5
        }
    }
    return pixels
}

let fontNames = [
    "Songti SC",
    "STSongti-SC-Regular",
    "STSongti-SC-Light",
    "PingFang SC",
    "PingFangSC-Regular",
    "PingFangSC-Ultralight",
    "PingFangSC-Thin",
    "PingFangSC-Light",
    "Heiti SC",
    "STHeitiSC-Light"
]

var best: (distance: Int, font: String, size: CGFloat, x: CGFloat, y: CGFloat, pixels: [Bool])?
var candidates: [(distance: Int, font: String, size: CGFloat, x: CGFloat, y: CGFloat, pixels: Int)] = []
for fontName in fontNames {
    for size in stride(from: CGFloat(10), through: CGFloat(16), by: 0.5) {
        for xOffset in stride(from: CGFloat(-2), through: CGFloat(1), by: 1) {
            for yOffset in stride(from: CGFloat(-5), through: CGFloat(1), by: 1) {
                guard let pixels = render(
                    title: arguments[2],
                    fontName: fontName,
                    fontSize: size,
                    xOffset: xOffset,
                    yOffset: yOffset
                ) else {
                    continue
                }
                let distance = zip(expected, pixels).reduce(0) { $0 + ($1.0 == $1.1 ? 0 : 1) }
                candidates.append((distance, fontName, size, xOffset, yOffset,
                                   pixels.reduce(0) { $0 + ($1 ? 1 : 0) }))
                if best == nil || distance < best!.distance {
                    best = (distance, fontName, size, xOffset, yOffset, pixels)
                }
            }
        }
    }
}

guard let best else {
    fputs("no candidate font was available\n", stderr)
    exit(1)
}

let expectedPixels = expected.reduce(0) { $0 + ($1 ? 1 : 0) }
let renderedPixels = best.pixels.reduce(0) { $0 + ($1 ? 1 : 0) }
print("distance=\(best.distance) expectedPixels=\(expectedPixels) renderedPixels=\(renderedPixels) font=\(best.font) size=\(best.size) x=\(best.x) y=\(best.y)")
for candidate in candidates.sorted(by: { $0.distance < $1.distance }).prefix(12) {
    print("candidate distance=\(candidate.distance) pixels=\(candidate.pixels) font=\(candidate.font) size=\(candidate.size) x=\(candidate.x) y=\(candidate.y)")
}
for y in 0..<height {
    print((0..<width).map { best.pixels[y * width + $0] ? "##" : "  " }.joined())
}
