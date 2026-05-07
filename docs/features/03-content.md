# Chức năng tạo và quản lý Content

## Mục tiêu

Tạo nội dung affiliate đa kênh từ yêu cầu của người dùng, chấm điểm chất lượng, lưu lịch sử và học từ đánh giá của người dùng.

## Tóm tắt cho BA/Tester

Chức năng này giúp người dùng tạo nội dung bán hàng/affiliate cho nhiều nền tảng. Nội dung cần đúng nền tảng, đúng tone người dùng đã chọn, có CTA rõ ràng và có thể được người dùng đánh giá để hệ thống học tốt hơn.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng yêu cầu tạo content qua Chat AI hoặc màn hình Content.
2. Hệ thống nhận diện nền tảng cần tạo: TikTok, Facebook, Instagram, Blog, YouTube, Zalo hoặc Email.
3. AI tạo nội dung theo niche, tone và phong cách người dùng.
4. Hệ thống chấm điểm chất lượng.
5. Nội dung được lưu vào lịch sử.
6. Người dùng copy, dùng nội dung hoặc đánh giá 1-5 sao.
7. Nếu đánh giá tốt/xấu, hệ thống ghi nhận để cá nhân hóa lần sau.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| CONTENT-01 | Tạo được content cho nền tảng người dùng yêu cầu. |
| CONTENT-02 | Nếu người dùng không nói rõ nền tảng, hệ thống tạo mặc định cho TikTok/Facebook/Instagram. |
| CONTENT-03 | Content có CTA hoặc lời kêu gọi hành động. |
| CONTENT-04 | Content thành công được lưu vào `content_history`. |
| CONTENT-05 | Người dùng đánh giá 1-5 sao thành công. |
| CONTENT-06 | Đánh giá content cập nhật memory để lần sau cá nhân hóa tốt hơn. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Tạo content TikTok | `Viết script TikTok cho kem chống nắng` | Có nội dung phù hợp TikTok, có CTA. |
| Tạo content Facebook | `Tạo caption Facebook cho deal skincare` | Có caption Facebook, văn phong tự nhiên. |
| Không nhập platform | `Viết content cho serum vitamin C` | Trả nhiều platform mặc định. |
| Đánh giá 5 sao | `content_id` hợp lệ, rating `5` | API trả thành công. |
| Đánh giá ngoài khoảng | Rating `0` hoặc `6` | Trả lỗi validation. |
| Content id không thuộc user | `content_id` của user khác | Không cập nhật dữ liệu user khác. |

## Kênh hỗ trợ

- TikTok
- Facebook
- Instagram
- Blog
- YouTube
- Zalo
- Email

## Luồng tạo content

1. Người dùng gửi yêu cầu qua Chat AI hoặc drawer nhanh.
2. Orchestrator xác định intent `content_create`.
3. Content Agent tạo nội dung theo platform được phát hiện trong message.
4. Evaluator Agent chấm điểm.
5. Nếu điểm thấp và có gợi ý sửa, hệ thống tạo lại bản cải thiện.
6. Nếu thành công, backend lưu vào `content_history`.
7. Người dùng có thể đánh giá 1-5 sao để hệ thống học sở thích.

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `POST` | `/api/agent/chat` | Có | Tạo content khi intent là `content_create`. |
| `POST` | `/api/content/rate` | Có | Đánh giá content đã tạo. |

## Request đánh giá content

```json
{
  "content_id": "00000000-0000-0000-0000-000000000000",
  "rating": 5
}
```

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `content_history` | Lưu platform, content, hashtags, quality score, rating, affiliate link. |
| `episodic_memory` | Lưu sự kiện content được tạo, approve hoặc reject. |
| `affiliate_profiles` | Cập nhật memory dài hạn từ feedback tốt/xấu. |

## Màn hình web

Trang `/dashboard/content` hiển thị danh sách content, filter theo platform, trạng thái, score và thông tin affiliate link nếu có.

## File liên quan

- `apps/api/src/agents/agents-v2.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/services/memory/memory-service.ts`
- `apps/web/src/app/dashboard/content/page.tsx`
- `apps/web/src/components/agent/AgentDrawer.tsx`
