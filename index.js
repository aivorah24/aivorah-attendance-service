require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { requireUser } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'aivorah-attendance-service' }));

app.use('/classes', requireUser, require('./routes/classes'));
app.use('/attendance', requireUser, require('./routes/attendance'));

// Current Affairs (daily news digest + weekly quiz for students). Hosted here
// until it has its own Render service; source of truth, schema and content
// pipeline: github.com/aivorah24/aivorah-current-affairs-service.
// Not behind requireUser: the digest is public; per-student routes check the
// Firebase token themselves (current-affairs/middleware/auth.js).
app.use('/current-affairs', require('./current-affairs/routes'));

const PORT = process.env.PORT || 3022;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Aivorah Attendance service on http://localhost:${PORT}`));
}

module.exports = app;
