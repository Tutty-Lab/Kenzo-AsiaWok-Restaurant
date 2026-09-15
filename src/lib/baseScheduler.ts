// ============================================================================
// Dienstplan nach GRUNDPLAN je Person (Kenzo / Asia Wok).
//
// Jede Person bringt ihren üblichen Wochenplan mit (types.ts baseSchedule).
// Der Scheduler legt genau diese Dienste an und gleicht dann je Budget-Einheit
// (ISO-Woche bei Wochenvertrag, Monat bei Monatsvertrag) auf das Soll ab:
//
//   ZU VIEL  -> kürzen/streichen. Zuerst dort, wo dadurch keine Lücke in einer
//               Besetzungsregel der Filiale entsteht, dann niedrigste Priorität
//               (Priorität = Tagesgewicht, Fr–So 1,5; Abenddienst +0,25).
//               adjustable: erst Vorbereitung/Aufräumen außerhalb der Öffnung,
//               dann 30′-Schritte (höchstens 1 h unter Grundplan), dann ganze
//               Dienste. Fester Rahmen: erst ganze Dienste, dann kürzen.
//               Gestrichen wird verteilt über den Monat, nicht am Stück.
//   ZU WENIG -> nur adjustable: in 30′-Schritten verlängern – zuerst, wo eine
//               Besetzungslücke geschlossen wird, dann höchste Priorität (Fr–So
//               abends), erst innerhalb der Öffnung, dann bis 60′ vor Öffnung /
//               30′ nach Schluss. Reicht das nicht, ein neuer Dienst (2 h) in
//               einem offenen Block eines Tages, an dem die Person ohnehin
//               arbeitet. Fester Rahmen bleibt kurz -> Warnung in der Prüfung.
//
// Personen mit festem Rahmen werden zuerst geplant, die verstellbaren danach –
// so füllen die verstellbaren die Lücken, die der feste Rahmen lässt.
//
// Harte Grenzen: höchstens 10 h bezahlt je Tag, höchstens 6 Tage am Stück,
// Dienste nie kürzer als 1,5 h, Pause nach § 4 ArbZG mit fester Uhrzeit.
// ============================================================================

import type { Employee, Shift } from "../types";
import { DAY_WEIGHTS, datesOfMonth, type WeekdayKey } from "./demand";
import {
  MAX_PAID_MINUTES_PER_DAY,
  SCHEDULE_SLOT_MINUTES,
  hasBaseSchedule,
  weeklyBudgetMinutes,
} from "./contract";
import { mayWorkOn } from "./availability";
import { maxConsecutiveRun } from "./consecutive";
import {
  effectiveWeekdayKey,
  resolveDay,
  type DayWindow,
  type OverrideMap,
  type ResolvedDay,
  type WorkHoursConfig,
} from "./workHours";
import { publicHolidays } from "./holidays";
import { weekStartOf } from "./weeks";
import { paidFromPresence } from "./time";
import { staffingWindows, workingAt, type StaffingRule } from "./staffing";

export type BaseScheduleInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  /** Besetzungsregeln der Filiale – Kürzen/Verlängern meidet bzw. schließt Lücken. */
  rules?: readonly StaffingRule[];
  holidays?: Set<string>;
};

const SLOT = SCHEDULE_SLOT_MINUTES;
/** Kürzester Dienst (Ngự 17:00–18:30). */
export const MIN_SHIFT_MINUTES = 90;
/** So weit darf ein Dienst vor die Öffnung (Vorbereitung) … */
export const PREP_MINUTES = 60;
/** … und über den Schluss hinaus (Aufräumen) verlängert werden. */
export const CLOSE_MINUTES = 30;
/** Höchstens so weit unter den Grundplan wird ein verstellbarer Dienst gekürzt. */
const MAX_SHRINK_BELOW_BASE = 60;
/** Ein neu angelegter Dienst ist höchstens so lang. */
const NEW_BLOCK_MINUTES = 120;
/** Mindestabstand zwischen zwei Diensten derselben Person am selben Tag. */
const GAP = 30;
/** Ab hier gilt ein Dienst als Abenddienst. */
const EVENING_FROM = 16 * 60;
/** Gewicht einer geschlossenen Besetzungslücke (je 30′) gegenüber der Priorität. */
const GAP_WEIGHT = 20;

