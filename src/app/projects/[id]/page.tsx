import { Suspense } from "react";
import { Editor } from "@/components/editor/editor";

export default function ProjectPage() {
  // The editor reads the route param on the client; Suspense keeps the shell static.
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}
