import { serve } from '@hono/node-server';
import { createChatRouter } from './routes/chat.js';

const port = Number(process.env.PORT || '8787');
const app = createChatRouter();

console.log(`Chat API listening on ${port}`);

serve({
  fetch: app.fetch,
  port,
});
