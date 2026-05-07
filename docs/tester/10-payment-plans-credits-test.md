# Test chức năng Payment, Plans và Credits

## Phạm vi test

Kiểm thử danh sách plan, tạo đơn ZaloPay, callback, upgrade Starter nhanh, credit và chặn tính năng theo plan.

## Tiền điều kiện

- User đã đăng nhập.
- Có cấu hình ZaloPay hoặc mock service payment.
- Có thể chỉnh plan/credits của user test.
- Nếu không mock ZaloPay hoặc thiếu env ZaloPay, `/api/payment/create` có thể trả `500 payment_error`; đây là hành vi đúng theo code khi không tạo được order.

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| PAY-TC-01 | Lấy danh sách plan | Gọi `GET /api/payment/plans` | Trả starter/pro/business với giá và credits đúng. |
| PAY-TC-02 | Tạo đơn Starter | Gọi `/api/payment/create` với `plan=starter` | Trả `order_url`, `app_trans_id`, amount `149000`. |
| PAY-TC-03 | Tạo đơn Pro | Gọi với `plan=pro` | Trả amount `399000`. |
| PAY-TC-04 | Tạo đơn Business | Gọi với `plan=business` | Trả amount `999000`. |
| PAY-TC-05 | Plan sai | Gọi với `plan=vip` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| PAY-TC-06 | Callback sai MAC | Gửi callback MAC sai | Trả lỗi, không cập nhật plan. |
| PAY-TC-07 | Callback hợp lệ | Gửi callback hợp lệ | Cập nhật plan và credits. |
| PAY-TC-08 | Upgrade Starter nhanh từ Free | User Free gọi `/api/payment/upgrade-starter` | Plan thành `starter`, credits `100`. |
| PAY-TC-09 | Upgrade Starter nhanh khi đã Pro | User Pro gọi endpoint | Trả lỗi `starter_upgrade_blocked`. |
| PAY-TC-10 | Chat hết credit | Set credits còn 0 rồi chat | Trả `insufficient_credits`. |
| PAY-TC-11 | Business unlimited | User `credits_total = -1` chat | Không bị chặn vì hết credit. |

## Regression checklist

- Callback sai MAC không bao giờ cập nhật plan.
- Giá plan đúng với tài liệu.
- Credit giảm khi chat thành công.
- Visual AI bị chặn với Free, mở với Starter trở lên.
