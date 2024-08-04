const { Readable } = require('stream');

async function fn(i) {
    // let ms = Math.floor(Math.random() * 500)
    let ms = 200
    if (i === 1) {
        ms += 5000
    }
    console.log(`${i} create sleep ${ms}`)
    let sleep = new Promise((resolve) => setTimeout(resolve, ms));
    await sleep
    return i
}

// streams

const start = new Date()

let test_arr = []
for (let i = 0; i < 20; i++) {
    test_arr.push(i)
}

const readable = Readable.from(test_arr).map(fn, { concurrency: 4 })



let result = []
readable.on('data', (chunk) => {
    console.log(`finish ${chunk}`);
    result.push(chunk)
});
readable.on("end",
    () => {
        const end = new Date()
        console.log(result)
        console.log(end - start)
    }
)


