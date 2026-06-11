import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("Colle ces variables dans backend/.env et frontend/.env :\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:hello@helloletsgo.fr`);
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`);
