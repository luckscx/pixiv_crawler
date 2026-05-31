// pixiv 网站特殊的逻辑函数
import * as cheerio from "cheerio";
import path from "path";
import fs from "node:fs/promises";
import {PromisePool} from "@supercharge/promise-pool";
import {book_dist_dir, fetchAndCache, load_page_puppet_idle, sortByKey} from "./utils.js";
import * as cfg from "./config.js";

const checkUrlType = (in_url) => {
    const seriesUrl = /^https:\/\/www.pixiv.net\/novel\/series\/\d+$/
    if (seriesUrl.test(in_url)) {
        console.log(`series novel url ${in_url}`)
        return "series"
    }

    const singleUrl = /^https:\/\/www.pixiv.net\/novel\/show.php\?id=\d+$/
    if (singleUrl.test(in_url)) {
        console.log(`single novel url ${in_url}`)
        return "single"
    }

    const tagUrl = /^https:\/\/www\.pixiv\.net\/(tags\/.+\/novels|search)(\?.*)?$/
    if (tagUrl.test(in_url)) {
        console.log(`novel tag url ${in_url}`)
        return "tag"
    }

    console.log(`target_url ${in_url} 无匹配`)
    return null
}
const getTags = ($) => {
    // 找第一个包含 novel tag 链接的 ul，不依赖混淆类名
    let tags = [];
    $('ul').each((i, ul) => {
        const links = $(ul).find('a[href^="/tags/"][href*="/novels"]');
        if (links.length > 0) {
            links.each((j, a) => {
                const tag = $(a).text().trim();
                if (tag) tags.push(tag);
            });
            return false; // 找到第一个就停
        }
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

const parse_content = (html_data) => {
    const $ = cheerio.load(html_data)
    const metas = getMetaProperties($)
    let word_count = 0
    const texts = $(`span.text-count`).map
    ((index, element) => {
            const line = $(element).text()
            word_count += line.length
            return line
        }
    ).get();
    const head_text = `#${metas["title"]}\n`
    texts.unshift(head_text)
    metas["word_count"] = word_count
    metas["lines"] = texts
    return metas
}

const parseTagListPage = (tag_obj, html_data) => {
    const $ = cheerio.load(html_data)
    let count = 0
    let star_count = 0
    $('div.col-span-6').each((i, card) => {
        const titleLink = $(card).find('a[href^="/novel/show.php"]')
            .filter((j, a) => $(a).text().trim()).first()
        const title = titleLink.text().trim()
        const href = titleLink.attr('href')
        if (!title || !href) return
        const starText = $(card).find('[class*="sc-66169772-2"]').text().trim()
        const star_num = parseInt(starText.replace(',', '')) || 0
        count += 1
        if (star_num > cfg.tag_list_star_min_limit) {
            tag_obj["novels"].push({
                title,
                url: pixiv_base_host + href,
                star_num,
            })
            star_count += 1
        }
    })
    console.log(`page cnt ${count} star ok ${star_count}`)
    tag_obj["find_cnt"] += count
    tag_obj["star_ok_cnt"] += star_count
}

const tag_page_num = 30

const parseTagFirstPage = (html_data) => {
    const $ = cheerio.load(html_data)
    // 总数：形如 "12,345件" 的文本
    let total_cnt = 0
    $('*').each((i, el) => {
        const t = $(el).clone().children().remove().end().text().trim()
        if (/^\d[\d,]+件$/.test(t)) {
            total_cnt = parseInt(t.replace(/,/g, '').replace('件', ''))
            return false
        }
    })
    const tag_obj = {
        "total_cnt"  : total_cnt,
        "find_cnt"   : 0,
        "star_ok_cnt": 0,
        "novels"     : [],
        "total_page" : Math.ceil(total_cnt / tag_page_num)
    }
    parseTagListPage(tag_obj, html_data)
    return tag_obj
}


const pixiv_base_host = "https://www.pixiv.net"

const parse_series = (html_data) => {
    const $ = cheerio.load(html_data)
    const metas = getMetaProperties($)
    const pages = []
    // 通过 href 选章节链接，文本格式为 "#序号 标题"，不依赖混淆类名
    $('a[href^="/novel/show.php"]').each((index, element) => {
        const raw_title = $(element).text().trim()
        const seg_url = $(element).attr("href")
        if (!raw_title.startsWith('#') || !seg_url) return
        const spaceIdx = raw_title.indexOf(' ')
        const seg_index = spaceIdx > 0 ? parseInt(raw_title.slice(1, spaceIdx)) : index + 1
        const seg_title = spaceIdx > 0 ? raw_title.slice(spaceIdx + 1) : raw_title
        const page_obj = {
            "url"   : pixiv_base_host + seg_url,
            "title" : seg_title,
            "index" : seg_index
        }
        pages.push(page_obj)
    })
    if (pages.length === 0) {
        console.log("未加载到具体分页，检查登录状态")
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
    lines.push(`原始地址：${book_obj["source_url"]}`)
    lines.push(`标签：${book_obj["tags"].join(",")}`)
    lines.push(`简介：${book_obj["desc"] || "无"}`)
    lines.push(`总字数：${book_obj["word_count"]}`)
    for (const page of pages) {
        lines.push(`子章节：${page["title"]} 字数: ${page["word_count"]}`)
    }
    for (const page of pages) {
        lines.push("\n\n====================")
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

const savePageToText = async (page_obj) => {
    const out_txt_file = path.join(book_dist_dir, `${page_obj["title"]}.txt`)
    let lines = []
    lines.push(`标题：${page_obj["full_title"]}`)
    lines.push(`标签：${page_obj["tags"].join(",")}`)
    lines.push(`简介：${page_obj["desc"] || "无"}`)
    lines.push(`总字数：${page_obj["word_count"]}`)
    lines.push("====================")
    lines = lines.concat(page_obj["lines"])
    if (lines.length > 0) {
        await fs.writeFile(out_txt_file, lines.join("\n"))
        console.log(`save to ${out_txt_file} 总行数${lines.length} 总字数 ${page_obj["word_count"]}`)
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
    for (const key in res) {
        page[key] = res[key]
    }
    let count = res["word_count"]
    if (count === 0 && retry <= 3) {
        console.log(`子章节 《${page["title"]}》 字数空 重试 ${retry + 1}`)
        page["retry"] += 1
        return await loadSinglePage(page)
    } else {
        console.log(`子章节 《${page["title"]}》 总字数:${count}`)
        return count
    }
}

const searchTags = async(in_url) => {
    // 用 networkidle2 确保收藏数等懒加载内容渲染完毕
    const first_html = await load_page_puppet_idle(in_url)
    const tag_obj = parseTagFirstPage(first_html)

    // pixiv 不一定渲染总数，改为：只要第一页满 30 条就继续翻页，直到拿够 star_ok 或页面不足 30 条
    const base_url = new URL(in_url)
    let page_num = 2
    while (tag_obj["find_cnt"] % tag_page_num === 0) {
        base_url.searchParams.set('p', page_num)
        const html = await load_page_puppet_idle(base_url.toString())
        const before = tag_obj["find_cnt"]
        parseTagListPage(tag_obj, html)
        if (tag_obj["find_cnt"] === before) break  // 没有新内容，停止
        page_num++
    }

    tag_obj["novels"] = sortByKey(tag_obj["novels"], "star_num", true)
    console.log(`共爬取 ${tag_obj["find_cnt"]} 篇，收藏数 > ${cfg.tag_list_star_min_limit} 的共 ${tag_obj["star_ok_cnt"]} 篇`)
    return tag_obj
}

const loadSeries = async (target_url) => {
    const start_time = new Date()
    let r = await fetchAndCache(target_url, false)
    const series_obj = parse_series(r)
    series_obj["source_url"] = target_url
    await PromisePool.withConcurrency(cfg.load_page_concurrency)
        .for(series_obj["pages"])
        .process(async (page) => {
            let word_count = await loadSinglePage(page)
            series_obj["word_count"] += word_count
        })
    const end_time = new Date()
    console.log(`used ${end_time - start_time} ms`)
    return series_obj
}

const loadAndSave = async (target_url) => {
    const url_type = checkUrlType(target_url)
    if (!url_type) {
        return false
    }
    if (url_type === "series") {
        const series_obj = await loadSeries(target_url)
        await saveSeriesToText(series_obj)
    } else if (url_type === "single") {
        const page_obj = {
            "url" : target_url
        }
        await loadSinglePage(page_obj)
        await savePageToText(page_obj)
    } else if (url_type === "tag") {
        let novel_list = await searchTags(target_url)
        if (novel_list["star_ok_cnt"] > 0) {
            for (let i = 0; i < cfg.tag_top_fetch_num; i++) {
                let novel_obj = novel_list["novels"][i]
                if (novel_obj) {
                    console.log(`开始存储 ${novel_obj["title"]}`)
                    await loadAndSave(novel_obj["url"])
                }
            }
        }
    }
}

export {
    loadAndSave,
    checkUrlType
}