type Block = {
  date: string;
  start: number;
  end: number;
  /** Öffnungsblock, an dem der Dienst hängt; null = liegt ganz außerhalb. */
  open: DayWindow | null;
  priority: number;
  /** Bezahlte Minuten laut Grundplan (0 = neu angelegt). */
  base: number;
  /** Anzahl Verlängerungs-/Kürzungsschritte – verteilt die Schritte reihum. */
  steps: number;
  /** Verteilungsrang für das Streichen (höher = wird eher gestrichen). */
  spread: number;
};

/** Wie viele Personen fehlen zu dieser Minute noch zur Mindestbesetzung (ohne die gerade geplante Person)? */
type GapAt = (date: string, minute: number) => number;

const paidOf = (block: Pick<Block, "start" | "end">) => paidFromPresence(block.end - block.start);
const total = (blocks: Block[]) => blocks.reduce((sum, block) => sum + paidOf(block), 0);
const byTime = (a: Block, b: Block) => a.date.localeCompare(b.date) || a.start - b.start;

export function blockPriority(weekday: WeekdayKey, startMinutes: number): number {
  return DAY_WEIGHTS[weekday] + (startMinutes >= EVENING_FROM ? 0.25 : 0);
}

/** 30′-Schritte in [from, to), in denen die Besetzungsregel ohne diese Person nicht erfüllt ist. */
function gapSlots(gapAt: GapAt, date: string, from: number, to: number): number {
  let slots = 0;
  for (let minute = from; minute < to; minute += SLOT) if (gapAt(date, minute) > 0) slots++;
  return slots;
}

/** Van-der-Corput-Wert: die ersten k Indizes mit kleinstem Wert liegen gleichmäßig verteilt. */
function vanDerCorput(index: number): number {
  let value = 0;
  let denominator = 1;
  for (let n = index; n > 0; n = Math.floor(n / 2)) {
    denominator *= 2;
    value += (n % 2) / denominator;
  }
  return value;
}

function openBlockFor(day: ResolvedDay, window: DayWindow): DayWindow | null {
  let best: DayWindow | null = null;
  let overlap = 0;
  for (const block of day.blocks) {
    const covered = Math.min(block.endMinutes, window.endMinutes) - Math.max(block.startMinutes, window.startMinutes);
    if (covered > overlap) {
      best = block;
      overlap = covered;
    }
  }
  return best;
}

/** Kürzt das Ende, bis die Anwesenheit eine gültige Pausenregel ergibt. */
function fitPresence(window: DayWindow): DayWindow | null {
  let end = window.endMinutes;
  while (end > window.startMinutes && paidFromPresence(end - window.startMinutes) === 0) end -= SLOT;
  return end > window.startMinutes ? { startMinutes: window.startMinutes, endMinutes: end } : null;
}

/** Grundplan-Dienste einer Person an einem offenen Tag. */
function baseWindows(employee: Employee, date: string, day: ResolvedDay, weekday: WeekdayKey, overrides: OverrideMap): DayWindow[] {
  let windows = hasBaseSchedule(employee)
    ? (employee.baseSchedule?.[weekday] ?? []).map((w) => ({ ...w }))
    : day.blocks.map((w) => ({ ...w }));
  const custom = overrides[date]?.window;
  if (custom) {
    // Abweichende Öffnung: Grundplan in den neuen Rahmen schneiden.
    windows = windows.map((w) => ({
      startMinutes: Math.max(w.startMinutes, custom.startMinutes - PREP_MINUTES),
      endMinutes: Math.min(w.endMinutes, custom.endMinutes + CLOSE_MINUTES),
    }));
  }
  return windows
    .filter((w) => w.endMinutes - w.startMinutes >= MIN_SHIFT_MINUTES)
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map(fitPresence)
    .filter((w): w is DayWindow => w !== null);
}

/** Um 30′ kürzen (oder 60′, wenn 30′ keine gültige Pausenregel ergibt). */
function shrunk(block: Block, side: "start" | "end"): Block | null {
  for (const cut of [SLOT, 2 * SLOT]) {
    const next = side === "start" ? { ...block, start: block.start + cut } : { ...block, end: block.end - cut };
    const paid = paidOf(next);
    if (paid > 0 && paid < paidOf(block)) return next;
  }
  return null;
}

