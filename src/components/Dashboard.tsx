import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, Schedule } from "../types";
import { minutesToDecimalHours } from "../lib/time";
import { monthlyTargetMinutesFor } from "../lib/contract";

/** "2026-08-27" -> "27.08." – kurz, weil oft mehrere Tage nebeneinander stehen. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

/**
 * Aufklappbarer Hinweis: eine Zeile mit Zusammenfassung und (i)-Knopf; die
 * ausführliche Begründung erscheint erst beim Klick. So steht bei einer Warnung
 * nicht mehr die ganze Liste dauerhaft auf dem Bildschirm.
 */
function InfoNote({
  tone,
  summary,
  children,
}: {
  tone: "error" | "warning";
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cls =
    tone === "error"
      ? "bg-rose-50 border-rose-200 text-rose-900"
      : "bg-amber-50 border-amber-200 text-amber-900";
  const icon = tone === "error" ? "✕" : "!";
  const badge = tone === "error" ? "bg-rose-200 text-rose-800" : "bg-amber-200 text-amber-800";
  return (
    <div className={`mt-2 rounded border text-sm ${cls}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge}`}>
          {icon}
        </span>
        <span className="flex-1 font-medium">{summary}</span>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current/40 text-xs font-semibold opacity-70"
          title={open ? "Ẩn chi tiết" : "Xem chi tiết vì sao"}
        >
          {open ? "×" : "i"}
        </span>
      </button>
      {open && <div className="border-t border-current/15 px-3 py-2 font-normal">{children}</div>}
    </div>
  );
}

/** Warum erreicht diese Person ihr Soll nicht? Aus ihren Feldern abgeleitet. */
function underQuotaReason(emp: Employee | undefined, schedule: Schedule): string {
  if (!emp) return "tháng này không đủ ngày cho định mức đó.";
  const prefix = `${schedule.year}-${String(schedule.month).padStart(2, "0")}-`;
  const parts: string[] = [];
  if (emp.startDate && emp.startDate.startsWith(prefix)) {
    parts.push(`vào làm từ ${shortDate(emp.startDate)} (các ngày trước không tính)`);
  }
  if (emp.adjustable) {
    parts.push("đã kéo dài ca tối đa (60′ trước giờ mở, 30′ sau giờ đóng) và thêm ca 2h ở ngày đang làm mà vẫn chưa đủ — lịch cơ bản quá ít ngày");
  } else {
    parts.push("giữ khung lịch cơ bản (không bật „Được điều chỉnh”), tháng này khung đó chỉ có chừng ấy giờ — ngày lễ/ngày đóng cửa cũng bớt giờ");
  }
  return `do ${parts.join("; ")}.`;
}

export function Dashboard({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, peakGaps, openDates } = store;
  const vz = schedule.employees.filter((e) => e.employmentType === "VOLLZEIT").length;
  const tz = schedule.employees.filter((e) => e.employmentType === "TEILZEIT").length;
  const mj = schedule.employees.filter((e) => e.employmentType === "MINIJOB").length;
  const byId = new Map(schedule.employees.map((e) => [e.id, e] as const));
  // Wochenverträge (weeklyHours) haben targetMinutes = 0; das Monats-Soll wird
  // erst über die offenen Tage abgeleitet (contract.ts), genau wie in der Prüfung.
  const targetMin = schedule.employees.reduce((s, e) => s + monthlyTargetMinutesFor(e, openDates, schedule.workHours), 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  const uncoveredMin = Math.max(0, targetMin - plannedMin);
  const notGenerated = schedule.shifts.length === 0;

  // Warnungen und Fehler getrennt: ein zu hohes Monats-Soll macht den Plan nicht
  // unbrauchbar, es fehlen nur Stunden, die der Monat nicht hergibt.
  const warnungen = validation.errors.filter((e) => e.severity === "warning");
  const fehler = validation.errors.filter((e) => e.severity !== "warning");

  const statusValue = notGenerated
    ? "Chưa tạo lịch"
    : fehler.length > 0
      ? `${fehler.length} lỗi`
      : warnungen.length > 0
        ? `${warnungen.length} cảnh báo`
        : "Hợp lệ";
  const statusAccent = notGenerated
    ? "text-slate-500"
    : fehler.length > 0
      ? "text-rose-600"
      : warnungen.length > 0
        ? "text-amber-600"
        : "text-emerald-600";

  const pct = targetMin > 0 ? Math.min(100, Math.round((plannedMin / targetMin) * 100)) : 0;
  const statusPill =
    statusAccent === "text-emerald-600"
      ? "bg-emerald-50 text-emerald-700"
      : statusAccent === "text-rose-600"
        ? "bg-rose-50 text-rose-700"
        : statusAccent === "text-amber-600"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";

  return (
    <div>
      {/* Eine Karte statt acht Zahlenkacheln (wie die Demo): Stunden als Balken. */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">
            Giờ đã xếp · {schedule.employees.length} người ({vz} TT · {tz} BT · {mj} MJ)
          </span>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill}`}>
            {statusValue === "Hợp lệ" ? "✓ Hợp lệ" : statusValue}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-slate-900">{minutesToDecimalHours(plannedMin, 0)}</span>
          <span className="text-sm text-slate-500">/ {minutesToDecimalHours(targetMin, 1)} h định mức</span>
          <span className={`ml-auto text-sm font-semibold ${uncoveredMin ? "text-amber-600" : "text-slate-500"}`}>{pct}%</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-slate-700" style={{ width: `${pct}%` }} />
          {uncoveredMin > 0 && plannedMin > 0 && <div className="bg-amber-300" style={{ width: `${100 - pct}%` }} />}
        </div>
        {!notGenerated && (
          <div className="mt-1.5 text-xs text-slate-600">
            {uncoveredMin > 0 ? <>Còn thiếu <b className="text-amber-700">{minutesToDecimalHours(uncoveredMin, 1)} h</b> chưa xếp được</> : "Đủ giờ cho mọi người"}
          </div>
        )}
      </div>

      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          Chưa có lịch — bấm Tạo lịch.
        </div>
      )}

      {/* Lỗi: gộp sau nút (i). */}
      {fehler.length > 0 && (
        <InfoNote tone="error" summary={`${fehler.length} lỗi cần sửa trước khi dùng lịch`}>
          <ul className="space-y-1">
            {fehler.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </InfoNote>
      )}

      {/* Cảnh báo thiếu giờ: một dòng + (i) mở chi tiết vì sao từng người. */}
      {warnungen.length > 0 && schedule.shifts.length > 0 && (
        <InfoNote tone="warning" summary={`${warnungen.length} người chưa đủ giờ định mức (lịch vẫn dùng được)`}>
          <ul className="space-y-1.5">
            {warnungen.map((w, i) => {
              const emp = w.employeeId ? byId.get(w.employeeId) : undefined;
              return (
                <li key={i}>
                  <div>{w.message}</div>
                  <div className="opacity-80">→ Vì sao: {underQuotaReason(emp, schedule)}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 opacity-80">
            App xếp theo lịch cơ bản của từng người và không bao giờ vượt hợp đồng. Muốn đủ giờ thì thêm
            ngày/khung vào lịch cơ bản, bật „Được điều chỉnh", hoặc sửa hợp đồng ở tab Nhân viên.
          </div>
        </InfoNote>
      )}

      {/* Cao điểm lệch số người: một dòng + (i). */}
      {peakGaps.length > 0 && (
        <InfoNote tone="warning" summary={`${peakGaps.length} ngày lệch số người ở giờ cao điểm`}>
          <div className="space-y-0.5">
            {peakGaps.slice(0, 8).map((d) => (
              <div key={d.date}>
                <b>{shortDate(d.date)}</b>{" "}
                {d.peaks
                  .filter((p) => !p.ok)
                  .map((p) =>
                    p.minStaff < p.required
                      ? `${p.label} thiếu: ${p.minStaff}/${p.required} người`
                      : `${p.label} thừa: ${p.maxStaff}, tối đa ${p.allowed}`,
                  )
                  .join(" · ")}{" "}
                <span className="opacity-70">({d.shiftCount} ca, {d.paidHours}h)</span>
              </div>
            ))}
            {peakGaps.length > 8 && <div className="opacity-70">… và {peakGaps.length - 8} ngày nữa</div>}
          </div>
          <div className="mt-2 opacity-80">
            → Vì sao: lịch cơ bản và giờ hợp đồng của mọi người chưa phủ đủ khung yêu cầu của quán (
            {store.storeConfig.staffingRules.map((rule) => `${rule.label} ${rule.when} ≥ ${rule.minStaff} người`).join("; ")}).
            Cách xử lý: thêm khung vào lịch cơ bản của ai đó, sửa tay ca ngày đó, hoặc chấp nhận vì lịch vẫn hợp lệ.
          </div>
        </InfoNote>
      )}
    </div>
  );
}
