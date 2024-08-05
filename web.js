import express from 'express';
import path from 'path';
import {fileURLToPath, parse} from "url";
import {spawn} from "child_process"
import {checkUrlType} from "./pixiv.js"

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

app.use(express.static(path.join(__dirname, 'assets')));

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

    // 处理外部程序的标准输出
    child.stdout.on('data', (data) => {
        const lines = data.toString('utf8').split('\n');
        lines.forEach(line => {
            if (line) {
                console.log(line)
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