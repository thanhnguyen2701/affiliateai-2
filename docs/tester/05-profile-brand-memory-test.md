# Test chức năng Profile, Brand Kit và Memory

## Phạm vi test

Kiểm thử lấy/cập nhật profile, cấu hình cá nhân hóa, full autopilot và memory sau khi đánh giá content.

## Tiền điều kiện

- User đã đăng nhập.
- User mới đã qua đăng ký để có profile/brand kit mặc định.

## Test data

| Field | Hợp lệ | Không hợp lệ |
| --- | --- | --- |
| `preferred_tone` | `friendly`, `professional`, `funny`, `inspiring` | `random` |
| `language_style` | `bắc`, `nam`, `trung`, `neutral` | `english` |
| `full_autopilot` | `true`, `false` | `"yes"` |

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| PROFILE-TC-01 | Lấy profile | Gọi `GET /api/profile` | Trả `user`, `profile`, `brand_kit`. |
| PROFILE-TC-02 | User mới có default data | Đăng ký user mới rồi gọi profile | Có profile và brand kit mặc định. |
| PROFILE-TC-03 | Cập nhật niche | PATCH `niche_primary = beauty` | Lưu thành công. |
| PROFILE-TC-04 | Cập nhật tone hợp lệ | PATCH `preferred_tone = friendly` | Lưu thành công. |
| PROFILE-TC-05 | Cập nhật tone sai | PATCH `preferred_tone = random` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| PROFILE-TC-06 | Cập nhật language style sai | PATCH `language_style = english` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| PROFILE-TC-07 | Bật full autopilot | PATCH `full_autopilot = true` | User được cập nhật. |
| PROFILE-TC-08 | Không token | Gọi profile không Authorization | Request bị từ chối. |
| PROFILE-TC-09 | Memory từ feedback | Đánh giá content 5 sao | Có event/memory học từ feedback. |

## Regression checklist

- Profile update không làm mất brand kit.
- Full autopilot lưu ở bảng `users`.
- Profile lưu ở bảng `affiliate_profiles`.
- Không có API riêng để cập nhật `brand_kits` trong route hiện tại; Settings UI có thể có phần hiển thị/chỉnh ở frontend nhưng backend profile route chưa xử lý brand kit update.
- User chỉ thao tác dữ liệu của chính mình.
