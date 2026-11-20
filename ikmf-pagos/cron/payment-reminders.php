<?php
/*
 * IKMF Pagos — recordatorio semanal por falta de pago.
 *
 * Manda un email a cada instructor / director activo que debe meses
 * (misma regla que "Alertas de falta de pago" del Dashboard). Un mes deja
 * de contar apenas se envía su comprobante (aunque todavía no esté
 * aprobado), así que el recordatorio se corta solo cuando la persona sube
 * el comprobante.
 *
 * Se ejecuta por línea de comandos (cron de cPanel), nunca desde la web:
 *
 *   php payment-reminders.php --dry-run            lista a quién le llegaría, sin enviar
 *   php payment-reminders.php --test-to=a@b.com    envía UN ejemplo solo a esa dirección
 *   php payment-reminders.php                      envío real (máximo una vez cada 6 días)
 *   php payment-reminders.php --force              envío real aunque no pasaron 6 días
 *
 * Lee la service_role del mismo ikmf-pagos-config.php que usa api/manage-user.php
 * (fuera de public_html). Deja un registro en payment-reminders.log, al lado
 * de este archivo.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$opts = getopt('', ['dry-run', 'test-to:', 'force']);
$dryRun = isset($opts['dry-run']);
$testTo = $opts['test-to'] ?? null;
$force  = isset($opts['force']);

/* ---------- Configuración ---------- */

function load_config() {
    foreach ([dirname(__DIR__) . '/ikmf-pagos-config.php', __DIR__ . '/ikmf-pagos-config.php'] as $f) {
        if (is_file($f)) {
            $cfg = require $f;
            if (!empty($cfg['supabase_url']) && !empty($cfg['service_role_key'])) return $cfg;
        }
    }
    fwrite(STDERR, "Falta ikmf-pagos-config.php con supabase_url / service_role_key\n");
    exit(1);
}

$cfg = load_config();
$site = rtrim($cfg['site_url'] ?? 'https://instructorfee.ikmfpassport.com', '/');
$from = $cfg['reminder_from'] ?? 'IKMF Fees <noreply@ikmfpassport.com>';
$replyTo = $cfg['reminder_reply_to'] ?? null;
$logFile = __DIR__ . '/payment-reminders.log';

function logline($msg) {
    global $logFile;
    $line = '[' . gmdate('Y-m-d H:i:s') . ' UTC] ' . $msg . "\n";
    echo $line;
    @file_put_contents($logFile, $line, FILE_APPEND);
}

/* ---------- Supabase (REST con service_role) ---------- */

