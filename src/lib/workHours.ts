// ============================================================================
// Öffnungszeiten je Wochentag + Feiertag. Ein Tag kann aus mehreren Blöcken
// bestehen (Kenzo: mittags und abends). Feiertage (NRW) nehmen die
// Feiertagszeiten – oder bleiben zu, wenn der Laden an Feiertagen schließt.
// ============================================================================

import { parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";

export type DayWindow = { startMinutes: number; endMinutes: number };

/** Ein Arbeitstag kann aus MEHREREN Öffnungsblöcken bestehen. */
export type DayBlocks = DayWindow[];

export type WorkHoursConfig = {
  perWeekday: Record<WeekdayKey, DayBlocks>;
  holiday: DayBlocks;
  /**
   * Wochentage, an denen der Laden grundsätzlich geschlossen ist. Ein
   * Datum-Override mit eigenen Zeiten kann einen solchen Tag trotzdem öffnen.
   */
  closedWeekdays: Record<WeekdayKey, boolean>;
  /** true = an gesetzlichen Feiertagen geschlossen (Asia Wok). */
  holidayClosed?: boolean;
};

/**
 * Ausnahme für ein konkretes Datum (überschreibt Wochentag/Feiertag).
 * closed = an diesem Tag wird nicht geplant (z.B. Betriebsruhe);
 * window = abweichende Arbeitszeiten (z.B. halber Tag).
 */
export type DateOverride = {
  date: string; // ISO yyyy-MM-dd
  closed: boolean;
  window?: DayWindow;
  note?: string;
};

export type OverrideMap = Record<string, DateOverride>;

export type ResolvedDay = {
  closed: boolean;
  /** Die tatsächlichen Öffnungsblöcke, aufsteigend und ohne Überlappung. */
  blocks: DayBlocks;
  /** Äußerer Rahmen (erster Anfang bis letztes Ende) – für Anzeige und Summen. */
  window: DayWindow;
};

/** Rahmen um eine Liste von Blöcken. Leere Liste => 0-Fenster. */
export function frameOf(blocks: DayBlocks): DayWindow {
  if (blocks.length === 0) return { startMinutes: 0, endMinutes: 0 };
  return {
    startMinutes: Math.min(...blocks.map((b) => b.startMinutes)),
    endMinutes: Math.max(...blocks.map((b) => b.endMinutes)),
  };
}

const w = (start: number, end: number): DayWindow => ({ startMinutes: start, endMinutes: end });
const copy = (blocks: DayBlocks): DayBlocks => blocks.map((b) => ({ ...b }));

// KENZO Asia Kitchen & Sushi Lounge:
//   Montag             Ruhetag
//   Dienstag–Mittwoch  17:00–21:00
//   Donnerstag–Sonntag 12:00–14:30 und 17:00–21:30 (Pause 14:30–17:00)
//   Feiertag           wie Sonntag (ein Montagsfeiertag bleibt zu)
const KENZO_ABEND: DayBlocks = [w(17 * 60, 21 * 60)];
const KENZO_ZWEI: DayBlocks = [w(12 * 60, 14 * 60 + 30), w(17 * 60, 21 * 60 + 30)];

export const KENZO_WORK_HOURS: WorkHoursConfig = {
  perWeekday: {
    monday: copy(KENZO_ABEND), // geschlossen, nur als Rückfall
    tuesday: copy(KENZO_ABEND),
    wednesday: copy(KENZO_ABEND),
    thursday: copy(KENZO_ZWEI),
    friday: copy(KENZO_ZWEI),
    saturday: copy(KENZO_ZWEI),
    sunday: copy(KENZO_ZWEI),
  },
  holiday: copy(KENZO_ZWEI),
  closedWeekdays: {
    monday: true,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  },
  holidayClosed: false,
};

// Asia Wok Warburg: Montag–Samstag 11:00–19:30; Sonntag und Feiertag geschlossen.
const WOK_TAG: DayBlocks = [w(11 * 60, 19 * 60 + 30)];

export const ASIA_WOK_WORK_HOURS: WorkHoursConfig = {
  perWeekday: {
    monday: copy(WOK_TAG),
    tuesday: copy(WOK_TAG),
    wednesday: copy(WOK_TAG),
    thursday: copy(WOK_TAG),
    friday: copy(WOK_TAG),
    saturday: copy(WOK_TAG),
    sunday: copy(WOK_TAG), // geschlossen, nur als Rückfall
  },
  holiday: copy(WOK_TAG),
  closedWeekdays: {
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: true,
  },
  holidayClosed: true,
};

/** Rückfall, wenn keine Filiale angegeben ist (Tests, Standardparameter). */
export const DEFAULT_WORK_HOURS: WorkHoursConfig = KENZO_WORK_HOURS;

/**
 * Für Grundplan und Priorität maßgeblicher Wochentag: ein geöffneter Feiertag
 * zählt wie Sonntag.
 */
export function effectiveWeekdayKey(isoDate: string, holidays: Set<string>): WeekdayKey {
  if (holidays.has(isoDate)) return "sunday";
  return weekdayKeyOf(parseIsoDate(isoDate));
}

/** Öffnungsblöcke für ein konkretes Datum (berücksichtigt Feiertage). */
export function resolveWorkBlocks(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
): DayBlocks {
  if (holidays.has(isoDate)) return config.holiday;
  return config.perWeekday[weekdayKeyOf(parseIsoDate(isoDate))];
}

const CLOSED: ResolvedDay = {
  closed: true,
  blocks: [],
  window: { startMinutes: 0, endMinutes: 0 },
};

const open = (blocks: DayBlocks): ResolvedDay => ({
  closed: false,
  blocks: [...blocks].sort((a, b) => a.startMinutes - b.startMinutes),
  window: frameOf(blocks),
});

/**
 * Vollständige Auflösung eines Tages inkl. Ausnahmen:
 * Ausnahme geschlossen > Ausnahme eigene Zeiten > geschlossener Wochentag
 * (z.B. Montag) > Feiertag (zu, wenn holidayClosed) > Wochentag.
 */
export function resolveDay(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
  overrides: OverrideMap = {},
): ResolvedDay {
  const ov = overrides[isoDate];
  if (ov?.closed) return CLOSED;
  // Ein Override mit eigenen Zeiten öffnet den Tag auch dann, wenn der
  // Wochentag sonst geschlossen wäre – dort gilt ein einzelner Block.
  if (ov?.window) return open([ov.window]);
  const weekday = weekdayKeyOf(parseIsoDate(isoDate));
  if (config.closedWeekdays?.[weekday]) return CLOSED;
  if (config.holidayClosed && holidays.has(isoDate)) return CLOSED;
  return open(resolveWorkBlocks(config, isoDate, holidays));
}

/** Ist der Laden an diesem Datum geschlossen? (für die Anzeige in der UI). */
export function isDayClosed(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
  overrides: OverrideMap = {},
): boolean {
  return resolveDay(config, isoDate, holidays, overrides).closed;
}

/** Ein einzelner Eintrag aus einem gespeicherten Stand als Blockliste. */
function blocksFrom(value: unknown, fallback: DayBlocks): DayBlocks {
  if (Array.isArray(value)) {
    const out = value.filter(
      (b): b is DayWindow =>
        !!b && typeof b.startMinutes === "number" && typeof b.endMinutes === "number",
    );
    if (out.length > 0) return out.map((b) => ({ ...b }));
    return copy(fallback);
  }
  // Alter Stand: EIN Fenster als Objekt – wird zu einer Liste mit einem Block.
  const one = value as DayWindow | undefined;
  if (one && typeof one.startMinutes === "number" && typeof one.endMinutes === "number") {
    return [{ startMinutes: one.startMinutes, endMinutes: one.endMinutes }];
  }
  return copy(fallback);
}

/** Tiefe Kopie mit Auffüllen fehlender Felder aus den Zeiten der Filiale. */
export function normalizeWorkHours(
  partial: Partial<WorkHoursConfig> | undefined,
  base: WorkHoursConfig = DEFAULT_WORK_HOURS,
): WorkHoursConfig {
  const perWeekday = {} as Record<WeekdayKey, DayBlocks>;
  for (const key of Object.keys(base.perWeekday) as WeekdayKey[]) {
    perWeekday[key] = blocksFrom(partial?.perWeekday?.[key], base.perWeekday[key]);
  }
  const holiday = blocksFrom(partial?.holiday, base.holiday);

  const closedWeekdays = { ...base.closedWeekdays };
  if (partial?.closedWeekdays) {
    for (const key of Object.keys(closedWeekdays) as WeekdayKey[]) {
      const v = partial.closedWeekdays[key];
      if (typeof v === "boolean") closedWeekdays[key] = v;
    }
  }
  const holidayClosed = typeof partial?.holidayClosed === "boolean" ? partial.holidayClosed : Boolean(base.holidayClosed);
  return { perWeekday, holiday, closedWeekdays, holidayClosed };
}
