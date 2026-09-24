import { DAY_WEIGHTS, WEEKDAY_LABELS_VI, WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import type { StoreConfig } from "../lib/stores";
import type { DayBlocks } from "../lib/workHours";
import { CLOSE_MINUTES, MIN_SHIFT_MINUTES, PREP_MINUTES, blockPriority } from "../lib/baseScheduler";
import { calculatePause, minutesToTime, presenceFromPaid } from "../lib/time";

const WEEKDAY_ORDER: WeekdayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const PAUSE_EXAMPLES = [2, 4, 6, 6.5, 8, 8.5, 10];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-2 text-base font-semibold text-slate-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

const blocksText = (blocks: DayBlocks) =>
  blocks.map((b) => `${minutesToTime(b.startMinutes)}–${minutesToTime(b.endMinutes)}`).join(" và ");

const fmt = (value: number) => value.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");

/** Giờ mở cửa mặc định của quán – lấy thẳng từ cấu hình trong code. */
function OpeningTable({ store }: { store: StoreConfig }) {
  const hours = store.workHours;
  const cell = "border border-slate-200 px-3 py-1.5";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] border-collapse text-sm">
        <tbody>
          {WEEKDAY_ORDER.map((key) => (
            <tr key={key}>
              <td className={`${cell} w-28 font-medium`}>{WEEKDAY_LABELS_VI[key]}</td>
              <td className={cell}>
                {hours.closedWeekdays[key] ? <span className="font-medium text-rose-600">Nghỉ</span> : blocksText(hours.perWeekday[key])}
              </td>
            </tr>
          ))}
          <tr>
            <td className={`${cell} font-medium`}>Ngày lễ (NRW)</td>
            <td className={cell}>
              {hours.holidayClosed ? <span className="font-medium text-rose-600">Nghỉ</span> : `${blocksText(hours.holiday)} (xếp như Chủ nhật; lễ rơi vào ngày quán nghỉ thì vẫn nghỉ)`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Thứ tự ưu tiên khi kéo dài/cắt ca – cùng hàm blockPriority với thuật toán. */
function PriorityTable() {
  const cell = "border border-slate-200 px-2 py-1 text-center";
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-slate-600">
            <th className={`${cell} text-left`}>Ca</th>
            {WEEKDAY_ORDER.map((key) => (
              <th key={key} className={`${cell} ${DAY_WEIGHTS[key] > 1 ? "bg-amber-50 text-amber-900" : ""}`}>{WEEKDAY_SHORT_VI[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {([["Trưa", 12 * 60], ["Tối", 17 * 60]] as const).map(([label, start]) => (
            <tr key={label}>
              <td className={`${cell} text-left font-medium`}>{label}</td>
              {WEEKDAY_ORDER.map((key) => (
                <td key={key} className={cell}>{fmt(blockPriority(key, start))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocsTab({ stores }: { stores: StoreConfig[] }) {
  // Hai quán KHÁC giờ mở và khác quy tắc số người, nên mục „giờ mở" và „số
  // người tối thiểu" in riêng cho từng quán; các mục còn lại (luật, lịch cơ
  // bản, thuật toán, giờ nghỉ) dùng chung.
  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg bg-slate-900 p-4 text-white sm:p-5">
        <h1 className="text-lg font-semibold">Tài liệu — nguyên tắc xếp lịch</h1>
        <p className="mt-1 text-sm text-slate-300">
          Mô tả đúng thuật toán đang chạy; bảng giờ mở và ưu tiên bên dưới lấy thẳng từ code. Thứ tự
          ưu tiên khi xung đột: <b>luật</b> → <b>hợp đồng</b> (không bao giờ vượt) → <b>lịch cơ bản</b> → <b>số người
          tối thiểu</b> → <b>ngày đông</b>.
        </p>
      </div>

      <Section title="1. Giờ mở cửa">
        {stores.map((store) => (
          <div key={store.id} className="space-y-1">
            <div className="text-sm font-semibold text-slate-900">
              {store.name} <span className="font-normal text-slate-500">· {store.address}</span>
            </div>
            <OpeningTable store={store} />
          </div>
        ))}
        <p className="text-slate-600">
          Giờ mở của từng tháng chỉnh ở <b>Cài đặt → Nâng cao</b>; ngày đóng cửa hay giờ riêng chỉnh ở <b>Ngày đặc biệt</b>.
          Hai quán dùng dữ liệu riêng nhưng hiện cùng lúc: mọi tab đều có phần của Kenzo và phần của Asia Wok,
          tháng/năm chọn chung ở thanh trên cùng.
        </p>
      </Section>

      <Section title="2. Điều kiện bắt buộc">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Luật giờ làm:</b> tối đa <b>10 giờ công/ngày</b> (cộng mọi ca trong ngày); tối đa <b>6 ngày liên tiếp</b>. Trên 6h công nghỉ <b>30′</b>, trên 8h nghỉ <b>60′</b> – nghỉ có giờ cụ thể, không làm quá 6h liền.</li>
          <li><b>Hợp đồng là giới hạn trên:</b> hợp đồng tuần không ISO-week nào vượt; hợp đồng tháng không vượt số giờ tháng. Không đủ thì cảnh báo vàng, không mượn giờ.</li>
          <li><b>Ca:</b> ngắn nhất <b>{minutesToTime(MIN_SHIFT_MINUTES)}</b>h; một ngày tối đa 2 ca (trưa + tối), cách nhau ≥ 30′.</li>
          <li>Ngày lễ tính theo <b>Nordrhein-Westfalen</b> (Warburg): không có Heilige Drei Könige, Mariä Himmelfahrt.</li>
        </ul>
      </Section>

      <Section title="3. Lịch cơ bản và hợp đồng">
        <ul className="list-disc space-y-1 pl-5">
          <li>Mỗi người nhập <b>lịch cơ bản theo thứ</b> (tab Nhân viên). Ngày lễ quán mở dùng lịch Chủ nhật. Ngày quán đóng thì không xếp.</li>
          <li><b>Hợp đồng tuần</b> (VD 40h/tuần): tuần đủ trong tháng = 40h. Tuần vắt qua 2 tháng chia theo <b>giờ lịch cơ bản</b> của các ngày thuộc tháng: T3+T4 cuối tháng với lịch 5h+5h trên tuần cơ bản 37h mang 40 × 10/37 ≈ 10,8h (làm tròn 30′).</li>
          <li><b>Hợp đồng tháng</b> (VD 120h/tháng): cân cả tháng một lần.</li>
          <li>Không có lịch cơ bản thì dùng giờ mở cửa làm lịch cơ bản.</li>
        </ul>
      </Section>

      <Section title="4. Thuật toán – các bước">
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>Đặt ca theo lịch cơ bản</b> vào mọi ngày quán mở trong tháng (từ ngày vào làm).</li>
          <li><b>Thừa giờ → cắt.</b> Trước tiên chỗ cắt không làm thiếu người (mục 5), rồi ngày ít ưu tiên nhất.
            Người <b>được điều chỉnh</b>: cắt phần chuẩn bị/dọn ngoài giờ mở → rút ca 30′ (tối đa 1h dưới lịch cơ bản) → bỏ cả ca.
            Người <b>giữ khung</b>: bỏ cả ca trước (rải đều trong tháng, không bỏ dồn một tuần) → phần dư mới rút ngắn.</li>
          <li><b>Thiếu giờ → kéo dài</b> (chỉ người được điều chỉnh), mỗi bước 30′: chỗ đang thiếu người trước → trong giờ mở trước ngoài giờ mở →
            ngày ưu tiên cao trước, rải lần lượt các ca. Giới hạn: <b>{PREP_MINUTES}′ trước giờ mở</b>, <b>{CLOSE_MINUTES}′ sau giờ đóng</b>, 10h/ngày.
            Vẫn thiếu thì thêm một ca 2h vào khung mở còn trống của ngày người đó đang làm.</li>
          <li>Người giữ khung được xếp trước, người được điều chỉnh xếp sau để lấp chỗ trống.</li>
          <li><b>Kiểm tra:</b> luật, hợp đồng, nghỉ và độ phủ; lỗi đỏ chặn, cảnh báo vàng không chặn in.</li>
        </ol>
        <p><b>Điểm ưu tiên</b> = hệ số ngày (T6, T7, CN = 1,5; ngày khác 1,0) + 0,25 cho ca tối — tối T6–CN được kéo dài trước, cắt sau cùng:</p>
        <PriorityTable />
      </Section>

      <Section title="5. Số người tối thiểu">
        {stores.map((store) => (
          <div key={store.id} className="space-y-1">
            <div className="text-sm font-semibold text-slate-900">{store.name}</div>
            {store.staffingRules.length === 0 ? (
              <p>Quán này <b>không đặt số người tối thiểu</b>. Tab Độ phủ chỉ hiện ai đang làm từng 30′.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {store.staffingRules.map((rule) => (
                  <li key={rule.label}><b>{rule.label}</b> ({rule.when}): ít nhất <b>{rule.minStaff} người</b> đang làm (người đang nghỉ giữa ca không tính).</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p>Thiếu người là <b>cảnh báo</b> (lịch vẫn hợp lệ): lịch cơ bản và giờ hợp đồng có thể không đủ phủ.</p>
      </Section>

      <Section title="6. Giờ nghỉ">
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="border border-slate-200 px-3 py-1">Giờ công</th>
                <th className="border border-slate-200 px-3 py-1">Nghỉ</th>
                <th className="border border-slate-200 px-3 py-1">Có mặt</th>
              </tr>
            </thead>
            <tbody>
              {PAUSE_EXAMPLES.map((hours) => (
                <tr key={hours}>
                  <td className="border border-slate-200 px-3 py-1">{fmt(hours)}h</td>
                  <td className="border border-slate-200 px-3 py-1">{calculatePause(hours * 60)}′</td>
                  <td className="border border-slate-200 px-3 py-1">{fmt(presenceFromPaid(hours * 60) / 60)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-slate-600">Khoảng nghỉ trưa giữa hai ca (VD 14:30–17:00) không tính công và không phải giờ nghỉ giữa ca.</p>
      </Section>

      <Section title="7. Cách dùng">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Chọn quán ở đầu trang. Kiểm tra giờ mở, ngày lễ và ngày đặc biệt trong <b>Cài đặt</b>.</li>
          <li>Kiểm tra hợp đồng, lịch cơ bản, „Được điều chỉnh" và ngày vào làm trong <b>Nhân viên</b>.</li>
          <li>Bấm <b>Tạo lịch làm việc</b>, xem <b>Độ phủ</b> và các cảnh báo (i) trước khi xuất PDF.</li>
          <li>Sửa tay xong thì xem lại cảnh báo rồi mới in.</li>
        </ol>
      </Section>
    </div>
  );
}
