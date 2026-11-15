// Supabase queries for the teacher Student Report (/reports).
const supabase = require('./supabase');

const norm = (v) => String(v || '').trim();

// School name, academic year and logo (branding_logos kind='school', keyed by
// the school's name — the same lookup profile-service /branding/logos does).
async function schoolInfo(schoolId) {
  const { data: school, error } = await supabase
    .from('schools').select('name, academic_year').eq('id', schoolId).maybeSingle();
  if (error) throw error;
  const name = norm(school?.name);
  let logoUrl = null;
  if (name) {
    const { data: logos } = await supabase.from('branding_logos').select('name, logo_url').eq('kind', 'school');
    logoUrl = (logos || []).find((l) => norm(l.name).toLowerCase() === name.toLowerCase())?.logo_url || null;
  }
  return { name, academicYear: school?.academic_year || null, logoUrl };
}

// Every timetable period this teacher takes in their school: [{ grade, section, subject }].
async function teacherSlots(schoolId, teacherId) {
  const { data: timetables, error } = await supabase
    .from('class_timetables').select('id, grade, section').eq('school_id', schoolId);
  if (error) throw error;
  if (!timetables?.length) return [];
  const byId = new Map(timetables.map((t) => [t.id, t]));
  const { data: slots, error: slotErr } = await supabase
    .from('timetable_slots').select('timetable_id, subject_name')
    .eq('teacher_id', teacherId).in('timetable_id', [...byId.keys()]);
  if (slotErr) throw slotErr;
  return (slots || [])
    .filter((s) => byId.has(s.timetable_id) && norm(s.subject_name))
    .map((s) => ({ grade: byId.get(s.timetable_id).grade, section: byId.get(s.timetable_id).section || '', subject: norm(s.subject_name) }));
}

// Distinct subjects on one class's timetable, whoever teaches them.
async function classTimetableSubjects(schoolId, grade, section) {
  const { data: tt, error } = await supabase
    .from('class_timetables').select('id')
    .eq('school_id', schoolId).eq('grade', grade).eq('section', section).maybeSingle();
  if (error) throw error;
  if (!tt) return [];
  const { data: slots, error: slotErr } = await supabase
    .from('timetable_slots').select('subject_name').eq('timetable_id', tt.id);
  if (slotErr) throw slotErr;
  const seen = new Map();
  for (const s of slots || []) {
    const name = norm(s.subject_name);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}

async function roster(schoolId, grade, section) {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, admission_number')
    .eq('school_id', schoolId).eq('role', 'student').eq('grade', grade).eq('section', section)
    .neq('status', 'archived')
    .order('name');
  if (error) throw error;
  return data || [];
}

async function getStudent(studentId) {
  const { data, error } = await supabase
    .from('users').select('id, name, email, role, school_id, grade, section, admission_number, status')
    .eq('id', studentId).maybeSingle();
  if (error) throw error;
  return data;
}

async function marksFor(studentIds, academicYear) {
  if (!studentIds.length) return [];
  const { data, error } = await supabase
    .from('student_marks').select('student_id, subject, marks')
    .eq('academic_year', academicYear).in('student_id', studentIds);
  if (error) throw error;
  return data || [];
}

async function upsertMarks(rows) {
  const { error } = await supabase.from('student_marks')
    .upsert(rows, { onConflict: 'student_id,academic_year,subject' });
  if (error) throw error;
}

// Linked parents (parent_children, the link School Admin creates).
async function parentsOf(studentId) {
  const { data: links, error } = await supabase
    .from('parent_children').select('parent_email').eq('child_id', studentId);
  if (error) throw error;
  const emails = [...new Set((links || []).map((l) => norm(l.parent_email).toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const { data: users } = await supabase.from('users').select('email, name').in('email', emails);
  const names = new Map((users || []).map((u) => [norm(u.email).toLowerCase(), u.name]));
  return emails.map((email) => ({ email, name: names.get(email) || email }));
}

// One Messages DM per recipient, in the shape aivorah-messages-service's
// POST /messages stores (attachment JSON in content), so it shows in their inbox.
async function sendReportMessages(rows) {
  const { error } = await supabase.from('messages').insert(rows);
  if (error) throw error;
}

module.exports = { schoolInfo, teacherSlots, classTimetableSubjects, roster, getStudent, marksFor, upsertMarks, parentsOf, sendReportMessages };
