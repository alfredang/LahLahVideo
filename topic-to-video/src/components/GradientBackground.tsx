import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { makeTransform, rotate, scale, translate } from "@remotion/animation-utils";

const PALETTES: Array<[string, string, string]> = [
  ["#ff6b6b", "#feca57", "#ff9ff3"],
  ["#48dbfb", "#0abde3", "#5f27cd"],
  ["#1dd1a1", "#10ac84", "#2e86de"],
  ["#f368e0", "#ff9ff3", "#576574"],
  ["#feca57", "#ff6348", "#5f27cd"],
  ["#54a0ff", "#5f27cd", "#222f3e"],
];

export const GradientBackground: React.FC<{ sceneIndex: number }> = ({
  sceneIndex,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [c1, c2, c3] = PALETTES[sceneIndex % PALETTES.length];

  // Rotating gradient angle
  const angle = interpolate(frame, [0, 120], [135, 315], {
    extrapolateRight: "extend",
  });

  // Shifting color stops
  const pos1 = interpolate(frame, [0, 120], [0, 100], {
    extrapolateRight: "extend",
  });

  // Slow zoom-in with spring for organic feel
  const zoomSpring = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 10, mass: 5 },
  });
  const scaleVal = interpolate(zoomSpring, [0, 1], [1.0, 1.15]);

  // Slow pan drift
  const panX = interpolate(frame, [0, 150], [0, -30], {
    extrapolateRight: "extend",
  });
  const panY = interpolate(frame, [0, 150], [0, -20], {
    extrapolateRight: "extend",
  });

  // Subtle rotation for a living feel
  const rotateVal = interpolate(frame, [0, 200], [0, 3], {
    extrapolateRight: "extend",
  });

  // Compose transforms using makeTransform
  const bgTransform = makeTransform([
    scale(scaleVal),
    translate(panX, panY),
    rotate(rotateVal),
  ]);

  // Vignette pulse
  const vignetteOpacity = interpolate(
    frame,
    [0, 60, 120],
    [0.3, 0.5, 0.3],
    { extrapolateRight: "extend" }
  );

  // Floating decorative shapes
  const shape1X = interpolate(frame, [0, 180], [-200, 200], {
    extrapolateRight: "extend",
  });
  const shape1Y = interpolate(frame, [0, 120], [400, -100], {
    extrapolateRight: "extend",
  });
  const shape1Rotate = interpolate(frame, [0, 150], [0, 360], {
    extrapolateRight: "extend",
  });
  const shape1Spring = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 5, mass: 8 },
  });
  const shape1Scale = interpolate(shape1Spring, [0, 1], [0, 1]);
  const shape1Transform = makeTransform([
    translate(shape1X, shape1Y),
    rotate(shape1Rotate),
    scale(shape1Scale),
  ]);

  const shape2X = interpolate(frame, [0, 200], [300, -150], {
    extrapolateRight: "extend",
  });
  const shape2Y = interpolate(frame, [0, 160], [-200, 300], {
    extrapolateRight: "extend",
  });
  const shape2Rotate = interpolate(frame, [0, 180], [45, -315], {
    extrapolateRight: "extend",
  });
  const shape2Transform = makeTransform([
    translate(shape2X, shape2Y),
    rotate(shape2Rotate),
    scale(shape1Scale * 0.7),
  ]);

  return (
    <AbsoluteFill>
      {/* Main gradient layer */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} ${pos1}%, ${c3} 100%)`,
          transform: bgTransform,
        }}
      />

      {/* Floating shape 1 */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 300,
            height: 300,
            borderRadius: "30%",
            background: `rgba(255,255,255,0.08)`,
            transform: shape1Transform,
          }}
        />
      </AbsoluteFill>

      {/* Floating shape 2 */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: `rgba(255,255,255,0.06)`,
            transform: shape2Transform,
          }}
        />
      </AbsoluteFill>

      {/* Vignette overlay */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${vignetteOpacity}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
