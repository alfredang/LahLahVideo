import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { flip } from "@remotion/transitions/flip";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { Plan } from "./types";
import { Scene } from "./components/Scene";

const TRANSITION_FRAMES = 15;

function getTransition(index: number, width: number, height: number) {
  const transitions = [
    () => slide({ direction: "from-left" }),
    () => fade(),
    () => wipe({ direction: "from-left" }),
    () => flip({ direction: "from-left" }),
    () => clockWipe({ width, height }),
    () => slide({ direction: "from-bottom" }),
  ];
  return transitions[index % transitions.length]();
}

export const TopicVideo: React.FC<{ plan: Plan }> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <TransitionSeries>
        {plan.scenes.map((scene, i) => {
          const isLast = i === plan.scenes.length - 1;

          return (
            <React.Fragment key={i}>
              <TransitionSeries.Sequence durationInFrames={scene.durationFrames}>
                <Scene scene={scene} index={i} total={plan.scenes.length} />
              </TransitionSeries.Sequence>
              {!isLast && (
                <TransitionSeries.Transition
                  presentation={getTransition(i, plan.width, plan.height)}
                  timing={springTiming({
                    durationInFrames: TRANSITION_FRAMES,
                    config: { damping: 20, stiffness: 80, mass: 0.5 },
                  })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
