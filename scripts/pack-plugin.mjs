import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pack } from '@commerce/plugin-sdk/cli';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const stage = path.resolve('release/plugin');
const platform = process.platform + '-' + process.arch;
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
// 界面目录整体带上：index.html、app.mjs、控制器与各业务模块、style.css。
await cp('ui', path.join(stage, 'ui'), { recursive: true });
// 交付的 SDK 必须与安装依赖同一份，避免界面运行时和底座契约漂移。
const sdk = new URL('./index.mjs', import.meta.resolve('@commerce/plugin-sdk/cli'));
await cp(sdk, path.join(stage, 'ui/sdk.mjs'));
await cp('LICENSE', path.join(stage, 'LICENSE'));
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, commerce: pkg.commerce }, null, 2));
const name = pkg.commerce.id + '-' + pkg.version + '-' + platform + '.ecplugin';
const filename = path.resolve('release', name);
const result = await pack(stage, filename);
const bytes = await readFile(filename);
// 市场按平台读取目录片段，片段里的地址必须是这条 Release 的固定下载地址；
// 片段本身只描述当前平台，另一个平台由对应机器的构建补齐。
const fragment = path.resolve('release', 'catalog-' + platform + '.json');
await writeFile(fragment, JSON.stringify({
  schemaVersion: 1,
  plugins: [{
    ...pkg.commerce,
    version: pkg.version,
    artifacts: {
      [platform]: {
        url: 'https://github.com/ZhiPenTu/qingzuo-plugin-shein-full/releases/download/v' + pkg.version + '/' + name,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }
    }
  }]
}, null, 2) + '\n');
console.log(JSON.stringify({
  artifact: path.relative(process.cwd(), filename),
  fragment: path.relative(process.cwd(), fragment),
  platform,
  size: bytes.length,
  sha256: result.sha256
}, null, 2));
