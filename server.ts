import express from 'express';
import { config } from './src/config.ts';
import authRoutes from './src/routes/auth.ts';
import apiRoutes from './src/routes/api.ts';
import { attachIdleShutdown } from './src/services/idleShutdown.ts';

const app = express();

app.use(express.static('public'));

attachIdleShutdown(app, { enabled: process.env.SPORTS_AUTOQUIT === '1' });

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

app.listen(config.port, () => {
  console.log(`Sports Tracker running at http://localhost:${config.port}`);
});
