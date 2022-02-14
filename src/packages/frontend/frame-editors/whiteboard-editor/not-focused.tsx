import { ReactNode } from "react";
import { useFrameContext } from "./hooks";

interface Props {
  children: ReactNode;
  id: string;
  selectable?: boolean;
}

export default function NotFocused({ children, id, selectable }: Props) {
  const frame = useFrameContext();
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      onClick={(e) => onClick(selectable, id, e, frame)}
    >
      {children}
    </div>
  );
}

function onClick(selectable, id, e, frame) {
  if (!selectable) return;
  e.stopPropagation();
  const edgeStart = frame.desc.get("edgeStart");
  if (edgeStart) {
    frame.actions.clearEdgeCreateStart(frame.id);
    // I'm ignoring edgeStart.get('position') here until I get a sense
    // for cocalc if we want to automate and make manual where the edge
    // comes out, etc.  Maybe we want less user control for less cognitive load,
    // and to be more like a digraph...
    frame.actions.createEdge(edgeStart.get("id"), id);
    return;
  }
  // select
  frame.actions.setSelection(
    frame.id,
    id,
    e.altKey || e.metaKey || e.ctrlKey || e.shiftKey ? "toggle" : "only"
  );
}
