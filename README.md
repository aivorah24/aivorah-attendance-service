# Aivorah Attendance Service

Standalone microservice for class **Attendance**: the class teacher marks each
student present / absent / late for a day; parents (and the student) read the
summary and history. Also serves the teacher's class list (`/classes/mine`).

Replaces `/attendance/*` and `/classes/mine` in the monolith (`ai-mentor/server`),
which kept attendance in a JSON file on its own disk (lost on every redeploy)
with no sign-in checks. Data now lives in `attendance_records`
(aivorah-db migration `0009_attendance_records.sql`, unique per student + date).

## Sign-in

Every route except `/health` needs `Authorization: Bearer <Firebase ID token>`.
The user's role, school and class are loaded from `users` by the token's email.

## Routes

| Route | Who |
|---|---|
| `GET /classes/mine` | teacher: classes they are class teacher of (`schools.academic_structure` `classTeacherEmail`); parent: children's classes; student: own class |
| `GET /attendance/class?grade=&section=&date=YYYY-MM-DD` | the class teacher, or a school admin — roster `{date, students:[{id,name,email,photoUrl,status}]}` |
| `POST /attendance/save` `{date, grade, section, records:{studentId: present\|absent\|late}}` | the class teacher, or a school admin; every student must be in that class |
| `GET /attendance/student/:id/summary` | the student, their parent, their class teacher, or a school admin — `{summary:{present,absent,late,total,ratePct}, history:[{date,status}]}` (newest first, last 30) |
| `GET /reports/classes` | teacher — Student Report class selector: `{academicYear, homeClasses:[{grade,section,label}], grades:[{grade, sections:[{section, subjects}]}]}` (sections/subjects taught come from the timetable) |
| `GET /reports/class?grade=&section=` | that class's homeroom teacher or a teacher with a timetable period there — `{isHomeClass, mySubjects, canDownload, canShare, students:[{id,name,admissionNumber}]}` |
| `GET /reports/marks?grade=&section=&subject=` / `PUT /reports/marks` `{grade, section, subject, marks:{studentId: 0-100}}` | only for a subject the teacher teaches in that class (`student_marks`, aivorah-db 0024) |
| `GET /reports/students/:id` | homeroom teacher: full report (all subjects, total, pass at 33, rating); subject teacher: own subject(s) only |
| `POST /reports/students/:id/share` `{attachmentUrl, attachmentName, attachmentSize}` | homeroom teacher only — sends the uploaded report PDF (Cloudinary, via messages-service `/messages/upload`) as a Messages DM to the student and each linked parent |

`ratePct = round((present + late × 0.5) / total × 100)` (same as the monolith),
or `null` when nothing is recorded (the monolith showed 100%).

## Import old data

```
node scripts/import-attendance-json.cjs <attendance.json>          # dry run report
node scripts/import-attendance-json.cjs <attendance.json> --write  # upsert
```

## Run

```
cp .env.example .env   # fill in
npm install
npm run dev            # http://localhost:3022
npm test               # unit + integration
ATTENDANCE_API_TESTS=1 ATTENDANCE_API_ENV=<env file with the Dev Supabase> npx jest tests/api
```

The API tests refuse to run unless `SUPABASE_URL` is the Dev project; they seed
and delete their own school and users.

Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FIREBASE_SERVICE_ACCOUNT_B64`,
`WORLD_AND_YOU_SERVICE_URL`.

## Current Affairs (forwarded)

Current Affairs lives in aivorah-world-and-you-service (source of truth).
Old app versions still call `/current-affairs/*` here; `routes/currentAffairsProxy.js`
forwards those calls to `WORLD_AND_YOU_SERVICE_URL` (default `http://localhost:3010`)
unchanged — method, path, query, body and `Authorization` — with no redirect.
On Render set `WORLD_AND_YOU_SERVICE_URL=https://aivorah-world-and-you-service.onrender.com`.
