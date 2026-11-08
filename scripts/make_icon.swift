import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Renders the LahLah Video icon in the LahLah family style (same grid, paper, white disc and
// ember ring as LahLah Voice's scripts/make_icon.swift): a play button in the ring and timeline
// clips where LahLah Voice has its sound wave.
// Usage: swift scripts/make_icon.swift <output.png> [--rounded]
// App Store icons must be opaque and square. The macOS icon gets its own rounded shape.

let arguments = CommandLine.arguments
let output = URL(fileURLWithPath: arguments[1])
let rounded = arguments.contains("--rounded")
let size = 1024
let side = CGFloat(size)

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let alpha: CGImageAlphaInfo = rounded ? .premultipliedLast : .noneSkipLast
let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
    bitmapInfo: alpha.rawValue)!

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: space, components: [r, g, b, a])!
}

let ink = color(0.11, 0.106, 0.098)
let ember = color(0.91, 0.455, 0.231)

if rounded {
    // macOS icon grid: 824pt shape centred in the 1024pt canvas.
    let inset: CGFloat = 100
    let rect = CGRect(x: inset, y: inset, width: side - 2 * inset, height: side - 2 * inset)
    context.addPath(CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil))
    context.clip()
}

// Background: warm paper.
let background = CGGradient(
    colorsSpace: space,
    colors: [color(0.985, 0.978, 0.958), color(0.925, 0.912, 0.878)] as CFArray,
    locations: [0, 1])!
context.drawLinearGradient(
    background, start: CGPoint(x: 0, y: side), end: CGPoint(x: side, y: 0), options: [])

// Everything below is drawn on a 1024 grid, scaled down to fit the macOS shape.
if rounded {
    context.translateBy(x: side / 2, y: side / 2)
    context.scaleBy(x: 0.8, y: 0.8)
    context.translateBy(x: -side / 2, y: -side / 2)
}

let ringCentre = CGPoint(x: 322, y: 512)
let ringRadius: CGFloat = 222

// The white disc, with a soft shadow.
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -14), blur: 40, color: color(0, 0, 0, 0.2))
context.setFillColor(color(1, 1, 1))
context.addArc(center: ringCentre, radius: ringRadius, startAngle: 0, endAngle: .pi * 2, clockwise: false)
context.fillPath()
context.restoreGState()

// The ember ring.
context.setStrokeColor(ember)
context.setLineWidth(34)
context.addArc(center: ringCentre, radius: ringRadius - 17, startAngle: 0, endAngle: .pi * 2, clockwise: false)
context.strokePath()

// The play button, optically centred.
context.setFillColor(ink)
context.setStrokeColor(ink)
context.setLineWidth(26)
context.setLineJoin(.round)
let play = CGMutablePath()
play.move(to: CGPoint(x: ringCentre.x - 52, y: ringCentre.y + 92))
play.addLine(to: CGPoint(x: ringCentre.x - 52, y: ringCentre.y - 92))
play.addLine(to: CGPoint(x: ringCentre.x + 96, y: ringCentre.y))
play.closeSubpath()
context.addPath(play)
context.drawPath(using: .fillStroke)

// Timeline clips: three tracks of rounded bars, one ember, thick enough to read at Dock size.
let rows: [(y: CGFloat, parts: [(x: CGFloat, w: CGFloat, ember: Bool)])] = [
    (650, [(588, 150, false), (756, 112, false)]),
    (512, [(588, 270, true)]),
    (374, [(588, 96, false), (702, 166, false)]),
]
let barHeight: CGFloat = 92
for row in rows {
    for part in row.parts {
        let rect = CGRect(x: part.x, y: row.y - barHeight / 2, width: part.w, height: barHeight)
        context.setFillColor(part.ember ? ember : ink)
        context.addPath(CGPath(roundedRect: rect, cornerWidth: 26, cornerHeight: 26, transform: nil))
        context.fillPath()
    }
}

let image = context.makeImage()!
let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
print("Wrote \(output.path)")
