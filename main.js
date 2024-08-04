import cheerio from 'cheerio'
import crypto from 'crypto'
import puppeteer from 'puppeteer'
import path from 'path'
import fs from 'node:fs/promises'
import { PromisePool } from '@supercharge/promise-pool'
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

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
    browser = await puppeteer.launch({headless: false, userDataDir:"./browser_data"} );
}

const clean_env = async () => {
    await browser.close();
}

const load_page_puppet = async function(url){
    let start = new Date()
    const page = await browser.newPage();
    await page.goto(url,  { waitUntil:"load", timeout: 0});
    const html = await page.content();
    page.close()
    console.log(`load ${url}  with ${new Date() - start}ms`)
    return html
}

const getTags = ($) => {
    const tags = [];
    $('.kMbYox span.fEUsms a').each((index, element) => {
        let tag = $(element).text()
        tags.push(tag)
    });
    return tags;
}

function getMetaProperties($) {
    const metaProperties = {};
    $('meta').each((index, element) => {
        const property = $(element).attr('property');
        const content = $(element).attr('content');
        if (property && content) {
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

    metaProperties["tags"] = getTags($)
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
        return await fs.readFile(filePath, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            try {
                const html = await load_page_puppet(url);
                await fs.writeFile(filePath, html);
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
    let word_count = 0
    const texts = $(`p.${line_class} span`).map
    ((index, element) => {
        const line = $(element).text()
        word_count += line.length
        return line
    }
    ).get();
    const head_text = `章节: ${metas["title"]}`
    texts.unshift(head_text)
    return {"count": word_count, "lines" : texts}
}



const pixiv_base_host = "https://www.pixiv.net"

const parse_series = (html_data) => {
    const link_class = ".jMTyeP.ZgTBh"
    const $ = cheerio.load(html_data)
    const metas = getMetaProperties($)
    const pages = []
    $(`a${link_class}`).map((index, element) => {
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
    } else {
        console.log(`获取 《${metas["full_title"]}》 总 ${pages.length} 章节`)
        console.log(`标签: ${metas["tags"].join(",")}` )
    }
    metas["pages"] = pages
    metas["word_count"] = 0
    return metas
}

const mergePages = (book_obj) => {
    let lines = []
    const pages = book_obj["pages"]
    lines.push(`书名：${book_obj["full_title"]}`)
    lines.push(`标签：${book_obj["tags"].join(",")}`)
    lines.push(`简介：${book_obj["desc"] || "无"}`)
    lines.push(`总字数：${book_obj["word_count"]}`)
    for (const page of pages) {
        lines.push(`子章节：${page["title"]} 字数: ${page["count"]}`)
    }
    for (const page of pages) {
        lines.push("====================")
        lines = lines.concat(page["lines"])
    }
    return lines
}

const saveSeriesToText = async (book_obj) => {
    const out_txt_file = path.join(book_dist_dir, `${book_obj["title"]}.txt`)
    const lines =  mergePages(book_obj)
    if (lines.length > 0) {
        await fs.writeFile(out_txt_file, lines.join("\n"))
        console.log(`save to ${out_txt_file} 总行数${lines.length} 总字数 ${book_obj["word_count"]}`)
    } else {
        console.log("no lines")
    }
}

const loadSinglePage = async (page) => {
    if (!page["retry"]) {
        page["retry"] = 0
    }
    let retry = page["retry"]
    const pr = await fetchAndCache(page.url, retry > 0)
    const res = parse_content(pr)
    page["lines"] = res["lines"]
    let count = res["count"]
    page["count"] = count
    if (count === 0 && retry <= 3) {
        console.log(`子章节 《${page["title"]}》 字数空 重试 ${retry + 1}`)
        page["retry"] += 1
        return await loadSinglePage(page)
    } else {
        console.log(`子章节 《${page["title"]}》 总字数:${count}`)
        return count
    }
}

const loadSeries = async (target_url) => {
    const start_time = new Date()
    let r = await fetchAndCache(target_url, false)
    const series_obj = parse_series(r)
    await PromisePool.withConcurrency(3)
        .for(series_obj["pages"])
        .process(async (page) => {
            let word_count = await loadSinglePage(page)
            series_obj["word_count"] += word_count
        })
    const end_time = new Date()
    console.log(`used ${end_time - start_time} ms`)
    return series_obj
}


const main = async() => {
    await pre_env()
    const target_url = process.argv[2]
    if (!target_url) {
        console.log("target_url 不存在")
        return
    }
    const series_obj = await loadSeries(target_url)
    await saveSeriesToText(series_obj)
    await clean_env()
}

main().then(() =>
    console.log("done")
).catch(err => {
    console.log(err)
})
