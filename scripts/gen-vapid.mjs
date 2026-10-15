// Gera o par de chaves VAPID para notificações push. Rode: npm run vapid
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
console.log("Cole estas linhas nas variáveis de ambiente (Vercel → Settings → Environment Variables) e no .env.local:\n");
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log("VAPID_SUBJECT=mailto:seu-email@exemplo.com");