function fetch_all($cfg, $path) {
    $out = [];
    for ($from = 0; ; $from += 1000) {
        $ch = curl_init(rtrim($cfg['supabase_url'], '/') . '/rest/v1/' . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_HTTPHEADER => [
                'apikey: ' . $cfg['service_role_key'],
                'Authorization: Bearer ' . $cfg['service_role_key'],
                'Range-Unit: items',
                'Range: ' . $from . '-' . ($from + 999),
            ],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $rows = json_decode((string) $body, true);
        if ($code >= 300 || !is_array($rows)) {
            fwrite(STDERR, "Error leyendo $path (HTTP $code)\n");
            exit(1);
        }
        $out = array_merge($out, $rows);
        if (count($rows) < 1000) return $out;
    }
}

/* ---------- Fechas (misma lógica que js/common.js) ---------- */

function add_months($period, $n) {
    $d = new DateTimeImmutable($period);
    return $d->modify('first day of this month')->modify(($n >= 0 ? '+' : '') . $n . ' month')->format('Y-m-01');
}
function current_period() { return gmdate('Y-m-01'); }
function today_iso() { return gmdate('Y-m-d'); }

// Un pago vale hasta el mismo día del mes siguiente (30/10 → 30/11).
function coverage_until($iso) {
    [$y, $m, $d] = array_map('intval', explode('-', $iso));
    $ny = $m === 12 ? $y + 1 : $y;
    $nm = $m === 12 ? 1 : $m + 1;
    $last = (int) (new DateTimeImmutable(sprintf('%04d-%02d-01', $ny, $nm)))->format('t');
    return sprintf('%04d-%02d-%02d', $ny, $nm, min($d, $last));
}
function reference_date($period) {
    $now = current_period();
    if ($period === $now) return today_iso();
    if ($period < $now) return (new DateTimeImmutable(add_months($period, 1)))->modify('-1 day')->format('Y-m-d');
    return $period;
}

/* ---------- Datos ---------- */

$countries = [];
foreach (fetch_all($cfg, 'countries?select=id,name,code,currency,default_fee,first_month') as $c) $countries[$c['id']] = $c;
$profiles = fetch_all($cfg, 'profiles?select=id,email,full_name,role,active,country_id,monthly_fee,start_month,end_month');
$payments = fetch_all($cfg, 'payments?select=instructor_id,period,status,paid_on');

$byPerson = [];      // id => [period => payment]
$approvedOn = [];    // id => [paid_on...]
$lastPaid = [];      // id => último período con pago no rechazado
foreach ($payments as $p) {
    $id = $p['instructor_id'];
    $byPerson[$id][$p['period']] = $p;
    if ($p['status'] !== 'rejected' && (!isset($lastPaid[$id]) || $p['period'] > $lastPaid[$id])) $lastPaid[$id] = $p['period'];
    if ($p['status'] === 'approved' && $p['paid_on']) $approvedOn[$id][] = $p['paid_on'];
}

function covered_on($id, $iso) {
    global $approvedOn;
    foreach ($approvedOn[$id] ?? [] as $d) if ($d <= $iso && $iso <= coverage_until($d)) return true;
    return false;
}

function due_months($p) {
    global $countries, $byPerson, $lastPaid;
    if (!$p['active'] || $p['end_month']) return [];   // solo cuentas activas
    $last = add_months(current_period(), -1);
    $c = $countries[$p['country_id']] ?? null;
    $start = $p['start_month'];
    if ($c && $c['first_month'] && $c['first_month'] > $start) $start = $c['first_month'];
    if (isset($lastPaid[$p['id']]) && add_months($lastPaid[$p['id']], 1) > $start) $start = add_months($lastPaid[$p['id']], 1);
    $out = [];
    for ($per = $start; $per <= $last; $per = add_months($per, 1)) {
        $pay = $byPerson[$p['id']][$per] ?? null;
        if ($pay && $pay['status'] !== 'rejected') continue;          // comprobante enviado
        if (covered_on($p['id'], reference_date($per))) continue;    // cubierto por un pago vigente
        $out[] = $per;
    }
    return $out;
}

/* ---------- Textos ---------- */

const LANG_BY_COUNTRY = [
    'he' => ['IL'],
    'de' => ['DE', 'AT', 'CH', 'LI'],
    'fr' => ['FR', 'BE', 'LU', 'MC'],
    'it' => ['IT', 'SM', 'VA'],
    'es' => ['AR', 'UY', 'CL', 'MX', 'ES', 'CO', 'PE', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO', 'CU', 'PR', 'AD'],
];
const MONTHS = [
    'es' => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    'en' => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    'he' => ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
    'fr' => ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    'de' => ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    'it' => ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
];
const TEXT = [
    'es' => [
        'subject' => 'IKMF — Recordatorio: cuota mensual pendiente',
        'body' => "Hola {name}:\n\nSegún nuestros registros, todavía no recibimos el comprobante de {count} cuota(s) mensual(es) de IKMF:\n\n{months}\n\nTotal: {total}\n\nPor favor, cargá el comprobante de pago en:\n{site}\n\nSi ya pagaste, solo subí el comprobante: este recordatorio deja de llegar en cuanto lo recibimos.\n\nGracias,\nIKMF",
    ],
    'en' => [
        'subject' => 'IKMF — Reminder: monthly fee pending',
        'body' => "Hello {name},\n\nAccording to our records, we have not yet received the receipt for {count} IKMF monthly fee(s):\n\n{months}\n\nTotal: {total}\n\nPlease upload your payment receipt at:\n{site}\n\nIf you have already paid, just upload the receipt: this reminder stops as soon as we receive it.\n\nThank you,\nIKMF",
    ],
    'he' => [
        'subject' => 'IKMF — תזכורת: דמי מנוי חודשיים פתוחים',
        'body' => "שלום {name},\n\nלפי הרישומים שלנו, טרם קיבלנו אסמכתא עבור {count} תשלומי דמי מנוי חודשיים של IKMF:\n\n{months}\n\nסה\"כ: {total}\n\nנא להעלות את אסמכתת התשלום בכתובת:\n{site}\n\nאם כבר שילמת, פשוט העלה/י את האסמכתא: התזכורת תיפסק ברגע שנקבל אותה.\n\nתודה,\nIKMF",
    ],
    'fr' => [
        'subject' => 'IKMF — Rappel : cotisation mensuelle en attente',
        'body' => "Bonjour {name},\n\nSelon nos registres, nous n'avons pas encore reçu le justificatif de {count} cotisation(s) mensuelle(s) IKMF :\n\n{months}\n\nTotal : {total}\n\nMerci de déposer votre justificatif de paiement sur :\n{site}\n\nSi vous avez déjà payé, déposez simplement le justificatif : ce rappel s'arrête dès que nous le recevons.\n\nMerci,\nIKMF",
    ],
    'de' => [
        'subject' => 'IKMF — Erinnerung: offener Monatsbeitrag',
        'body' => "Hallo {name},\n\nlaut unseren Unterlagen haben wir für {count} IKMF-Monatsbeitrag/-beiträge noch keinen Beleg erhalten:\n\n{months}\n\nGesamt: {total}\n\nBitte lade deinen Zahlungsbeleg hier hoch:\n{site}\n\nWenn du bereits bezahlt hast, lade einfach den Beleg hoch: Diese Erinnerung endet, sobald wir ihn erhalten.\n\nDanke,\nIKMF",
    ],
    'it' => [
        'subject' => 'IKMF — Promemoria: quota mensile in sospeso',
        'body' => "Ciao {name},\n\nsecondo i nostri registri non abbiamo ancora ricevuto la ricevuta di {count} quota/e mensile/i IKMF:\n\n{months}\n\nTotale: {total}\n\nCarica la ricevuta di pagamento qui:\n{site}\n\nSe hai già pagato, carica solo la ricevuta: questo promemoria si interrompe appena la riceviamo.\n\nGrazie,\nIKMF",
    ],
];

function lang_for($country) {
    $code = $country['code'] ?? '';
    foreach (LANG_BY_COUNTRY as $lang => $codes) if (in_array($code, $codes, true)) return $lang;
    return 'en';
}
function month_label($period, $lang) {
    [$y, $m] = explode('-', $period);
    return MONTHS[$lang][(int) $m - 1] . ' ' . $y;
}
function money($amount, $currency) {
    return ($currency === 'USD' ? 'US$ ' : $currency . ' ') . number_format($amount, 2, '.', ',');
}

function build_mail($p, $due) {
    global $countries, $site;
    $c = $countries[$p['country_id']] ?? null;
    $lang = lang_for($c);
    $fee = $p['monthly_fee'] !== null ? (float) $p['monthly_fee'] : (float) ($c['default_fee'] ?? 0);
    $months = implode("\n", array_map(fn($per) => '  • ' . month_label($per, $lang), $due));
    $name = trim($p['full_name']) !== '' ? trim($p['full_name']) : $p['email'];
    $body = strtr(TEXT[$lang]['body'], [
        '{name}' => $name,
        '{count}' => count($due),
        '{months}' => $months,
        '{total}' => money($fee * count($due), $c['currency'] ?? 'USD'),
        '{site}' => $site . '/',
    ]);
    return [TEXT[$lang]['subject'], $body, $lang];
}

function send_mail($to, $subject, $body) {
    global $from, $replyTo;
    $headers = [
        'From: ' . $from,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'Auto-Submitted: auto-generated',
    ];
    if ($replyTo) $headers[] = 'Reply-To: ' . $replyTo;
    return mail($to, mb_encode_mimeheader($subject, 'UTF-8', 'B'), $body, implode("\r\n", $headers));
}

/* ---------- Envío ---------- */

$targets = [];
foreach ($profiles as $p) {
    if (!in_array($p['role'], ['instructor', 'director'], true)) continue;
    if (!filter_var($p['email'], FILTER_VALIDATE_EMAIL)) continue;
    $due = due_months($p);
    if ($due) $targets[] = [$p, $due];
}

if ($dryRun) {
    foreach ($targets as [$p, $due]) {
        [, , $lang] = build_mail($p, $due);
        echo sprintf("%-40s %-6s %d mes(es): %s\n", $p['email'], $lang, count($due), implode(', ', $due));
    }
    echo count($targets) . " recordatorio(s) se enviarían.\n";
    exit(0);
}

if ($testTo) {
    if (!$targets) { echo "Nadie debe meses: no hay ejemplo para enviar.\n"; exit(0); }
    [$p, $due] = $targets[0];
    [$subject, $body] = build_mail($p, $due);
    $ok = send_mail($testTo, '[PRUEBA] ' . $subject, $body);
    logline(($ok ? 'Prueba enviada' : 'FALLÓ la prueba') . " a $testTo (ejemplo: " . count($due) . ' mes(es))');
    exit($ok ? 0 : 1);
}

// Envío real: como mucho una vez cada 6 días (por si el cron corre de más).
$stamp = __DIR__ . '/payment-reminders.last';
if (!$force && is_file($stamp) && time() - (int) file_get_contents($stamp) < 6 * 86400) {
    logline('Omitido: el último envío fue hace menos de 6 días.');
    exit(0);
}
$sent = 0; $failed = 0;
foreach ($targets as [$p, $due]) {
    [$subject, $body] = build_mail($p, $due);
    if (send_mail($p['email'], $subject, $body)) $sent++; else { $failed++; logline('FALLÓ: ' . $p['email']); }
    usleep(300000); // no saturar el servidor de correo
}
file_put_contents($stamp, (string) time());
logline("Recordatorios enviados: $sent · fallidos: $failed");
