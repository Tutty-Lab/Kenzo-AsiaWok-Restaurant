// ============================================================================
// Zentrales State-Management (ohne externe Bibliothek). Kapselt Schedule,
// LocalStorage-Persistenz und alle Aktionen (Generieren, Bearbeiten, Reset) –
// je Filiale getrennt: das Umschalten lädt den Stand der anderen Filiale.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BaseSchedule, Employee, EmploymentType, Schedule, Shift } from "../types";
import { generateSchedule } from "../lib/scheduler";
import { isScheduleYearAllowed, SCHEDULE_YEAR_RANGE_LABEL } from "../lib/years";
import { analyzeSchedule } from "../lib/analyze";
import { validateSchedule, type ValidationResult } from "../lib/validation";
import { clearState, loadState, saveState, type PersistedState } from "../lib/storage";
import { MIN_PASSWORD_LENGTH, hashPassword, passwordMatches } from "../lib/auth";
import { isRemoteConfigured, loadRemote, saveRemote, type RemoteStatus } from "../lib/remote";
import { createManualShift, updateShiftTimes } from "../lib/shiftOps";
import { normalizeWorkHours, resolveDay, type DateOverride, type OverrideMap } from "../lib/workHours";
import { DAY_WEIGHTS, datesOfMonth, type WeekdayKey } from "../lib/demand";
import { publicHolidays } from "../lib/holidays";
import { initialScheduleFor, storeById, type StoreConfig } from "../lib/stores";
import { contractOpenDays } from "../lib/contract";
import { weekStartOf } from "../lib/weeks";

/**
 * Steht in diesem Stand überhaupt etwas? Maßstab sind Mitarbeiter und
 * Schichten – Firmenname und Monat allein sind noch kein Inhalt.
 */
function hatInhalt(state: PersistedState): boolean {
  return state.schedule.employees.length > 0 || state.schedule.shifts.length > 0;
}

function emptySchedule(store: StoreConfig): Schedule {
  const now = new Date();
  return {
    companyName: store.name,
    address: store.address,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    workHours: structuredClone(store.workHours),
    dateOverrides: [],
    employees: [],
    shifts: [],
  };
}

/** Ausnahmen-Array -> nach Datum indizierte Map (für den Scheduler). */
function overridesToMap(list: DateOverride[]): OverrideMap {
  const map: OverrideMap = {};
  for (const ov of list) map[ov.date] = ov;
  return map;
}

const WEEKDAYS = Object.keys(DAY_WEIGHTS) as WeekdayKey[];
const EMPLOYMENT_TYPES: EmploymentType[] = ["VOLLZEIT", "TEILZEIT", "MINIJOB"];

/** Bereinigt einen (evtl. alten oder von Hand gebauten) Mitarbeiter. */
export function normalizeEmployee(raw: Employee): Employee {
  const base: BaseSchedule = {};
  for (const key of WEEKDAYS) {
    const blocks = raw.baseSchedule?.[key];
    if (!Array.isArray(blocks)) continue;
    const clean = blocks
      .filter((b) => b && Number.isFinite(b.startMinutes) && Number.isFinite(b.endMinutes) && b.endMinutes > b.startMinutes)
      .map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes }))
      .sort((a, b) => a.startMinutes - b.startMinutes);
    if (clean.length > 0) base[key] = clean;
  }
  return {
    id: raw.id,
    name: raw.name,
    employmentType: EMPLOYMENT_TYPES.includes(raw.employmentType) ? raw.employmentType : "TEILZEIT",
    targetMinutes: Number.isFinite(raw.targetMinutes) ? Math.max(0, Math.round(raw.targetMinutes)) : 0,
    ...(typeof raw.weeklyHours === "number" && Number.isFinite(raw.weeklyHours) ? { weeklyHours: raw.weeklyHours } : {}),
    ...(Object.keys(base).length > 0 ? { baseSchedule: base } : {}),
    adjustable: Boolean(raw.adjustable),
    ...(raw.startDate ? { startDate: raw.startDate } : {}),
  };
}

