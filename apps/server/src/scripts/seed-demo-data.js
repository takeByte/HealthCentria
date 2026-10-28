import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { Announcement } from '../models/announcement.model.js';
import { Appointment } from '../models/appointment.model.js';
import { Service } from '../models/service.model.js';
import { User } from '../models/user.model.js';
import { hashPassword } from '../utils/password.js';
import { addDaysYMD, todayYMD, upcomingValidDates } from '../utils/service-schedule.js';
import { notifyRoles, notifyUser } from '../utils/notifications.js';

// Demo data for the whole center. One run creates:
//   • demo admin / staff / patient accounts (existing emails are reused, never reset)
//   • the v1 service catalog
//   • completed visits (patient "My Records" + staff patient charts)
//   • pending / confirmed appointments (staff queue + admin overview)
//   • announcements (shared by admin, staff and patients)
//   • notifications for patients (announcements, confirmations, reminders) and
//     for staff/admin (new requests)
//
// Re-running is safe: every record has a stable seed key or title, so it
// updates in place instead of duplicating. Nothing is deleted.
//
// Usage: node src/scripts/seed-demo-data.js

const DEMO_PASSWORD = 'Demo1234!';
const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);
const today = todayYMD();

const SERVICES = [
  { name: 'Consultation', description: 'General checkups and medical consultations.', schedule: { mode: 'weekly', weekdays: [1] } },
  { name: 'Prenatal', description: 'Checkups for expecting mothers.', schedule: { mode: 'weekly', weekdays: [2] } },
  {
    name: 'Routine Immunization of Newborn Babies',
    description: 'Scheduled immunization for newborns. Staff manage the dose schedule; booking only reserves the visit day.',
    schedule: { mode: 'nth-weekday', nthWeek: 2, weekday: 3 },
  },
  { name: 'Family Planning', description: 'Counseling and family planning services.', schedule: { mode: 'weekly', weekdays: [4] } },
  { name: 'Postpartum Visit', description: 'Follow-up care after delivery. Staff confirm the date.', schedule: { mode: 'as-needed' } },
  { name: 'Follow-up Visit', description: 'Return visits as advised by staff. Staff confirm the date.', schedule: { mode: 'as-needed' } },
  {
    name: 'Hypertensive Patient Monitoring',
    description: 'Blood pressure checks and monitoring. Staff confirm the date.',
    schedule: { mode: 'as-needed' },
  },
  {
    name: 'Breastfeeding Mothers Support',
    description: 'Guidance and support for breastfeeding mothers. Staff confirm the date.',
    schedule: { mode: 'as-needed' },
  },
];

const DEMO_USERS = [
  {
    email: 'admin@healthcentria.test',
    fullName: 'Dr. Elena Reyes',
    role: 'admin',
  },
  {
    email: 'nurse@healthcentria.test',
    fullName: 'Nurse Joy Santiago',
    role: 'staff',
  },
  {
    email: 'maria.bautista@example.com',
    fullName: 'Maria Bautista',
    role: 'patient',
    profile: {
      birthdate: new Date('1994-03-18T00:00:00.000Z'),
      sex: 'Female',
      address: 'Purok 2, Barangay 11, Malaybalay City',
      householdNumber: 'HH-0112',
      contactNumber: '0917 555 0142',
      philHealthNumber: '12-345678901-2',
      emergencyName: 'Jose Bautista',
      emergencyNumber: '0917 555 0199',
    },
  },
  {
    email: 'juan.dela.cruz@example.com',
    fullName: 'Juan Dela Cruz',
    role: 'patient',
    profile: {
      birthdate: new Date('1988-11-02T00:00:00.000Z'),
      sex: 'Male',
      address: 'Purok 5, Barangay 11, Malaybalay City',
      householdNumber: 'HH-0207',
      contactNumber: '0918 555 0107',
      philHealthNumber: '12-987654321-0',
      emergencyName: 'Ana Dela Cruz',
      emergencyNumber: '0918 555 0110',
    },
  },
  {
    email: '2401101397@student.buksu.edu.ph',
    fullName: 'Red Can',
    role: 'patient',
    profile: {
      birthdate: new Date('2002-06-12T00:00:00.000Z'),
      sex: 'Prefer not to say',
      address: 'Purok 1, Barangay 11, Malaybalay City',
      householdNumber: 'HH-0011',
      contactNumber: '0919 555 0111',
      philHealthNumber: '12-111222333-4',
      emergencyName: 'Rosa Can',
      emergencyNumber: '0919 555 0112',
    },
  },
];

