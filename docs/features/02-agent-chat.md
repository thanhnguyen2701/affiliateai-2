# Chức năng Chat AI và hệ thống Agent

## Mục tiêu

Chat AI là cổng chính để người dùng yêu cầu AffiliateAI tạo content, tìm trend, tìm offer, phân tích hiệu suất, trả lời khách hàng, nghiên cứu sản phẩm hoặc lên kế hoạch nội dung.

## Tóm tắt cho BA/Tester

Người dùng nhập yêu cầu bằng tiếng Việt tự nhiên. Hệ thống tự hiểu mục đích, chọn agent phù hợp và trả về kết quả. Mỗi lần chat thành công trừ 1 credit. Nếu hết credit, người dùng phải nâng cấp hoặc nạp thêm trước khi tiếp tục.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng mở Chat AI hoặc bấm gợi ý nhanh trong dashboard.
2. Người dùng nhập yêu cầu, ví dụ: “Viết caption Facebook cho serum vitamin C”.
3. Hệ thống xác định yêu cầu thuộc loại nào: tạo content, tìm trend, tìm offer, phân tích, trả lời khách, nghiên cứu sản phẩm hoặc lên lịch.
4. Hệ thống lấy thêm thông tin cá nhân hóa như niche, tone, brand kit và lịch sử gần đây.
5. Agent phù hợp xử lý yêu cầu.
6. Nếu là content, hệ thống chấm điểm chất lượng.
7. Hệ thống trả kết quả cho người dùng và trừ credit.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| CHAT-01 | Người dùng đăng nhập có thể gửi message hợp lệ và nhận phản hồi AI. |
| CHAT-02 | Message rỗng hoặc quá dài bị từ chối. |
| CHAT-03 | Mỗi request chat thành công trừ đúng 1 credit. |
| CHAT-04 | Khi hết credit, hệ thống trả lỗi `insufficient_credits`. |
| CHAT-05 | Khi intent là tạo content, response có nội dung và điểm chất lượng nếu chấm được. |
| CHAT-06 | Nếu người dùng truyền intent cụ thể, hệ thống ưu tiên xử lý theo intent đó. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Tạo content TikTok | `Viết script TikTok review kem dưỡng da` | Trả content dạng script/caption, intent `content_create`. |
| Tìm trend | `Top trend beauty hôm nay là gì?` | Trả danh sách trend và gợi ý angle. |
| Tìm offer | `Tìm offer hoa hồng cao cho skincare` | Trả danh sách offer hoặc đề xuất offer. |
| Phân tích hiệu suất | `Báo cáo hiệu suất 30 ngày` | Trả insight hoặc đề xuất tối ưu. |
| Trả lời khách hàng | `Khách hỏi sản phẩm có dùng cho da dầu không?` | Trả câu trả lời phù hợp ngữ cảnh. |
| Hết credit | User có `credits_remaining = 0` | Trả HTTP `402`, không gọi AI thành công. |

## Agent chính

| Agent | Vai trò |
| --- | --- |
| Orchestrator | Đọc yêu cầu, xác định intent, chọn agent xử lý. |
| Content Generator | Tạo content đa nền tảng. |
| Self Evaluator | Chấm điểm và đề xuất cải thiện content. |
| Social Listening | Tìm trend theo niche và thị trường Việt Nam. |
| Offer Matching | Gợi ý offer phù hợp theo niche/network. |
| Performance Analyst | Phân tích hiệu suất, CTR, conversion, doanh thu. |
| Customer Engage | Soạn phản hồi inbox/comment. |
| RAG Agent | Trả lời dựa trên Knowledge Base. |
| Scheduler Agent | Lên lịch content tuần/tháng. |

## Intent hỗ trợ

| Intent | Mục đích |
| --- | --- |
| `content_create` | Tạo script, caption, blog, email, nội dung đa kênh. |
| `trend_research` | Tìm sản phẩm/chủ đề đang hot. |
| `offer_find` | Gợi ý offer affiliate tốt. |
| `performance_review` | Phân tích số liệu và đề xuất tối ưu. |
| `customer_reply` | Soạn câu trả lời khách hàng. |
| `schedule_task` | Lên lịch hoặc kế hoạch nội dung. |
| `product_research` | Nghiên cứu sản phẩm bằng RAG. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `POST` | `/api/agent/chat` | Có | Gửi message cho AI và nhận kết quả. |

## Request mẫu

```json
{
  "message": "Viết script TikTok review kem dưỡng da Innisfree",
  "intent": "content_create"
}
```

## Response chính

```json
{
  "success": true,
  "data": {
    "intent": "content_create",
    "content": "...",
    "structured": {},
    "quality_score": 89
  },
  "meta": {
    "credits_used": 1,
    "credits_remaining": 99,
    "duration_ms": 1234
  }
}
```

## Quy tắc credits

- Mỗi lần gọi `/api/agent/chat` dùng 1 credit.
- Nếu hết credit, API trả về `402` với mã lỗi `insufficient_credits`.
- Gói unlimited dùng `credits_total = -1`.

## Dữ liệu ngữ cảnh

Trước khi gọi agent, backend cố gắng nạp:

- Semantic profile từ `affiliate_profiles`
- Brand kit từ `brand_kits`
- Recent episodes từ `episodic_memory`

## File liên quan

- `apps/api/src/agents/agents-v2.ts`
- `apps/api/src/agents/llm.ts`
- `apps/api/src/agents/prompts/index.ts`
- `apps/api/src/routes/index.ts`
- `apps/web/src/components/agent/AgentDrawer.tsx`
