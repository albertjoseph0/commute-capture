import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import healthRouter from './routes/health.js';
import promptsRouter from './routes/v1/prompts.js';
import commutesRouter from './routes/v1/commutes.js';
import uploadsRouter from './routes/v1/uploads.js';
import recordingsRouter from './routes/v1/recordings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();

app.use(express.json());

// Serve static frontend files
app.use(express.static(publicDir));

app.use(healthRouter);
app.use('/v1/prompts', promptsRouter);
app.use('/v1/commutes', commutesRouter);
app.use('/v1/uploads', uploadsRouter);
app.use('/v1/recordings', recordingsRouter);

// SPA fallback: serve index.html for non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/v1/') || req.path.startsWith('/health')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(publicDir, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`CommuteCapture API listening on port ${config.port}`);
});
