const rules = require('../../services/reportRules');

// T1: homeroom of Grade 8 A, teaches Maths there. T2: teaches Science in 8 A.
// T3: homeroom of Grade 7 B, teaches English in 8 A and 8 B.
const GRADES = [
  { name: 'Grade 7', sections: [{ name: 'B', classTeacherEmail: 't3@s.org' }] },
  { name: 'Grade 8', sections: [
    { name: 'A', classTeacherEmail: 'T1@s.org' },
    { name: 'B', classTeacherEmail: null },
    { name: 'Z', classTeacherEmail: 't3@s.org', archived: true },
  ] },
];
const T1 = { id: 't1', role: 'teacher', school_id: 's1', email: 't1@s.org' };
const T2 = { id: 't2', role: 'teacher', school_id: 's1', email: 't2@s.org' };
const T3 = { id: 't3', role: 'teacher', school_id: 's1', email: 't3@s.org' };
const SLOTS = {
  t1: [{ grade: 'Grade 8', section: 'A', subject: 'Maths' }, { grade: 'Grade 8', section: 'A', subject: 'maths ' }],
  t2: [{ grade: 'Grade 8', section: 'A', subject: 'Science' }],
  t3: [
    { grade: 'Grade 8', section: 'B', subject: 'English' },
    { grade: 'Grade 8', section: 'A', subject: 'English' },
    { grade: 'Grade 8', section: 'Z', subject: 'English' },
  ],
};

describe('academicYearFor', () => {
  test("uses the school's own year when set", () => expect(rules.academicYearFor(' 2026-2027 ')).toBe('2026-2027'));
  test('falls back to the April–March year', () => {
    expect(rules.academicYearFor(null, new Date('2026-11-14'))).toBe('2026-27');
    expect(rules.academicYearFor('', new Date('2027-02-01'))).toBe('2026-27');
    expect(rules.academicYearFor(undefined, new Date('2027-04-01'))).toBe('2027-28');
  });
});

describe('classAccess (the T1/T2/T3 example)', () => {
  test('T1, homeroom of 8 A: full report, Download, Share, Upload Marks for Maths only', () => {
    expect(rules.classAccess(T1, GRADES, SLOTS.t1, 'Grade 8', 'A')).toEqual({
      allowed: true, isHomeClass: true, mySubjects: ['Maths'], canDownload: true, canShare: true,
    });
  });
  test('T2, subject teacher in 8 A: own subject only, no Download/Share', () => {
    expect(rules.classAccess(T2, GRADES, SLOTS.t2, 'Grade 8', 'A')).toEqual({
      allowed: true, isHomeClass: false, mySubjects: ['Science'], canDownload: false, canShare: false,
    });
  });
  test('T3: full rights in their own home class, subject rights only in 8 A', () => {
    expect(rules.classAccess(T3, GRADES, SLOTS.t3, 'Grade 7', 'B')).toMatchObject({ allowed: true, isHomeClass: true, canShare: true, mySubjects: [] });
    expect(rules.classAccess(T3, GRADES, SLOTS.t3, 'Grade 8', 'A')).toMatchObject({ allowed: true, isHomeClass: false, canShare: false, mySubjects: ['English'] });
  });
  test('a class the teacher neither leads nor teaches is refused', () => {
    expect(rules.classAccess(T2, GRADES, SLOTS.t2, 'Grade 8', 'B').allowed).toBe(false);
    expect(rules.classAccess(T1, GRADES, SLOTS.t1, 'Grade 7', 'B').allowed).toBe(false);
  });
  test('non-teachers and teachers without a school get nothing', () => {
    expect(rules.classAccess({ ...T1, role: 'school_admin' }, GRADES, SLOTS.t1, 'Grade 8', 'A').allowed).toBe(false);
    expect(rules.classAccess({ ...T1, school_id: null }, GRADES, SLOTS.t1, 'Grade 8', 'A').allowed).toBe(false);
  });
  test('teachesSubject ignores case and spaces', () => {
    const a = rules.classAccess(T1, GRADES, SLOTS.t1, 'Grade 8', 'A');
    expect(rules.teachesSubject(a, ' MATHS')).toBe(true);
    expect(rules.teachesSubject(a, 'Science')).toBe(false);
  });
});

