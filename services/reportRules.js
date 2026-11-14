/**
 * Pure rules for the teacher Student Report (no I/O).
 *
 * Who may do what, for one grade-section:
 *   - its homeroom (class) teacher: every student, the full report (all
 *     subjects), Download and Share, plus Upload Marks for the subject(s)
 *     they teach in that class.
 *   - a subject teacher (teaches a timetable period there): every student,
 *     Upload Marks and View Report for their own subject(s) only.
 *   - anyone else: nothing.
 * The subjects a teacher teaches in a class come from the school timetable
 * (timetable_slots.teacher_id + subject_name of that grade-section's
 * class_timetables row); the homeroom teacher from academic_structure
 * (`grades` is services/academicStructure.buildGradesSectionsView output).
 *
 * Marks are out of 100; 33 is a pass. The overall rating comes from the
 * percentage across the subjects that have marks.
 */
const MAX_MARKS = 100;
const PASS_MARK = 33;

const RATINGS = [
  { min: 85, label: 'Excellent', remark: (n) => `${n} has demonstrated outstanding understanding and consistent effort across subjects. Keep up the exceptional work.` },
  { min: 70, label: 'Good', remark: (n) => `${n} has shown a sound grasp of most subjects. Continued focus and regular practice will lead to even stronger results.` },
  { min: 50, label: 'Satisfactory', remark: (n) => `${n} meets the expected standard in most areas. Regular revision and practice will help achieve greater progress.` },
  { min: -Infinity, label: 'Needs Improvement', remark: (n) => `${n} requires additional support and consistent practice to reach the expected standard. Close follow-up between school and home is recommended.` },
];

const norm = (v) => String(v || '').trim();
const key = (v) => norm(v).toLowerCase();

