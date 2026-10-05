const express = require('express');
const { buildGradesSectionsView } = require('../services/academicStructure');
const { teacherClasses } = require('../services/rules');
const store = require('../services/attendanceStore');

const router = express.Router();

// GET /classes/mine — teacher: classes they are class teacher of; parent: children's classes; student: own class.
router.get('/mine', async (req, res) => {
  const user = req.user;
  try {
    if (!user.school_id) return res.json({ classes: [] });
    if (user.role === 'teacher') {
      const grades = await buildGradesSectionsView(user.school_id);
      return res.json({ classes: teacherClasses(user, grades) });
    }
    let own = [];
    if (user.role === 'student') own = [user];
    else if (user.role === 'parent') own = await store.childrenOf(user.email);
    const seen = new Set();
    const classes = [];
    for (const c of own) {
      if (!c.grade || c.school_id !== user.school_id) continue;
      const label = `${c.grade} ${c.section || ''}`.trim();
      if (seen.has(label)) continue;
      seen.add(label);
      classes.push({ grade: c.grade, section: c.section || '', label });
    }
    return res.json({ classes });
  } catch (err) {
    console.error('[GET /classes/mine]', err.message);
    return res.status(500).json({ error: 'Failed to load classes' });
  }
});

module.exports = router;
