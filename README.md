---
ai_level: low
---

# 阿里云 CDT 流量监控 & ECS 控制 (Cloudflare Worker)

本项目通过 Cloudflare Workers 的 Cron 触发器运行阿里云 ECS 控制逻辑。

这是对原始 `aly_ecs.py` 脚本的无服务器替代方案。

## 前置要求

- 已安装 [Node.js](https://nodejs.org/)
- Cloudflare 账户

## 设置

1. **安装依赖**

   ```bash
   npm install
   ```

2. **配置密钥**

   出于安全考虑，请在 Cloudflare 中设置以下密钥。不要将它们提交到代码仓库。

   ```bash
   npx wrangler secret put ACCESS_KEY_ID
   # 输入您的阿里云 Access Key ID

   npx wrangler secret put ACCESS_KEY_SECRET
   # 输入您的阿里云 Access Key Secret

   npx wrangler secret put REGION_ID
   # 输入您的区域 ID (例如: cn-hongkong)

   npx wrangler secret put ECS_INSTANCE_ID
   # 输入您的 ECS 实例 ID

   npx wrangler secret put TRAFFIC_THRESHOLD_GB
   # 输入流量阈值 (例如: 180)。如果未设置，默认值为 180。
   ```

3. **部署**

   ```bash
   npx wrangler deploy
   ```

## 配置

- **调度计划**: 默认情况下，worker 每 30 分钟运行一次。您可以在 `wrangler.toml` 文件的 `[triggers]` 部分修改此设置。
  ```toml
  [triggers]
  crons = ["*/30 * * * *"]
  ```

## 开发

- **本地测试 (通过 HTTP 触发)**

   在开发过程中，您可以通过访问 worker URL 手动触发逻辑，例如在使用 `wrangler dev` 时。

  ```bash
   npx wrangler dev
  ```
