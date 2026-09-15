// ============================================================================
// Wann darf eine Person überhaupt eingeplant werden?
//
// Die Wochentage ergeben sich aus dem Grundplan (types.ts baseSchedule); hier
// steht nur, was für JEDEN Tag gilt – der Eintritt.
// ============================================================================

import type { Employee } from "../types";

/**
 * Hat die Person an diesem Tag schon angefangen? Ohne startDate: immer ja.
 * Der ISO-Stringvergleich reicht, weil "yyyy-MM-dd" lexikografisch = zeitlich.
 */
export function hasStarted(employee: Employee, isoDate: string): boolean {
  return employee.startDate == null || isoDate >= employee.startDate;
}

/** Darf diese Person an diesem Datum arbeiten? */
export function mayWorkOn(employee: Employee, isoDate: string): boolean {
  return hasStarted(employee, isoDate);
}
