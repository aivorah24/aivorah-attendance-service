// Real /reports routes + auth middleware through Supertest; Firebase, the users lookup, the grades view
// and the report store are mocked at the module boundary. Classes follow the T1/T2/T3 example:
// T1 is homeroom of Grade 8 A and teaches Maths there; T2 teaches Science in 8 A;
// T3 is homeroom of Grade 7 B and teaches English in 8 A.

const USERS = {
  t1: { id: 't1', role: 'teacher', school_id: 's1', email: 't1@s1.org', name: 'Ms One' },
  t2: { id: 't2', role: 'teacher', school_id: 's1', email: 't2@s1.org', name: 'Mr Two' },
  t3: { id: 't3', role: 'teacher', school_id: 's1', email: 't3@s1.org', name: 'Ms Three' },
  t4: { id: 't4', role: 'teacher', school_id: 's1', email: 't4@s1.org', name: 'Mr Four' },
  admin: { id: 'a1', role: 'school_admin', school_id: 's1', email: 'admin@s1.org' },
  kid: { id: 'k1', role: 'student', school_id: 's1', email: 'k1@s1.org' },
  noschool: { id: 't9', role: 'teacher', school_id: null, email: 'free@x.org' },
};

jest.mock('../../services/firebaseAdmin', () => ({
  auth: () => ({ verifyIdToken: jest.fn(async (token) => ({ email: `${token}@token` })) }),
}));

jest.mock('../../services/supabase', () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn(function (_c, v) { this._email = v; return this; }),
    maybeSingle: jest.fn(),
  };
  return { from: jest.fn(() => chain), _chain: chain };
});

jest.mock('../../services/academicStructure', () => ({
  buildGradesSectionsView: jest.fn(async () => [
    { name: 'Grade 7', sections: [{ name: 'B', classTeacherEmail: 't3@s1.org' }] },
    { name: 'Grade 8', sections: [{ name: 'A', classTeacherEmail: 't1@s1.org' }, { name: 'B', classTeacherEmail: null }] },
  ]),
}));

jest.mock('../../services/reportStore', () => ({
  schoolInfo: jest.fn(async () => ({ name: 'Sunrise School', academicYear: '2026-27', logoUrl: 'https://res.cloudinary.com/logo.png' })),
  teacherSlots: jest.fn(),
  classTimetableSubjects: jest.fn(async () => ['Maths', 'Science', 'English', 'Hindi']),
  roster: jest.fn(),
  getStudent: jest.fn(),
  marksFor: jest.fn(),
  upsertMarks: jest.fn(async () => {}),
  parentsOf: jest.fn(async () => [{ email: 'mum@x.org', name: 'Mum' }]),
  sendReportMessages: jest.fn(async () => {}),
}));

const request = require('supertest');
const supabase = require('../../services/supabase');
const store = require('../../services/reportStore');
const app = require('../../index');

const as = (key) => ({ Authorization: `Bearer ${key}` });
const SLOTS = {
  t1: [{ grade: 'Grade 8', section: 'A', subject: 'Maths' }],
  t2: [{ grade: 'Grade 8', section: 'A', subject: 'Science' }],
  t3: [{ grade: 'Grade 8', section: 'A', subject: 'English' }],
  t4: [],
};
const ROSTER_8A = [
  { id: 'k1', name: 'Asha', email: 'k1@s1.org', admission_number: 'A-1' },
  { id: 'k2', name: 'Ravi', email: 'k2@s1.org', admission_number: null },
];
const STUDENTS = {
  k1: { id: 'k1', name: 'Asha', email: 'k1@s1.org', role: 'student', school_id: 's1', grade: 'Grade 8', section: 'A', admission_number: 'A-1', status: 'active' },
  k7: { id: 'k7', name: 'Meera', email: 'k7@s1.org', role: 'student', school_id: 's1', grade: 'Grade 7', section: 'B', status: 'active' },
  other: { id: 'other', name: 'X', role: 'student', school_id: 's2', grade: 'Grade 8', section: 'A', status: 'active' },
  archived: { id: 'archived', name: 'Y', role: 'student', school_id: 's1', grade: 'Grade 8', section: 'A', status: 'archived' },
};
const MARKS = [
  { student_id: 'k1', subject: 'Maths', marks: 90 },
  { student_id: 'k1', subject: 'Science', marks: 80 },
  { student_id: 'k1', subject: 'English', marks: 30 },
];
const PDF = { attachmentUrl: 'https://res.cloudinary.com/demo/raw/upload/report.pdf', attachmentName: 'Asha-report.pdf', attachmentSize: 2048 };

