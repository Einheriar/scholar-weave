import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome' });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

// 侧栏 → 正文：点 edit_1 卡片
const editCard = p.locator('[data-review-card="review_edit_1"]');
await editCard.scrollIntoViewIfNeeded();
await editCard.click();
await p.waitForTimeout(500);
const selInline = await p.locator('.rev-selected.rev-underline').count();
const cardSelected = await p.locator('[data-review-card="review_edit_1"][aria-current="true"]').count();
console.log('sidebar→editor: .rev-selected underline =', selInline, '| card aria-current =', cardSelected);

// 接受 → 文本被改
await editCard.locator('button:has-text("接受")').click();
await p.waitForTimeout(700);
const txt = await p.locator('[aria-label="文档编辑器"]').innerText();
console.log('accept applied:', txt.includes('may already have been decided'));

// 过期演示：edit_5 锚定的 interpersonal part，编辑该段使其失效
// 先点 edit_5 看它 open
console.log('edit_5 status open?', await p.locator('[data-review-card="review_edit_5"] >> text=待处理').count());

await p.screenshot({ path: '/tmp/stage2.png', fullPage: true });
console.log('pageerrors:', errors.length ? errors : 'none');
await b.close();
