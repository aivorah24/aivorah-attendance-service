/**
 * Teacher Student Report (Teacher Portal > Resources > Student Report).
 * Every permission is decided here from the signed-in teacher (req.user),
 * never from the request: see services/reportRules.js for who may do what.
 *
 *   GET  /reports/classes                     class selector (Home Class first, then grades/sections taught)
 *   GET  /reports/class?grade=&section=       students + what this teacher may do in that class
 *   GET  /reports/marks?grade=&section=&subject=   current marks for one of the teacher's subjects
 *   PUT  /reports/marks                       upload marks for one of the teacher's subjects
 *   GET  /reports/students/:id                the report (all subjects for the homeroom teacher, own subject(s) otherwise)
 *   POST /reports/students/:id/share          homeroom teacher only: send the report PDF to the student and linked parents
 */
const express = require('express');
const { buildGradesSectionsView } = require('../services/academicStructure');
const rules = require('../services/reportRules');
const store = require('../services/reportStore');

const router = express.Router();
const norm = (v) => String(v || '').trim();

router.use((req, res, next) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can use Student Report' });
  if (!req.user.school_id) return res.status(403).json({ error: 'Your account is not linked to a school' });
  next();
});

// Grades view, this teacher's timetable periods and the school's year, loaded together.
async function context(user) {
  const [grades, slots, school] = await Promise.all([
    buildGradesSectionsView(user.school_id),
    store.teacherSlots(user.school_id, user.id),
    store.schoolInfo(user.school_id),
  ]);
  return { grades, slots, school, academicYear: rules.academicYearFor(school.academicYear) };
}

function fail(res, where, err) {
  console.error(`[${where}]`, err.message);
  return res.status(500).json({ error: 'Something went wrong loading Student Report' });
}

router.get('/classes', async (req, res) => {
  try {
    const { grades, slots, academicYear } = await context(req.user);
    return res.json({ academicYear, ...rules.reportClasses(req.user, grades, slots) });
  } catch (err) {
    return fail(res, 'GET /reports/classes', err);
  }
});

router.get('/class', async (req, res) => {
  const grade = norm(req.query.grade);
  const section = norm(req.query.section);
  if (!grade) return res.status(400).json({ error: 'grade is required' });
  try {
    const { grades, slots, academicYear } = await context(req.user);
    const access = rules.classAccess(req.user, grades, slots, grade, section);
    if (!access.allowed) return res.status(403).json({ error: 'You do not teach this class' });
    const students = await store.roster(req.user.school_id, grade, section);
    return res.json({
      grade, section, academicYear,
      isHomeClass: access.isHomeClass, mySubjects: access.mySubjects,
      canDownload: access.canDownload, canShare: access.canShare,
      students: students.map((s) => ({ id: s.id, name: s.name, admissionNumber: s.admission_number || null })),
    });
  } catch (err) {
    return fail(res, 'GET /reports/class', err);
  }
});

router.get('/marks', async (req, res) => {
  const grade = norm(req.query.grade);
  const section = norm(req.query.section);
  const subject = norm(req.query.subject);
  if (!grade || !subject) return res.status(400).json({ error: 'grade and subject are required' });
  try {
    const { grades, slots, academicYear } = await context(req.user);
    const access = rules.classAccess(req.user, grades, slots, grade, section);
    if (!rules.teachesSubject(access, subject)) return res.status(403).json({ error: 'You can only upload marks for a subject you teach in this class' });
    const students = await store.roster(req.user.school_id, grade, section);
    const rows = await store.marksFor(students.map((s) => s.id), academicYear);
    const marks = {};
    for (const r of rows) if (norm(r.subject).toLowerCase() === subject.toLowerCase()) marks[r.student_id] = Number(r.marks);
    return res.json({ grade, section, subject, academicYear, maxMarks: rules.MAX_MARKS, marks });
  } catch (err) {
    return fail(res, 'GET /reports/marks', err);
  }
});

