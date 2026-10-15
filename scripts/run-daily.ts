// Roda a rotina diária pelo terminal (usa o mesmo armazenamento do .env.local): npm run daily
import { runDaily } from "../lib/jobs/daily";
import { getStore } from "../lib/store";

getStore()
  .then((store) => runDaily(store, { notify: process.argv.includes("--notify") }))
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => { console.error(e); process.exit(1); });