// "2026-27" for 1 Apr 2026 – 31 Mar 2027 (Indian school year), used when the
// school has not set an academic year in Workspace Settings.
function academicYearFor(schoolYear, now = new Date()) {
  if (norm(schoolYear)) return norm(schoolYear);
  const y = now.getFullYear();
  const start = now.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function findSection(grades, grade, section) {
  const g = (grades || []).find((x) => norm(x.name) === norm(grade));
  return g ? (g.sections || []).find((s) => norm(s.name) === norm(section)) || null : null;
}

function isHomeTeacher(user, grades, grade, section) {
  if (!user || user.role !== 'teacher' || !user.school_id) return false;
  const s = findSection(grades, grade, section);
  return !!s && !!s.classTeacherEmail && key(s.classTeacherEmail) === key(user.email);
}

// slots: [{ grade, section, subject }] — this teacher's timetable periods.
// Returns the distinct subjects they teach in one grade-section.
function subjectsTaughtIn(slots, grade, section) {
  const seen = new Map();
  for (const s of slots || []) {
    if (norm(s.grade) !== norm(grade) || norm(s.section) !== norm(section)) continue;
    const subject = norm(s.subject);
    if (subject && !seen.has(key(subject))) seen.set(key(subject), subject);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// What this teacher may do in one class.
function classAccess(user, grades, slots, grade, section) {
  if (!user || user.role !== 'teacher' || !user.school_id || !norm(grade)) {
    return { allowed: false, isHomeClass: false, mySubjects: [], canDownload: false, canShare: false };
  }
  const isHomeClass = isHomeTeacher(user, grades, grade, section);
  const mySubjects = subjectsTaughtIn(slots, grade, section);
  return {
    allowed: isHomeClass || mySubjects.length > 0,
    isHomeClass,
    mySubjects,
    canDownload: isHomeClass,
    canShare: isHomeClass,
  };
}

function teachesSubject(access, subject) {
  return !!access && access.mySubjects.some((s) => key(s) === key(subject));
}

// The class selector: "Home Class" entries first, then each grade taught with
// only the sections taught in it. Archived grades/sections are left out.
function reportClasses(user, grades, slots) {
  if (!user || user.role !== 'teacher' || !user.school_id) return { homeClasses: [], grades: [] };
  const archived = (g, s) => {
    const gr = (grades || []).find((x) => norm(x.name) === norm(g));
    if (gr && gr.archived) return true;
    const sec = findSection(grades, g, s);
    return !!(sec && sec.archived);
  };

  const homeClasses = [];
  for (const g of grades || []) {
    for (const s of g.sections || []) {
      if (isHomeTeacher(user, grades, g.name, s.name) && !archived(g.name, s.name)) {
        homeClasses.push({ grade: g.name, section: s.name, label: `${g.name} ${s.name}`.trim() });
      }
    }
  }

  const byGrade = new Map();
  for (const slot of slots || []) {
    const grade = norm(slot.grade);
    const section = norm(slot.section);
    if (!grade || archived(grade, section)) continue;
    if (!byGrade.has(grade)) byGrade.set(grade, new Set());
    byGrade.get(grade).add(section);
  }
  const gradeOrder = (grades || []).map((g) => norm(g.name));
  const taught = [...byGrade.entries()]
    .sort(([a], [b]) => {
      const ia = gradeOrder.indexOf(a), ib = gradeOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== ib) return ia === -1 ? 1 : -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([grade, sections]) => ({
      grade,
      sections: [...sections].sort((a, b) => a.localeCompare(b)).map((section) => ({
        section, subjects: subjectsTaughtIn(slots, grade, section),
      })),
    }));
  return { homeClasses, grades: taught };
}

function parseMark(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0 || n > MAX_MARKS) return NaN;
  return Math.round(n * 100) / 100;
}

// marks: { studentId: number }. Returns an error message or null.
function validateMarks(marks, rosterIds) {
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) return 'marks must be an object of studentId: marks';
  const entries = Object.entries(marks);
  if (!entries.length) return 'Enter marks for at least one student';
  const allowed = new Set(rosterIds);
  for (const [id, value] of entries) {
    if (!allowed.has(id)) return `student ${id} is not in this class`;
    const n = parseMark(value);
    if (n === null || Number.isNaN(n)) return `Marks must be a number from 0 to ${MAX_MARKS}`;
  }
  return null;
}

function ratingFor(percentage, studentName) {
  const r = RATINGS.find((x) => percentage >= x.min);
  return { label: r.label, remark: r.remark(norm(studentName) || 'The student') };
}

/**
 * The report body from a student's marks rows ([{ subject, marks }]).
 * onlySubjects (a subject teacher's view) keeps just those subjects; the full
 * report (onlySubjects null) also lists classSubjects that have no marks yet
 * as `pendingSubjects`, so the homeroom teacher knows before sharing.
 */
function buildReport(rows, { studentName, onlySubjects = null, classSubjects = [] } = {}) {
  const wanted = onlySubjects ? new Set(onlySubjects.map(key)) : null;
  const subjects = (rows || [])
    .filter((r) => norm(r.subject) && (!wanted || wanted.has(key(r.subject))))
    .map((r) => ({ subject: norm(r.subject), marks: Number(r.marks) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const table = subjects.map((r, i) => ({
    sno: i + 1,
    subject: r.subject,
    marks: r.marks,
    maxMarks: MAX_MARKS,
    result: r.marks >= PASS_MARK ? 'Pass' : 'Fail',
  }));
  const obtained = Math.round(table.reduce((sum, r) => sum + r.marks, 0) * 100) / 100;
  const max = table.length * MAX_MARKS;
  const percentage = max ? Math.round((obtained / max) * 1000) / 10 : null;
  const have = new Set(table.map((r) => key(r.subject)));
  const pendingSubjects = onlySubjects
    ? (onlySubjects || []).filter((s) => !have.has(key(s)))
    : [...new Map((classSubjects || []).filter((s) => norm(s) && !have.has(key(s))).map((s) => [key(s), norm(s)])).values()];

  return {
    full: !onlySubjects,
    rows: table,
    total: { obtained, max },
    percentage,
    // The overall rating is only for the full report: one subject alone is not an overall result.
    rating: !onlySubjects && percentage !== null ? ratingFor(percentage, studentName) : null,
    pendingSubjects,
    passMark: PASS_MARK,
    maxMarks: MAX_MARKS,
  };
}

const ALLOWED_ATTACHMENT_HOST = /^res\.cloudinary\.com$/i;

// Share only attaches a PDF uploaded through messages-service /messages/upload (Cloudinary).
function validateShareAttachment(body) {
  const { attachmentUrl, attachmentName } = body || {};
  let url;
  try { url = new URL(String(attachmentUrl || '')); } catch { return 'attachmentUrl must be the uploaded report PDF'; }
  if (url.protocol !== 'https:' || !ALLOWED_ATTACHMENT_HOST.test(url.hostname)) return 'attachmentUrl must be the uploaded report PDF';
  if (!/\.pdf$/i.test(norm(attachmentName))) return 'attachmentName must be a .pdf file name';
  return null;
}

module.exports = {
  MAX_MARKS, PASS_MARK, RATINGS,
  academicYearFor, isHomeTeacher, subjectsTaughtIn, classAccess, teachesSubject, reportClasses,
  parseMark, validateMarks, ratingFor, buildReport, validateShareAttachment,
};
