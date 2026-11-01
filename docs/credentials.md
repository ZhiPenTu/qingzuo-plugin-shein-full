# 凭据与设置

插件里能配置的东西都在右上角「设置」里。希音的 `APP_SecretKey` 与店铺 `secretKey` 都存在系统凭据库，系统不会把已保存内容自动回填到页面。只有本次插件页面会话中，用户刚输入并成功保存或启动授权的值会暂存在页面内存里，眼睛可临时回显；关闭设置或页面退出即清除，不会持久化明文。

## 设置项

| 项目 | 位置 | 说明 |
| --- | --- | --- |
| 翻译模型 | 设置 → 翻译模型 | 从轻作 AI 设置拉取模型；留空使用轻作默认模型 |
| 新草稿加价系数 | 设置 → 新草稿加价系数 | 默认 `1.35`，可填 `1.05`–`3`。只影响之后新建的草稿 |
| 希音接口 | 设置 → 希音接口 | 全托管正式 `https://openapi.sheincorp.cn`，测试 `https://openapi-test01.sheincorp.cn` |
| 希音 APP_ID | 设置 → 希音 APP_ID | 开放平台「应用管理」里的应用标识，不是密钥，存在设置里 |
| 希音 APP_SecretKey | 设置 → 希音 APP_SecretKey | 存系统凭据库，只用于换密钥与解密；重新打开轻作后需要再次输入，本次会话输入过的值可临时回显 |
| 店铺 secretKey | 设置 → 已有店铺 openKeyId 与 secretKey | 存系统凭据库；本次会话手动保存过的值可临时回显，授权自动换来的值不回显 |
| 授权回调地址 | 设置 → 授权回调地址 | 插件按当前环境生成，只读；「连接希音」用它接收回调 |
| 网络代理 | 设置 → 网络代理与出口 | 列出需要代理软件执行 `DIRECT` 的域名，可复制 Clash 或 Surge 规则 |
| 希音接口当前出口 | 设置 → 网络代理与出口 | 手动检测时显示接口出口 IP、位置和运营商；请求只访问 `ipinfo.io/json`，不携带店铺凭据 |

设置保存后立即生效。更换 AI 模型后，下一次翻译使用新模型。切换希音接口环境会清除旧环境的店铺凭据与应用凭据，需要在新环境重新连接。

## 网络代理与出口

1688 登录、采集、商品图片、希音授权、希音接口和授权回调都应直连，不要让代理节点接管。设置页会把以下域名标记为需要 `DIRECT`：

| 域名 | 用途 |
| --- | --- |
| `1688.com` | 1688 登录、采集与商品页 |
| `taobao.com`、`tmall.com` | 1688 账号登录可能发生的跳转 |
| `alicdn.com` | 1688 商品图片 |
| `sheincorp.cn` | 希音接口与测试环境 |
| `sheincorp.com` | 希音授权与正式接口 |
| `zhipentu.github.io` | 希音授权回调页 |

Clash/Mihomo 复制内容：

```yaml
rules:
  - DOMAIN-SUFFIX,1688.com,DIRECT
  - DOMAIN-SUFFIX,taobao.com,DIRECT
  - DOMAIN-SUFFIX,tmall.com,DIRECT
  - DOMAIN-SUFFIX,alicdn.com,DIRECT
  - DOMAIN-SUFFIX,sheincorp.cn,DIRECT
  - DOMAIN-SUFFIX,sheincorp.com,DIRECT
  - DOMAIN,zhipentu.github.io,DIRECT
```

Surge 复制内容：

```text
DOMAIN-SUFFIX,1688.com,DIRECT
DOMAIN-SUFFIX,taobao.com,DIRECT
DOMAIN-SUFFIX,tmall.com,DIRECT
DOMAIN-SUFFIX,alicdn.com,DIRECT
DOMAIN-SUFFIX,sheincorp.cn,DIRECT
DOMAIN-SUFFIX,sheincorp.com,DIRECT
DOMAIN,zhipentu.github.io,DIRECT
```

务必在代理软件里保存并重载规则。若使用 TUN、增强模式或全局路由，只改系统代理开关不够。

「检测出口」按钮通过希音接口同一网络通道访问 `https://ipinfo.io/json`，只显示 IP、位置和运营商，不发送店铺凭据。它可以帮助识别 TUN/增强模式是否接管了接口请求；如果这里显示的是代理节点 IP，就说明接口请求已经走了代理。1688 内嵌浏览器跟随系统代理，仍需按上面的 `DIRECT` 规则配置。

## 店铺凭据怎么来

希音开放平台把「应用」和「店铺」分开授权：应用的 `APP_ID`、`APP_SecretKey` 只能证明开发者身份，业务接口要的是店铺的 `openKeyId` 与 `secretKey`。

1. 插件用 `appid` 拼出授权链接（`https://<授权页域名>/?appid=<APP_ID>&redirectUrl=<base64>&state=<state>#/empower`），在内嵌浏览器里打开；商家同意后回调地址会带 `tempToken` 与 `state`。
2. 调 `POST /open-api/auth/get-by-token`，请求头用 `x-lt-appid`，签名用 `APP_ID`（顶替 `openKeyId`）与 `APP_SecretKey` 生成，请求体是 `{ "tempToken": "..." }`。
3. 返回的 `info.openKeyId` 直接可用；`info.secretKey` 是密文，要用 `APP_SecretKey` 解密：密钥取 `APP_SecretKey` 的 UTF-8 前 16 字节，AES-128-CBC，IV 固定 `space-station-de`，PKCS7 补齐。

