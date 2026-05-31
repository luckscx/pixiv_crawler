import express from 'express';
import path from 'path';
import fs from "node:fs/promises";
import {fileURLToPath, parse} from "url";
import {spawn} from "child_process"
import {checkUrlType} from "./pixiv.js"
import * as cfg from "./config.js";

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

// 生成的 TXT 文件所在目录
const booksDir = path.resolve(__dirname, cfg.output_dir);

// 启动时加载 HTML 模板，渲染时填充占位符，保持路由逻辑简洁
const templatesDir = path.join(__dirname, 'templates');
const indexTemplate = await fs.readFile(path.join(templatesDir, 'index.html'), 'utf-8');
const bookTemplate  = await fs.readFile(path.join(templatesDir, 'book.html'),  'utf-8');
const render = (tpl, vars) => tpl.replace(/{{(\w+)}}/g, (_, key) => vars[key] ?? '');

app.get('/', (_req, res) => res.send(indexTemplate));

// 下载已生成的 TXT 文件
app.get('/download/:name', (req, res) => {
    const fileName = path.basename(req.params.name); // 防止路径穿越
    const filePath = path.join(booksDir, fileName);
    res.download(filePath, fileName, (err) => {
        if (err && !res.headersSent) {
            res.status(404).send('文件不存在');
        }
    });
});

// 格式化文件大小
const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => (
    {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
));

// 列表页：查看 books 目录下的文件（名称、大小、修改时间），按修改时间倒序，支持下载
app.get('/book', async (_req, res) => {
    let files = [];
    try {
        const names = await fs.readdir(booksDir);
        const stats = await Promise.all(names.map(async (name) => {
            try {
                const st = await fs.stat(path.join(booksDir, name));
                return st.isFile() ? {name, size: st.size, mtime: st.mtimeMs} : null;
            } catch {
                return null;
            }
        }));
        files = stats.filter(Boolean).sort((a, b) => b.mtime - a.mtime); // 按修改时间倒序
    } catch (e) {
        console.error(`读取 ${booksDir} 失败: ${e.message}`);
    }

    const rows = files.map(f => `
        <tr>
            <td>${escapeHtml(f.name)}</td>
            <td>${formatSize(f.size)}</td>
            <td>${new Date(f.mtime).toLocaleString()}</td>
            <td><a class="btn btn-sm btn-primary" href="/download/${encodeURIComponent(f.name)}" download>下载</a></td>
        </tr>`).join('');

    res.send(render(bookTemplate, {
        count: files.length,
        rows : rows || '<tr><td colspan="4" class="text-center text-muted">暂无文件</td></tr>',
    }));
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const queryObject = parse(req.url, true).query;
    const targetUrl = queryObject.url;

    if (!targetUrl) {
        res.write('data: bad\n\n');
        res.end();
        return;
    }

    if (!checkUrlType(targetUrl)) {
        res.write('data: 无匹配\n\n');
        res.end();
        return;
    }

    const child = spawn('node', ['main.js', targetUrl]);

    // 收集生成的 TXT 文件名，任务结束后提供下载链接
    const savedFiles = [];

    // 处理外部程序的标准输出
    child.stdout.on('data', (data) => {
        const lines = data.toString('utf8').split('\n');
        lines.forEach(line => {
            if (line) {
                console.log(line)
                // 解析 "save to <path>.txt 总行数..." 日志，提取生成的文件
                const m = line.match(/save to (.+?\.txt)\s/);
                if (m) {
                    savedFiles.push(path.basename(m[1]));
                }
                res.write(`data: ${line}\n\n`); // 发送每一行
            }
        });
    });

    // 处理外部程序的错误输出
    child.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        res.write(`data: ${data}\n\n`); // 发送每一行
    });

    // 处理外部程序结束
    child.on('close', (code) => {
        // 任务成功完成后，逐个推送下载链接
        if (code === 0 && savedFiles.length > 0) {
            savedFiles.forEach(name => {
                const payload = {
                    url : `/download/${encodeURIComponent(name)}`,
                    name,
                };
                res.write(`data: DOWNLOAD:${JSON.stringify(payload)}\n\n`);
            });
        }
        res.write(`data: Process exited with code ${code}\n\n`);
        res.end(); // 结束响应
        console.log(`Child process exited with code ${code}`);
    });

    req.on('close', () => {
        child.kill();
        res.end();
    });
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});