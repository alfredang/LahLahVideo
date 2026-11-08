import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  makeTransform,
  rotate,
  scale,
  translate,
  skew,
} from "@remotion/animation-utils";
import { PlanScene } from "../types";
import { GradientBackground } from "./GradientBackground";

type Props = {
  scene: PlanScene;
  index: number;
  total: number;
};

export const Scene: React.FC<Props> = ({ scene, index, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Caption entrance: scale bounce + slide up + slight rotation ---
  const entranceSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100, mass: 0.8 },
  });

  const captionScale = interpolate(entranceSpring, [0, 1], [0.6, 1]);
  const captionY = interpolate(entranceSpring, [0, 1], [80, 0]);
  const captionRotate = interpolate(entranceSpring, [0, 1], [-3, 0]);

  const captionTransform = makeTransform([
    translate(0, captionY),
    scale(captionScale),
    rotate(captionRotate),
  ]);

  // --- Fade in / fade out ---
  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const exitStart = scene.durationFrames - 12;
  const fadeOut = interpolate(frame, [exitStart, scene.durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Exit transform: scale down + slide out + rotate away
  const exitProgress = interpolate(
    frame,
    [exitStart, scene.durationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const exitScale = interpolate(exitProgress, [0, 1], [1, 0.85]);
  const exitY = interpolate(exitProgress, [0, 1], [0, -40]);
  const exitRotate = interpolate(exitProgress, [0, 1], [0, 2]);

  const exitTransform = makeTransform([
    translate(0, exitY),
    scale(exitScale),
    rotate(exitRotate),
  ]);

  const opacity = fadeIn * fadeOut;

  // Combine entrance and exit — entrance dominates early, exit dominates late
  const isExiting = frame >= exitStart;
  const containerTransform = isExiting ? exitTransform : captionTransform;

  // --- Word-by-word caption reveal ---
  const words = scene.caption.split(" ");
  const WORD_STAGGER = 4; // frames between each word appearing

  // --- Narration text fade-in below caption ---
  const narrationDelay = words.length * WORD_STAGGER + 10;
  const narrationSpring = spring({
    frame: Math.max(0, frame - narrationDelay),
    fps,
    config: { damping: 16, stiffness: 100, mass: 0.6 },
  });
  const narrationOpacity =
    interpolate(narrationSpring, [0, 1], [0, 0.7]) * fadeOut;
  const narrationY = interpolate(narrationSpring, [0, 1], [30, 0]);
  const narrationScale = interpolate(narrationSpring, [0, 1], [0.95, 1]);
  const narrationTransform = makeTransform([
    translate(0, narrationY),
    scale(narrationScale),
  ]);

  // --- Title bar decoration (top) ---
  const titleBarSpring = spring({
    frame: Math.max(0, frame - 2),
    fps,
    config: { damping: 20, stiffness: 80, mass: 0.5 },
  });
  const titleBarWidth = interpolate(titleBarSpring, [0, 1], [0, 60]);
  const titleBarOpacity = interpolate(titleBarSpring, [0, 1], [0, 0.6]) * fadeOut;

  // --- Progress dots animation ---
  const dotSpring = spring({
    frame: Math.max(0, frame - 5),
    fps,
    config: { damping: 12, stiffness: 80, mass: 0.6 },
  });
  const dotContainerY = interpolate(dotSpring, [0, 1], [20, 0]);
  const dotContainerOpacity = interpolate(dotSpring, [0, 1], [0, 1]);
  const dotContainerTransform = makeTransform([translate(0, dotContainerY)]);

  return (
    <AbsoluteFill>
      <GradientBackground sceneIndex={index} />
      {scene.audioFile ? <Audio src={staticFile(scene.audioFile)} /> : null}

      {/* Decorative line above caption */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "32%",
            width: `${titleBarWidth}%`,
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.3)",
            opacity: titleBarOpacity,
          }}
        />
      </AbsoluteFill>

      {/* Caption - word by word reveal with composed transforms */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 80,
          opacity,
          transform: containerTransform,
        }}
      >
        <div
          style={{
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: 96,
            lineHeight: 1.1,
            color: "white",
            textAlign: "center",
            textShadow: "0 8px 40px rgba(0,0,0,0.35)",
            letterSpacing: "-0.02em",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0 24px",
          }}
        >
          {words.map((word, wi) => {
            const wordDelay = wi * WORD_STAGGER;
            const wordSpring = spring({
              frame: Math.max(0, frame - wordDelay),
              fps,
              config: { damping: 12, stiffness: 150, mass: 0.5 },
            });
            const wordOpacity = interpolate(wordSpring, [0, 1], [0, 1]);
            const wordY = interpolate(wordSpring, [0, 1], [30, 0]);
            const wordScaleVal = interpolate(
              wordSpring,
              [0, 0.5, 1],
              [0.8, 1.1, 1]
            );
            // Alternate words skew in from different directions
            const wordSkew = interpolate(
              wordSpring,
              [0, 1],
              [wi % 2 === 0 ? 8 : -8, 0]
            );
            const wordRotate = interpolate(
              wordSpring,
              [0, 1],
              [wi % 2 === 0 ? -5 : 5, 0]
            );

            const wordTransform = makeTransform([
              translate(0, wordY),
              scale(wordScaleVal),
              skew(wordSkew, 0),
              rotate(wordRotate),
            ]);

            return (
              <span
                key={wi}
                style={{
                  display: "inline-block",
                  opacity: wordOpacity,
                  transform: wordTransform,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* Narration subtitle with transform */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 160,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            opacity: narrationOpacity,
            transform: narrationTransform,
            maxWidth: "85%",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.5,
            color: "white",
            textAlign: "center",
            textShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          {scene.narration}
        </div>
      </AbsoluteFill>

      {/* Animated progress dots */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 80,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            opacity: dotContainerOpacity,
            transform: dotContainerTransform,
          }}
        >
          {Array.from({ length: total }).map((_, i) => {
            const isActive = i === index;
            const dotScaleVal = isActive
              ? interpolate(
                  spring({
                    frame: Math.max(0, frame - 8),
                    fps,
                    config: { damping: 10, stiffness: 200, mass: 0.4 },
                  }),
                  [0, 1],
                  [0.5, 1]
                )
              : 1;
            const dotTransform = makeTransform([scale(dotScaleVal)]);

            return (
              <div
                key={i}
                style={{
                  width: isActive ? 36 : 18,
                  height: 18,
                  borderRadius: 9,
                  background: isActive ? "white" : "rgba(255,255,255,0.35)",
                  transform: dotTransform,
                  transition: "width 0.3s",
                }}
              />
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
