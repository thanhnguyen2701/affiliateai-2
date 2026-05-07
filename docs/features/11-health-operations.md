# Chức năng Health Check và vận hành

## Mục tiêu

Cung cấp endpoint kiểm tra tình trạng backend, database và dependency bên ngoài để hỗ trợ local development, deploy và monitoring.

## Tóm tắt cho BA/Tester

Health Check giúp biết hệ thống backend đang chạy hay lỗi. Tester nên dùng endpoint này trước khi test các chức năng khác để tránh nhầm lỗi môi trường với lỗi nghiệp vụ.

## Luồng kiểm tra dễ hiểu

1. Tester gọi `/health` để kiểm tra API server còn sống.
2. Nếu `/health` OK, gọi `/health/deep` để kiểm tra dependency như database hoặc service ngoài.
3. Nếu status là `degraded`, backend vẫn chạy nhưng có service phụ đang lỗi.
4. Nếu API không phản hồi, cần kiểm tra backend có đang chạy đúng port không.

## Tiêu chí nghiệm thu

| Mã | Tiêu chí |
| --- | --- |
| HEALTH-01 | `/health` trả `status: ok` khi backend chạy. |
| HEALTH-02 | `/health` không yêu cầu đăng nhập. |
| HEALTH-03 | `/health/deep` trả danh sách check dependency. |
| HEALTH-04 | Nếu dependency lỗi, `/health/deep` trả trạng thái `degraded` thay vì crash. |
| HEALTH-05 | Response có timestamp để phục vụ debug. |

## Gợi ý test case

| Test case | Dữ liệu | Kết quả mong đợi |
| --- | --- | --- |
| Health cơ bản | Gọi `/health` | HTTP 200, status `ok`. |
| Deep health bình thường | DB và service ngoài OK | Status `healthy`. |
| DB/service ngoài lỗi | Tắt hoặc mock lỗi dependency | Status `degraded` hoặc check service lỗi. |
| Không token | Không gửi Authorization | Vẫn gọi được. |

## API

| Method | Endpoint | Auth | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/health` | Không | Kiểm tra backend còn sống. |
| `GET` | `/health/deep` | Không | Kiểm tra sâu database và CakeAI/API ngoài nếu có cấu hình. |

## Response `/health`

```json
{
  "status": "ok",
  "timestamp": "2026-05-05T00:00:00.000Z",
  "version": "1.0.0"
}
```

## Response `/health/deep`

```json
{
  "status": "healthy",
  "checks": [
    {
      "service": "database",
      "status": "ok"
    },
    {
      "service": "cakeai",
      "status": "ok"
    }
  ]
}
```

## Trạng thái

| Status | Ý nghĩa |
| --- | --- |
| `healthy` | Tất cả dependency chính hoạt động. |
| `degraded` | Một hoặc nhiều dependency lỗi nhưng backend vẫn trả response. |
| `down` | Service phụ không phản hồi. |

## Dùng khi nào

- Sau khi chạy `npm run dev`.
- Sau khi deploy API lên Railway hoặc server riêng.
- Khi frontend báo không kết nối được API.
- Khi nghi ngờ lỗi Supabase, LLM provider hoặc network.

## Lệnh kiểm tra local

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/health/deep
```

## File liên quan

- `apps/api/src/routes/index.ts`
- `apps/api/src/server.ts`
- `apps/api/src/lib/supabase.ts`
- `.env.example`