const COMPLETED_VISITS = [
  {
    seedKey: 'demo-visit-maria-consultation',
    patientEmail: 'maria.bautista@example.com',
    serviceName: 'Consultation',
    daysAgo: 32,
    timePreference: 'morning',
    notes: 'Persistent cough and mild fever.',
    diagnosis: 'Acute viral nasopharyngitis (common cold)',
    prescription: 'Paracetamol 500 mg every 6 hours for 3 days as needed; increase fluids and rest.',
    visitNotes:
      'Mild sore throat and low-grade fever since Monday. No shortness of breath. Advised rest and to return if fever persists beyond 3 days.',
  },
  {
    seedKey: 'demo-visit-maria-prenatal',
    patientEmail: 'maria.bautista@example.com',
    serviceName: 'Prenatal',
    daysAgo: 15,
    timePreference: 'afternoon',
    notes: 'Routine prenatal check.',
    diagnosis: 'Normal pregnancy, 24 weeks by last menstrual period',
    prescription: 'Ferrous sulfate + folic acid once daily; calcium supplement as advised.',
    visitNotes:
      'Fundal height appropriate for age of gestation. Fetal heart tone heard. Blood pressure within normal range. Next visit in 4 weeks.',
  },
  {
    seedKey: 'demo-visit-maria-hypertension',
    patientEmail: 'maria.bautista@example.com',
    serviceName: 'Hypertensive Patient Monitoring',
    daysAgo: 5,
    timePreference: 'morning',
    notes: 'Blood pressure monitoring.',
    diagnosis: 'Essential hypertension, controlled',
    prescription: 'Amlodipine 5 mg once daily in the morning; continue low-salt diet.',
    visitNotes: 'BP 120/80. No headache or dizziness. Continue maintenance medicine and log home readings.',
  },
  {
    seedKey: 'demo-visit-juan-consultation',
    patientEmail: 'juan.dela.cruz@example.com',
    serviceName: 'Consultation',
    daysAgo: 21,
    timePreference: 'any',
    notes: 'Stomach ache and loose stools since yesterday.',
    diagnosis: 'Acute gastroenteritis, mild dehydration',
    prescription: 'Oral rehydration solution after each loose stool; zinc supplementation for 10 days.',
    visitNotes: 'No blood in stool. Advised soft diet and to return if vomiting or high fever develops.',
  },
  {
    seedKey: 'demo-visit-red-family-planning',
    patientEmail: '2401101397@student.buksu.edu.ph',
    serviceName: 'Family Planning',
    daysAgo: 12,
    timePreference: 'afternoon',
    notes: 'Family planning counseling.',
    diagnosis: 'Family planning counseling — combined oral contraceptive pill',
    prescription: 'Combined oral contraceptive pill, one tablet daily starting on day 1 of menses.',
    visitNotes: 'Counseled on correct use, side effects and follow-up. No contraindications reported.',
  },
];

const UPCOMING_VISITS = [
  {
    seedKey: 'demo-appt-maria-consultation-pending',
    patientEmail: 'maria.bautista@example.com',
    serviceName: 'Consultation',
    status: 'pending',
    timePreference: 'morning',
    notes: 'Persistent cough for one week — would like a check-up.',
  },
  {
    seedKey: 'demo-appt-maria-prenatal-confirmed',
    patientEmail: 'maria.bautista@example.com',
    serviceName: 'Prenatal',
    status: 'confirmed',
    timePreference: 'afternoon',
    notes: 'Routine prenatal check and blood pressure monitoring.',
  },
  {
    seedKey: 'demo-appt-juan-followup-confirmed',
    patientEmail: 'juan.dela.cruz@example.com',
    serviceName: 'Follow-up Visit',
    status: 'confirmed',
    timePreference: 'any',
    notes: 'Follow-up after gastroenteritis.',
  },
  {
    seedKey: 'demo-appt-red-family-planning-pending',
    patientEmail: '2401101397@student.buksu.edu.ph',
    serviceName: 'Family Planning',
    status: 'pending',
    timePreference: 'afternoon',
    notes: 'Refill and counseling follow-up.',
  },
];

