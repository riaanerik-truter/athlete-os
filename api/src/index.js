import 'dotenv/config';
import { buildApp } from './app.js';

const required = ['API_KEY', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_PASSWORD'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Athlete OS API listening on http://localhost:${port}/api/v1`);
});
