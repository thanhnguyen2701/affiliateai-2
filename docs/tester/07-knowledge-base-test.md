# Test chức năng Knowledge Base và RAG

## Phạm vi test

Kiểm thử upload text, ingest URL, list source, delete source và dùng Knowledge Base cho RAG.

## Tiền điều kiện

- User đã đăng nhập.
- Database có extension vector.
- Embedding provider/API key hoạt động hoặc mock.
- Lưu ý code hiện tại: upload text và ingest URL dùng Supabase trực tiếp; list/delete đang gọi `(app as any).db()` nên có thể trả `500 internal_error`.
- Lưu ý Chat RAG hiện import `ragService.search` nhưng module chưa export `ragService`; chat có thể không dùng được KB đã upload.

## Test data

| Loại | Dữ liệu |
| --- | --- |
| `kb_type` hợp lệ | `product`, `brand`, `review`, `policy`, `content`, `competitor` |
| `kb_type` sai | `random` |
| Content hợp lệ | Text trên 50 ký tự |
| Content không hợp lệ | Text dưới 50 ký tự |

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| KB-TC-01 | Upload text hợp lệ | Gọi `/api/knowledge/upload-text` với content trên 50 ký tự | Trả `chunks_stored > 0`. |
| KB-TC-02 | Upload text quá ngắn | Content dưới 50 ký tự | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| KB-TC-03 | Upload kb_type sai | `kb_type = random` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| KB-TC-04 | Ingest URL hợp lệ | Gọi `/api/knowledge/ingest-url` với URL đọc được | Trả `success: true`, có `chunks_stored`. |
| KB-TC-05 | Ingest URL sai format | `url = abc` | Request thất bại do validation; code hiện tại có thể trả `500 internal_error`. |
| KB-TC-06 | List Knowledge Base hiện tại | Gọi `/api/knowledge/list` | Có thể trả `500 internal_error` do thiếu `app.db()`; ghi bug nếu xảy ra. Sau khi fix, expected là danh sách source của user. |
| KB-TC-07 | List dedupe source sau khi fix | Một source có nhiều chunk | Source chỉ hiển thị một lần. |
| KB-TC-08 | Delete source hiện tại | Gọi `DELETE /api/knowledge/:source` | Có thể trả `500 internal_error` do thiếu `app.db()`; sau khi fix, các chunk thuộc source bị xóa. |
| KB-TC-09 | Delete source user khác sau khi fix | Gọi source không thuộc user | Không xóa dữ liệu user khác. |
| KB-TC-10 | RAG trả lời theo KB hiện tại | Upload policy rồi hỏi AI về policy | Có thể không bám KB do lỗi import `ragService`; ghi bug nếu response nói không tìm thấy KB. |

## Regression checklist

- Không upload được content quá ngắn.
- Không dùng được `kb_type` ngoài danh sách.
- User chỉ thấy dữ liệu KB của mình.
- Delete source không ảnh hưởng user khác.
