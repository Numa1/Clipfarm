import { Suspense } from "react";
import { VideoView } from "@/components/video/video-view";

export default function VideoPage() {
  // The view reads the route param on the client; Suspense keeps the shell static.
  return (
    <Suspense>
      <VideoView />
    </Suspense>
  );
}
