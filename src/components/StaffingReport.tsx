import type { ScheduleAnalysis } from "../lib/analyze";
import { WEEKDAY_SHORT_VI } from "../lib/demand";
import { minutesToTime } from "../lib/time";

function hours(value: number) {
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}

export function StaffingReport({ analysis, hasRules }: { analysis: ScheduleAnalysis; hasRules: boolean }) {
  const open = analysis.days.filter((day) => !day.closed);
  const gaps = open.flatMap((day) => day.peaks.filter((peak) => !peak.ok).map((peak) => ({ day, peak })));
  const tone = !hasRules
    ? "border-slate-200 bg-white text-slate-700"
    : gaps.length
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <details className={`mb-3 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <summary className="cursor-pointer font-medium">
        {!hasRules
          ? "Giờ công theo ngày"
          : gaps.length
            ? `${gaps.length} khung thiếu người`
            : "Đủ người ở các khung yêu cầu"}
        <span className="ml-2 text-xs font-normal">Xem giờ công từng ngày</span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[420px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="border px-2 py-1 text-left">Ngày</th>
              <th className="border px-2 py-1">Số ca</th>
              <th className="border px-2 py-1">Giờ đã xếp</th>
              {hasRules && <th className="border px-2 py-1 text-left">Kiểm tra số người</th>}
            </tr>
          </thead>
          <tbody>
            {open.map((day) => (
              <tr key={day.date}>
                <td className="border px-2 py-1">{day.date.split("-").reverse().join(".")} · {WEEKDAY_SHORT_VI[day.weekday]}</td>
                <td className="border px-2 py-1 text-right">{day.shiftCount}</td>
                <td className="border px-2 py-1 text-right">{hours(day.paidHours)}</td>
                {hasRules && (
                  <td className="border px-2 py-1">
                    {day.peaks.map((peak) => (
                      <span key={`${peak.label}-${peak.startMinutes}`} className={peak.ok ? "mr-2 text-emerald-800" : "mr-2 font-medium text-rose-700"}>
                        {peak.label} {minutesToTime(peak.startMinutes)}–{minutesToTime(peak.endMinutes)}: {peak.minStaff} / cần {peak.required}
                      </span>
                    ))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
