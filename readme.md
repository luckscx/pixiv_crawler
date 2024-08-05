# Pixiv Novel Crawler
- Pixiv系列小说下载器，实现将一个系列文件下载到本地txt文件
- 使用现代JS编写，利用promise pool并发，最大化拉取效率
- 注意部分页面需要在浏览器中预先登录账号拉取，游客无法访问

# Usage

```bash
git clone https://github.com/luckscx/pixiv_crawler
cd pixiv_crawler
npm install

# 找到目标小说系列的页面URL 例如 
node main.js https://www.pixiv.net/novel/series/11681494

# 下载整个tag类型下最热门的5(可配置)个作品 
node main.js "https://www.pixiv.net/tags/中文/novels?gs=1" 
```

# Config
见`config.js`文件
```js
const load_page_concurrency = 4  // 访问页面的tab并发数
const tag_list_star_min_limit = 100  //tag拉取时过滤掉小于这个收藏数的作品
const tag_top_fetch_num = 5       //最终拉取star top的作品数量
```

# Deps
- node.js
- puppeteer 
- cheerio
- @supercharge/promise-pool


# ToDo

- 解决class 随机错误问题
- 实现账号密码自动登录
