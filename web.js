import express from 'express';
import path from 'path';
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

app.use(express.static(path.join(__dirname, 'assets')));

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