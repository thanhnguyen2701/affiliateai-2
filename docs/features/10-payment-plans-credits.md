# Chức năng Payment, Plans và Credits

## Mục tiêu

Quản lý gói dịch vụ, credits, thanh toán ZaloPay và nâng cấp plan để mở khóa các tính năng cao hơn.

## Tóm tắt cho BA/Tester

Payment quyết định người dùng được dùng tính năng nào và có bao nhiêu lượt AI. Tester cần kiểm tra đúng plan, đúng số credits, đúng chặn tính năng khi chưa đủ gói.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng xem bảng giá ở trang Upgrade.
2. Người dùng chọn plan.
3. Hệ thống tạo đơn ZaloPay và trả link thanh toán.
4. Sau khi thanh toán, ZaloPay gọi callback.
5. Backend xác thực callback.
6. Nếu hợp lệ, backend cập nhật plan và credits.
7. Các tính năng như Chat AI hoặc Visual AI kiểm tra plan/credits trước khi chạy.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| PAY-01 | API plans trả đúng danh sách plan và giá. |
| PAY-02 | User đăng nhập tạo được đơn thanh toán cho `starter`, `pro`, `business`. |
| PAY-03 | Plan không hợp lệ bị từ chối. |
| PAY-04 | Callback sai MAC không cập nhật plan. |
| PAY-05 | Callback hợp lệ cập nhật plan và credits. |
| PAY-06 | User Free có thể nâng nhanh lên Starter bằng endpoint hiện tại. |
| PAY-07 | Chat bị chặn khi hết credit. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Lấy danh sách plan | Gọi `/api/payment/plans` | Trả starter/pro/business với giá đúng. |
| Tạo đơn starter | `plan = starter` | Trả `order_url`, `app_trans_id`, amount `149000`. |
| Tạo đơn plan sai | `plan = vip` | Trả lỗi validation. |
| Callback sai MAC | MAC không hợp lệ | Trả `Invalid mac`, không update user. |
| Upgrade starter nhanh | User plan `free` | Plan thành `starter`, credits `100`. |
| Upgrade starter khi đã pro | User plan `pro` | Trả lỗi không cho downgrade/upgrade nhanh. |

## Plans

| Plan | Giá | Credits | Ghi chú |
| --- | ---: | ---: | --- |
| `free` | 0 | 10 | Tài khoản mới. |
| `starter` | 149.000 VND/tháng | 100 | Mở Visual AI cơ bản. |
| `pro` | 399.000 VND/tháng | 500 | Mở agentic loop 24/7. |
| `business` | 999.000 VND/tháng | Không giới hạn | API access, white-label, priority support. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/payment/plans` | Không | Lấy danh sách gói và giá. |
| `POST` | `/api/payment/create` | Có | Tạo đơn thanh toán ZaloPay. |
| `POST` | `/api/payment/callback` | Không | Webhook ZaloPay sau thanh toán. |
| `POST` | `/api/payment/upgrade-starter` | Có | Nâng nhanh Free lên Starter không qua thanh toán. |

## Request tạo đơn

```json
{
  "plan": "starter"
}
```

## Response tạo đơn

```json
{
  "success": true,
  "data": {
    "order_url": "https://...",
    "app_trans_id": "...",
    "amount": 149000,
    "plan": "starter"
  }
}
```

## Credits

- Chat AI dùng 1 credit mỗi request.
- `credits_total = -1` nghĩa là không giới hạn.
- Khi thanh toán thành công, backend cập nhật plan và reset/cấp credits theo plan.
- Nếu credit hết, API chat trả về lỗi `insufficient_credits`.

## Bảo mật payment

ZaloPay callback được kiểm tra MAC bằng `verifyZaloPayCallback`. Chỉ callback hợp lệ mới gọi `handlePaymentSuccess`.

## Màn hình web

Trang `/dashboard/upgrade` hiển thị các plan, feature, giới hạn và nút nâng cấp.

## File liên quan

- `apps/api/src/routes/payment.ts`
- `apps/api/src/services/credits.ts`
- `apps/web/src/app/dashboard/upgrade/page.tsx`
- `apps/web/src/lib/api.ts`
