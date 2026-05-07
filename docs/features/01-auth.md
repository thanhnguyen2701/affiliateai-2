# Chức năng xác thực và tài khoản

## Mục tiêu

Cho phép người dùng đăng ký, đăng nhập, đăng xuất và khởi tạo dữ liệu mặc định để sử dụng AffiliateAI.

## Tóm tắt cho BA/Tester

Người dùng phải có tài khoản hợp lệ trước khi vào dashboard và dùng các chức năng có dữ liệu cá nhân. Sau khi đăng ký hoặc đăng nhập thành công, hệ thống tự tạo hồ sơ mặc định để người dùng không bị lỗi khi vào các màn hình sau.

## Người dùng

- Người dùng mới cần tạo tài khoản.
- Người dùng cũ cần đăng nhập vào dashboard.
- Backend cần xác định `userId` từ JWT để bảo vệ các API cá nhân.

## Luồng chính

1. Người dùng nhập email và mật khẩu ở web.
2. Frontend gọi API auth.
3. Backend dùng Supabase Auth để đăng ký hoặc đăng nhập.
4. Khi có user hợp lệ, backend tạo hoặc đảm bảo tồn tại:
   - Bản ghi trong `users`
   - Bản ghi trong `affiliate_profiles`
   - Bản ghi trong `brand_kits`
5. Các request sau dùng Bearer token trong header `Authorization`.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| AUTH-01 | Người dùng đăng ký bằng email hợp lệ và mật khẩu từ 8 ký tự trở lên thành công. |
| AUTH-02 | Sau khi đăng ký, hệ thống có dữ liệu mặc định trong `users`, `affiliate_profiles`, `brand_kits`. |
| AUTH-03 | Người dùng đăng nhập đúng email/mật khẩu thành công và nhận session. |
| AUTH-04 | Người dùng đăng nhập sai nhận lỗi rõ ràng, không vào được dashboard. |
| AUTH-05 | API yêu cầu đăng nhập phải từ chối request không có token. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Đăng ký thành công | Email mới, password `password123` | Trả `success: true`, có user/session. |
| Đăng ký email sai format | `abc`, password hợp lệ | Trả lỗi validation. |
| Đăng ký password ngắn | Email hợp lệ, password dưới 8 ký tự | Trả lỗi validation. |
| Đăng nhập đúng | Email/password đã đăng ký | Trả session hợp lệ. |
| Đăng nhập sai mật khẩu | Email đúng, password sai | Trả `401 invalid_credentials`. |
| Gọi API cá nhân không token | Không gửi Authorization header | Request bị từ chối. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Không | Đăng ký bằng email và mật khẩu. |
| `POST` | `/auth/login` | Không | Đăng nhập bằng email và mật khẩu. |
| `POST` | `/auth/logout` | Có | Đăng xuất. |

## Request mẫu

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

## Response thành công

```json
{
  "success": true,
  "data": {
    "user": {},
    "session": {}
  }
}
```

## Bảng dữ liệu liên quan

| Bảng | Vai trò |
| --- | --- |
| `users` | Lưu email, plan, credits, trạng thái active, full autopilot. |
| `affiliate_profiles` | Lưu niche, tone, network, dữ liệu semantic memory. |
| `brand_kits` | Lưu màu thương hiệu, logo, watermark, style keywords. |

## Validation và lỗi

- Email phải đúng định dạng.
- Mật khẩu tối thiểu 8 ký tự.
- Login sai trả về `401` với mã lỗi `invalid_credentials`.
- Register lỗi Supabase trả về `400` với mã lỗi `auth_error`.

## File liên quan

- `apps/api/src/routes/index.ts`
- `apps/api/src/middleware/index.ts`
- `apps/web/src/app/auth/login/page.tsx`
- `apps/web/src/app/auth/register/page.tsx`
- `apps/web/src/lib/api.ts`