/** Migriert einen (evtl. alten) gespeicherten Stand auf das aktuelle Schema. */
function normalizeSchedule(raw: Schedule | undefined, store: StoreConfig): Schedule {
  const base = emptySchedule(store);
  if (!raw) return base;
  return {
    // Firmenname & Adresse kommen aus der Filiale (không cho sửa).
    companyName: store.name,
    address: store.address,
    year: raw.year ?? base.year,
    month: raw.month ?? base.month,
    workHours: normalizeWorkHours(raw.workHours, store.workHours),
    dateOverrides: Array.isArray(raw.dateOverrides) ? raw.dateOverrides : [],
    employees: (raw.employees ?? []).map(normalizeEmployee),
    shifts: raw.shifts ?? [],
    lockedAt: raw.lockedAt,
    printedWeeks: Array.isArray(raw.printedWeeks) ? raw.printedWeeks : [],
  };
}

/** Lokaler Stand einer Filiale; beim allerersten Öffnen die Startbelegschaft. */
function localStateOf(storeId: string): PersistedState {
  const store = storeById(storeId);
  const persisted = loadState(storeId);
  return {
    schedule: normalizeSchedule(persisted?.schedule ?? initialScheduleFor(store), store),
    originalShifts: persisted?.originalShifts ?? [],
    passwordHash: persisted?.passwordHash,
  };
}

