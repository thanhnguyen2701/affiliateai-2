# Chức năng Visual AI

## Mục tiêu

Visual AI tạo asset ảnh/video phục vụ affiliate marketing từ link sản phẩm, ảnh upload hoặc video raw.

## Tóm tắt cho BA/Tester

Người dùng dùng Visual AI để tạo ảnh hoặc video marketing mà không cần tự thiết kế. Hệ thống chạy theo job bất đồng bộ: người dùng tạo job, theo dõi trạng thái, sau đó xem/tải asset khi job hoàn tất.

Với luồng A, input chính là ảnh sản phẩm. Người dùng có thể mô tả sản phẩm và nhập headline/subline/CTA. API dùng phần mô tả này làm brief để điều chỉnh nội dung, bố cục và thông điệp, rồi tạo banner hoàn chỉnh theo từng platform.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng vào trang Visual AI.
2. Người dùng chọn một pipeline:
   - Link Shopee/Lazada.
   - Upload ảnh sản phẩm, nhập mô tả sản phẩm và copy banner.
   - Upload video raw.
3. Người dùng chọn platform output như TikTok, Facebook, Instagram, YouTube, Zalo.
4. Hệ thống kiểm tra plan. Gói Free không được dùng Visual AI.
5. Hệ thống tạo job trạng thái `queued`.
6. Queue xử lý job và cập nhật `processing`, `done` hoặc `failed`.
7. Người dùng xem asset trong lịch sử hoặc màn hình chi tiết job.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| VISUAL-01 | User gói Free không tạo được visual job. |
| VISUAL-02 | User gói Starter trở lên tạo được job từ link Shopee/Lazada hợp lệ. |
| VISUAL-03 | Link không phải Shopee/Lazada bị từ chối ở luồng URL. |
| VISUAL-04 | Upload ảnh kèm mô tả sản phẩm tạo pipeline A, upload video tạo pipeline C. |
| VISUAL-05 | Luồng A lưu mô tả sản phẩm/copy vào `product_info` và đưa vào queue tạo banner. |
| VISUAL-06 | Người dùng chỉ xem được job của chính mình. |
| VISUAL-07 | History hiển thị các job gần nhất với status đúng. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Tạo job từ Shopee | URL `shopee.vn` hoặc `shp.ee`, user Starter | Trả `job_id`, status `queued`. |
| Tạo job từ Lazada | URL `lazada.vn` hoặc `lzd.co`, user Starter | Trả `job_id`, status `queued`. |
| URL không hỗ trợ | URL website khác | Trả lỗi `unsupported_product_url`. |
| User Free tạo visual | User plan `free` | Trả lỗi `plan_required`. |
| Upload ảnh luồng A | File ảnh hợp lệ, mô tả sản phẩm, headline/subline/CTA nếu có | Tạo pipeline `A`; API dùng mô tả để điều chỉnh banner hoàn chỉnh. |
| Upload video | File video hợp lệ | Tạo pipeline `C`. |
| Xem job user khác | `job_id` không thuộc user | Trả `404` hoặc không trả dữ liệu. |

## Pipeline

| Pipeline | Input | Output chính |
| --- | --- | --- |
| `A` | Upload ảnh sản phẩm thực, mô tả sản phẩm, copy banner tùy chọn | Banner, thumbnail, carousel theo platform. |
| `B` | Link Shopee/Lazada | Bộ ảnh marketing từ thông tin sản phẩm. |
| `C` | Upload video raw | Video TikTok-style, subtitle, thumbnail. |
| `A+C` | Ảnh và video | Bộ asset đầy đủ khi backend hỗ trợ. |

## Điều kiện gói

Visual AI yêu cầu người dùng có plan khác `free`, tối thiểu Starter. Nếu chưa đủ điều kiện, API trả về `403` với mã lỗi `plan_required`.

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `POST` | `/api/visual/upload` | Có | Upload ảnh kèm `product_description` để tạo job pipeline A, hoặc upload video để tạo job pipeline C. |
| `POST` | `/api/visual/from-url` | Có | Tạo job pipeline B từ link Shopee/Lazada. |
| `GET` | `/api/visual/job/:id` | Có | Lấy trạng thái và asset của job. |
| `GET` | `/api/visual/history` | Có | Lấy 20 job gần nhất của user. |

## Request pipeline A

Multipart form-data:

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `file` | Có | Ảnh `.jpg`, `.jpeg`, `.png`, `.webp`, tối đa 15MB. |
| `platforms` | Không | Danh sách platform, ví dụ `tiktok,facebook`. |
| `niche` | Không | Mặc định `beauty` nếu không gửi. |
| `product_description` | Không | Brief sản phẩm, tối đa 1200 ký tự. |
| `headline` | Không | Dòng chính trên banner. |
| `subline` | Không | Dòng phụ trên banner. |
| `cta` | Không | Nút/kêu gọi hành động, mặc định UI là `Mua ngay`. |
| `badge` | Không | Nhãn ưu đãi nếu cần. |

## Request pipeline B

```json
{
  "product_url": "https://shopee.vn/product/123/456",
  "platforms": ["tiktok", "facebook"],
  "pipeline": "B"
}
```

## Trạng thái job

| Status | Ý nghĩa |
| --- | --- |
| `queued` | Đã tạo job, chờ xử lý. |
| `processing` | Đang tạo asset. |
| `done` | Hoàn tất, có assets. |
| `failed` | Lỗi, xem `error_msg`. |

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `visual_jobs` | Lưu pipeline, trạng thái, source URL/path, product info, assets, chi phí API. |
| `brand_kits` | Cấu hình màu, watermark, style áp vào asset. |

## Màn hình web

Trang `/dashboard/visual` cho phép chọn pipeline, platform, nhập mô tả/copy, upload file, theo dõi progress và xem asset đã tạo.

## File liên quan

- `apps/api/src/routes/index.ts`
- `apps/api/src/services/visual/visual-queue.ts`
- `apps/api/src/agents/openai-image-mini-agent.ts`
- `apps/api/src/agents/openai-video-mini-agent.ts`
- `apps/web/src/app/dashboard/visual/VisualPageClient.tsx`
- `apps/web/src/components/visual/*`
