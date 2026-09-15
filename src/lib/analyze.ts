// ============================================================================
// Auswertung eines fertigen Dienstplans. Rein lesend – verändert nichts.
//
// Beantwortet: Sind die Besetzungsregeln der Filiale (stores.ts) erfüllt, und
// wie viele Stunden stehen an jedem Tag?
// ============================================================================

import type { Employee, Shift } from "../types";
import { datesOfMonth, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";
import { publicHolidays } from "./holidays";
import { effectiveWeekdayKey, resolveDay, type OverrideMap, type WorkHoursConfig } from "./workHours";
import { coveragePoints, staffingWindows, workingAt, type StaffingRule } from "./staffing";
import { mayWorkOn } from "./availability";

export type PeakCoverage = {
  label: string;
  /** Kleinste Besetzung über die ganze Spanne. */
  minStaff: number;
  /** Größte Besetzung über die Spanne – für die Obergrenze. */
  maxStaff: number;
  required: number;
  /** So viele dürfen höchstens da sein. */
  allowed: number;
  ok: boolean;
  startMinutes: number;
  endMinutes: number;
};

export type DayReport = {
  date: string;
  weekday: WeekdayKey;
  closed: boolean;
  shiftCount: number;
  paidHours: number;
  peaks: PeakCoverage[];
};

export type ScheduleAnalysis = {
  days: DayReport[];
  openDays: number;
  totalPaidHours: number;
  /** Tage, an denen mindestens eine Besetzungsregel verletzt ist. */
  peakViolations: DayReport[];
  /** Mitarbeiter-Id -> zugewiesene Stunden. */
  hoursByEmployee: Map<string, number>;
};

export type AnalyzeInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  shifts: Shift[];
  rules: readonly StaffingRule[];
  holidays?: Set<string>;
};

export function analyzeSchedule(input: AnalyzeInput): ScheduleAnalysis {
  const holidays = input.holidays ?? publicHolidays(input.year);
  const overrides = input.overrides ?? {};
  const employeesById = new Map(input.employees.map((employee) => [employee.id, employee]));

  const byDate = new Map<string, Shift[]>();
  for (const s of input.shifts) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  const days: DayReport[] = datesOfMonth(input.year, input.month).map((date) => {
    const day = resolveDay(input.workHours, date, holidays, overrides);
    const onDay = byDate.get(date) ?? [];
    const available = onDay.filter((shift) => {
      const employee = employeesById.get(shift.employeeId);
      return employee && mayWorkOn(employee, date);
    });
    const peaks: PeakCoverage[] = day.closed ? [] : staffingWindows(day.blocks, effectiveWeekdayKey(date, holidays), input.rules)
      .map((peak) => {
        const points = coveragePoints(available, peak.startMinutes, peak.endMinutes).slice(0, -1);
        const counts = points.map((minute) => new Set(available.filter((shift) => workingAt(shift, minute)).map((shift) => shift.employeeId)).size);
        const minStaff = counts.length ? Math.min(...counts) : 0;
        const maxStaff = counts.length ? Math.max(...counts) : 0;
        return {
          label: peak.label,
          minStaff,
          maxStaff,
          required: peak.minStaff,
          allowed: peak.maxStaff,
          ok: minStaff >= peak.minStaff && maxStaff <= peak.maxStaff,
          startMinutes: peak.startMinutes,
          endMinutes: peak.endMinutes,
        };
      });
    return {
      date,
      weekday: weekdayKeyOf(parseIsoDate(date)),
      closed: day.closed,
      shiftCount: onDay.length,
      paidHours: onDay.reduce((sum, s) => sum + s.paidMinutes, 0) / 60,
      peaks,
    };
  });

  const hoursByEmployee = new Map<string, number>();
  for (const e of input.employees) hoursByEmployee.set(e.id, 0);
  for (const s of input.shifts) {
    hoursByEmployee.set(s.employeeId, (hoursByEmployee.get(s.employeeId) ?? 0) + s.paidMinutes / 60);
  }

  return {
    days,
    openDays: days.filter((d) => !d.closed).length,
    totalPaidHours: input.shifts.reduce((sum, s) => sum + s.paidMinutes, 0) / 60,
    peakViolations: days.filter((d) => d.peaks.some((p) => !p.ok)),
    hoursByEmployee,
  };
}
