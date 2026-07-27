/*
 * Netlify Scheduled Function — corre sola cada 5 minutos (ver netlify.toml).
 * Es el corazón del "monitoreo automático": revisa todos los switches de
 * todos los usuarios y dispara la alerta real de los que ya vencieron su
 * período de gracia / alarma y todavía no fueron disparados.
 */

const { adminClient, triggerSwitch } = require("./_lib/send");

exports.handler = async () => {
  const supabase = adminClient();
  const now = Date.now();

  const { data: switches, error } = await supabase
    .from("switches")
    .select("id, mode, next_due, grace_ms, alarm_ms, off, triggered_at")
    .eq("off", false)
    .is("triggered_at", null);

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  const due = (switches || []).filter((sw) => {
    const nextDue = new Date(sw.next_due).getTime();
    const windowMs = sw.mode === "legado" ? (sw.grace_ms || 24 * 60 * 60 * 1000) : (sw.alarm_ms || 90 * 1000);
    return now >= nextDue + windowMs;
  });

  const results = [];
  for (const sw of due) {
    try {
      const r = await triggerSwitch(sw.id, { historyType: "trigger_auto" });
      results.push({ switchId: sw.id, ...r });
    } catch (e) {
      results.push({ switchId: sw.id, ok: false, error: String(e.message || e) });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ checked: (switches || []).length, triggered: results.length, results }) };
};
