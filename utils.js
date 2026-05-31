// 爬虫公用的基础函数

import {fileURLToPath} from "url";
import path from "path";
import fs from "node:fs/promises";
import puppeteer from "puppeteer-core";
import crypto from "crypto";
import * as cfg from "./config.js";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const cacheDir = path.join(__dirname, 'cache');
const book_dist_dir = cfg.output_dir;

const check_dir_exist = async (dir_path) => {
    try {
        await fs.access(dir_path);
    } catch {
        await fs.mkdir(dir_path);
    }
}

let browser = null

const cookieFile = path.join(__dirname, 'cookies.json');

const pre_env = async () => {
    await check_dir_exist(cacheDir)
    await check_dir_exist(book_dist_dir)

    browser = await puppeteer.launch({
        headless: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
        ]
    });
    console.log('Chrome (headless) 已启动');

    // 读取本地 cookie 文件并注入
    try {
        const raw = await fs.readFile(cookieFile, 'utf-8');
        const rawCookies = JSON.parse(raw);
        // 浏览器插件导出格式转换为 Puppeteer 标准格式
        const cookies = rawCookies.map(c => {
            const cookie = {
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || '/',
                secure: c.secure || false,
                httpOnly: c.httpOnly || false,
            };
            if (c.expirationDate) {
                cookie.expires = Math.floor(c.expirationDate);
            }
            if (c.sameSite && c.sameSite !== 'no_restriction') {
                cookie.sameSite = c.sameSite;
            }
            return cookie;
        });
        const page = await browser.newPage();
        await page.setCookie(...cookies);
        await page.close();
        console.log(`已加载 ${cookies.length} 条 cookie`);
    } catch (e) {
        console.warn(`读取 cookie 文件失败 (${cookieFile}): ${e.message}`);
    }
}

const clean_env = async () => {
    if (browser) {
        await browser.close();
    }
}

const load_page_puppet = async function (url) {
    let start = new Date()
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: "load", timeout: 0,});
    const html = await page.content();
    page.close()
    console.log(`load ${url}  with ${new Date() - start}ms`)
    return html
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

function sortByKey(array, key, reverse = false) {
    if (reverse) {
        return array.sort((a, b) => b[key] - a[key]);
    } else {
        return array.sort((a, b) => a[key] - b[key]);
    }
}

export {
    fetchAndCache, pre_env, clean_env, sortByKey, book_dist_dir,
}