/** Liegt die Seite, die beim Kürzen wegfällt, außerhalb der Öffnung? */
function outsideSide(block: Block): "start" | "end" | null {
  if (!block.open) return "end";
  if (block.start < block.open.startMinutes) return "start";
  if (block.end > block.open.endMinutes) return "end";
  return null;
}

type Step = { from: Block; to: Block | null; gap: number };

function trimStep(blocks: Block[], over: number, adjustable: boolean, gapAt: GapAt): Step | null {
  const step = (from: Block, to: Block | null): Step => ({
    from,
    to,
    gap: to === null
      ? gapSlots(gapAt, from.date, from.start, from.end)
      : gapSlots(gapAt, from.date, from.start, to.start) + gapSlots(gapAt, from.date, to.end, from.end),
  });
  const shrinkOrder = (a: Step, b: Step) =>
    a.gap - b.gap || a.from.priority - b.from.priority || a.from.steps - b.from.steps || byTime(a.from, b.from);
  const dropOrder = (a: Step, b: Step) =>
    a.gap - b.gap || a.from.priority - b.from.priority || b.from.spread - a.from.spread || byTime(a.from, b.from);

  const drops = blocks.filter((b) => paidOf(b) <= over).map((b) => step(b, null)).sort(dropOrder);
  const outside = blocks
    .map((b) => {
      const side = outsideSide(b);
      const next = side ? shrunk(b, side) : null;
      return next && paidOf(next) >= MIN_SHIFT_MINUTES ? step(b, next) : null;
    })
    .filter((s): s is Step => s !== null)
    .sort(shrinkOrder);
  const inside = blocks
    .map((b) => {
      const next = shrunk(b, "end");
      const floor = adjustable ? Math.max(MIN_SHIFT_MINUTES, b.base - MAX_SHRINK_BELOW_BASE) : MIN_SHIFT_MINUTES;
      return next && paidOf(next) >= floor ? step(b, next) : null;
    })
    .filter((s): s is Step => s !== null)
    .sort(shrinkOrder);
  const forced = blocks.map((b) => step(b, null)).sort(dropOrder);

  const order = adjustable ? [outside, inside, drops, forced] : [drops, outside, inside, forced];
  return order.find((list) => list.length > 0)?.[0] ?? null;
}

type Growth = { from: Block; to: Block; score: number };

function growSteps(blocks: Block[], gapAt: GapAt): Growth[] {
  const steps: Growth[] = [];
  for (const block of blocks) {
    if (!block.open) continue;
    const sameDay = blocks.filter((b) => b.date === block.date).sort(byTime);
    const index = sameDay.indexOf(block);
    const prev = sameDay[index - 1];
    const next = sameDay[index + 1];
    const dayPaid = sameDay.reduce((sum, b) => sum + paidOf(b), 0);
    const minStart = Math.max(block.open.startMinutes - PREP_MINUTES, prev ? prev.end + GAP : -Infinity);
    const maxEnd = Math.min(block.open.endMinutes + CLOSE_MINUTES, next ? next.start - GAP : Infinity);
    for (const side of ["end", "start"] as const) {
      for (const grow of [SLOT, 2 * SLOT]) {
        const to = side === "end" ? { ...block, end: block.end + grow } : { ...block, start: block.start - grow };
        if (to.start < minStart || to.end > maxEnd) break;
        const gain = paidOf(to) - paidOf(block);
        if (gain <= 0) continue;
        if (dayPaid + gain > MAX_PAID_MINUTES_PER_DAY) break;
        const inside = side === "end" ? to.end <= block.open.endMinutes : to.start >= block.open.startMinutes;
        const filled = side === "end"
          ? gapSlots(gapAt, block.date, block.end, to.end)
          : gapSlots(gapAt, block.date, to.start, block.start);
        steps.push({
          from: block,
          to,
          score: (inside ? 0 : 10) - block.priority - filled * GAP_WEIGHT + block.steps * 0.3 + (side === "start" ? 0.05 : 0),
        });
        break;
      }
    }
  }
  return steps.sort((a, b) => a.score - b.score || byTime(a.from, b.from));
}

