# Test chức năng Auto-pilot Scheduler

## Phạm vi test

Kiểm thử các job tự động, điều kiện plan, active user, credits, quiet hours, logging và xử lý lỗi.

## Tiền điều kiện

- Có thể chạy/mocking Inngest functions.
- Có user test nhiều plan: Free, Starter, Pro, Business.
- Có quyền xem `scheduler_logs`.

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| AUTO-TC-01 | Không chạy cho user inactive | Set `is_active = false`, chạy job | User không được xử lý. |
| AUTO-TC-02 | Agentic loop không chạy cho Free | User plan `free`, chạy job agentic | User bị bỏ qua. |
| AUTO-TC-03 | Agentic loop chạy cho Pro | User plan `pro`, active | User được xử lý. |
| AUTO-TC-04 | Content autopilot thiếu credits | User còn dưới 3 credits | Không tạo content, có nhắc low credits nếu logic chạy. |
| AUTO-TC-05 | Ghi log completed ở job có log | Chạy Morning Trend Scan, Content Autopilot, Weekly Report, Offer Refresh hoặc Monthly Strategy thành công | Có log `completed` trong `scheduler_logs`. |
| AUTO-TC-06 | Ghi log failed ở job có log | Mock agent throw error với các job có `logJob()` | Có log `failed`, không crash toàn bộ job. |
| AUTO-TC-07 | Link health check link chết | Content có affiliate link lỗi | Job xử lý được và ghi nhận link lỗi. |
| AUTO-TC-08 | Một user lỗi không ảnh hưởng user khác | Mock lỗi cho 1 user | Các user còn lại vẫn xử lý. |

## Job cần kiểm tra

| Job | Expected chính |
| --- | --- |
| Morning Trend Scan | Gọi intent `trend_research`. |
| Content Autopilot | Tạo draft content khi đủ điều kiện. |
| Engagement Monitor | Gửi/ghi nhắc tương tác. |
| Weekly Report | Gọi intent `performance_review`. |
| Link Health Check | Kiểm tra link gần đây; hiện chưa ghi `scheduler_logs`. |
| Offer Refresh | Gọi intent `offer_find`. |
| Monthly Strategy | Gọi intent `performance_review`. |

## Regression checklist

- Job không xử lý user inactive.
- Job trả phí không chạy cho Free.
- Lỗi một user không làm dừng toàn bộ batch.
- Các job có gọi `logJob()` phải có log đủ thông tin; `engagementMonitor` và `linkHealthCheck` hiện chưa ghi scheduler log.