describe('reportClasses', () => {
  test('Home Class first, then grades taught with only the sections taught (archived left out)', () => {
    expect(rules.reportClasses(T3, GRADES, SLOTS.t3)).toEqual({
      homeClasses: [{ grade: 'Grade 7', section: 'B', label: 'Grade 7 B' }],
      grades: [{ grade: 'Grade 8', sections: [
        { section: 'A', subjects: ['English'] },
        { section: 'B', subjects: ['English'] },
      ] }],
    });
  });
  test('a subject-only teacher has no home class', () => {
    expect(rules.reportClasses(T2, GRADES, SLOTS.t2).homeClasses).toEqual([]);
  });
  test('non-teachers get an empty selector', () => {
    expect(rules.reportClasses({ ...T1, role: 'parent' }, GRADES, SLOTS.t1)).toEqual({ homeClasses: [], grades: [] });
  });
});

describe('validateMarks / parseMark', () => {
  test('accepts 0–100 for students in the class', () => {
    expect(rules.validateMarks({ k1: 0, k2: '99.5' }, ['k1', 'k2'])).toBeNull();
    expect(rules.parseMark('72.456')).toBe(72.46);
  });
  test.each([
    [{ k1: 101 }, /0 to 100/],
    [{ k1: -1 }, /0 to 100/],
    [{ k1: 'abc' }, /0 to 100/],
    [{ k1: '' }, /0 to 100/],
    [{ x9: 50 }, /not in this class/],
    [{}, /at least one/],
    [[], /object/],
  ])('rejects %j', (marks, msg) => expect(rules.validateMarks(marks, ['k1'])).toMatch(msg));
});

describe('buildReport', () => {
  const ROWS = [
    { subject: 'Science', marks: '90' },
    { subject: 'Maths', marks: 32 },
    { subject: 'English', marks: 33 },
  ];
  test('full report: every subject, Pass at 33, total, percentage, rating and pending subjects', () => {
    const r = rules.buildReport(ROWS, { studentName: 'Asha', classSubjects: ['Maths', 'Hindi', 'science'] });
    expect(r.rows).toEqual([
      { sno: 1, subject: 'English', marks: 33, maxMarks: 100, result: 'Pass' },
      { sno: 2, subject: 'Maths', marks: 32, maxMarks: 100, result: 'Fail' },
      { sno: 3, subject: 'Science', marks: 90, maxMarks: 100, result: 'Pass' },
    ]);
    expect(r.total).toEqual({ obtained: 155, max: 300 });
    expect(r.percentage).toBe(51.7);
    expect(r.rating.label).toBe('Satisfactory');
    expect(r.rating.remark).toMatch(/^Asha /);
    expect(r.pendingSubjects).toEqual(['Hindi']);
    expect(r.full).toBe(true);
  });
  test("a subject teacher's view keeps only their subject and has no overall rating", () => {
    const r = rules.buildReport(ROWS, { studentName: 'Asha', onlySubjects: ['science', 'Art'] });
    expect(r.rows.map((x) => x.subject)).toEqual(['Science']);
    expect(r.total).toEqual({ obtained: 90, max: 100 });
    expect(r.rating).toBeNull();
    expect(r.pendingSubjects).toEqual(['Art']);
    expect(r.full).toBe(false);
  });
  test('no marks yet: empty table, no percentage or rating', () => {
    const r = rules.buildReport([], { studentName: 'Asha' });
    expect(r.rows).toEqual([]);
    expect(r.percentage).toBeNull();
    expect(r.rating).toBeNull();
  });
});

describe('ratingFor thresholds', () => {
  test.each([
    [100, 'Excellent'], [85, 'Excellent'], [84.9, 'Good'], [70, 'Good'],
    [69.9, 'Satisfactory'], [50, 'Satisfactory'], [49.9, 'Needs Improvement'], [0, 'Needs Improvement'],
  ])('%s%% is %s', (pct, label) => expect(rules.ratingFor(pct, 'Ravi').label).toBe(label));
});

describe('validateShareAttachment', () => {
  test('only an https Cloudinary PDF', () => {
    expect(rules.validateShareAttachment({ attachmentUrl: 'https://res.cloudinary.com/x/raw/upload/a.pdf', attachmentName: 'Report.pdf' })).toBeNull();
    expect(rules.validateShareAttachment({ attachmentUrl: 'http://res.cloudinary.com/x.pdf', attachmentName: 'r.pdf' })).toMatch(/uploaded/);
    expect(rules.validateShareAttachment({ attachmentUrl: 'https://evil.example/x.pdf', attachmentName: 'r.pdf' })).toMatch(/uploaded/);
    expect(rules.validateShareAttachment({ attachmentUrl: 'nope', attachmentName: 'r.pdf' })).toMatch(/uploaded/);
    expect(rules.validateShareAttachment({ attachmentUrl: 'https://res.cloudinary.com/x/a.png', attachmentName: 'r.png' })).toMatch(/pdf/);
  });
});
