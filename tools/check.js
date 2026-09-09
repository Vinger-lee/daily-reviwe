#!/usr/bin/env node
/**
 * daily-review 自检脚本
 * 用法: node tools/check.js <报告.html>
 * 检查项:
 *  1. HTML 基本结构（DOCTYPE / </html> / 单文件无外链 CDN script）
 *  2. 抽取内联 <script> 做 node --check 语法验证
 *  3. 表头与列内容一致性抽查（防止占位/错误表头）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('用法: node tools/check.js <报告.html>');
  process.exit(2);
}
const html = fs.readFileSync(file, 'utf-8');
let failed = 0;
const fail = (msg) => { console.error('FAIL: ' + msg); failed++; };
const ok = (msg) => console.log('OK  : ' + msg);

// 1. 基本结构
html.startsWith('<!DOCTYPE html>') ? ok('DOCTYPE 存在') : fail('缺少 <!DOCTYPE html>');
html.includes('</html>') ? ok('html 闭合标签存在') : fail('缺少 </html>');
const external = html.match(/<script[^>]+src=/g) || [];
external.length === 0 ? ok('无外链 script（离线自包含）') : fail('发现外链 script: ' + external.join(', '));

// 2. 内联 JS 语法
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length === 0) {
  fail('未找到内联 <script>');
} else {
  const tmp = path.join(os.tmpdir(), 'daily-review-check-' + Date.now() + '.js');
  fs.writeFileSync(tmp, scripts.join('\n'));
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok(`内联脚本语法通过（${scripts.length} 个块）`);
  } catch (e) {
    fail('内联脚本语法错误:\n' + e.stderr);
  } finally {
    fs.unlinkSync(tmp);
  }
}

// 3. 图表检查：所有空壳 <svg id="X"> 必须在 <script> 内被引用填充（getElementById/renderLineBar 等调用）
//    注：匹配空壳标签本身，不依赖 class 位置（class 在外层 div 上）
const scriptsAll = scripts.join('\n');
const chartIds = [...html.matchAll(/<svg id="([^"]+)"[^>]*>\s*<\/svg>/g)].map(m => m[1]);
if (chartIds.length === 0) {
  fail('未发现任何空壳 SVG 图表（<svg id="..."></svg>）');
} else {
  ok(`发现 ${chartIds.length} 张图表: ${chartIds.join(', ')}`);
  for (const id of chartIds) {
    const referenced = scriptsAll.includes(`getElementById("${id}")`) ||
                       scriptsAll.includes(`getElementById('${id}')`) ||
                       scriptsAll.includes(`"${id}"`) ||
                       scriptsAll.includes(`'${id}'`);
    referenced ? ok(`图表 #${id}：空壳 + JS 填充引用存在`) : fail(`图表 #${id}：空壳存在但 <script> 中无填充引用`);
  }
}

// 4. 表头占位词检查
const badHeaders = ['TODO', 'XXX', '占位', '口径说明'];
for (const w of badHeaders) {
  if (html.includes(w)) fail(`发现疑似占位/错误文本: "${w}"`);
}
if (html.includes('TODO') === false) ok('无占位表头');

// 5. 文件名与报告日期一致性：技术面复盘_YYYYMMDD.html ↔ <title>/统计日期
const dateM = path.basename(file).match(/_(\d{8})\.html$/);
if (!dateM) {
  ok('文件名不含日期后缀，跳过日期一致性检查');
} else {
  const ymd = dateM[1];
  const ymdDash = `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  (title.includes(ymdDash)) ? ok(`<title> 日期与文件名一致（${ymdDash}）`)
                            : fail(`<title> "${title}" 不含文件名日期 ${ymdDash}`);
  (html.includes(`统计日期：${ymdDash}`)) ? ok(`统计日期与文件名一致（${ymdDash}）`)
                            : fail(`正文缺少「统计日期：${ymdDash}」`);
}

console.log(failed === 0 ? '\n全部检查通过 ✓' : `\n${failed} 项检查失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
