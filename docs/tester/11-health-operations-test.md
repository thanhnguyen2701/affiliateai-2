# Test chức năng Health Check và vận hành

## Phạm vi test

Kiểm thử API health cơ bản, deep health, response khi dependency lỗi và khả năng gọi không cần đăng nhập.

## Tiền điều kiện

- Backend API đang chạy.
- Có thể bật/tắt hoặc mock dependency nếu cần test degraded.

## Test cases

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| HEALTH-TC-01 | Health cơ bản | Gọi `GET /health` | HTTP 200, `status = ok`. |
| HEALTH-TC-02 | Health không cần token | Gọi `/health` không Authorization | Vẫn trả thành công. |
| HEALTH-TC-03 | Deep health bình thường | Gọi `GET /health/deep` khi database và CakeAI health OK | Trả HTTP `200`, status `healthy`. |
| HEALTH-TC-04 | Deep health degraded | Mock DB/service ngoài lỗi hoặc thiếu CakeAI config | Trả HTTP `207`, status `degraded`, không crash server. |
| HEALTH-TC-05 | Response có timestamp | Gọi `/health` | Có `timestamp` ISO string. |
| HEALTH-TC-06 | Response có version | Gọi `/health` | Có `version`. |

## Smoke commands

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/health/deep
```

## Regression checklist

- `/health` luôn nhẹ và nhanh.
- `/health` không yêu cầu đăng nhập.
- `/health/deep` không làm server crash khi dependency lỗi.
- Status phản ánh đúng tình trạng dependency.
