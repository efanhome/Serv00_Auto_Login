const fs = require('fs');
const puppeteer = require('puppeteer');

// 默认无头运行（CI 不需要 xvfb）；需要看浏览器界面时用 HEADLESS=0
const HEADLESS = process.env.HEADLESS !== '0';

// GitHub Actions 的 ubuntu-24.04 禁用了非特权 user namespace，
// Chrome 的 sandbox 起不来（No usable sandbox!），只能在 CI 里关掉。
// 本地跑保留 sandbox。
const ARGS = process.env.CI
  ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  : [];

function formatToISO(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  // 读取 accounts.json 中的 JSON 字符串
  const accountsJson = fs.readFileSync('accounts.json', 'utf-8');
  const accounts = JSON.parse(accountsJson);
  let failed = false;

  for (const account of accounts) {
    const { username, password, panelnum } = account;

    const browser = await puppeteer.launch({ headless: HEADLESS, args: ARGS });
    const page = await browser.newPage();

    const url = `https://panel${panelnum}.serv00.com/login/?next=/`;

    try {
      await page.goto(url, { waitUntil: 'networkidle2' });

      // 改版后提交按钮不再带 id="submit"，改为登录表单内的 button[type="submit"]
      // （页面上还有一个语言切换表单的提交按钮，必须限定在登录表单内）
      const loginButton = await page.$('#submit, form[data-login-form] button[type="submit"]');
      if (!loginButton) {
        throw new Error('无法找到登录按钮');
      }

      // 输入账号和密码
      await page.type('#id_username', username);
      await page.type('#id_password', password);

      // 提交表单：必须先挂上导航等待，否则点击触发的跳转可能先于 waitForNavigation 完成
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        loginButton.click(),
      ]);

      // 等待登录成功标志（/logout/ 链接）或失败提示（.alert-danger）
      await page.waitForFunction(
        () => !!document.querySelector('a[href*="/logout/"]') || !!document.querySelector('.alert-danger'),
        { timeout: 15000 }
      );

      const isLoggedIn = await page.evaluate(() => !!document.querySelector('a[href*="/logout/"]'));

      if (isLoggedIn) {
        // 获取当前的UTC时间和北京时间
        const nowUtc = formatToISO(new Date());// UTC时间
        const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000)); // 北京时间东8区，用算术来搞
        console.log(`账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）登录成功！`);
      } else {
        failed = true;
        const reason = await page.evaluate(() => {
          const el = document.querySelector('.alert-danger');
          return el ? el.innerText.replace(/\s+/g, ' ').trim() : '未知原因';
        });
        console.error(`账号 ${username} 登录失败：${reason}`);
      }
    } catch (error) {
      failed = true;
      console.error(`账号 ${username} 登录时出现错误: ${error}`);
    } finally {
      // 关闭页面和浏览器
      await page.close();
      await browser.close();

      // 用户之间添加随机延时
      const delay = Math.floor(Math.random() * 8000) + 1000; // 随机延时1秒到8秒之间
      await delayTime(delay);
    }
  }

  console.log('所有账号登录完成！');
  if (failed) process.exit(1); // 让 CI 能感知到登录失败
})();
