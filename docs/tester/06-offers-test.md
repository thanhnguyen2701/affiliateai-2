# Test chức năng Offers

## Phạm vi test

Kiểm thử lấy top offers theo niche/network, hiển thị thông tin offer và xử lý khi network lỗi.

## Tiền điều kiện

- User đã đăng nhập.
- Profile có `niche_primary` và `active_networks`.
- Có cấu hình network API hoặc mock data.
- Lưu ý code hiện tại: route `/api/offers/top` gọi `(app as any).db()` nhưng server chưa decorate `db`, nên API có khả năng trả `500 internal_error`. UI Offers bắt lỗi và hiển thị `DEMO_OFFERS`.

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| OFFER-TC-01 | Lấy top offers API hiện tại | Gọi `GET /api/offers/top` | Có thể trả `500 internal_error` do thiếu `app.db()`; ghi bug nếu xảy ra. Sau khi fix, expected là `success: true`, data là list. |
| OFFER-TC-02 | Offers theo niche sau khi API fix | Set niche `beauty`, gọi API | Offer liên quan beauty hoặc list an toàn. |
| OFFER-TC-03 | Offers theo network sau khi API fix | Set active networks `shopee` | Ưu tiên/trả offer từ Shopee nếu có. |
| OFFER-TC-04 | Không cấu hình network sau khi API fix | Active networks rỗng | Không crash, dùng default Shopee hoặc trả list rỗng. |
| OFFER-TC-05 | Network lỗi sau khi API fix | Mock lỗi network API | API không crash. |
| OFFER-TC-06 | UI Offers page khi API lỗi | Mở `/dashboard/offers` | UI không crash và fallback sang demo offers. |
| OFFER-TC-07 | Click affiliate link | Click offer có `affiliate_url` | Link mở tab mới. |
| OFFER-TC-08 | Không token | Gọi API không token | Request bị từ chối. |

## Field cần kiểm tra

| Field | Expected |
| --- | --- |
| `product_name` | Không rỗng nếu offer hợp lệ. |
| `network` | Có nguồn affiliate. |
| `commission_pct` | Là số hoặc có fallback hiển thị. |
| `epc_estimate` | Là số hoặc có fallback hiển thị. |
| `affiliate_url` | URL hợp lệ nếu network trả link. |

## Regression checklist

- Offers không lộ dữ liệu riêng user khác.
- UI không crash khi danh sách rỗng.
- Network lỗi không làm sập API.