const ANNOUNCEMENTS = [
  {
    title: 'Family Planning service moves to Thursday afternoons',
    body:
      'Starting October 29, Family Planning consultations will be held every Thursday from 1:00 PM to 4:00 PM instead of the morning slot. ' +
      'If you already have a confirmed booking for a Thursday morning, staff will call you to move it. ' +
      'Walk-ins are still welcome any Thursday afternoon while slots last.',
    category: 'schedule-change',
    pinned: true,
    publishedAt: daysAgo(1),
  },
  {
    title: 'Routine immunization for newborns — 2nd Wednesday, November 11',
    body:
      "The next immunization day for newborns is Wednesday, November 11, 8:00 AM to 3:00 PM. " +
      "Please bring your baby's immunization card (or the green booklet from the hospital) and your own pen. " +
      'Mothers who delivered within the last 6 weeks can also have their postpartum check done on the same visit — just tell the nurse at the desk.',
    category: 'vaccination-day',
    pinned: false,
    publishedAt: daysAgo(3),
  },
  {
    title: 'Dengue watch: empty standing water around your home',
    body:
      'With the rainy season here, please check your surroundings once a week for standing water in tires, drums, flower pots and roof gutters. ' +
      'Cover water containers, and see a doctor the same day if anyone in the household has fever with body aches, rash, or bleeding gums. ' +
      'The center can do an initial dengue assessment during consultation hours — no appointment needed for fever cases.',
    category: 'health-advisory',
    pinned: false,
    publishedAt: daysAgo(6),
  },
  {
    title: 'Free blood pressure check every Monday',
    body:
      'Hypertensive patients can have their blood pressure checked for free every Monday, 8:00 AM to 4:00 PM, at the monitoring station beside the front desk. ' +
      'Bring your maintenance medicines so the nurse can record what you are currently taking. ' +
      'No booking needed — but if you also need a consultation, please book ahead so you skip the queue.',
    category: 'general',
    pinned: false,
    publishedAt: daysAgo(9),
  },
  {
    title: 'Holiday schedule: center closed on All Saints’ Day',
    body:
      'The health center will be closed on November 1 for All Saints’ Day. Regular consultation and prenatal services resume on November 2. ' +
      'For urgent concerns, please go to the nearest emergency room or call the barangay health hotline.',
    category: 'schedule-change',
    pinned: false,
    publishedAt: daysAgo(2),
  },
  {
    title: 'Nutrition counseling for mothers and young children',
    body:
      'Free nutrition counseling is available every Friday morning for mothers with children under five. ' +
      'Staff will check weight and height, review feeding practices, and give practical meal suggestions using affordable local ingredients. ' +
      'Walk in between 8:00 AM and 11:00 AM — no appointment needed.',
    category: 'health-advisory',
    pinned: false,
    publishedAt: daysAgo(4),
  },
];

async function seedUsers() {
  const users = {};
  const created = [];
  for (const demo of DEMO_USERS) {
    let user = await User.findOne({ email: demo.email });
    if (!user) {
      user = await User.create({
        email: demo.email,
        fullName: demo.fullName,
        role: demo.role,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        ...(demo.profile ?? {}),
      });
      created.push(demo.email);
    }
    users[demo.email] = user;
  }
  return { users, created };
}

