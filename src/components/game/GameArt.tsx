import { cn } from "@/lib/utils";
import type { GameId } from "@/lib/mock";

const hueBg: Record<string, string> = {
  "game-1": "bg-game-1",
  "game-2": "bg-game-2",
  "game-3": "bg-game-3",
  "game-4": "bg-game-4",
  "game-5": "bg-game-5",
  "game-6": "bg-game-6",
  "game-7": "bg-game-7",
};
export const hueClass = (hue: string) => hueBg[hue] ?? "bg-primary";

/** Static, purely visual representation of each game's board. No game logic. */
export function GameArt({
  id,
  className,
  live = false,
}: {
  id: GameId;
  className?: string;
  live?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-surface",
        className,
      )}
      aria-hidden
    >
      {id === "stack-10" && <Stack10 />}
      {id === "color-merge" && <ColorMerge />}
      {id === "dont-touch-the-black" && <BlackTiles live={live} />}
      {id === "one-move" && <OneMove />}
      {id === "dont-break-the-chain" && <Chain />}
      {id === "memory-flash" && <MemoryFlash />}
      {id === "7-second" && <Seven />}
    </div>
  );
}

function Stack10() {
  const cols = [[3, 4, 2], [5, 1], [6, 2, 1], [7]];
  return (
    <div className="flex h-3/5 items-end gap-[6%] w-3/4">
      {cols.map((c, i) => (
        <div
          key={i}
          className="flex flex-1 flex-col-reverse gap-1.5 rounded-lg border border-glass-border p-1.5 h-full"
        >
          {c.map((n, j) => (
            <div
              key={j}
              className="flex aspect-square items-center justify-center rounded-md bg-game-1/80 font-mono text-lg font-semibold text-background tabular"
            >
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ColorMerge() {
  const o = [20, 45, 70, 100, 0, 45, 20, 70, 100, 70, 0, 20, 45, 20, 100, 45];
  return (
    <div className="grid w-3/4 max-w-80 grid-cols-4 gap-2">
      {o.map((v, i) => (
        <div
          key={i}
          className={cn(
            "aspect-square rounded-md",
            v === 0 ? "border border-glass-border" : "bg-game-2",
          )}
          style={{ opacity: v === 0 ? 1 : 0.25 + v / 135 }}
        />
      ))}
    </div>
  );
}

function BlackTiles({ live }: { live: boolean }) {
  const rows = [1, 3, 0, 2, 1, 3];
  return (
    <div className="grid h-full w-full grid-rows-6">
      {rows.map((b, r) => (
        <div key={r} className="grid grid-cols-4 border-b border-background/40">
          {[0, 1, 2, 3].map((c) => (
            <div
              key={c}
              className={cn(
                "border-r border-background/40",
                c === b ? "bg-background" : "bg-game-3",
                live && r === 5 && c === b && "bg-primary",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function OneMove() {
  const cells = Array.from({ length: 25 }, (_, i) => i);
  const filled = new Set([6, 7, 8, 11, 13, 16, 17]);
  return (
    <div className="grid w-2/3 max-w-72 grid-cols-5 gap-1.5">
      {cells.map((i) => (
        <div
          key={i}
          className={cn(
            "aspect-square rounded-sm",
            filled.has(i)
              ? "bg-game-4"
              : i === 18
                ? "border-2 border-dashed border-game-4"
                : "bg-surface-2",
          )}
        />
      ))}
    </div>
  );
}

function Chain() {
  return (
    <div className="flex w-3/4 flex-wrap items-center justify-center gap-3">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className={cn(
            "size-12 rounded-full border-2 border-game-5",
            i < 5 && "bg-game-5",
            i === 5 && "bg-game-5/40",
          )}
        />
      ))}
    </div>
  );
}

function MemoryFlash() {
  const lit = new Set([0, 5, 6, 10, 15, 13]);
  return (
    <div className="grid w-2/3 max-w-72 grid-cols-4 gap-2">
      {Array.from({ length: 16 }, (_, i) => (
        <div
          key={i}
          className={cn("aspect-square rounded-md", lit.has(i) ? "bg-game-6" : "bg-surface-2")}
        />
      ))}
    </div>
  );
}

function Seven() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex size-40 items-center justify-center rounded-full border-[6px] border-game-7/30">
        <span className="font-mono text-6xl font-semibold text-game-7 tabular">7.00</span>
      </div>
      <span className="text-xs font-medium uppercase text-muted-foreground">Daily challenge</span>
    </div>
  );
}
