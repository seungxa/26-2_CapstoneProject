import { STAGES, type Application, type Stage } from "../../types";

const CLOSED = new Set(["합격", "불합격"]);

/** Board columns in stage order. Decided applications (passed or rejected) are left out unless showClosed, and
 *  counted either way so the board can offer to show them */
export function groupByStage(apps: Application[], showClosed: boolean): { columns: Record<Stage, Application[]>; closed: number } {
  const columns = Object.fromEntries(STAGES.map((stage) => [stage, [] as Application[]])) as Record<Stage, Application[]>;
  let closed = 0;
  for (const app of apps) {
    const decided = CLOSED.has(app.status);
    if (decided) closed += 1;
    if (!decided || showClosed) columns[app.stage].push(app);
  }
  return { columns, closed };
}

/** The neighbouring stage in direction dir (-1 back, 1 forward), or null at either end */
export function moveTarget(stage: Stage, dir: -1 | 1): Stage | null {
  return STAGES[STAGES.indexOf(stage) + dir] ?? null;
}
