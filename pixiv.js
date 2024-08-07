// pixiv 网站特殊的逻辑函数
import * as cheerio from "cheerio";
import path from "path";
import fs from "node:fs/promises";
import {PromisePool} from "@supercharge/promise-pool";
import {book_dist_dir, fetchAndCache, sortByKey} from "./utils.js";
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

    const tagUrl = /^https:\/\/www.pixiv.net\/tags\/.*\/novels\?gs=\d+$/
    if (tagUrl.test(in_url)) {
        console.log(`novel tag url ${in_url}`)
        return "tag"
    }

    console.log(`target_url ${in_url} 无匹配`)
    return null
}
const getTags = ($) => {
    const tags = [];

    // series page
    $('.kMbYox span.fEUsms a').each((index, element) => {
        let tag = $(element).text()
        tags.push(tag)
    });

    // 尝试单页的
    if (tags.length === 0) {
        $('.gZfuPH span.lhUcKZ a').each((index, element) => {
            let tag = $(element).text()
            tags.push(tag)
        });
    }
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
    const head_text = `#${metas["title"]}\n`
    texts.unshift(head_text)
    metas["word_count"] = word_count
    metas["lines"] = texts
    return metas
}

const parseNumStr = (str) => {
    str = str.replace(",", "")
    return parseInt(str)
}

const parseTagListPage = (tag_obj, html_data) => {
    const novel_class = "div.sc-11uoiov-0.hBozqW"
    const $ = cheerio.load(html_data)
    let count = 0
    let star_count = 0
    $(novel_class).map((i, ele) => {
        let title_ele =  $(ele).find("a.sc-d98f2c-0.sc-11uoiov-5.hWHHNe")
        let url = pixiv_base_host + title_ele.attr("href")
        let star_num = $(ele).find("div.sc-eoqmwo-1.grSeZG span.sc-eoqmwo-2.dfUmJJ").text()
        if (star_num) {
            star_num = parseNumStr(star_num)
        } else {
            star_num = 0
        }
        count += 1
        if (star_num > cfg.tag_list_star_min_limit) {
            const novel_obj = {
                "title" : title_ele.text(),
                "url" : url,
                "star_num" : star_num
            }
            tag_obj["novels"].push(novel_obj)
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
    const tag_name_class = "div.cgOIoZ span.bCtdDN"
    const tag_count_class = "div.cgOIoZ span.sc-1pt8s3a-10"
    let name = $(tag_name_class).text()
    let total_cnt = $(tag_count_class).text()
    total_cnt = parseInt(total_cnt.replace(",",""))
    const tag_obj = {
        "total_cnt" : total_cnt,
        "find_cnt" : 0,
        "star_ok_cnt" : 0,
        "name" : name,
        "novels" : [],
        "total_page" : Math.ceil(total_cnt / tag_page_num)
    }
    //顺便parse了第一页
    parseTagListPage(tag_obj, html_data)
    return tag_obj
}


const pixiv_base_host = "https://www.pixiv.net"

const parse_series = (html_data) => {
    const link_class = "a.sc-d98f2c-0.ZgTBh"
    const $ = cheerio.load(html_data)
    const metas = getMetaProperties($)
    const pages = []
    $(link_class).map((index, element) => {
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
    const first_page = await fetchAndCache(in_url)
    const tag_obj = parseTagFirstPage(first_page)
    console.log(tag_obj)
    if (tag_obj["total_cnt"] > tag_page_num) {
        const page_urls = []
        for (let i = 2; i < tag_obj["total_page"]; i++) {
            const page_url = `${pixiv_base_host}/tags/${tag_obj["name"]}/novels?p=${i}&gs=1`
            page_urls.push(page_url)
        }
        await PromisePool.withConcurrency(cfg.load_page_concurrency)
            .for(page_urls)
            .process(async (page_url) => {
                let page_html = await fetchAndCache(page_url)
                parseTagListPage(tag_obj, page_html)
            })

        tag_obj["novels"] = sortByKey(tag_obj["novels"], "star_num", true)
    }
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