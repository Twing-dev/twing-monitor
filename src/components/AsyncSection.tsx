import type { ReactNode } from "react";
import type { AsyncState } from "../hooks/useAsyncData.js";
import { Mascot } from "./Mascot.js";

/** Uniform loading/error/empty/ready handling for every list view --
 * factored out of the load/error/empty markup `RepoListView` hand-rolled
 * first, so DesignsView/ReviewsView/ActivityView/AlignmentThreadsView/
 * MembersView/ConstraintsView don't each repeat it. */
export function AsyncSection<T>({
  state,
  isEmpty,
  emptyMessage,
  render,
}: {
  state: AsyncState<T>;
  isEmpty: (data: T) => boolean;
  emptyMessage: ReactNode;
  render: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <p className="empty-state">Loading…</p>;
  if (state.status === "error") {
    return (
      <p className="empty-state error" role="alert">
        Couldn't load: {state.message}
      </p>
    );
  }
  if (isEmpty(state.data)) {
    return (
      <div className="empty-state empty-state-figure">
        <Mascot />
        <p>{emptyMessage}</p>
      </div>
    );
  }
  return <>{render(state.data)}</>;
}
