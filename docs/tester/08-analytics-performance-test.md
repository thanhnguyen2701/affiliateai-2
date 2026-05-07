# Test chức năng Analytics và Performance

## Phạm vi test

Kiểm thử API performance summary, lọc ngày, tổng hợp số liệu và UI dashboard/analytics.

## Tiền điều kiện

- User đã đăng nhập.
- Có dữ liệu test trong `performance_data` hoặc mock response.

## Test data mẫu

| Date | Clicks | Conversions | Revenue |
| --- | ---: | ---: | ---: |
| Hôm nay | 100 | 5 | 500000 |
| Hôm qua | 50 | 2 | 200000 |
| 40 ngày trước | 30 | 1 | 100000 |

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| ANA-TC-01 | Summary mặc định | Gọi `/api/performance/summary` không query | Lấy dữ liệu 30 ngày gần nhất. |
| ANA-TC-02 | Summary theo `from` | Gọi với `from=YYYY-MM-DD` | Chỉ lấy rows từ ngày đó trở đi. |
| ANA-TC-03 | Cộng tổng đúng | Có nhiều rows cùng user | `total_clicks`, `total_conversions`, `total_revenue_vnd` cộng đúng. |
| ANA-TC-04 | Không có dữ liệu | User không có row | Trả `rows` rỗng; `summary` hiện có thể là object rỗng `{}` thay vì các tổng bằng 0. |
| ANA-TC-05 | Không lấy user khác | Có rows của user khác | Không cộng dữ liệu user khác. |
| ANA-TC-06 | UI Dashboard | Mở `/dashboard` | KPI hiển thị, không crash. |
| ANA-TC-07 | UI Analytics | Mở `/dashboard/analytics` | Biểu đồ/insight hiển thị. |
| ANA-TC-08 | AI performance review | Chat `Báo cáo hiệu suất 30 ngày` | Trả insight hoặc đề xuất. |

## Regression checklist

- Summary không cộng dữ liệu ngoài khoảng ngày.
- Summary không cộng dữ liệu user khác.
- UI xử lý tốt trạng thái dữ liệu rỗng.
- Doanh thu hiển thị đúng đơn vị VND.
