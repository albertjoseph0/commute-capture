import express from 'express';
import { config } from './config/env.js';
import healthRouter from './routes/health.js';
import promptsRouter from './routes/v1/prompts.js';
import commutesRouter from './routes/v1/commutes.js';
import uploadsRouter from './routes/v1/uploads.js';
import recordingsRouter from './routes/v1/recordings.js';

const app = express();

app.use(express.json());

app.use(healthRouter);
app.use('/v1/prompts', promptsRouter);
app.use('/v1/commutes', commutesRouter);
app.use('/v1/uploads', uploadsRouter);
app.use('/v1/recordings', recordingsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
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