插件把这三步做成了「连接希音」按钮：填 APP_ID、APP_SecretKey，点一下打开授权页，商家确认后就自动读回 `tempToken`，把 `openKeyId` 存进设置、解密后的 `secretKey` 存进系统凭据库。授权页由插件按所选环境生成：全托管正式环境在 `https://openapi-sem.sheincorp.com`，测试环境在 `https://openapi-test01.sheincorp.cn`；回调统一落在 `https://zhipentu.github.io/qingzuo-desktop/shein-auth-callback.html`。`state` 每次授权都不同，回来的 `state` 对不上就不算这次的结果。

手里已经有店铺 `openKeyId` 与 `secretKey` 时（例如测试店铺直接给出的那一对），展开「已有店铺 openKeyId 与 secretKey」直接填写即可，不必走授权流程。

## 凭据清单

清单里声明的两个凭据与代码一一对应，没有多申请的：

| 凭据名 | 用途 | 谁在使用 |
| --- | --- | --- |
| `shein-app-secret` | 换密钥请求的签名与 `secretKey` 解密 | `ui/shein-client.mjs`、`ui/controller.mjs` |
| `shein-secret-key` | 希音业务请求签名 | `ui/shein-client.mjs` 通过 `network.sign` 调用 |

`openKeyId` 会出现在每个业务请求的 `x-lt-openKeyId` 头里，本身是公开标识，因此不占凭据槽。

## 密钥怎么用

- **业务签名不出主进程。** 插件只把「要签名的规范串」交给主进程的 `network.sign`，拿回摘要；签名算法是 `HMAC-SHA256(secretKey + 5 位随机串, openKeyId&timestamp&path)`，随机串随请求一起发出，用于希音侧还原密钥。
- **只有换密钥那次会碰到明文。** 希音下发的 `secretKey` 是密文，解密需要 `APP_SecretKey` 原值，所以这两个值在点「连接希音」时进入页面，解密结果立刻写入凭据库；输入框随即清空。关闭设置前可用眼睛临时回显本次输入，关闭或页面退出后即清除。
- **翻译使用轻作 AI 配置。** 服务地址、访问密钥和模型都由底座保管，插件只请求模型列表和补全结果。

## 轮换与撤销

- 轮换店铺密钥：点「连接希音」重新走一次店铺授权即可，旧的 `secretKey` 被覆盖。
- 轮换应用密钥：在开放平台重置 `APP_SecretKey` 后，重新填 APP_ID、APP_SecretKey 并连接一次。
- 更换 AI 提供方或模型：在轻作的 AI 设置里完成，插件里点「刷新」重新拉取模型。
- 怀疑泄露：先在对应平台吊销密钥，再展开「已有店铺 openKeyId 与 secretKey」点「清除」，最后重新连接。已提交的草稿不受影响，但再次提交前要重新配好凭据。

## 测试环境与正式环境

- 两套域名在设置里切换，凭据也各有一套；切换环境后要重新连接，`openKeyId` 与 `secretKey` 必须属于同一个环境。
- 从旧版升级时，插件会一次性清除没有环境标记的旧凭据并保留草稿、模型与加价系数。这样做是为了避免把旧域名签发的密钥继续发给新域名；重新连接一次后即可继续使用。
- 授权调试页模拟出来的 `openKeyId`、`secretKey` 只验证换密钥流程，调不动业务接口；要在测试环境真实发品，用测试店铺给出的那一对。
- 测试环境发出的商品只在测试环境可见，不会进入正式店铺。
- 插件同时只保存一份希音凭据；需要频繁来回切换时，每次切换后重新连接对应环境。

## 卸载与数据

插件的凭据、浏览器登录分区、设置、草稿、图片文件令牌都归插件所有。卸载插件时它们会被一起清除，不会留在底座里，也不会被其他插件读到。

因此卸载前如果还需要历史草稿，先导出或截图留档。

## 常见报错

| 提示 | 处理 |
| --- | --- |
| 请先填写希音 APP_ID | 在设置里补 APP_ID |
| 请填写希音 APP_SecretKey | 在设置里补 APP_SecretKey，或者换用店铺密钥直接填写 |
| 等待希音授权超时，请重新连接 | 授权页十分钟内没确认，重新点「连接希音」 |
| 已取消希音授权 | 主动取消了等待，需要时重新连接 |
| 希音授权没有返回临时授权码 | 回跳地址里没有 `tempToken`，重新走一次授权 |
| 希音返回的密钥无法解密 | 核对 APP_ID 与 APP_SecretKey 是否属于同一个应用、是否已被重置 |
| 希音授权没有返回店铺凭据 | 授权结果已过期或已被使用，重新走一次授权 |
| 请先在设置中连接希音店铺 | 完成「连接希音」，或在展开项里直接填店铺凭据 |
| 希音凭据无效或未授权 | 核对凭据是否同一环境、是否已被吊销，必要时重新连接 |
| 希音接口请求过于频繁 | 停一会儿手动重试，插件不会自动重试 |
| AI 服务密钥无效或未授权 | 到轻作 AI 设置重新检查兼容代理地址、访问密钥和模型 |
