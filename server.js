import express from 'express';
import { config } from './src/config.js';
import authRoutes from './src/routes/auth.js';
import apiRoutes from './src/routes/api.js';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

app.listen(config.port, () => {
  console.log(`Sports Tracker running at http://localhost:${config.port}`);
});
