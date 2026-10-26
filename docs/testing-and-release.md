# 测试与发布

这个插件的风险集中在两处：**没点确认就发了品**，以及**字段映射和真实平台不一致**。测试和验收都围绕这两点。

## 测试分层

| 层 | 命令 | 覆盖什么 | 依赖 |
| --- | --- | --- | --- |
| 单元 | `npm test` | 清单校验、采集解析、定价、签名、载荷、状态机、翻译解析、图片校验 | 无 |
| 端到端 | `QINGZUO_DESKTOP_ROOT=… npm run test:e2e` | 真实 Electron 底座装包 → 采集 → 翻译 → 配图 → 审核 → 确认 → 提交 → 查审核状态 | 已构建的 `qingzuo-desktop` |
| 宿主冒烟 | `QINGZUO_HOST_EXECUTABLE=… npm run test:host` | 打进安装包的宿主能加载插件、界面保持静默、密钥框是密码框 | 已安装的轻作桌面 |
| 平台契约 | 在 `qingzuo-desktop` 里跑 `npm run test:platform` | 浏览器白名单、`network.sign`、`storage` 隔离与配额 | 底座仓库 |

单元测试是 `node --test tests/*.test.mjs`。`tests/fixtures/1688-detail-snapshot.json` 是录制的快照固定件，采集规则改动必须让它继续通过。

## 端到端怎么跑起来

`tests/e2e/shein-full.spec.mjs` 做的事：

1. 用 `@commerce/plugin-sdk/cli` 的 `pack` 把 `ui/` 打成临时 `.ecplugin`，SDK 直接取安装依赖里的同一份。
2. 用 `_electron.launch` 启动 `QINGZUO_DESKTOP_ROOT` 指向的底座，带上临时 `--user-data-dir`。
3. 用 Chromium 的 `--host-resolver-rules` 把 `detail.1688.com` 与希音测试授权域名 `openapi-test01.sheincorp.cn` 一起指到本机 HTTPS 服务，证书是临时自签的，所以启动参数里有 `--ignore-certificate-errors`。这台服务同时模拟 1688 详情页、希音授权页与授权回调，授权页会把 `appid`、回调地址和 `state` 原样带回回调，用来断言插件自己走完了整条授权链路。
4. 通过 `COMMERCE_TEST_NETWORK_ROUTES` 把希音测试主机重定向到本机 mock 网关；AI 模型目录和补全由同一个 mock 网关的 `/v1/models` 与 `/v1/chat/completions` 提供。
5. 在底座里导入插件、配置 mock AI、打开工具、填希音设置与密钥，再走完整流程。

`COMMERCE_TEST_NETWORK_ROUTES` 的边界（底座侧实现，`desktop/network-test-routes.mjs`）：

- 只在**非打包构建**生效，安装包里的宿主直接忽略这个变量。
- 只能重定向固定的平台主机（希音正式、希音测试、OpenAI、DeepSeek），且目标必须是 `127.0.0.1`。
- 重定向发生在 `NetworkBroker` 完成 origin 授权之后，**不能绕过清单白名单**。
- 重定向请求不带 Cookie 跨主机。

所以这条链路既是端到端测试，也是白名单没有被测试开关绕过的证据。

## 不允许放宽的断言

以下断言如果失败，先判断是实现错了还是预期错了，不要改断言来让它变绿：

- 进入「待审核」后、点确认之前，查重 / 权限 / 额度 / 上传 / 发品 / 审核状态这六类调用**一次都不能发生**（编辑阶段读属性模板、币种标准属于只读准备，不算在内）。
- 弹出确认摘要后点「取消」，依旧零调用。
- 点确认后的调用顺序：查重 → 发品权限 → 额度 → 逐图上传 → 发品。
- 每个请求的 `x-lt-openKeyId`、13 位 `x-lt-timestamp`、`x-lt-signature` 都符合 `5 位随机串 + base64(hex(HMAC-SHA256(secretKey + 随机串, openKeyId&timestamp&path)))`。
- 非上传请求是 `application/json;charset=UTF-8`；上传请求是 `multipart/form-data`，字段名 `image_type` 与 `file`。
- 发品载荷：`default_language=en`、`main_site=shein`、多语言列表只有英语、`supplier_price` 等于「1688 单价 × 系数」、`supplier_sku` 与查重请求里的键完全一致。
- 提交后状态从「待审核」进入「已提交」，查到 `APPROVED` 后进入「通过」。