/** Neuer Dienst in einem offenen Block eines Tages, an dem die Person schon arbeitet. */
function newBlock(
  blocks: Block[],
  remaining: number,
  days: Map<string, ResolvedDay>,
  holidays: Set<string>,
  gapAt: GapAt,
): Block | null {
  const length = Math.min(NEW_BLOCK_MINUTES, Math.floor(remaining / SLOT) * SLOT);
  if (length < MIN_SHIFT_MINUTES) return null;
  const options: { block: Block; score: number }[] = [];
  for (const date of new Set(blocks.map((b) => b.date))) {
    const sameDay = blocks.filter((b) => b.date === date);
    if (sameDay.reduce((sum, b) => sum + paidOf(b), 0) + length > MAX_PAID_MINUTES_PER_DAY) continue;
    for (const open of days.get(date)?.blocks ?? []) {
      const start = open.startMinutes;
      const end = Math.min(open.endMinutes, start + length);
      if (paidFromPresence(end - start) < MIN_SHIFT_MINUTES) continue;
      if (sameDay.some((b) => b.start < end + GAP && start < b.end + GAP)) continue;
      const block: Block = {
        date, start, end, open,
        priority: blockPriority(effectiveWeekdayKey(date, holidays), start),
        base: 0, steps: 0, spread: 0,
      };
      options.push({ block, score: block.priority + gapSlots(gapAt, date, start, end) * GAP_WEIGHT });
    }
  }
  return options.sort((a, b) => b.score - a.score || byTime(a.block, b.block))[0]?.block ?? null;
}

function balance(
  blocks: Block[],
  budget: number,
  adjustable: boolean,
  days: Map<string, ResolvedDay>,
  holidays: Set<string>,
  gapAt: GapAt,
): Block[] {
  let list = [...blocks];
  while (total(list) > budget) {
    const step = trimStep(list, total(list) - budget, adjustable, gapAt);
    if (!step) break;
    list = list.filter((b) => b !== step.from);
    if (step.to) list.push({ ...step.to, steps: step.from.steps + 1 });
  }
  if (!adjustable) return list;
  while (budget - total(list) >= SLOT) {
    const grow = growSteps(list, gapAt)[0];
    if (grow) {
      list = [...list.filter((b) => b !== grow.from), { ...grow.to, steps: grow.from.steps + 1 }];
      continue;
    }
    const added = newBlock(list, budget - total(list), days, holidays, gapAt);
    if (!added) break;
    list = [...list, added];
  }
  return list;
}

