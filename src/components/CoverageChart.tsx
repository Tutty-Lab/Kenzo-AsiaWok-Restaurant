import { useMemo } from "react";
import type { Schedule, Shift } from "../types";
import { parseIsoDate, WEEKDAY_SHORT_VI, weekdayKeyOf } from "../lib/demand";
import { publicHolidayNames, publicHolidays } from "../lib/holidays";
import { coveragePoints, staffingWindows, validPause, workingAt, type StaffingRule } from "../lib/staffing";
import { effectiveWeekdayKey, resolveDay } from "../lib/workHours";
import { minutesToTime } from "../lib/time";

type Slot = {
  from: number;
  to: number;
  actual: number;
  required: number;
  closed: boolean;
  /** Wer um from arbeitet bzw. gerade Pause macht (Tooltip). */
  names: string[];
  paused: string[];
};

const SLOT = 30;

function minWorking(shifts: Shift[], from: number, to: number): number {
  const points = coveragePoints(shifts, from, to).slice(0, -1);
  return points.length
    ? Math.min(...points.map((minute) => new Set(shifts.filter((shift) => workingAt(shift, minute)).map((shift) => shift.employeeId)).size))
    : 0;
}

export function CoverageChart({ schedule, dates, rules }: { schedule: Schedule; dates: string[]; rules: readonly StaffingRule[] }) {
  const holidayNames = useMemo(() => publicHolidayNames(schedule.year), [schedule.year]);
  const rows = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const overrides = Object.fromEntries(schedule.dateOverrides.map((override) => [override.date, override]));
    const nameOf = new Map(schedule.employees.map((employee) => [employee.id, employee.name] as const));
    return dates.map((date) => {
      const day = resolveDay(schedule.workHours, date, holidays, overrides);
      const shifts = schedule.shifts.filter((shift) => shift.date === date);
      if (day.closed) return { date, slots: [] as Slot[] };
      const windows = staffingWindows(day.blocks, effectiveWeekdayKey(date, holidays), rules);
      // Rahmen: Öffnung plus Vorbereitung/Aufräumen, damit Dienste davor/danach sichtbar sind.
      const first = Math.min(day.window.startMinutes, ...shifts.map((shift) => shift.startMinutes));
      const last = Math.max(day.window.endMinutes, ...shifts.map((shift) => shift.endMinutes));
      const slots: Slot[] = [];
      for (let from = Math.floor(first / SLOT) * SLOT; from < last; from += SLOT) {
        const to = from + SLOT;
        const isOpen = day.blocks.some((block) => from >= block.startMinutes && to <= block.endMinutes);
        const active = windows.filter((window) => window.startMinutes < to && window.endMinutes > from);
        const here = shifts.filter((shift) => shift.startMinutes <= from && shift.endMinutes > from);
        slots.push({
          from,
          to,
          actual: minWorking(shifts, from, to),
          required: active.length ? Math.max(...active.map((window) => window.minStaff)) : 0,
          closed: !isOpen,
          names: here.filter((shift) => workingAt(shift, from)).map((shift) => nameOf.get(shift.employeeId) ?? "?"),
          paused: here.filter((shift) => validPause(shift) && !workingAt(shift, from)).map((shift) => nameOf.get(shift.employeeId) ?? "?"),
        });
      }
      return { date, slots };
    });
  }, [dates, schedule, rules]);

  const scale = Math.max(3, ...rows.flatMap((row) => row.slots.flatMap((slot) => [slot.actual, slot.required])));

  if (schedule.shifts.length === 0) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Tạo lịch trước để xem độ phủ.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Mỗi cột = 30 phút</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 bg-teal-600" /> Số đang làm</span>
        {rules.length > 0 && (
          <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-amber-600" /> Tối thiểu: {rules.map((rule) => `${rule.label} ${rule.when} ≥ ${rule.minStaff}`).join(" · ")}</span>
        )}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">Ngoài giờ mở (chuẩn bị/dọn)</span>
        <span className="text-slate-400">Chạm vào cột để xem tên</span>
      </div>

      {rows.map(({ date, slots }) => {
        const weekday = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(date))];
        const holiday = holidayNames.get(date);
        return (
          <section key={date} className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-label={`Độ phủ ${date}`}>
            <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {date.split("-").reverse().join(".")} · {weekday}
                {holiday && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Lễ: {holiday}</span>
                )}
              </h3>
            </header>
            {slots.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-slate-400">Đóng cửa</div>
            ) : (
              <div className="overflow-x-auto px-2 pb-2">
                <div className="flex min-w-max pt-2" role="list" aria-label={`Số người làm theo từng 30 phút ngày ${date}`}>
                  {slots.map((slot) => {
                    const shortfall = slot.required > 0 && slot.actual < slot.required;
                    const who = [
                      slot.names.length ? slot.names.join(", ") : "không ai",
                      slot.paused.length ? `đang nghỉ: ${slot.paused.join(", ")}` : "",
                    ].filter(Boolean).join(" · ");
                    const label = `${minutesToTime(slot.from)}–${minutesToTime(slot.to)}: ${slot.actual} người${slot.required ? `, cần ≥ ${slot.required}` : ""}${slot.closed ? " (ngoài giờ mở)" : ""} — ${who}`;
                    return (
                      <div
                        key={slot.from}
                        className={`w-11 shrink-0 border-r border-slate-100 text-center ${slot.closed ? "bg-slate-50" : "bg-white"} ${shortfall ? "ring-1 ring-inset ring-rose-400" : ""}`}
                        title={label}
                        aria-label={label}
                        role="listitem"
                      >
                        <div className="relative mx-1 h-16 border-b border-slate-300">
                          {slot.required > 0 && (
                            <span className="absolute inset-x-0 z-10 border-t-2 border-dashed border-amber-600" style={{ bottom: `${slot.required / scale * 100}%` }} />
                          )}
                          <span className={`absolute inset-x-1 bottom-0 ${slot.closed ? "bg-teal-300" : "bg-teal-600"}`} style={{ height: `${slot.actual / scale * 100}%` }} />
                          <span className="absolute inset-x-0 z-20 text-xs font-bold text-slate-900" style={{ bottom: `${Math.min(80, slot.actual / scale * 100 + 2)}%` }}>{slot.actual}</span>
                          {slot.paused.length > 0 && <span className="absolute right-0 top-0 z-20 text-[9px] text-slate-500">z</span>}
                        </div>
                        <div className="pt-1 text-[9px] font-medium text-slate-600">{minutesToTime(slot.from)}</div>
                        <div className={`pb-1 text-[9px] ${shortfall ? "font-bold text-rose-700" : "text-slate-400"}`}>{slot.required ? `≥${slot.required}` : slot.closed ? "ngoài" : ""}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
