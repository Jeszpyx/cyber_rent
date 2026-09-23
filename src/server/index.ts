import path from 'node:path';
import express from 'express';

const app = express();
const clientDir = path.join(__dirname, '../client');
const indexHtml = path.join(clientDir, 'index.html');
const startedAt = new Date().toISOString();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, node: process.version, startedAt });
});

app.use(
  '/assets',
  express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }),
);

app.use(express.static(clientDir, { index: false }));

// index.html must never be cached, otherwise Telegram WebView keeps serving an old build
app.get('/{*splat}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexHtml);
});

// Under iisnode PORT is a named pipe, not a number
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
