/*
 * Capa de datos del prototipo. Todo vive en localStorage — no hay backend real.
 * Sirve para que el prototipo "se sienta vivo" entre pantallas (check-ins,
 * destinatarios, historial) sin necesidad de un servidor.
 */

const DB_KEY = "checkinapp_proto_db_v1";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function seedDB() {
  const now = Date.now();
  return {
    account: {
      phoneVerified: true,
      emailVerified: true,
      phone: "+54 9 11 5555-0100",
      email: "dario@example.com",
      biometric: false,
      securityCode: null, // PIN para entrar a configuración crítica (si no hay biometría)
      plan: "free",
      duress: { status: "none" }, // none | step1 | confirmed
    },
    recipients: [
      { id: "r1", name: "Mamá (María)", phone: "+54 9 11 4444-1111", email: "maria@example.com", status: "confirmed" },
      { id: "r2", name: "Juan", phone: "+54 9 11 4444-2222", email: "juan@example.com", status: "confirmed" },
      { id: "r3", name: "Ana", phone: "+54 9 11 4444-3333", email: "ana@example.com", status: "pending" },
    ],
    switches: [
      {
        id: "s1",
        mode: "legado",
        name: "Chequeo semanal",
        intervalMs: 7 * DAY,
        graceMs: 24 * HOUR,
        nextDue: now + 4 * HOUR + 12 * MIN,
        recipients: ["r1", "r2"],
        verifierId: "r1",
        message: "Estoy bien, no se preocupen. Si reciben esto es porque no pude confirmar a tiempo.",
        channels: { email: true, sms: false, call: false },
        location: false,
        off: false,
      },
      {
        id: "s2",
        mode: "sesion",
        name: "Viaje a Bariloche",
        intervalMs: 90 * MIN,
        alarmMs: 90 * 1000,
        nextDue: now + 42 * MIN,
        recipients: ["r2"],
        verifierId: null,
        message: "No confirmé mi check-in a tiempo. Esta es mi última ubicación conocida.",
        channels: { email: true, sms: true, call: false },
        location: true,
        off: false,
      },
    ],
    history: [
      { id: "h1", switchId: "s1", type: "created", ts: now - 6 * DAY, note: "Switch creado" },
      { id: "h2", switchId: "s1", type: "checkin", ts: now - 3 * DAY, note: "Check-in confirmado" },
      { id: "h3", switchId: "s2", type: "created", ts: now - 2 * HOUR, note: "Switch creado" },
      { id: "h4", switchId: null, type: "invite", ts: now - 2 * DAY, note: "Invitación enviada a Ana" },
    ],
  };
}

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const fresh = seedDB();
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const fresh = seedDB();
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function resetDB() {
  const fresh = seedDB();
  saveDB(fresh);
  return fresh;
}

/* ---------- Switches ---------- */
function getSwitches() {
  return loadDB().switches;
}
function getSwitch(id) {
  return loadDB().switches.find((s) => s.id === id) || null;
}
function saveSwitch(sw) {
  const db = loadDB();
  const idx = db.switches.findIndex((s) => s.id === sw.id);
  if (idx >= 0) db.switches[idx] = sw;
  else db.switches.push(sw);
  saveDB(db);
}
function deleteSwitch(id) {
  const db = loadDB();
  db.switches = db.switches.filter((s) => s.id !== id);
  saveDB(db);
}

function switchStatus(sw) {
  if (sw.off) return "off";
  const now = Date.now();
  if (sw.mode === "legado") {
    const graceEnd = sw.nextDue + (sw.graceMs || 24 * HOUR);
    if (now < sw.nextDue) return "active";
    if (now < graceEnd) return "grace";
    return "triggered";
  } else {
    const alarmEnd = sw.nextDue + (sw.alarmMs || 90 * 1000);
    if (now < sw.nextDue) return "active";
    if (now < alarmEnd) return "alarm";
    return "triggered";
  }
}

function doCheckin(id) {
  const sw = getSwitch(id);
  if (!sw) return;
  sw.nextDue = Date.now() + sw.intervalMs;
  saveSwitch(sw);
  addHistory({ switchId: id, type: "checkin", note: "Check-in confirmado" });
}

/* ---------- Recipients ---------- */
function getRecipients() {
  return loadDB().recipients;
}
function getRecipient(id) {
  return loadDB().recipients.find((r) => r.id === id) || null;
}
function saveRecipient(r) {
  const db = loadDB();
  if (!r.id) r.id = "r" + Math.random().toString(36).slice(2, 8);
  const idx = db.recipients.findIndex((x) => x.id === r.id);
  if (idx >= 0) db.recipients[idx] = r;
  else db.recipients.push(r);
  saveDB(db);
  return r;
}
function deleteRecipient(id) {
  const db = loadDB();
  db.recipients = db.recipients.filter((r) => r.id !== id);
  saveDB(db);
}

/* ---------- History ---------- */
function getHistory(switchId) {
  const all = loadDB().history.slice().sort((a, b) => b.ts - a.ts);
  if (!switchId) return all;
  return all.filter((h) => h.switchId === switchId);
}
function addHistory(entry) {
  const db = loadDB();
  db.history.push({
    id: "h" + Math.random().toString(36).slice(2, 8),
    ts: Date.now(),
    switchId: null,
    ...entry,
  });
  saveDB(db);
}

/* ---------- Account ---------- */
function getAccount() {
  return loadDB().account;
}
function saveAccount(acc) {
  const db = loadDB();
  db.account = acc;
  saveDB(db);
}

/* ---------- Formatting helpers ---------- */
function formatDuration(ms) {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / MIN);
  const d = Math.floor(totalMin / (24 * 60));
  const h = Math.floor((totalMin % (24 * 60)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(currentLocale(), { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + formatClock(ts);
}

function recipientNames(sw) {
  const names = sw.recipients.map((id) => getRecipient(id)).filter(Boolean).map((r) => r.name.split(" ")[0]);
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " " + t("common.and") + " " + names[names.length - 1];
}
