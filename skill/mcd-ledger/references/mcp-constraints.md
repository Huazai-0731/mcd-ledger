# 麦当劳 MCP 实测硬约束

> 来源：真实账号实测（2026-10-20 全链路验证）+ MCP_INTEGRATION.md。回答用户提问或排查异常时引用，**不要凭 API 文档字面意思推翻这些结论**。

## 接入事实

| 项 | 值 |
| --- | --- |
| 地址 | `https://mcp.mcd.cn`（可用 `MCD_MCP_URL` 覆盖） |
| 协议 | MCP 2025-06-18 · Streamable HTTP，`Authorization: Bearer <token>` |
| 工具总数 | 实测 35 个 |
| 限流 | 600 次/分钟（超限 429，客户端已内置滑动窗口 + 指数退避 + 尊重 `Retry-After`） |
| 本项目只用 | 8 个只读工具：`now-time-info`、`order-list`、`query-order`、`query-meals`、`query-my-coupons`、`query-my-account`、`mall-points-products`、`campaign-calendar` |

## 十条硬约束

1. **一单只能用一张券**：两张券同单传参报 `600022`。"多券"问题实为"选哪张 + 要不要拆单"。
2. **菜单价 ≠ 结算价**：实测安格斯四件套菜单 ¥37、直接结算 ¥66.50。任何从菜单价推差价的做法都错，必须以 `calculate-price` 为准（本 Skill 不调用它，只用订单记录口径）。
3. **菜单 tags 不保证结算生效**：圆筒标"第二份半价"，买 2 个结算 ¥10 无折扣。
4. **商品随时段售罄**：优品豆浆 10:15 可售、13:19 报 `60006`；菜单本身也随时段切换（10:00 前只有早餐菜单）。
5. **券的 `couponId` 只有 `query-store-coupons` 给**；`query-my-coupons` / `available-coupons` 只返回 markdown。
6. **`status` 数字编码与官方文档不符**：文档说 1=待支付、7=已取消、10=配餐中；实测 **10=待支付、60=订单已取消**。状态判断一律用 `orderStatus` 文本（`"待支付"` / `"订单已取消"`），用数字会写出永不触发的分支。
7. **`payH5Url` 是一次性凭证**：`https://m.mcd.cn/mcp/scanToPay?orderId=<id>` 带订单号，不可写入日志、不可截图外传。它是 H5 链接不是二维码图片，需要客户端自己编码成 QR。
8. **待支付单 15 分钟过期**（`expirePayTime = 下单时间 + 15min`）；未支付时 `pickupCode` 为空串。
9. **无购物车概念**：`create-order` 直接出待支付单 + 支付链接。
10. **`auto-bind-coupons` 无参数**，一键领全部可领券——这是唯一的低风险写操作；本 Skill 不调用。

## 字段坑位（解析层已处理，排障时知道去哪看）

- `order-list` 响应是双层 `{"data":{"data":{"list":[…]}}}`，直接读 `data.list` 得 `undefined`。
- `query-meals` 必须带 `beType`；`beType=1` 到店自取不传 `beCode`。统一用 `beType=1 + orderType=1` 取价格字典。
- 恒等式：`totalAmount − totalDiscountAmount + 配送费 ≈ realTotalAmount`；`totalDiscountAmount` 缺失时用该式倒推。
- 券字段无公开说明：用字段嗅探 + 有效期字符串解析（`2026-10-20 05:00-2026-10-20 10:29 周二 05:00-10:29`），失败时降级而不是当作没有券。
- 积分字段拼写不一致：`currentMouthExpirePoint`（是 Mouth 不是 Month），解析器两种拼写都兼容。

## 写操作边界

本 Skill **不调用**任何写操作（`create-order`、`cancel-order`、`auto-bind-coupons`、`draw-lottery` 等）。用户要求代办下单时，说明该链路（`calculate-price` → `create-order` → 支付 → `cancel-order` 撤销）技术上已验证可行（真实账号 11 秒闭环、¥0 支付、无残留），但不在本 Skill 范围内，不要擅自扩展。
