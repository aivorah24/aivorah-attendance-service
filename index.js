require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { requireUser } = require('./middleware/auth');

const app = express();
app.use(cors());

// Current Affairs lives in aivorah-world-and-you-service. Old app versions
// still call /current-affairs here: forwarded there unchanged (no redirect).
// Mounted before the JSON parser so the body is forwarded byte for byte.
// Not behind requireUser: the digest is public, and world-and-you checks the
// student's Firebase token itself.
app.use('/current-affairs', require('./routes/currentAffairsProxy').currentAffairsProxy());

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'aivorah-attendance-service' }));

app.use('/classes', requireUser, require('./routes/classes'));
app.use('/attendance', requireUser, require('./routes/attendance'));
app.use('/reports', requireUser, require('./routes/reports'));

const PORT = process.env.PORT || 3022;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Aivorah Attendance service on http://localhost:${PORT}`));
}

module.exports = app;
