import PocketBase from 'pocketbase';

const pocketbase = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
if (process.env.POCKETBASE_ADMIN_TOKEN) {
    pocketbase.authStore.save(process.env.POCKETBASE_ADMIN_TOKEN, null);
}

export default pocketbase; 