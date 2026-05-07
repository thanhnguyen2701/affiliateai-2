# Test chức năng Auth và tài khoản

## Phạm vi test

Kiểm thử đăng ký, đăng nhập, đăng xuất, validation email/password và bảo vệ API yêu cầu đăng nhập.

## Tiền điều kiện

- API backend đang chạy.
- Supabase Auth cấu hình đúng.
- Tester có thể tạo email test mới.

## Test data

| Loại | Dữ liệu |
| --- | --- |
| Email hợp lệ | `tester_auth_01@test.local` |
| Email sai format | `abc` |
| Password hợp lệ | `password123` |
| Password ngắn | `123` |

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| AUTH-TC-01 | Đăng ký thành công | Gọi `POST /auth/register` với email mới và password hợp lệ | Trả `success: true`, có `user`; `session` có thể null nếu Supabase bật confirm email. |
| AUTH-TC-02 | Đăng ký email sai format | Gọi register với email `abc` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error` vì chưa bắt `ZodError`. |
| AUTH-TC-03 | Đăng ký password ngắn | Gọi register với password dưới 8 ký tự | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| AUTH-TC-04 | Đăng nhập thành công | Gọi `POST /auth/login` với tài khoản hợp lệ | Trả `success: true`, có session token. |
| AUTH-TC-05 | Đăng nhập sai password | Gọi login với password sai | Trả HTTP `401`, mã lỗi `invalid_credentials`. |
| AUTH-TC-06 | Gọi API private không token | Gọi `/api/profile` không header Authorization | Request bị từ chối. |
| AUTH-TC-07 | Gọi API private có token | Gọi `/api/profile` với Bearer token hợp lệ | Trả dữ liệu của user hiện tại. |
| AUTH-TC-08 | Đăng xuất | Gọi `POST /auth/logout` với token hợp lệ | Trả `success: true`. |

## Regression checklist

- User mới luôn có bản ghi `users`, `affiliate_profiles`, `brand_kits`.
- Không login được bằng mật khẩu sai.
- API private không bị truy cập khi thiếu token.
- Không lộ thông tin user khác.
