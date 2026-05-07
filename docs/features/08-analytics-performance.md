# Chức năng Analytics và Performance

## Mục tiêu

Theo dõi doanh thu, clicks, conversions, CTR, conversion rate và đưa ra insight tối ưu cho affiliate marketing.

## Tóm tắt cho BA/Tester

Analytics giúp người dùng biết kênh nào hiệu quả, content nào tạo doanh thu và nên tối ưu gì tiếp theo. Tester cần kiểm tra số tổng hợp có đúng với dữ liệu dòng chi tiết không.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng vào Dashboard hoặc Analytics.
2. Hệ thống lấy dữ liệu hiệu suất trong khoảng ngày, mặc định 30 ngày gần nhất.
3. Hệ thống cộng tổng click, conversion và doanh thu.
4. UI hiển thị biểu đồ, KPI và insight.
5. Người dùng có thể hỏi AI phân tích hiệu suất để nhận đề xuất hành động.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| ANALYTICS-01 | API trả summary đúng theo dữ liệu `performance_data`. |
| ANALYTICS-02 | Nếu không truyền `from`, hệ thống dùng mặc định 30 ngày gần nhất. |
| ANALYTICS-03 | Nếu không có dữ liệu, UI không crash và hiển thị trạng thái/demo phù hợp. |
| ANALYTICS-04 | Dashboard hiển thị revenue, content count, CTR, conversion rate. |
| ANALYTICS-05 | AI Performance Analyst trả được đề xuất khi người dùng yêu cầu báo cáo. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Summary có dữ liệu | 3 dòng performance cùng user | Tổng click/conversion/revenue cộng đúng. |
| Filter theo ngày | Truyền `from=YYYY-MM-DD` | Chỉ lấy dòng từ ngày đó trở đi. |
| User không có dữ liệu | Không có row trong DB | Trả summary rỗng, rows rỗng. |
| Dữ liệu user khác | Có row của user khác | Không cộng vào summary. |
| Hỏi AI báo cáo | Message `Báo cáo hiệu suất 30 ngày` | Trả insight hoặc đề xuất hành động. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/performance/summary` | Có | Lấy dữ liệu hiệu suất theo khoảng ngày. |

## Query params

| Param | Mô tả |
| --- | --- |
| `from` | Ngày bắt đầu dạng `YYYY-MM-DD`. Nếu không truyền, backend lấy mặc định 30 ngày gần nhất. |

## Response chính

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_clicks": 1000,
      "total_conversions": 50,
      "total_revenue_vnd": 4200000
    },
    "rows": []
  }
}
```

## Chỉ số

| Chỉ số | Ý nghĩa |
| --- | --- |
| Revenue | Tổng doanh thu affiliate. |
| Clicks | Tổng lượt click affiliate link. |
| Conversions | Tổng đơn/chuyển đổi. |
| CTR | Tỷ lệ click theo content hoặc platform. |
| Conversion rate | Tỷ lệ chuyển đổi từ click sang đơn. |

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `performance_data` | Lưu clicks, conversions, revenue theo offer, network, platform, date. |
| `content_history` | Liên kết hiệu suất về content cụ thể. |
| `scheduler_logs` | Hiển thị hoạt động auto-pilot và job. |

## Màn hình web

- `/dashboard` hiển thị snapshot doanh thu, content, CTR, conversion, trend, offer và activity.
- `/dashboard/analytics` hiển thị biểu đồ, phân tích platform, insight và đề xuất hành động.

## AI Analyst

Khi intent là `performance_review`, Analyst Agent đọc yêu cầu người dùng và profile để tạo báo cáo định tính, đề xuất tăng tần suất đăng, thay offer, đổi giờ đăng hoặc mở rộng kênh.

## File liên quan

- `apps/api/src/routes/index.ts`
- `apps/api/src/agents/agents-v2.ts`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/dashboard/DashboardClient.tsx`
- `apps/web/src/app/dashboard/analytics/page.tsx`
