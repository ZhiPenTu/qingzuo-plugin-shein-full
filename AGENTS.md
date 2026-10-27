# AGENTS.md

本文件是 `qingzuo-plugin-shein-full` 的开发指南。插件跑在轻作底座（`qingzuo-desktop`）的渲染进程沙箱里，权限、密钥和网络边界都由底座主进程裁决。

## 项目边界

- 这里只有插件：`ui/` 是插件页面与业务逻辑，`tests/` 是单元与端到端测试，`scripts/pack-plugin.mjs` 负责打包。
- 平台能力（浏览器、网络、凭据、存储、文件令牌）属于底座，不要在本仓库复刻或用 `node_modules` 里的内部路径绕过 SDK。
- 1688 的平台知识（页面结构、表头、图片规则）留在 `ui/collect.mjs`，不要下沉到底座。
- 希音接口形状集中在 `ui/shein-client.mjs`（接口与签名）和 `ui/shein-payload.mjs`（发品载荷），真实环境校正只改这两处。

## 硬约束

- **人工闸门**：只有草稿处于 `待审核`、页面无未保存改动、且用户在确认摘要里点过确认，才允许调用发品链路。任何「自动提交」「批量静默提交」的需求都视为越权。
- **确认前的调用范围**：编辑阶段只允许只读接口（属性模板、币种标准、类目建议）；查重、额度、上传图片、发品、查审核状态都必须发生在确认之后。
- **不绕过风控**：登录、验证码、访问受限、页面改版一律停为「需人工处理」，不注入脚本对抗检测。
- **密钥不出主进程**：`secretKey` 只通过 `network.sign` 使用；不要在页面里保存、打印或回填密钥。
- **不改商品原貌**：图内文字翻译只替换文字，不抠图、不换商品、不重排构图；原图必须保留，提交版本由运营确认。翻译会调用图像模型并产生费用，不能静默批量生成。

## 目录

- `ui/app.mjs` 界面渲染与事件；`ui/controller.mjs` 流程编排；`ui/store.mjs` 状态机与校验。
- `ui/collect.mjs` 快照解析；`ui/images.mjs` 图片格式、体积、尺寸校验与 WebP→JPEG。
- `ui/shein-sign.mjs` 签名规范串与拼装；`ui/translate.mjs` 翻译提示词与严格 JSON 解析。
- `tests/e2e/` 真实 Electron 端到端：本地 HTTPS 伪造 1688、本地 mock 希音网关与翻译服务。

## 开发与验证

```sh
npm install                    # vendor/commerce-plugin-sdk-1.4.0.tgz 提供 SDK
npm test                       # 单元测试（node --test）
QINGZUO_DESKTOP_ROOT=/path/to/qingzuo-desktop npm run test:e2e
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

- 改动采集、定价、载荷、签名、状态机时，先跑 `npm test`，再跑端到端。
- 端到端里「确认前零发品调用」「确认后调用顺序与签名」「幂等键」三类断言不允许为了跑通而放宽；如果断言与预期不符，先判断是实现错了还是预期错了。
- 平台侧缺能力时，改底座（`qingzuo-desktop`）并在那里补平台测试，不要在插件里造假接口。

## 提交与发布

- 提交信息用 `feat:` / `fix:` / `test:` / `docs:` / `chore:` 前缀。
- 未经用户明确要求，不要提交、不要打标签、不要发布市场版本。
- 打包产物 `release/`、测试产物 `output/`、`node_modules/` 不入库。
- 发布前必须完成 [docs/testing-and-release.md](docs/testing-and-release.md) 里的真实环境验收。

## 用户可见文案

- 只写运营需要知道的内容：这一步要做什么、哪里出错、怎么继续。
- 不解释内部实现（快照结构、签名算法、存储键名、接口路径）。
- 正常状态保持安静，出错和需要人工介入时才提示。
