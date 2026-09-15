// ============================================================================
// Einstieg in die Dienstplan-Erstellung. Geplant wird nach dem Grundplan jeder
// Person – die eigentliche Logik steht in baseScheduler.ts. Dieser Wrapper hält
// die Signatur für den Hook und die Tests stabil.
// ============================================================================

import type { Employee, Shift } from "../types";
import type { OverrideMap, WorkHoursConfig } from "./workHours";
import { generateBaseSchedule } from "./baseScheduler";
import type { StaffingRule } from "./staffing";

export type GenerateInput = {
  year: number;
  month: number; // 1-basiert
  /** Öffnungszeiten je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  overrides?: OverrideMap;
  employees: Employee[];
  /** Besetzungsregeln der Filiale (stores.ts); fehlt = keine Rücksicht auf Lücken. */
  rules?: readonly StaffingRule[];
  /** Feiertage als ISO-Set; Standard: Feiertage in NRW des Jahres. */
  holidays?: Set<string>;
  /** Nicht verwendet (der Planer ist deterministisch); bleibt für die Signatur. */
  seed?: string;
};

export function generateSchedule(input: GenerateInput): Shift[] {
  return generateBaseSchedule(input);
}