router.put('/marks', async (req, res) => {
  const grade = norm(req.body?.grade);
  const section = norm(req.body?.section);
  const subject = norm(req.body?.subject);
  if (!grade || !subject) return res.status(400).json({ error: 'grade and subject are required' });
  try {
    const { grades, slots, academicYear } = await context(req.user);
    const access = rules.classAccess(req.user, grades, slots, grade, section);
    if (!rules.teachesSubject(access, subject)) return res.status(403).json({ error: 'You can only upload marks for a subject you teach in this class' });
    // Store the subject exactly as the timetable names it, so one subject is one row.
    const canonical = access.mySubjects.find((s) => s.toLowerCase() === subject.toLowerCase());
    const students = await store.roster(req.user.school_id, grade, section);
    const problem = rules.validateMarks(req.body?.marks, students.map((s) => s.id));
    if (problem) return res.status(400).json({ error: problem });
    const now = new Date().toISOString();
    const rows = Object.entries(req.body.marks).map(([studentId, value]) => ({
      school_id: req.user.school_id, student_id: studentId, academic_year: academicYear,
      grade, section, subject: canonical, marks: rules.parseMark(value),
      uploaded_by: req.user.id, updated_at: now,
    }));
    await store.upsertMarks(rows);
    return res.json({ ok: true, saved: rows.length, subject: canonical, academicYear });
  } catch (err) {
    return fail(res, 'PUT /reports/marks', err);
  }
});

// Loads the student and decides this teacher's access through the student's own class.
async function studentWithAccess(req) {
  const student = await store.getStudent(req.params.id);
  if (!student || student.role !== 'student' || student.school_id !== req.user.school_id || student.status === 'archived') {
    return { status: 404, error: 'Student not found' };
  }
  const ctx = await context(req.user);
  const access = rules.classAccess(req.user, ctx.grades, ctx.slots, student.grade, student.section || '');
  if (!access.allowed) return { status: 403, error: 'You do not teach this student' };
  return { student, access, ...ctx };
}

async function reportFor(found) {
  const { student, access, school, academicYear } = found;
  const rows = await store.marksFor([student.id], academicYear);
  // The full report also lists timetable subjects with no marks yet (pendingSubjects).
  const body = access.isHomeClass
    ? rules.buildReport(rows, {
      studentName: student.name,
      classSubjects: await store.classTimetableSubjects(student.school_id, student.grade, student.section || ''),
    })
    : rules.buildReport(rows, { studentName: student.name, onlySubjects: access.mySubjects });
  return {
    school: { name: school.name, logoUrl: school.logoUrl },
    student: { id: student.id, name: student.name, grade: student.grade, section: student.section || '', admissionNumber: student.admission_number || null },
    academicYear,
    generatedAt: new Date().toISOString(),
    canDownload: access.canDownload,
    canShare: access.canShare,
    ...body,
  };
}

router.get('/students/:id', async (req, res) => {
  try {
    const found = await studentWithAccess(req);
    if (found.error) return res.status(found.status).json({ error: found.error });
    return res.json(await reportFor(found));
  } catch (err) {
    return fail(res, 'GET /reports/students/:id', err);
  }
});

router.post('/students/:id/share', async (req, res) => {
  try {
    const found = await studentWithAccess(req);
    if (found.error) return res.status(found.status).json({ error: found.error });
    if (!found.access.canShare) return res.status(403).json({ error: 'Only the class teacher can share the full report' });
    const problem = rules.validateShareAttachment(req.body);
    if (problem) return res.status(400).json({ error: problem });

    const { student } = found;
    const parents = await store.parentsOf(student.id);
    const recipients = [
      ...(student.email ? [{ email: String(student.email).toLowerCase(), name: student.name, role: 'student' }] : []),
      ...parents.map((p) => ({ ...p, role: 'parent' })),
    ];
    if (!recipients.length) return res.status(400).json({ error: 'This student has no email or linked parent to send to' });

    const { attachmentUrl, attachmentName } = req.body;
    const size = Number(req.body.attachmentSize);
    const text = `${student.name}'s report card for ${found.academicYear}`;
    const content = JSON.stringify({
      text,
      attachment: { url: attachmentUrl, name: norm(attachmentName), size: Number.isFinite(size) ? size : null, type: 'pdf' },
    });
    await store.sendReportMessages(recipients.map((r) => ({
      sender_email: String(req.user.email).toLowerCase(),
      sender_name: req.user.name || req.user.email,
      sender_role: 'teacher',
      recipient_email: r.email,
      recipient_name: r.name || r.email,
      content,
      student_id: r.role === 'parent' ? student.id : null,
      student_name: r.role === 'parent' ? student.name : null,
    })));
    return res.json({ ok: true, sentTo: recipients });
  } catch (err) {
    return fail(res, 'POST /reports/students/:id/share', err);
  }
});

module.exports = router;
