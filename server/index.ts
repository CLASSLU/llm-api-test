import { Hono } from 'hono';
import api from './routes';

const app = new Hono();

app.route('/api', api);

export default {
  fetch: app.fetch,
};