# Chức năng Offers và affiliate networks

## Mục tiêu

Tìm và gợi ý offer affiliate phù hợp với niche, network đang dùng, EPC, hoa hồng, rating và độ khớp với người dùng.

## Tóm tắt cho BA/Tester

Chức năng Offers giúp người dùng chọn sản phẩm/chiến dịch nên quảng bá. Offer tốt không chỉ có hoa hồng cao mà còn phải phù hợp niche, có EPC tốt, có rating/số bán đáng tin và có link affiliate dùng được.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng vào trang Offers hoặc hỏi Chat AI “Tìm offer tốt”.
2. Hệ thống đọc niche và network đang bật trong profile.
3. Hệ thống lấy offer từ Shopee, Accesstrade, TikTok hoặc cache.
4. Hệ thống tính/sắp xếp theo độ phù hợp, EPC, hoa hồng và dữ liệu sản phẩm.
5. Người dùng xem danh sách offer và mở affiliate link.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| OFFER-01 | User đăng nhập lấy được danh sách top offers. |
| OFFER-02 | Danh sách offer bám theo niche và active networks của user. |
| OFFER-03 | Mỗi offer hiển thị thông tin quan trọng: tên, network, hoa hồng, EPC hoặc match score nếu có. |
| OFFER-04 | Nếu network lỗi, hệ thống vẫn có thể trả cache hoặc danh sách rỗng an toàn. |
| OFFER-05 | Affiliate URL nếu có phải mở được ở tab mới trên web. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Lấy top offers | User niche `beauty`, network `shopee` | Trả danh sách offer phù hợp beauty. |
| Không có active networks | Profile không cấu hình network | Hệ thống dùng mặc định hoặc trả danh sách an toàn. |
| Network API lỗi | Mock lỗi Shopee/Accesstrade | Không crash API. |
| Kiểm tra UI | Vào `/dashboard/offers` | Thấy tên offer, hoa hồng, EPC/match score. |
| Click affiliate link | Offer có `affiliate_url` | Link mở tab mới. |

## Nguồn dữ liệu

| Nguồn | Vai trò |
| --- | --- |
| Shopee | Lấy top offers, thông tin sản phẩm, tạo affiliate link, report. |
| Accesstrade | Lấy offers, tạo tracking link, report. |
| TikTok | Lấy sản phẩm affiliate nếu có cấu hình. |
| Offer cache | Cache kết quả để giảm số lần gọi network. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/offers/top` | Có | Lấy top offers phù hợp với profile user. |

## Cách hệ thống chọn offer

1. Đọc `niche_primary` và `active_networks` từ `affiliate_profiles`.
2. Gọi `getTopOffersForUser`.
3. Tổng hợp từ các network được bật.
4. Sắp xếp và trả về danh sách giới hạn, mặc định 10 offer.

## Dữ liệu offer thường có

| Field | Mô tả |
| --- | --- |
| `product_name` | Tên sản phẩm. |
| `network` | Nguồn affiliate. |
| `commission_pct` | Tỷ lệ hoa hồng. |
| `epc_estimate` | EPC ước tính. |
| `price` | Giá sản phẩm. |
| `rating` | Điểm đánh giá. |
| `sold_count` | Số đã bán. |
| `affiliate_url` | Link affiliate hoặc tracking link. |
| `match_score` | Điểm phù hợp với niche/user. |

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `offer_cache` | Cache offer theo network và offer id. |
| `affiliate_profiles` | Cung cấp niche và active networks. |
| `performance_data` | Lưu kết quả click/conversion/revenue theo offer. |

## Màn hình web

Trang `/dashboard/offers` hiển thị danh sách offer, chỉ số EPC, hoa hồng, match score và link affiliate.

## File liên quan

- `apps/api/src/routes/payment.ts`
- `apps/api/src/services/integrations/offer-aggregator.ts`
- `apps/api/src/services/integrations/shopee.ts`
- `apps/api/src/services/integrations/accesstrade.ts`
- `apps/api/src/services/integrations/tiktok.ts`
- `apps/web/src/app/dashboard/offers/page.tsx`
