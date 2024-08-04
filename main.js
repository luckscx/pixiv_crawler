const cheerio = require('cheerio')
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('node:fs/promises');

const load_timeout = 30 * 1000

const cacheDir = path.join(__dirname, 'cache');
const book_dist_dir = path.join(__dirname, 'books');

const check_dir_exist = async (dir_path) =>{
    try {
        await fs.access(dir_path);
    } catch {
        await fs.mkdir(dir_path);
    }
}

let browser = null

const pre_env = async () => {
    await check_dir_exist(cacheDir)
    await check_dir_exist(book_dist_dir)
    // const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await puppeteer.launch({headless: false, userDataDir:"./browser_data"} );
}

const clean_env = async () => {
    await browser.close();
}

const load_page_puppet = async function(url){
    const page = await browser.newPage();
    // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36');
    await page.goto(url,  { waitUntil:"load", timeout: 0});
    const html = await page.content();
    page.close()
    return html
}

function getMetaProperties($) {
    const metaProperties = {};
    $('meta').each((index, element) => {
        const property = $(element).attr('property');
        const content = $(element).attr('content');

        if (property && content) {
            console.log(property, content)
            if (property === "og:title")  {
                metaProperties["full_title"] = content
            }
            if (property === "twitter:title")  {
                metaProperties["title"] = content
            }
            if (property === "og:description")  {
                metaProperties["desc"] = content
            }
        }
    });

    return metaProperties;
}

async function fetchAndCache(url, force = false) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const filePath = path.join(cacheDir, `${hash}.html`);

    try {
        if (force) {
            await fs.rm(filePath)
        }
        await fs.access(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        console.log(`从缓存中获取: ${url}  ${filePath}`);
        return content;
    } catch (err) {
        if (err.code === 'ENOENT') {
            try {
                const html = await load_page_puppet(url);
                await fs.writeFile(filePath, html);
                console.log(`将内容缓存: ${url}`);
                return html;
            } catch (error) {
                console.error(`获取 ${url} 时出错: ${error}`);
                return null;
            }
        } else {
            throw err;
        }
    }
}

const parse_content = (html_data) => {
    const line_class = "sc-iemWCZ"
    const $ = cheerio.load(html_data)
    const metas = getMetaProperties($)
    console.log(metas)
    const texts = $(`p.${line_class}`).map
    ((index, element) =>
        $(element).text()).get();
    console.log(texts)
    const head_text = `章节:${metas["title"]}`
    texts.unshift(head_text)
    return texts
}


const pixiv_base_host = "https://www.pixiv.net"

const parse_series = (html_data) => {
    const link_class = ".jMTyeP.ZgTBh"
    const $ = cheerio.load(html_data)
    const metas = getMetaProperties($)
    const pages = []
    $(`a`).map((index, element) => {
        const seg_index = index + 1
        const seg_title = $(element).text()
        const seg_url = $(element).attr("href")
        const page_obj = {
            "url" : pixiv_base_host + seg_url,
            "title" : seg_title,
            "index" : seg_index
        }
        pages.push(page_obj)
    })
    if (pages.length === 0) {
        throw "未加载到具体分页"
    }
    metas["pages"] = pages
    return metas
}

const savePageToTxt = async (page_obj, filename) => {
    const lines = page_obj["lines"]
    if (lines.length > 0) {
        await fs.writeFile(filename, lines.join("\n"))
        console.log(`save to ${filename}`)
    } else {
        console.log("no lines")
    }
}

const megrePages = (book_obj) => {
    let lines = []
    const pages = book_obj["pages"]
    lines.push(`书名：${book_obj["full_title"]}`)
    lines.push(`简介：${book_obj["desc"]}`)
    for (const page of pages) {
        lines.push("====================")
        lines = lines.concat(page["lines"])
    }
    return lines
}

const saveSeriesToText = async (book_obj) => {
    const out_txt_file = path.join(book_dist_dir, `${book_obj["title"]}.txt`)
    const lines = megrePages(book_obj)
    if (lines.length > 0) {
        await fs.writeFile(out_txt_file, lines.join("\n"))
        console.log(`save to ${out_txt_file} total line ${lines.length}`)
    } else {
        console.log("no lines")
    }
}

// const target_url = 'https://www.pixiv.net/novel/show.php?id=22623110'
const target_url = 'https://www.pixiv.net/novel/series/12146141'

const main = async() => {
    await pre_env()
    let r = await fetchAndCache(target_url, true)
    const series_obj = parse_series(r)
    console.log(series_obj)
    for (const page of series_obj["pages"]) {
        const pr = await fetchAndCache(page.url)
        page["lines"] = parse_content(pr)
    }
    await saveSeriesToText(series_obj)

    await clean_env()
}

main().then(() =>
    console.log("done")
).catch(err => {
    console.log(err)
})

