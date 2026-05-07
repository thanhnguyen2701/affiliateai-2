# Chức năng Knowledge Base và RAG

## Mục tiêu

Cho phép người dùng đưa tài liệu sản phẩm, brand, review, policy, nội dung mẫu hoặc thông tin đối thủ vào hệ thống để AI trả lời và tạo content dựa trên dữ liệu riêng.

## Tóm tắt cho BA/Tester

Knowledge Base là nơi người dùng “dạy” AI bằng dữ liệu riêng. Khi đã upload tài liệu sản phẩm hoặc chính sách, AI phải trả lời chính xác hơn thay vì chỉ dùng kiến thức chung.

## Luồng nghiệp vụ dễ hiểu

1. Người dùng upload text hoặc nhập URL sản phẩm/tài liệu.
2. Hệ thống kiểm tra loại tài liệu và độ dài nội dung.
3. Hệ thống chia nội dung thành các đoạn nhỏ.
4. Hệ thống tạo embedding và lưu vào Knowledge Base.
5. Khi người dùng hỏi về sản phẩm/chính sách, AI tìm đoạn liên quan.
6. AI dùng các đoạn liên quan để trả lời.
7. Người dùng có thể xem danh sách tài liệu hoặc xóa tài liệu đã lưu.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| KB-01 | User upload text hợp lệ thành công. |
| KB-02 | Text dưới 50 ký tự bị từ chối. |
| KB-03 | URL hợp lệ được ingest và lưu chunk nếu đọc được nội dung. |
| KB-04 | Danh sách Knowledge Base không bị trùng source name. |
| KB-05 | User xóa source thì các chunk thuộc source đó bị xóa. |
| KB-06 | User không thấy/xóa được tài liệu của user khác. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Upload product text | `kb_type = product`, content trên 50 ký tự | Trả số chunk đã lưu. |
| Upload text quá ngắn | Content dưới 50 ký tự | Trả lỗi validation. |
| Upload kb_type sai | `kb_type = random` | Trả lỗi validation. |
| Ingest URL hợp lệ | URL đọc được | Trả `success: true`, có `chunks_stored`. |
| List KB | User có nhiều chunk cùng source | Chỉ hiển thị source một lần. |
| Delete source | Source thuộc user | Xóa thành công. |

## Loại tài liệu

| `kb_type` | Mục đích |
| --- | --- |
| `product` | Thông tin sản phẩm. |
| `brand` | Tài liệu thương hiệu. |
| `review` | Review thật, feedback khách hàng. |
| `policy` | Chính sách đổi trả, bảo hành, giao hàng. |
| `content` | Content mẫu. |
| `competitor` | Thông tin đối thủ. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `POST` | `/api/knowledge/upload-text` | Có | Upload text trực tiếp vào KB. |
| `POST` | `/api/knowledge/ingest-url` | Có | Crawl URL, chia chunk và embed. |
| `GET` | `/api/knowledge/list` | Có | Lấy danh sách source đã lưu. |
| `DELETE` | `/api/knowledge/:source` | Có | Xóa toàn bộ chunk theo source name. |

## Request upload text

```json
{
  "kb_type": "product",
  "source_name": "Innisfree Green Tea Serum",
  "content": "Nội dung tài liệu tối thiểu 50 ký tự...",
  "metadata": {
    "language": "vi"
  }
}
```

## Cách RAG hoạt động

1. Nội dung được chia thành nhiều chunk.
2. Mỗi chunk được embed bằng embedding model.
3. Vector lưu vào `knowledge_chunks`.
4. Khi intent là `product_research`, hệ thống tìm chunk liên quan bằng semantic search.
5. RAG Agent dùng các chunk liên quan làm ngữ cảnh để trả lời.

## Bảng dữ liệu

| Bảng | Vai trò |
| --- | --- |
| `knowledge_chunks` | Lưu chunk text, embedding, metadata, source. |
| `affiliate_profiles` | Bổ sung ngữ cảnh user khi trả lời. |

## Yêu cầu hạ tầng

- PostgreSQL cần extension `vector`.
- Cần cấu hình `OPENAI_API_KEY` hoặc provider embedding tương ứng.
- SQL schema có function `search_knowledge`.

## File liên quan

- `apps/api/src/routes/payment.ts`
- `apps/api/src/services/memory/rag-service.ts`
- `apps/api/src/agents/agents-v2.ts`
- `packages/db/migrations/001_initial_schema.sql`
