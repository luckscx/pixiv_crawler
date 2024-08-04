import {pre_env, clean_env} from "./utils.js"
import {loadAndSave } from "./pixiv.js"

const main = async() => {
    await pre_env()
    const target_url = process.argv[2]
    await loadAndSave(target_url)
    await clean_env()
}

main().then(() =>
    console.log("done")
).catch(err => {
    console.log(err)
})
