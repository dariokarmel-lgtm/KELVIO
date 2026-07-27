/*
 * Capa de datos — Supabase real (ver supabase/schema.sql).
 *
 * Patrón: loadAll() trae todo una vez (async) y lo guarda en una caché
 * en memoria; los getters (getSwitches, getSwitch, getRecipient, etc.)
 * son sincrónicos y leen esa caché — así el resto del código (render(),
 * cardFor(), etc.) no tuvo que reescribirse para ser async en cada
 * función. Los "save"/"add"/"delete" sí son async: escriben en Supabase
 * y después actualizan la caché.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const _cache = { account: null, recipients: [], switches: [], history: [] };

function mapProfile(row) {
  const session = CURRENT_SESSION;
  return {
    phone: row?.phone || "",
    phoneVerified: !!row?.phone_verified,
    email: session ? session.user.email : "",
    emailVerified: !!row?.email_verified,
    biometric: !!row?.biometric,
    securityCode: row?.security_code || null,
    plan: row?.plan || "free",
    duress: { status: row?.duress_status || "none", code: row?.duress_code || null },
  };
}

function mapRecipient(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || "",
    email: row.email || "",
    status: row.status,
    inviteToken: row.invite_token,
  };
}

function mapSwitch(row) {
  return {
    id: row.id,
    mode: row.mode,
    name: row.name,
    intervalMs: Number(row.interval_ms),
    graceMs: row.grace_ms != null ? Number(row.grace_ms) : undefined,
    alarmMs: row.alarm_ms != null ? Number(row.alarm_ms) : undefined,
    nextDue: new Date(row.next_due).getTime(),
    recipients: (row.switch_recipients || []).map((x) => x.recipient_id),
    verifierId: row.verifier_id,
    message: row.message,
    channels: row.channels || { email: true, sms: false, call: false },
    location: !!row.location,
    off: !!row.off,
    panicVisible: row.panic_visible !== false,
    reminders: row.reminders || null,
    triggeredAt: row.triggered_at ? new Date(row.triggered_at).getTime() : null,
  };
}

function mapHistory(row) {
  return { id: row.id, switchId: row.switch_id, type: row.type, note: row.note, ts: new Date(row.ts).getTime() };
}

/* ---------- Carga inicial ---------- */
async function loadAll() {
  const uid = getUserId();
  const [accRes, recRes, swRes, histRes] = await Promise.all([
    supabaseClient.from("profiles").select("*").eq("id", uid).single(),
    supabaseClient.from("recipients").select("*").eq("user_id", uid).order("created_at"),
    supabaseClient.from("switches").select("*, switch_recipients(recipient_id)").eq("user_id", uid).order("created_at"),
    supabaseClient.from("history").select("*").eq("user_id", uid).order("ts", { ascending: false }),
  ]);
  _cache.account = mapProfile(accRes.data);
  _cache.recipients = (recRes.data || []).map(mapRecipient);
  _cache.switches = (swRes.data || []).map(mapSwitch);
  _cache.history = (histRes.data || []).map(mapHistory);
}

/* ---------- Switches ---------- */
function getSwitches() {
  return _cache.switches;
}
function getSwitch(id) {
  return _cache.switches.find((s) => s.id === id) || null;
}

async function saveSwitch(sw) {
  const uid = getUserId();
  if (!sw.id) sw.id = crypto.randomUUID();
  const row = {
    id: sw.id,
    user_id: uid,
    mode: sw.mode,
    name: sw.name,
    interval_ms: sw.intervalMs,
    grace_ms: sw.graceMs ?? null,
    alarm_ms: sw.alarmMs ?? null,
    next_due: new Date(sw.nextDue).toISOString(),
    verifier_id: sw.verifierId || null,
    message: sw.message,
    channels: sw.channels,
    location: sw.location,
    off: sw.off,
    panic_visible: sw.panicVisible !== false,
    reminders: sw.reminders || null,
  };
  const { data, error } = await supabaseClient.from("switches").upsert(row).select().single();
  if (error) throw error;

  // Sincroniza destinatarios: borrar y reinsertar es más simple que diffear.
  await supabaseClient.from("switch_recipients").delete().eq("switch_id", data.id);
  if (sw.recipients && sw.recipients.length) {
    await supabaseClient
      .from("switch_recipients")
      .insert(sw.recipients.map((rid) => ({ switch_id: data.id, recipient_id: rid })));
  }

  const mapped = mapSwitch({ ...data, switch_recipients: (sw.recipients || []).map((rid) => ({ recipient_id: rid })) });
  const idx = _cache.switches.findIndex((s) => s.id === mapped.id);
  if (idx >= 0) _cache.switches[idx] = mapped;
  else _cache.switches.push(mapped);
  return mapped;
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

async function doCheckin(id) {
  const sw = getSwitch(id);
  if (!sw) return;
  const newNextDue = Date.now() + sw.intervalMs;
  const { error } = await supabaseClient
    .from("switches")
    .update({ next_due: new Date(newNextDue).toISOString(), triggered_at: null })
    .eq("id", id);
  if (error) throw error;
  sw.nextDue = newNextDue;
  sw.triggeredAt = null;
  await addHistory({ switchId: id, type: "checkin", note: t("history.type_checkin") });
}

/* ---------- Recipients ---------- */
function getRecipients() {
  return _cache.recipients;
}
function getRecipient(id) {
  return _cache.recipients.find((r) => r.id === id) || null;
}

async function saveRecipient(r) {
  const uid = getUserId();
  if (!r.id) r.id = crypto.randomUUID();
  const row = { id: r.id, user_id: uid, name: r.name, phone: r.phone || null, email: r.email || null, status: r.status };
  const { data, error } = await supabaseClient.from("recipients").upsert(row).select().single();
  if (error) throw error;
  const mapped = mapRecipient(data);
  const idx = _cache.recipients.findIndex((x) => x.id === mapped.id);
  if (idx >= 0) _cache.recipients[idx] = mapped;
  else _cache.recipients.push(mapped);
  return mapped;
}

async function deleteRecipient(id) {
  const { error } = await supabaseClient.from("recipients").delete().eq("id", id);
  if (error) throw error;
  _cache.recipients = _cache.recipients.filter((r) => r.id !== id);
}

/* ---------- History ---------- */
function getHistory(switchId) {
  if (!switchId) return _cache.history;
  return _cache.history.filter((h) => h.switchId === switchId);
}

async function addHistory(entry) {
  const uid = getUserId();
  const row = { user_id: uid, switch_id: entry.switchId || null, type: entry.type, note: entry.note };
  const { data, error } = await supabaseClient.from("history").insert(row).select().single();
  if (error) throw error;
  const mapped = mapHistory(data);
  _cache.history.unshift(mapped);
  return mapped;
}

/* ---------- Account ---------- */
function getAccount() {
  return _cache.account;
}

async function saveAccount(acc) {
  const uid = getUserId();
  const row = {
    phone: acc.phone || null,
    phone_verified: acc.phoneVerified,
    email_verified: acc.emailVerified,
    biometric: acc.biometric,
    security_code: acc.securityCode || null,
    duress_status: acc.duress.status,
    duress_code: acc.duress.code || null,
    plan: acc.plan,
  };
  const { error } = await supabaseClient.from("profiles").update(row).eq("id", uid);
  if (error) throw error;
  _cache.account = acc;
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
