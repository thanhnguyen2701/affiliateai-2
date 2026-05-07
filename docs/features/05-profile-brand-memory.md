# Chức năng Profile, Brand Kit và Memory

## Mục tiêu

Lưu hồ sơ affiliate, phong cách thương hiệu và ký ức tương tác để AI cá nhân hóa kết quả cho từng người dùng.

## Tóm tắt cho BA/Tester

Đây là phần “cá nhân hóa” của hệ thống. Nếu người dùng chọn niche beauty, tone thân thiện và màu thương hiệu riêng, AI phải dùng các thông tin đó khi viết content, gợi ý offer hoặc tạo visual.

## Luồng nghiệp vụ dễ hiểu

1. Khi tài khoản được tạo, hệ thống tạo profile và brand kit mặc định.
2. Người dùng vào Settings để cập nhật niche, tone, vùng ngôn ngữ, network và brand kit.
3. Khi người dùng chat hoặc tạo visual, hệ thống đọc profile/brand kit để cá nhân hóa.
4. Khi người dùng đánh giá content, hệ thống ghi nhận vào memory.
5. Các lần tạo content sau dùng memory để cải thiện kết quả.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| PROFILE-01 | User mới có profile và brand kit mặc định. |
| PROFILE-02 | User cập nhật niche, tone, language style và active networks thành công. |
| PROFILE-03 | User bật/tắt `full_autopilot` thành công. |
| PROFILE-04 | AI sử dụng profile khi tạo content hoặc phân tích. |
| PROFILE-05 | Đánh giá content tạo event memory phù hợp. |
| PROFILE-06 | User không đọc/ghi được profile của user khác. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Lấy profile | User đã đăng nhập | Trả `user`, `profile`, `brand_kit`. |
| Cập nhật niche | `niche_primary = beauty` | Profile lưu niche mới. |
| Cập nhật tone hợp lệ | `preferred_tone = friendly` | Lưu thành công. |
| Cập nhật tone không hợp lệ | `preferred_tone = random` | Trả lỗi validation. |
| Bật autopilot | `full_autopilot = true` | User được cập nhật. |
| Không có token | Gọi `/api/profile` không token | Bị từ chối. |

## Thành phần

| Thành phần | Mô tả |
| --- | --- |
| Affiliate Profile | Niche, tone, phong cách ngôn ngữ, mạng affiliate, giờ đăng tốt. |
| Brand Kit | Màu thương hiệu, logo, watermark, từ khóa style và từ khóa cần tránh. |
| Episodic Memory M1 | Lưu tương tác gần đây, tự hết hạn sau 90 ngày. |
| Semantic Memory M2 | Lưu sở thích dài hạn và dữ liệu học từ feedback. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/profile` | Có | Lấy user, affiliate profile và brand kit. |
| `PATCH` | `/api/profile` | Có | Cập nhật profile và bật/tắt full autopilot. |

## Request cập nhật profile

```json
{
  "niche_primary": "beauty",
  "niche_secondary": ["skincare", "makeup"],
  "preferred_tone": "friendly",
  "language_style": "neutral",
  "active_networks": ["shopee", "accesstrade"],
  "full_autopilot": false
}
```

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `affiliate_profiles` | Semantic memory, niche, tone, active networks, posting hours. |
| `brand_kits` | Cấu hình thương hiệu cho content và visual. |
| `episodic_memory` | Lưu event ngắn hạn như content_created, content_approved, visual_created. |
| `users` | Lưu plan, credits, full_autopilot, quiet hours. |

## Tác động đến AI

- Content Agent dùng niche, tone và language style để viết đúng giọng.
- Visual AI dùng Brand Kit để áp màu, watermark và style.
- Evaluator và Memory Service dùng rating để học loại content người dùng thích.
- Scheduler dùng `full_autopilot` và quiet hours để quyết định mức tự động hóa.

## Màn hình web

Trang `/dashboard/settings` hiển thị và cho phép chỉnh AI settings, profile, brand kit, màu, watermark và các cấu hình cá nhân hóa.

## File liên quan

- `apps/api/src/routes/index.ts`
- `apps/api/src/services/memory/memory-service.ts`
- `apps/api/src/services/memory/rag-service.ts`
- `apps/web/src/app/dashboard/settings/page.tsx`
- `packages/db/migrations/001_initial_schema.sql`
