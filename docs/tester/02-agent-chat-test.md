# Test chức năng Chat AI và Agent

## Phạm vi test

Kiểm thử API chat chính, nhận diện intent, ưu tiên intent từ UI nếu có, gọi LLM provider, trừ credit, lưu content history và hiển thị lỗi rõ ràng trên frontend.

## Tiền điều kiện

- User đã đăng nhập.
- User còn credit, trừ test case hết credit.
- Backend API đang chạy sau khi restart.
- `OPENAI_API_KEY` hợp lệ.
- Model trong `AGENT_MODELS` tồn tại và hỗ trợ Chat Completions.

## Test data

| Intent | Message mẫu |
| --- | --- |
| `content_create` | `Viết script TikTok review kem dưỡng da Innisfree` |
| `trend_research` | `Top 5 trend beauty hôm nay là gì?` |
| `offer_find` | `Tìm offer hoa hồng cao cho skincare` |
| `performance_review` | `Báo cáo hiệu suất 30 ngày và đề xuất tối ưu` |
| `customer_reply` | `Khách hỏi sản phẩm này có hợp da dầu không, trả lời giúp tôi` |
| `schedule_task` | `Lên lịch content tuần tới cho TikTok và Facebook` |

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| CHAT-TC-01 | Chat tạo content thành công | Gọi `POST /api/agent/chat` với message content | Trả `success: true`, `data.intent = content_create`, `data.content` không rỗng. |
| CHAT-TC-02 | Chat tìm trend | Gọi chat với message trend | Response có danh sách trend/gợi ý, không rỗng. |
| CHAT-TC-03 | Chat tìm offer | Gọi chat với message offer | Response có offer hoặc đề xuất liên quan. |
| CHAT-TC-04 | Chat phân tích hiệu suất | Gọi chat với message performance | Response có insight hoặc action item. |
| CHAT-TC-05 | Chat trả lời khách hàng | Gọi chat với message khách hỏi | Response là câu trả lời dùng được cho khách. |
| CHAT-TC-06 | Truyền intent cụ thể từ UI | Gọi chat với `intent = content_create` | Backend ưu tiên intent truyền vào, không bắt buộc gọi orchestrator để phân loại lại. |
| CHAT-TC-07 | Message rỗng | Gửi `message = ""` | Request thất bại do validation. |
| CHAT-TC-08 | Message quá dài | Gửi message trên 2000 ký tự | Request thất bại do validation. |
| CHAT-TC-09 | Trừ credit | Gọi chat thành công | `credits_used` tăng 1, `data.meta.credits_remaining` giảm 1. |
| CHAT-TC-10 | Hết credit | User còn 0 credit gọi chat | Trả HTTP `402`, mã lỗi `insufficient_credits`; không gọi LLM. |
| CHAT-TC-11 | Không đăng nhập | Gọi chat không token | Request bị từ chối. |
| CHAT-TC-12 | Provider lỗi | Cấu hình sai model/key rồi gọi chat | Trả lỗi rõ từ API/FE; không trả nội dung fallback giả, không trừ credit. |
| CHAT-TC-13 | Product research bằng KB | Upload KB rồi chat hỏi về tài liệu | Nếu KB có dữ liệu liên quan thì trả nội dung từ KB; nếu không có thì trả thông báo không tìm thấy trong KB. |

## Expected response cần kiểm tra

| Field | Expected |
| --- | --- |
| `success` | `true` khi xử lý thành công. |
| `data.intent` | Đúng hoặc gần đúng intent mong đợi; nếu request gửi `intent` hợp lệ thì ưu tiên intent đó. |
| `data.content` | Không rỗng, đọc được, đúng yêu cầu. |
| `data.structured` | Có dữ liệu cấu trúc nếu agent tạo được. |
| `data.quality_score` | Có với content nếu evaluator chạy được; nếu evaluator lỗi thì vẫn có fallback score. |
| `data.meta.credits_used` | Bằng `1` cho request thành công. |
| `data.meta.duration_ms` | Là số dương. |

## Regression checklist

- Chat không được bỏ qua kiểm tra credit.
- Hết credit không được gọi LLM và không trừ thêm credit.
- Provider lỗi không được trả content fallback giả.
- Content tạo ra phải được lưu vào lịch sử khi intent là `content_create`.
- Response lỗi phải có message dễ hiểu để FE hiển thị cho tester.