async function seedServices() {
  const services = {};
  for (const item of SERVICES) {
    const doc = await Service.findOneAndUpdate(
      { name: item.name },
      { $set: { description: item.description, schedule: item.schedule, active: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    services[item.name] = doc;
  }
  return services;
}

function nextServiceDay(service, fromDays = 1) {
  const start = addDaysYMD(today, fromDays);
  const dates = upcomingValidDates(service, start, 30);
  return dates[0] ?? addDaysYMD(today, Math.max(fromDays, 2));
}

async function pickUpcomingDay(patient, service, seedKey) {
  const dates = upcomingValidDates(service, addDaysYMD(today, 1), 30);
  for (const day of dates) {
    const existing = await Appointment.findOne({ patient: patient._id, service: service._id, day }).lean();
    if (!existing || existing.seedKey === seedKey) return day;
  }
  return nextServiceDay(service);
}

async function seedAppointments(users, services, adminId) {
  const createdVisits = [];
  for (const visit of COMPLETED_VISITS) {
    const patient = users[visit.patientEmail];
    const service = services[visit.serviceName];
    if (!patient || !service) continue;
    const day = addDaysYMD(today, -visit.daysAgo);
    const appt = await Appointment.findOneAndUpdate(
      { seedKey: visit.seedKey },
      {
        $set: {
          patient: patient._id,
          service: service._id,
          day,
          date: new Date(`${day}T12:00:00.000Z`),
          timePreference: visit.timePreference,
          notes: visit.notes,
          status: 'completed',
          declineReason: '',
          diagnosis: visit.diagnosis,
          prescription: visit.prescription,
          visitNotes: visit.visitNotes,
          createdBy: adminId,
          seedKey: visit.seedKey,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    createdVisits.push(appt);
  }

  const upcoming = [];
  for (const visit of UPCOMING_VISITS) {
    const patient = users[visit.patientEmail];
    const service = services[visit.serviceName];
    if (!patient || !service) continue;
    const day = await pickUpcomingDay(patient, service, visit.seedKey);
    const appt = await Appointment.findOneAndUpdate(
      { seedKey: visit.seedKey },
      {
        $set: {
          patient: patient._id,
          service: service._id,
          day,
          date: new Date(`${day}T12:00:00.000Z`),
          timePreference: visit.timePreference,
          notes: visit.notes,
          status: visit.status,
          declineReason: '',
          diagnosis: '',
          prescription: '',
          visitNotes: '',
          createdBy: adminId,
          seedKey: visit.seedKey,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    upcoming.push({ appt, patient, service });
  }

  return { createdVisits, upcoming };
}

async function seedAnnouncements(adminId) {
  const posts = [];
  for (const post of ANNOUNCEMENTS) {
    const doc = await Announcement.findOneAndUpdate(
      { title: post.title },
      { $set: { ...post, active: true, createdBy: adminId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    posts.push(doc);
  }
  return posts;
}

async function seedNotifications(upcoming, announcements) {
  // Announcements are shared with everyone in the feed; per the product decision
  // only patients receive the bell/email notification for a new post.
  for (const post of announcements) {
    await notifyRoles(['patient'], {
      type: 'new-announcement',
      title: post.title,
      body: 'New announcement from the health center.',
      link: '/app/announcements',
      keyPrefix: `new-announcement:${post._id}`,
    }).catch(() => {});
  }

  for (const { appt, patient, service } of upcoming) {
    if (appt.status === 'pending') {
      await notifyRoles(['staff', 'admin'], {
        type: 'new-request',
        title: `New request: ${service.name} on ${appt.day}`,
        body: `${patient.fullName} requested an appointment that needs review.`,
        link: '/staff/appointments',
        keyPrefix: `demo-new-request:${appt._id}`,
      }).catch(() => {});
    }
    if (appt.status === 'confirmed') {
      await notifyUser(patient._id, {
        type: 'appointment-confirmed',
        title: `Confirmed: ${service.name} on ${appt.day}`,
        body: 'Your appointment is confirmed. Please arrive on time and bring a valid ID.',
        link: '/app/appointments',
        key: `demo-confirmed:${appt._id}`,
      }).catch(() => {});
      await notifyUser(patient._id, {
        type: 'reminder',
        title: `Reminder: ${service.name} on ${appt.day}`,
        body: 'Your visit is coming up. Bring your medicines, records, and a valid ID.',
        link: '/app/appointments',
        key: `demo-reminder:${appt._id}`,
      }).catch(() => {});
    }
  }
}

async function main() {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('<user>')) {
    console.error('MONGODB_URI is missing or still a placeholder — set it in apps/server/.env first.');
    process.exit(2);
  }

  await connectDB(process.env.MONGODB_URI);
  try {
    const { users, created } = await seedUsers();
    const admin = users['admin@healthcentria.test'];
    const services = await seedServices();
    const { createdVisits, upcoming } = await seedAppointments(users, services, admin?._id);
    const announcements = await seedAnnouncements(admin?._id);
    await seedNotifications(upcoming, announcements);

    console.log(`Demo accounts ready${created.length ? ` (created: ${created.join(', ')})` : ' (existing accounts reused)'}.`);
    if (created.length > 0) {
      console.log(`New demo accounts use password: ${DEMO_PASSWORD}`);
    }
    console.log(`Services ready: ${Object.keys(services).length}`);
    console.log(`Completed visit records ready: ${createdVisits.length}`);
    console.log(`Upcoming appointments ready: ${upcoming.length} (${upcoming.filter((u) => u.appt.status === 'pending').length} pending)`);
    console.log(`Announcements ready: ${announcements.length}`);
    console.log('Notifications refreshed for patients, staff and admins.');
    console.log(`Today: ${today}. Re-run this script any time; it updates in place.`);
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error('Seeding demo data failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
