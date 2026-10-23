/**
 * Whether a started run would be lost if the player left the play screen.
 *
 * The play screen owns the exit control, but only the runtime knows whether a run
 * is live: each game keeps its own idea of "started", from the rules panel being
 * dismissed (One Move, 7 Second, Color Merge, Don't Touch) to the first showing
 * beat (Chain, Memory Flash) to the server's own `playing` state (Stack 10). So
 * the runtime reports, and the screen asks before throwing that away.
 *
 * Reporting is deliberately one-way and additive: a runtime that mounts outside
 * the play screen — the component tests do exactly that — simply finds no
 * reporter and does nothing, rather than requiring a provider it does not need.
 */

import { createContext, useContext, useEffect } from "react";

/** The play screen's setter; `true` from the moment a run can be lost. */
export type RunProgressReporter = (active: boolean) => void;

export const RunProgressContext = createContext<RunProgressReporter | null>(null);

/**
 * Reports whether this runtime holds an unverified run, and clears the report
 * when the runtime unmounts so a stale "in progress" cannot outlive it.
 */
export function useReportRunProgress(active: boolean): void {
  const report = useContext(RunProgressContext);

  useEffect(() => {
    if (!report) return;
    report(active);
    return () => report(false);
  }, [report, active]);
}