跑一次大约几秒到十几秒；首次会先生成自签证书，需要本机有 `openssl`。

## 发布前必须人工验收的两条链路

自动化跑绿只能证明「流程和断言一致」，不能证明「字段和真实平台一致」。下列两项各成功一次才能发布：

**一、真实 1688 采集**

- 用一条真实的 `detail.1688.com/offer/...` 链接，在未登录和已登录两种状态下各试一次。
- 核对：标题、最低价、起批量、属性表条数与内容、SKU 行数与颜色、主图数量、详情图数量、类目路径。
- 确认登录态在重启后仍然有效；遇到验证码时插件停在提示而不是卡死。
- 记录识别不到或识别错的字段，回到 `ui/collect.mjs` 修正并补固定件测试。

**二、希音测试环境发品**

- 在设置里切到测试环境 `https://openapi-test01.sheincorp.cn`，填该环境的 APP_ID、APP_SecretKey，点「连接希音」，在内嵌浏览器里用测试店铺完成授权；换到的 `openKeyId`、`secretKey` 应能在开放平台后台对上。
- 换密钥请求必须带 `x-lt-appid`（不是 `x-lt-openKeyId`），签名用 `APP_ID` 与 `APP_SecretKey` 生成；业务请求仍用换到的 `openKeyId` 与 `secretKey`。
- 先调一次店铺类目树、类目建议与属性模板，核对返回结构与 `ui/category.mjs` 的解析一致。
- 生成一条真实草稿，人工审核后确认提交，记录返回的 SPU / SKC / SKU 编号。
- 到希音后台核对：商品是否出现在待审核、字段是否落位、图片是否齐全、价格与币种是否正确。
- 用「查询审核状态」拉一次真实状态，核对 `ui/shein-client.mjs` 里 `parseDocumentState` 的字段映射。

**需要按真实返回校正的地方**（只改这两处，不影响采集与审核流程）：

- `ui/shein-payload.mjs`：`buildPublishPayload` 的字段名、层级、必填项、`image_info` 结构、SKC/SKU 字段。
- `ui/shein-client.mjs`：`parsePermission`、`parseQuota`、`parseFillInStandard`、`parseRepeated`、`parseUploadedUrl`、`parsePublishResult`、`parseDocumentState` 的取值兼容。
- `ui/category.mjs`：类目树、属性模板与类目建议的字段形状。

## 失败与重试

- 提交过程中断（超时、网关 5xx、网络断开）时，草稿会记下「上次提交结果未确认」。插件**不会自动重试**：先到希音后台核对是否已建品，确认没有建品后勾选重试，重试前仍会做供货 SKU 查重。
- 429 与 5xx 一律提示手动重试，不做退避轮询。
- 驳回后点「重新编辑」回到待审核，改完再次确认提交，不会复用上一次的确认。

## 打包与发布

```sh
npm test
QINGZUO_DESKTOP_ROOT=/path/to/qingzuo-desktop npm run test:e2e
npm run pack
```

`npm run pack` 产出 `release/official.shein-full-<version>-<platform>.ecplugin`，并打印体积与 SHA256。包里只有 `package.json`、`LICENSE` 和 `ui/`（含交付用 `sdk.mjs`），不带测试与 `node_modules`。

发布流程：

1. 改 `package.json` 的 `version` 与 `commerce.releaseNotes`。
2. 按上面的顺序跑完单元、端到端、打包。
3. 用 `unzip -l` 检查产物只含预期文件。
4. 在干净的轻作桌面里导入 `.ecplugin` 手动走一遍，或用 `QINGZUO_HOST_EXECUTABLE` 跑宿主冒烟。
5. 首发形态是本地安装试用；市场签名发布另行安排，不随代码合并自动进行。

底座需要支持插件 API `1.3.0`。旧底座会在安装时拒绝并提示升级，不要通过降低 `api` 声明来兼容——这个插件依赖的浏览器、签名、存储能力在 1.3 之前都不存在。