beforeEach(() => {
  jest.clearAllMocks();
  supabase._chain.maybeSingle.mockImplementation(async function () {
    return { data: USERS[String(this._email).replace('@token', '')] || null, error: null };
  });
  store.teacherSlots.mockImplementation(async (_s, teacherId) => SLOTS[teacherId] || []);
  store.roster.mockImplementation(async (_s, grade, section) => (grade === 'Grade 8' && section === 'A' ? ROSTER_8A : []));
  store.getStudent.mockImplementation(async (id) => STUDENTS[id] || null);
  store.marksFor.mockImplementation(async (ids) => MARKS.filter((m) => ids.includes(m.student_id)));
});

describe('who can use /reports', () => {
  test('401 without sign-in', async () => expect((await request(app).get('/reports/classes')).status).toBe(401));
  test('403 for non-teachers', async () => expect((await request(app).get('/reports/classes').set(as('admin'))).status).toBe(403));
  test('403 for a teacher with no school', async () => expect((await request(app).get('/reports/classes').set(as('noschool'))).status).toBe(403));
});

describe('GET /reports/classes', () => {
  test('T3: Home Class first, then the grades/sections they teach', async () => {
    const res = await request(app).get('/reports/classes').set(as('t3'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      academicYear: '2026-27',
      homeClasses: [{ grade: 'Grade 7', section: 'B', label: 'Grade 7 B' }],
      grades: [{ grade: 'Grade 8', sections: [{ section: 'A', subjects: ['English'] }] }],
    });
    expect(store.teacherSlots).toHaveBeenCalledWith('s1', 't3');
  });
});

describe('GET /reports/class', () => {
  test('T1 (homeroom): students, Download and Share, Upload for Maths', async () => {
    const res = await request(app).get('/reports/class').query({ grade: 'Grade 8', section: 'A' }).set(as('t1'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isHomeClass: true, mySubjects: ['Maths'], canDownload: true, canShare: true });
    expect(res.body.students).toEqual([{ id: 'k1', name: 'Asha', admissionNumber: 'A-1' }, { id: 'k2', name: 'Ravi', admissionNumber: null }]);
  });
  test('T2 (subject teacher): same students, no Download or Share', async () => {
    const res = await request(app).get('/reports/class').query({ grade: 'Grade 8', section: 'A' }).set(as('t2'));
    expect(res.body).toMatchObject({ isHomeClass: false, mySubjects: ['Science'], canDownload: false, canShare: false });
  });
  test('403 for a class the teacher does not teach', async () => {
    const res = await request(app).get('/reports/class').query({ grade: 'Grade 8', section: 'B' }).set(as('t1'));
    expect(res.status).toBe(403);
    expect(store.roster).not.toHaveBeenCalled();
  });
  test('400 without a grade', async () => expect((await request(app).get('/reports/class').set(as('t1'))).status).toBe(400));
});

