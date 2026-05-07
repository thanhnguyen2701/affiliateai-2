# Test chức năng Content

## Phạm vi test

Kiểm thử tạo content đa nền tảng, lưu lịch sử content và đánh giá content.

## Tiền điều kiện

- User đã đăng nhập.
- User còn credit.
- Có quyền gọi Chat AI.

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| CONTENT-TC-01 | Tạo content TikTok | Chat: `Viết script TikTok cho kem chống nắng` | Response có nội dung phù hợp TikTok, có hook/CTA. |
| CONTENT-TC-02 | Tạo content Facebook | Chat: `Tạo caption Facebook cho deal skincare` | Response có caption Facebook, giọng văn tự nhiên. |
| CONTENT-TC-03 | Tạo content nhiều nền tảng | Chat: `Viết content TikTok Facebook Instagram cho serum` | Response có nhiều phần theo platform. |
| CONTENT-TC-04 | Không chỉ định platform | Chat: `Viết content cho serum vitamin C` | Hệ thống tạo platform mặc định. |
| CONTENT-TC-05 | Lưu lịch sử | Tạo content thành công | Có bản ghi mới trong `content_history`. |
| CONTENT-TC-06 | Đánh giá content hợp lệ | Gọi `POST /api/content/rate` với rating 1-5 | Trả `success: true`. |
| CONTENT-TC-07 | Đánh giá rating không hợp lệ | Gửi rating `0` hoặc `6` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| CONTENT-TC-08 | Đánh giá content user khác qua API | Gửi `content_id` không thuộc user | API vẫn có thể trả `success: true`, nhưng row của user khác không được update do filter `user_id`. |
| CONTENT-TC-09 | Đánh giá content trên UI | Mở `/dashboard/content`, bấm sao | UI update trực tiếp Supabase `content_history.user_rating`; không gọi `/api/content/rate`, nên không kích hoạt memory learning của API. |

## Test data

| Field | Giá trị mẫu |
| --- | --- |
| Product | `Kem chống nắng SPF50+` |
| Platform | `tiktok`, `facebook`, `instagram` |
| Rating hợp lệ | `1`, `3`, `5` |
| Rating không hợp lệ | `0`, `6` |

## Regression checklist

- Content có CTA.
- Content đúng platform.
- User rating lưu đúng.
- Feedback qua API `/api/content/rate` mới gọi memory learning; feedback qua UI hiện chỉ update Supabase rating.
