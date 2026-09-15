# Quy tắc giờ làm & nghỉ

Hai nhóm quy tắc: **(1) LUẬT** (không được vi phạm) và **(2) quy tắc app/quán**
(đổi được tuỳ quán). Thuật toán xếp lịch và phần nghiệm thu đều đối chiếu theo đây.

---

## 1. Giờ làm & nghỉ — quán ăn Đức (LUẬT, bản gọn)

- **Tối đa 10h/ngày** (bình thường **8h**) — không hơn, kể cả làm thêm.
- **Tối đa 6 ngày/tuần**, phải có **1 ngày nghỉ**.
- Làm **> 6h → nghỉ 30 phút**; làm **> 8h → nghỉ 60 phút** (nghỉ **không tính lương**).
- **Nghỉ ≥ 11h** giữa hai ca.
- **Làm đêm / Chủ Nhật / lễ → có phụ cấp** (đêm **~25%**).
- **Dưới 18 tuổi**: tối đa **8h/ngày**, **không làm sau 22h**.
- **Ghi giờ làm và giữ ≥ 2 năm** — dùng **Stundenzettel xuất PDF hàng tháng** là đủ.

> Đây là bản rút gọn để kiểm nhanh. Không thay thế tư vấn pháp lý; khi quán có
> tình huống đặc biệt (ca đêm dài, người < 18, hợp đồng riêng) thì kiểm với kế
> toán/luật.

### Suy ra cho thuật toán (phải luôn đúng)
- Không xếp ai **> 10h/ngày**.
- Không xếp ai **> 6 ngày liên tiếp** (phải chèn ngày nghỉ).
- **Pause** tự tính theo ngưỡng 6h/8h và **trừ khỏi giờ trả lương**.
- Khoảng cách hai ca của cùng người **≥ 11h**.

---

## 2. Quy tắc app / quán — KHÔNG phải luật (đổi được tuỳ quán)

Repo này phục vụ **2 quán ở Warburg (NRW)** — ngày lễ theo Nordrhein-Westfalen.

- **Xếp theo lịch cơ bản từng người** (tab Nhân viên), rồi chỉnh cho khớp hợp đồng
  tuần/tháng: thừa thì cắt ngày ít ưu tiên, thiếu thì kéo dài ca (chỉ người bật
  „Được điều chỉnh", tối đa 60′ trước giờ mở / 30′ sau giờ đóng).
- **Ưu tiên tối T6, T7, CN** — kéo dài ở đó trước, cắt ở đó sau cùng.
- **KENZO:** T2 nghỉ · T3–T4 17:00–21:00 · T5–CN 12:00–14:30 và 17:00–21:30 · lễ
  như CN. Tối T6–CN (18:00–21:00) ít nhất **2 người**.
- **Asia Wok:** T2–T7 11:00–19:30 · CN và ngày lễ nghỉ · không đặt số người tối thiểu.
- Ca ngắn nhất **1,5 giờ**; app chặn **10 giờ công/ngày** (đúng mức luật).

> Các quy tắc này là vận hành của quán, không phải luật — có thể chỉnh theo từng
> cửa hàng (số người tối thiểu, khung giờ cao điểm, số ngày mở…). Khi đổi, nhớ
> cập nhật lại phần **"trước khi giao khách"** trong [`nghiem-thu.md`](nghiem-thu.md).