function newEmployeeId(): string {
  return `emp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function useSchedule(storeId: string) {
  const storeConfig = storeById(storeId);
  const [initial] = useState(() => localStateOf(storeId));
  const [schedule, setSchedule] = useState<Schedule>(initial.schedule);
  const [passwordHash, setPasswordHash] = useState<string | undefined>(initial.passwordHash);
  const [originalShifts, setOriginalShifts] = useState<Shift[]>(initial.originalShifts);
  const [genError, setGenError] = useState<string | null>(null);
  // Zählt jede ERFOLGREICHE Generierung hoch – die Oberfläche zeigt daraufhin
  // eine kurze Erfolgsmeldung („Đã tạo lịch").
  const [genStamp, setGenStamp] = useState(0);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>(
    isRemoteConfigured ? "idle" : "off",
  );

  // Immer sofort lokal sichern – das ist der Offline-Puffer. storeId wechselt im
  // SELBEN Update wie der Stand (setStoreId), daher passt beides zusammen.
  useEffect(() => {
    saveState(storeId, { schedule, originalShifts, passwordHash });
  }, [storeId, schedule, originalShifts, passwordHash]);

  // Letzter Stand für Zugriffe außerhalb des Renders (siehe Erst-Upload).
  const latest = useRef<PersistedState>({ schedule, originalShifts, passwordHash });
  useEffect(() => {
    latest.current = { schedule, originalShifts, passwordHash };
  }, [schedule, originalShifts, passwordHash]);

  // Beim Start und nach jedem Filialwechsel den Stand dieser Filiale aus der
  // gemeinsamen Datenbank holen. Vorher darf nicht hochgeladen werden, sonst
  // überschreibt der lokale (evtl. leere) Stand die Daten in der Datenbank.
  const hydrated = useRef(!isRemoteConfigured);
  useEffect(() => {
    if (!isRemoteConfigured) return;
    hydrated.current = false;
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadRemote(storeId);
        if (cancelled) return;
        if (remote?.schedule) {
          setSchedule(normalizeSchedule(remote.schedule, storeById(storeId)));
          setOriginalShifts(remote.originalShifts ?? []);
          setPasswordHash(remote.passwordHash);
        } else if (hatInhalt(latest.current)) {
          // Noch keine Zeile für diese Filiale: lokalen Stand hochladen –
          // aber nur, wenn lokal überhaupt etwas drinsteht.
          await saveRemote(storeId, latest.current);
        }
        if (!cancelled) setRemoteStatus("idle");
        // NUR nach erfolgreichem Lesen darf hochgeladen werden.
        if (!cancelled) hydrated.current = true;
      } catch {
        // Lesen fehlgeschlagen: hydrated bleibt false, es wird NICHTS
        // hochgeladen – sonst überschreibt der lokale Stand die Datenbank.
        if (!cancelled) setRemoteStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  // Änderungen gebündelt hochladen (nicht bei jedem Tastendruck).
  useEffect(() => {
    if (!isRemoteConfigured || !hydrated.current) return;
    const timer = window.setTimeout(() => {
      setRemoteStatus("saving");
      saveRemote(storeId, { schedule, originalShifts, passwordHash })
        .then(() => setRemoteStatus("idle"))
        .catch(() => setRemoteStatus("error"));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [storeId, schedule, originalShifts, passwordHash]);

  // Offene Tage des Monats als ISO-Liste – Grundlage für das Monats-Soll von
  // Wochenverträgen (contract.ts / validateSchedule).
  const openDates = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const overrides = overridesToMap(schedule.dateOverrides);
    return datesOfMonth(schedule.year, schedule.month).filter(
      (d) => !resolveDay(schedule.workHours, d, holidays, overrides).closed,
    );
  }, [schedule.year, schedule.month, schedule.workHours, schedule.dateOverrides]);

  const openDays = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const date of openDates) byWeek.set(weekStartOf(date), (byWeek.get(weekStartOf(date)) ?? 0) + 1);
    return contractOpenDays([...byWeek.values()]);
  }, [openDates]);

  const validation: ValidationResult = useMemo(
    () => validateSchedule(schedule.employees, schedule.shifts, schedule.year, openDates, schedule.workHours),
    [schedule.employees, schedule.shifts, schedule.year, openDates, schedule.workHours],
  );

  /**
   * Tage, an denen eine Besetzungsregel der Filiale verletzt ist. Bewusst KEIN
   * Validierungsfehler: der Plan ist rechnerisch korrekt, es sind schlicht zu
   * wenige Leute da.
   */
  const analysis = useMemo(() => {
    return analyzeSchedule({
      year: schedule.year,
      month: schedule.month,
      workHours: schedule.workHours,
      overrides: overridesToMap(schedule.dateOverrides),
      employees: schedule.employees,
      shifts: schedule.shifts,
      rules: storeConfig.staffingRules,
    });
  }, [
    schedule.year,
    schedule.month,
    schedule.workHours,
    schedule.dateOverrides,
    schedule.employees,
    schedule.shifts,
    storeConfig,
  ]);
  const peakGaps = schedule.shifts.length === 0 ? [] : analysis.peakViolations;

  /**
   * Gesperrt = eine Woche dieses Monats wurde bereits ausgedruckt. Ab da darf
   * sich am Plan nichts mehr ändern, sonst weicht das Papier im Laden vom
   * Stand im System ab. Alle ändernden Aktionen prüfen das selbst.
   */
  const isLocked = Boolean(schedule.lockedAt);

  // ----- Firma / Monat / Öffnungszeiten -----
  const updateMeta = useCallback((patch: Partial<Schedule>) => {
    setSchedule((s) => {
      // Ein Monatswechsel beginnt einen neuen Plan: die Sperre des alten
      // Monats darf nicht mitwandern.
      const monthChanged =
        (patch.year !== undefined && patch.year !== s.year) ||
        (patch.month !== undefined && patch.month !== s.month);
      if (monthChanged) {
        return { ...s, ...patch, lockedAt: undefined, printedWeeks: [] };
      }
      return { ...s, ...patch };
    });
  }, []);

  /**
   * Sofort speichern, ohne die Entprell-Zeit abzuwarten – für Sperren,
   * Entsperren und Passwort: wer direkt danach neu lädt, soll den neuen Stand
   * sehen und nicht den alten aus der Datenbank.
   */
  const pushNow = useCallback(async (state: PersistedState) => {
    saveState(storeId, state);
    if (!isRemoteConfigured || !hydrated.current) return;
    setRemoteStatus("saving");
    try {
      await saveRemote(storeId, state);
      setRemoteStatus("idle");
    } catch {
      setRemoteStatus("error");
    }
  }, [storeId]);

  /** Passwort der Filiale ändern. Gibt eine Meldung zurück oder null bei Erfolg. */
  const changePassword = useCallback(
    async (alt: string, neu: string): Promise<string | null> => {
      if (!(await passwordMatches(alt, latest.current.passwordHash))) {
        return "Mật khẩu hiện tại không đúng.";
      }
      const sauber = neu.trim();
      if (sauber.length < MIN_PASSWORD_LENGTH) {
        return `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
      }
      const neuerHash = await hashPassword(sauber);
      setPasswordHash(neuerHash);
      await pushNow({ ...latest.current, passwordHash: neuerHash });
      return null;
    },
    [pushNow],
  );

  /** Merkt eine gedruckte Woche und sperrt den Monat beim ersten Mal. */
  const markWeekPrinted = useCallback(
    (weekStart: string) => {
      const current = latest.current;
      const weeks = current.schedule.printedWeeks ?? [];
      const next: Schedule = {
        ...current.schedule,
        printedWeeks: weeks.includes(weekStart) ? weeks : [...weeks, weekStart].sort(),
        lockedAt: current.schedule.lockedAt ?? new Date().toISOString(),
      };
      setSchedule(next);
      void pushNow({ ...current, schedule: next });
    },
    [pushNow],
  );

  /** Sperre wieder aufheben (die Oberfläche fragt vorher nach). */
  const unlockMonth = useCallback(() => {
    const current = latest.current;
    const next: Schedule = { ...current.schedule, lockedAt: undefined };
    setSchedule(next);
    void pushNow({ ...current, schedule: next });
  }, [pushNow]);

  // ----- Mitarbeiter -----
  const addEmployee = useCallback((data: Omit<Employee, "id">): string | null => {
    if (latest.current.schedule.lockedAt) return null; // Monat gedruckt und gesperrt
    const emp = normalizeEmployee({
      ...data,
      id: newEmployeeId(),
      name: data.name.trim() || "Nhân viên mới",
    });
    setSchedule((s) => {
      if (s.lockedAt) return s;
      return { ...s, employees: [...s.employees, emp] };
    });
    return emp.id;
  }, []);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        // Ein Patch ersetzt das Blatt komplett: fehlt weeklyHours, gilt der Monatsvertrag.
        employees: s.employees.map((e) => (e.id === id ? normalizeEmployee({ id, ...patch } as Employee) : e)),
      };
    });
  }, []);

  const removeEmployee = useCallback((id: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        employees: s.employees.filter((e) => e.id !== id),
        shifts: s.shifts.filter((sh) => sh.employeeId !== id),
      };
    });
  }, []);

  // ----- Generierung -----
  /**
   * Plan erzeugen – für den gewählten Monat (Popup „Tạo lịch") oder, ohne
   * Angabe, für den aktuellen. Monat/Jahr werden im SELBEN Update gesetzt wie
   * die Schichten.
   */
  const generate = useCallback((target?: { year: number; month: number }) => {
    setGenError(null);
    const year = target?.year ?? schedule.year;
    const month = target?.month ?? schedule.month;
    if (!isScheduleYearAllowed(year)) {
      setGenError(`Chỉ tạo lịch cho các năm ${SCHEDULE_YEAR_RANGE_LABEL}.`);
      return;
    }
    try {
      const shifts = generateSchedule({
        year,
        month,
        workHours: schedule.workHours,
        overrides: overridesToMap(schedule.dateOverrides),
        employees: schedule.employees,
        rules: storeConfig.staffingRules,
      });
      setSchedule((s) => ({ ...s, year, month, shifts, lockedAt: undefined, printedWeeks: [] }));
      setOriginalShifts(shifts.map((sh) => ({ ...sh })));
      setGenStamp((n) => n + 1);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    }
  }, [
    schedule.year,
    schedule.month,
    schedule.workHours,
    schedule.dateOverrides,
    schedule.employees,
    storeConfig,
  ]);

  const resetToOriginal = useCallback(() => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return { ...s, shifts: originalShifts.map((sh) => ({ ...sh })) };
    });
  }, [originalShifts]);

  const resetAll = useCallback(() => {
    clearState(storeId);
    setSchedule(emptySchedule(storeById(storeId)));
    setOriginalShifts([]);
    setGenError(null);
  }, [storeId]);

  const saveNow = useCallback(() => {
    saveState(storeId, { schedule, originalShifts, passwordHash });
  }, [storeId, schedule, originalShifts, passwordHash]);

  // ----- Ausnahmen je Datum -----
  const upsertOverride = useCallback((override: DateOverride) => {
    setSchedule((s) => {
      const rest = s.dateOverrides.filter((o) => o.date !== override.date);
      const next = [...rest, override].sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, dateOverrides: next };
    });
  }, []);

  const removeOverride = useCallback((date: string) => {
    setSchedule((s) => ({
      ...s,
      dateOverrides: s.dateOverrides.filter((o) => o.date !== date),
    }));
  }, []);

  // ----- Schicht-Bearbeitung -----
  const findShift = useCallback(
    (employeeId: string, date: string): Shift | undefined =>
      schedule.shifts.find((s) => s.employeeId === employeeId && s.date === date),
    [schedule.shifts],
  );

  const editShiftTimes = useCallback(
    (
      shiftId: string,
      changes: Partial<Pick<Shift, "startMinutes" | "endMinutes" | "pauseMinutes" | "pauseStartMinutes">>,
    ) => {
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        return {
          ...s,
          shifts: s.shifts.map((sh) => (sh.id === shiftId ? updateShiftTimes(sh, changes) : sh)),
        };
      });
    },
    [],
  );

  const addShift = useCallback(
    (employeeId: string, date: string, start: number, end: number, pause: number, pauseStart?: number) => {
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        const overlaps = s.shifts.some(
          (sh) => sh.employeeId === employeeId && sh.date === date && sh.startMinutes < end && start < sh.endMinutes,
        );
        if (overlaps) return s;
        return { ...s, shifts: [...s.shifts, createManualShift(employeeId, date, start, end, pause, pauseStart)] };
      });
    },
    [],
  );

  const deleteShift = useCallback((shiftId: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return { ...s, shifts: s.shifts.filter((sh) => sh.id !== shiftId) };
    });
  }, []);

  /** Markiert einen Tag als "Frei": entfernt alle Schichten dieses Tages. */
  const setFrei = useCallback((employeeId: string, date: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        shifts: s.shifts.filter((sh) => !(sh.employeeId === employeeId && sh.date === date)),
      };
    });
  }, []);

  /** Verschiebt eine Schicht zu einem anderen Mitarbeiter (gleicher Tag). */
  const moveShiftToEmployee = useCallback((shiftId: string, targetEmployeeId: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      const shift = s.shifts.find((sh) => sh.id === shiftId);
      if (!shift) return s;
      const conflict = s.shifts.some(
        (sh) => sh.employeeId === targetEmployeeId && sh.date === shift.date,
      );
      if (conflict) return s;
      return {
        ...s,
        shifts: s.shifts.map((sh) =>
          sh.id === shiftId ? { ...sh, employeeId: targetEmployeeId, generated: false } : sh,
        ),
      };
    });
  }, []);

  return {
    storeId,
    storeConfig,
    schedule,
    originalShifts,
    validation,
    peakGaps,
    analysis,
    openDays,
    openDates,
    isLocked,
    markWeekPrinted,
    unlockMonth,
    genError,
    genStamp,
    hasOriginal: originalShifts.length > 0,
    updateMeta,
    addEmployee,
    updateEmployee,
    removeEmployee,
    changePassword,
    hasOwnPassword: passwordHash !== undefined,
    generate,
    resetToOriginal,
    resetAll,
    remoteStatus,
    isRemoteConfigured,
    saveNow,
    upsertOverride,
    removeOverride,
    findShift,
    editShiftTimes,
    addShift,
    deleteShift,
    setFrei,
    moveShiftToEmployee,
  };
}

export type UseScheduleReturn = ReturnType<typeof useSchedule>;