/** Höchstens 6 Tage am Stück: im zu langen Lauf den Tag mit der niedrigsten Priorität streichen. */
function enforceRestDays(blocks: Block[]): Block[] {
  let list = [...blocks];
  while (maxConsecutiveRun(new Set(list.map((b) => b.date))) > 6) {
    const dates = [...new Set(list.map((b) => b.date))].sort();
    let runStart = 0;
    let victim: string | undefined;
    for (let i = 1; i <= dates.length; i++) {
      const next = new Date(`${dates[i - 1]}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      if (i < dates.length && dates[i] === next.toISOString().slice(0, 10)) continue;
      if (i - runStart > 6) {
        const run = dates.slice(runStart, i);
        const dayPriority = (date: string) => Math.max(...list.filter((b) => b.date === date).map((b) => b.priority));
        victim = [...run].sort((a, b) => dayPriority(a) - dayPriority(b) || b.localeCompare(a))[0];
        break;
      }
      runStart = i;
    }
    if (!victim) break;
    list = list.filter((b) => b.date !== victim);
  }
  return list;
}

/** Pause mittig in den Dienst legen (30′-Raster, höchstens 6 h Arbeit am Stück). */
function pauseStartOf(start: number, end: number, pause: number): number | undefined {
  if (pause <= 0) return undefined;
  const ideal = start + Math.round((end - start - pause) / 2 / SLOT) * SLOT;
  const candidates: number[] = [];
  for (let at = start + SLOT; at + pause < end; at += SLOT) {
    if (at - start <= 360 && end - at - pause <= 360) candidates.push(at);
  }
  return candidates.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b)[0];
}

function toShift(employee: Employee, block: Block): Shift {
  const presence = block.end - block.start;
  const paidMinutes = paidFromPresence(presence);
  const pauseMinutes = presence - paidMinutes;
  const pauseStartMinutes = pauseStartOf(block.start, block.end, pauseMinutes);
  return {
    id: `base-${employee.id}-${block.date}-${block.start}`,
    employeeId: employee.id,
    date: block.date,
    startMinutes: block.start,
    endMinutes: block.end,
    ...(pauseStartMinutes == null ? {} : { pauseStartMinutes }),
    pauseMinutes,
    paidMinutes,
    shiftType: block.start < EVENING_FROM ? "EARLY" : "LATE",
    generated: true,
  };
}

export function generateBaseSchedule(input: BaseScheduleInput): Shift[] {
  const holidays = input.holidays ?? publicHolidays(input.year);
  const overrides = input.overrides ?? {};
  const monthDates = datesOfMonth(input.year, input.month);
  const days = new Map(monthDates.map((date) => [date, resolveDay(input.workHours, date, holidays, overrides)] as const));
  const openDates = monthDates.filter((date) => !days.get(date)!.closed);
  const monthBounds = { first: monthDates[0], last: monthDates[monthDates.length - 1] };

  const windowsByDate = new Map(openDates.map((date) => [
    date,
    staffingWindows(days.get(date)!.blocks, effectiveWeekdayKey(date, holidays), input.rules ?? []),
  ] as const));
  const placedByDate = new Map<string, Shift[]>();
  const gapAt: GapAt = (date, minute) => {
    const need = Math.max(0, ...(windowsByDate.get(date) ?? [])
      .filter((w) => w.startMinutes <= minute && minute < w.endMinutes)
      .map((w) => w.minStaff));
    if (need === 0) return 0;
    const present = new Set((placedByDate.get(date) ?? []).filter((s) => workingAt(s, minute)).map((s) => s.employeeId));
    return Math.max(0, need - present.size);
  };

  const shifts: Shift[] = [];
  // Fester Rahmen zuerst, verstellbare danach (stabile Sortierung behält die Listenreihenfolge).
  const planningOrder = [...input.employees].sort((a, b) => Number(Boolean(a.adjustable)) - Number(Boolean(b.adjustable)));
  for (const employee of planningOrder) {
    const adjustable = Boolean(employee.adjustable);
    let blocks: Block[] = [];
    for (const date of openDates) {
      if (!mayWorkOn(employee, date)) continue;
      const day = days.get(date)!;
      const weekday = effectiveWeekdayKey(date, holidays);
      let dayBlocks = baseWindows(employee, date, day, weekday, overrides).map((w): Block => ({
        date,
        start: w.startMinutes,
        end: w.endMinutes,
        open: openBlockFor(day, w),
        priority: blockPriority(weekday, w.startMinutes),
        base: paidFromPresence(w.endMinutes - w.startMinutes),
        steps: 0,
        spread: 0,
      }));
      // Tagesgrenze: den längsten Dienst am Ende kürzen, bis der Tag passt.
      while (total(dayBlocks) > MAX_PAID_MINUTES_PER_DAY) {
        const longest = [...dayBlocks].sort((a, b) => paidOf(b) - paidOf(a))[0];
        const next = shrunk(longest, "end");
        dayBlocks = dayBlocks.filter((b) => b !== longest);
        if (next && paidOf(next) >= MIN_SHIFT_MINUTES) dayBlocks.push({ ...next, base: paidOf(next) });
      }
      blocks.push(...dayBlocks);
    }
    blocks = enforceRestDays(blocks.sort(byTime)).map((b, index) => ({ ...b, spread: vanDerCorput(index) }));

    // Budget-Einheiten: ISO-Woche (Wochenvertrag) oder der ganze Monat.
    const units = new Map<string, Block[]>();
    const unitOf = (block: Block) => (employee.weeklyHours != null ? weekStartOf(block.date) : "month");
    for (const block of blocks) units.set(unitOf(block), [...(units.get(unitOf(block)) ?? []), block]);
    const weekly = employee.weeklyHours != null
      ? weeklyBudgetMinutes(employee, openDates, monthBounds, input.workHours)
      : undefined;
    const monthly = Math.max(0, Math.floor(employee.targetMinutes / SLOT) * SLOT);

    for (const [unit, unitBlocks] of units) {
      const budget = weekly ? (weekly.get(unit) ?? 0) : monthly;
      for (const block of balance(unitBlocks, budget, adjustable, days, holidays, gapAt).sort(byTime)) {
        const shift = toShift(employee, block);
        shifts.push(shift);
        placedByDate.set(shift.date, [...(placedByDate.get(shift.date) ?? []), shift]);
      }
    }
  }
  return shifts.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
