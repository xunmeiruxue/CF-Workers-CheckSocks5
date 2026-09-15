#!/usr/bin/env node
/**
 * 把上游 _worker.js 写入 upstream/_worker.js。
 *
 * 用法（由 .github/workflows/sync.yml 调用）：
 *   git show FETCH_HEAD:_worker.js | node tools/sync-upstream.mjs <输出路径>
 *
 * 处理内容：去掉 UTF-8 BOM、拒绝空内容、写上游版本号、
 * 用 node --check 做一次 ESM 语法校验，坏文件不会被提交。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outputPath = resolve(process.argv[2] || 'upstream/_worker.js');
const revision = (process.env.UPSTREAM_REV || '').trim();
const repo = process.env.UPSTREAM_REPO || 'https://github.com/cmliu/CF-Workers-CheckSocks5';

function fail(message) {
	console.error('[sync-upstream] ' + message);
	process.exit(1);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let source = Buffer.concat(chunks);

if (source.length === 0) fail('上游 _worker.js 内容为空，放弃写入');

// 上游文件带 UTF-8 BOM，去掉避免打包器解析歧义
if (source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf) {
	source = source.subarray(3);
}

const text = source.toString('utf8');
if (!text.includes('export default')) fail('上游文件里没有 export default，疑似上游改了入口结构，请人工确认');
if (!text.includes("cloudflare:sockets")) fail('上游文件里没有 sockets 引用，疑似上游改了实现，请人工确认');

mkdirSync(dirname(outputPath), { recursive: true });

// ESM 语法校验：坏文件直接拦在这里，不让它进仓库
const checkPath = outputPath + '.check.mjs';
writeFileSync(checkPath, text);
try {
	execFileSync(process.execPath, ['--check', checkPath], { stdio: 'pipe' });
} catch (error) {
	fail('上游文件语法校验失败：' + (error.stderr ? error.stderr.toString() : error.message));
}

writeFileSync(outputPath, text);

const metaPath = resolve(dirname(outputPath), 'UPSTREAM_REV');
const previous = (() => {
	try {
		return readFileSync(metaPath, 'utf8').trim();
	} catch {
		return '';
	}
})();
writeFileSync(metaPath, (revision || 'unknown') + '\n');

console.log('[sync-upstream] 写入 ' + outputPath + '（' + source.length + ' 字节）');
console.log('[sync-upstream] 上游仓库 ' + repo);
console.log('[sync-upstream] commit ' + (revision || 'unknown') + (previous && previous !== revision ? '（原 ' + previous + '）' : ''));
