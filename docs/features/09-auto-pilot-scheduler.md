# Chức năng Auto-pilot Scheduler

## Mục tiêu

Chạy các tác vụ affiliate tự động theo lịch để tìm trend, tạo draft content, nhắc tương tác, kiểm tra link, refresh offer và lập báo cáo.

## Tóm tắt cho BA/Tester

Auto-pilot là nhóm tác vụ chạy tự động theo lịch. Người dùng không cần bấm thủ công, nhưng hệ thống chỉ chạy cho user đủ điều kiện plan và phải tôn trọng quiet hours khi áp dụng.

## Luồng nghiệp vụ dễ hiểu

1. Scheduler đến thời điểm cron.
2. Hệ thống lấy danh sách user active và đủ plan.
3. Với từng user, hệ thống kiểm tra điều kiện như credits, quiet hours, full autopilot.
4. Hệ thống gọi Agent phù hợp để tạo trend, content, report hoặc offer.
5. Hệ thống ghi log job vào `scheduler_logs`.
6. Nếu có lỗi, job ghi trạng thái failed nhưng không làm sập toàn bộ scheduler.

## Điều kiện sử dụng

- Các job chính lọc user `is_active = true`.
- Một số job yêu cầu plan khác `free`.
- Job agentic loop yêu cầu plan `pro`, `business` hoặc `enterprise`.
- Quiet hours có thể chặn một số tác vụ theo cấu hình user.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| AUTO-01 | Scheduler chỉ xử lý user active. |
| AUTO-02 | Job agentic loop chỉ chạy cho plan `pro`, `business`, `enterprise`. |
| AUTO-03 | Job ghi log thành công hoặc thất bại vào `scheduler_logs`. |
| AUTO-04 | Khi một user lỗi, các user khác vẫn được xử lý. |
| AUTO-05 | Content Autopilot không chạy nếu user thiếu credits theo rule hiện tại. |
| AUTO-06 | Link Health Check phát hiện link lỗi mà không crash khi timeout. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| User free | Plan `free` | Không chạy các job yêu cầu trả phí. |
| User pro active | Plan `pro`, `is_active = true` | Được đưa vào agentic loop. |
| User inactive | `is_active = false` | Không xử lý. |
| Credits thấp | Credits còn dưới mức cần | Content autopilot bỏ qua hoặc nhắc low credits. |
| Agent lỗi | Mock orchestrate throw error | Ghi log `failed`, scheduler tiếp tục. |
| Link timeout | Affiliate link timeout | Không crash job. |

## Danh sách job

| Job | Lịch VN | Mục tiêu |
| --- | --- | --- |
| Morning Trend Scan | 06:00 hằng ngày | Tìm top trend và gợi ý content. |
| Content Autopilot | 07:00 hằng ngày | Tạo draft content TikTok/Facebook từ trend. |
| Engagement Monitor | 19:30 hằng ngày | Nhắc kiểm tra inbox/comment. |
| Weekly Report | 08:00 thứ Hai | Tổng hợp hiệu suất tuần và việc cần làm. |
| Link Health Check | 22:00 hằng ngày | Kiểm tra affiliate link gần đây còn sống không. |
| Offer Refresh | 09:00 thứ Sáu | Tìm offer mới có EPC tốt hơn. |
| Monthly Strategy | 09:00 ngày 1 hằng tháng | Phân tích tháng trước và lập kế hoạch tháng tới. |

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `scheduler_logs` | Lưu job type, status, result, duration, error. |
| `users` | Lưu plan, `full_autopilot`, quiet hours, active status. |
| `content_history` | Nguồn để kiểm tra affiliate link. |

## Trạng thái log

| Status | Ý nghĩa |
| --- | --- |
| `running` | Job đang chạy. |
| `completed` | Job hoàn tất. |
| `failed` | Job lỗi. |
| `skipped` | Job bị bỏ qua. |

## Tích hợp

Scheduler dùng Inngest để tạo cron functions. Các job gọi Orchestrator với intent phù hợp như `trend_research`, `content_create`, `offer_find`, `performance_review`.

## File liên quan

- `apps/api/src/jobs/scheduler.ts`
- `apps/api/src/agents/agents-v2.ts`
- `packages/db/migrations/001_initial_schema.sql`
- `apps/web/src/components/layout/Sidebar.tsx`
