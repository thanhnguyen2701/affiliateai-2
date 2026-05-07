# Test chức năng Visual AI

## Phạm vi test

Kiểm thử tạo visual job từ URL, upload ảnh luồng A, upload video luồng C, kiểm tra plan, trạng thái job và lịch sử job.

Luồng A hiện tại: người dùng upload ảnh sản phẩm, nhập mô tả sản phẩm và có thể nhập headline/subline/CTA. API lưu các thông tin này vào job và đưa vào queue để AI phân tích ảnh, điều chỉnh nội dung, sau đó tạo banner hoàn chỉnh theo platform.

## Tiền điều kiện

- Có user Free và user Starter trở lên.
- Backend upload hoạt động.
- Queue visual hoạt động hoặc có mock xử lý job.
- Có API key/dịch vụ AI nếu test end-to-end đến bước sinh asset.

## Test data

| Loại | Dữ liệu mẫu |
| --- | --- |
| Shopee URL | `https://shopee.vn/product/123456/987654321` |
| Shopee short URL | `https://shp.ee/xxxxx` |
| Lazada URL | `https://www.lazada.vn/products/example-i123456789.html` |
| Lazada short URL | `https://lzd.co/xxxxx` |
| URL không hỗ trợ | `https://example.com/product/1` |
| File ảnh luồng A | `.jpg`, `.png`, `.webp`, tối đa 15MB |
| Mô tả sản phẩm luồng A | `Serum vitamin C cho da xỉn màu, giúp sáng da sau 7 ngày, phù hợp nữ 22-35 tuổi, phong cách banner sạch và cao cấp.` |
| Headline luồng A | `SÁNG DA 7 NGÀY` |
| Subline luồng A | `Deal độc quyền hôm nay` |
| CTA luồng A | `Mua ngay` |
| File video | `.mp4`, `.mov` |

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| VISUAL-TC-01 | User Free tạo visual từ URL | Gọi `/api/visual/from-url` bằng user Free | Trả HTTP `403`, mã lỗi `plan_required`. |
| VISUAL-TC-02 | User Starter tạo job Shopee | Gọi `/api/visual/from-url` với Shopee URL | Trả `job_id`, status `queued`. |
| VISUAL-TC-03 | User Starter tạo job Lazada | Gọi `/api/visual/from-url` với Lazada URL | Trả `job_id`, status `queued`. |
| VISUAL-TC-04 | URL không hỗ trợ | Gọi from-url với `example.com` | Trả lỗi `unsupported_product_url`. |
| VISUAL-TC-05 | Upload ảnh luồng A kèm mô tả sản phẩm | Gọi `/api/visual/upload` với file ảnh và form-data `product_description`, `headline`, `subline`, `cta`, `niche`, `platforms` | Tạo job pipeline `A`, status `queued`; `product_info` lưu đúng các trường đã nhập. |
| VISUAL-TC-06 | Upload ảnh luồng A không nhập mô tả | Gọi `/api/visual/upload` chỉ với file ảnh, `niche`, `platforms` | Vẫn tạo job pipeline `A`; AI dùng ảnh và niche làm fallback để tạo banner. |
| VISUAL-TC-07 | Upload video | Gọi `/api/visual/upload` với file video | Tạo job pipeline `C`. |
| VISUAL-TC-08 | Upload không có file | Gọi upload không kèm file | Trả lỗi `file_required` nếu route nhận request; multipart sai format có thể bị Fastify chặn trước. |
| VISUAL-TC-09 | Xem job hợp lệ | Gọi `/api/visual/job/:id` với job của user | Trả chi tiết job. |
| VISUAL-TC-10 | Xem job user khác | Gọi job id của user khác | Trả `404` hoặc không trả dữ liệu. |
| VISUAL-TC-11 | Lịch sử job | Gọi `/api/visual/history` | Trả tối đa 20 job gần nhất của user. |

## Checklist riêng cho luồng A

- UI chỉ cho chọn file ảnh `.jpg`, `.jpeg`, `.png`, `.webp` và chặn file quá 15MB.
- Người dùng có thể nhập mô tả sản phẩm tối đa 1200 ký tự.
- Người dùng có thể nhập headline, subline, CTA; CTA mặc định là `Mua ngay`.
- Khi bấm tạo, request multipart gửi `product_description`, `headline`, `subline`, `cta`, `niche`, `platforms`.
- API tạo job pipeline `A` với `source_type = photo_upload`.
- `product_info` của job lưu `niche`, `product_description`, `headline`, `subline`, `cta` nếu có.
- Queue nhận `copy.productDescription` và dùng nó trong bước phân tích ảnh, sinh nội dung quảng cáo, prompt tạo banner.
- Nếu không nhập mô tả, luồng A vẫn chạy bằng ảnh và niche.
- Sau khi tạo job thành công, form reset ảnh, mô tả, headline, subline và CTA về mặc định.

## Regression checklist

- Gói Free luôn bị chặn Visual AI.
- Job tạo ra có `user_id` đúng.
- User không đọc được job của user khác.
- Status job nằm trong `queued`, `processing`, `done`, `failed`.
- Asset hiển thị được khi job `done`.
- `visualQueue.add()` chạy async sau khi API trả response; test API tạo job không nên chờ asset có ngay.
