import { Composition } from "remotion";
import { emptyTimeline } from "@/timeline/factory";
import { durationInFrames } from "@/timeline/ops";
import { ShortComposition, type ShortProps } from "./ShortComposition";

export const COMPOSITION_ID = "Short";

export function RemotionRoot() {
  const defaultProps: ShortProps = { timeline: emptyTimeline(), media: { baseUrl: "", quality: "full" } };
  return (
    <Composition
      id={COMPOSITION_ID}
      component={ShortComposition}
      defaultProps={defaultProps}
      // Real size/duration come from the timeline passed as inputProps at render time.
      calculateMetadata={({ props }) => ({
        durationInFrames: durationInFrames(props.timeline),
        fps: props.timeline.fps,
        width: props.timeline.width,
        height: props.timeline.height,
      })}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1920}
    />
  );
}