describe('marks upload', () => {
  test('GET returns current marks for the teacher’s subject', async () => {
    const res = await request(app).get('/reports/marks').query({ grade: 'Grade 8', section: 'A', subject: 'science' }).set(as('t2'));
    expect(res.status).toBe(200);
    expect(res.body.marks).toEqual({ k1: 80 });
  });
  test('T2 saves Science marks, stored under the timetable’s subject name', async () => {
    const res = await request(app).put('/reports/marks').set(as('t2'))
      .send({ grade: 'Grade 8', section: 'A', subject: 'science', marks: { k1: 81, k2: '45.5' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, saved: 2, subject: 'Science', academicYear: '2026-27' });
    expect(store.upsertMarks).toHaveBeenCalledWith([
      expect.objectContaining({ school_id: 's1', student_id: 'k1', academic_year: '2026-27', grade: 'Grade 8', section: 'A', subject: 'Science', marks: 81, uploaded_by: 't2' }),
      expect.objectContaining({ student_id: 'k2', marks: 45.5 }),
    ]);
  });
  test('the homeroom teacher cannot upload a subject they do not teach', async () => {
    const res = await request(app).put('/reports/marks').set(as('t1'))
      .send({ grade: 'Grade 8', section: 'A', subject: 'Science', marks: { k1: 50 } });
    expect(res.status).toBe(403);
    expect(store.upsertMarks).not.toHaveBeenCalled();
  });
  test('GET is refused for a subject the teacher does not teach', async () => {
    const res = await request(app).get('/reports/marks').query({ grade: 'Grade 8', section: 'A', subject: 'Maths' }).set(as('t2'));
    expect(res.status).toBe(403);
  });
  test('400 for out-of-range marks or a student not in the class', async () => {
    let res = await request(app).put('/reports/marks').set(as('t1')).send({ grade: 'Grade 8', section: 'A', subject: 'Maths', marks: { k1: 120 } });
    expect(res.status).toBe(400);
    res = await request(app).put('/reports/marks').set(as('t1')).send({ grade: 'Grade 8', section: 'A', subject: 'Maths', marks: { k7: 50 } });
    expect(res.status).toBe(400);
    expect(store.upsertMarks).not.toHaveBeenCalled();
  });
});

describe('GET /reports/students/:id', () => {
  test('T1 (homeroom) sees the full report with every subject, total and rating', async () => {
    const res = await request(app).get('/reports/students/k1').set(as('t1'));
    expect(res.status).toBe(200);
    expect(res.body.school).toEqual({ name: 'Sunrise School', logoUrl: 'https://res.cloudinary.com/logo.png' });
    expect(res.body.student).toEqual({ id: 'k1', name: 'Asha', grade: 'Grade 8', section: 'A', admissionNumber: 'A-1' });
    expect(res.body.rows.map((r) => [r.subject, r.marks, r.result])).toEqual([['English', 30, 'Fail'], ['Maths', 90, 'Pass'], ['Science', 80, 'Pass']]);
    expect(res.body.total).toEqual({ obtained: 200, max: 300 });
    expect(res.body.rating.label).toBe('Satisfactory');
    expect(res.body.pendingSubjects).toEqual(['Hindi']);
    expect(res.body).toMatchObject({ full: true, canDownload: true, canShare: true, academicYear: '2026-27' });
    expect(new Date(res.body.generatedAt).toString()).not.toBe('Invalid Date');
  });
  test('T2 (subject teacher) sees only Science, no rating, no Download/Share', async () => {
    const res = await request(app).get('/reports/students/k1').set(as('t2'));
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.subject)).toEqual(['Science']);
    expect(res.body).toMatchObject({ full: false, rating: null, canDownload: false, canShare: false });
  });
  test('T3 has full rights in their home class but only English in 8 A', async () => {
    expect((await request(app).get('/reports/students/k7').set(as('t3'))).body).toMatchObject({ full: true, canShare: true });
    const res = await request(app).get('/reports/students/k1').set(as('t3'));
    expect(res.body.rows.map((r) => r.subject)).toEqual(['English']);
    expect(res.body.canShare).toBe(false);
  });
  test('403 for a teacher who does not teach the student', async () => {
    expect((await request(app).get('/reports/students/k1').set(as('t4'))).status).toBe(403);
  });
  test('404 for an unknown, archived or other-school student', async () => {
    for (const id of ['nope', 'archived', 'other']) {
      expect((await request(app).get(`/reports/students/${id}`).set(as('t1'))).status).toBe(404);
    }
  });
});

describe('POST /reports/students/:id/share', () => {
  test('the homeroom teacher sends the PDF to the student and each linked parent', async () => {
    const res = await request(app).post('/reports/students/k1/share').set(as('t1')).send(PDF);
    expect(res.status).toBe(200);
    expect(res.body.sentTo).toEqual([
      { email: 'k1@s1.org', name: 'Asha', role: 'student' },
      { email: 'mum@x.org', name: 'Mum', role: 'parent' },
    ]);
    const rows = store.sendReportMessages.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sender_email: 't1@s1.org', sender_role: 'teacher', recipient_email: 'k1@s1.org', student_id: null });
    expect(rows[1]).toMatchObject({ recipient_email: 'mum@x.org', student_id: 'k1', student_name: 'Asha' });
    expect(JSON.parse(rows[0].content)).toEqual({
      text: "Asha's report card for 2026-27",
      attachment: { url: PDF.attachmentUrl, name: 'Asha-report.pdf', size: 2048, type: 'pdf' },
    });
  });
  test('a subject teacher cannot share', async () => {
    const res = await request(app).post('/reports/students/k1/share').set(as('t2')).send(PDF);
    expect(res.status).toBe(403);
    expect(store.sendReportMessages).not.toHaveBeenCalled();
  });
  test('400 for a link that is not the uploaded PDF', async () => {
    const res = await request(app).post('/reports/students/k1/share').set(as('t1')).send({ ...PDF, attachmentUrl: 'https://evil.example/x.pdf' });
    expect(res.status).toBe(400);
    expect(store.sendReportMessages).not.toHaveBeenCalled();
  });
});
