<?php
/*
 * POST api/manage-user.php
 * Header: Authorization: Bearer <access_token del usuario>
 * Body JSON: { action, userId?, data? }
 *
 *   create      → alta de usuario. Con data.password se crea con esa
 *                 contraseña; sin password se le manda invitación por email.
 *   update      → edita nombre, email, teléfono, cuota, mes de inicio
 *                 (y rol / país si quien llama es admin).
 *   deactivate  → baja: deja de cobrarse después de data.end_month y no
 *                 puede volver a ingresar. El historial de pagos se conserva.
 *   reactivate  → deshace la baja (o activa a quien se registró solo).
 *   resend      → reenvía el acceso: si nunca aceptó la invitación se la
 *                 reenvía; si ya tenía cuenta, le manda un link para elegir
 *                 una nueva contraseña.
 *
 * Permisos (la service_role saltea RLS, así que se chequean acá):
 *   admin              → instructores y directores de cualquier país.
 *   director activo    → solo instructores de su propio país.
 *   Nadie gestiona cuentas admin por acá (se hace por SQL).
 *
 * Los secretos NO van en este archivo: se leen de ikmf-pagos-config.php,
 * FUERA de public_html (ver api/config.example.php y el README).
 * Los errores devuelven { error, code }; `code` es la clave err.<code>
 * de js/i18n.js para mostrarlo traducido.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const BAN_FOREVER = '876000h'; // ~100 años

class HttpError extends Exception {
    public $status;
    public $codeKey;
    public function __construct($status, $message, $codeKey = null) {
        parent::__construct($message);
        $this->status = $status;
        $this->codeKey = $codeKey;
    }
}

function respond($status, $body) {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------- Configuración ---------- */

function load_config() {
    $candidates = array_filter([
        getenv('IKMF_CONFIG') ?: null,
        dirname(__DIR__, 3) . '/ikmf-pagos-config.php', // /home/ikmf/ikmf-pagos-config.php
        __DIR__ . '/config.php',                          // respaldo (protegido por .htaccess)
    ]);
    foreach ($candidates as $file) {
        if (is_file($file)) {
            $cfg = require $file;
            if (!empty($cfg['supabase_url']) && !empty($cfg['service_role_key'])) return $cfg;
        }
    }
    throw new HttpError(500, 'Falta el archivo de configuración con supabase_url / service_role_key.', 'missing_env');
}

/* ---------- Cliente HTTP mínimo para Supabase ---------- */

function sb_request($cfg, $method, $path, $body = null, $extraHeaders = [], $token = null) {
    $ch = curl_init(rtrim($cfg['supabase_url'], '/') . $path);
    $headers = array_merge([
        'apikey: ' . $cfg['service_role_key'],
        'Authorization: Bearer ' . ($token ?: $cfg['service_role_key']),
        'Content-Type: application/json',
    ], $extraHeaders);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 20,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new HttpError(502, 'No se pudo conectar con Supabase: ' . $err, 'generic');
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($raw, true);
    return [$status, $data];
}

function auth_error($data) {
    $msg = is_array($data) ? ($data['msg'] ?? $data['message'] ?? $data['error_description'] ?? $data['error'] ?? 'Error') : 'Error';
    if (preg_match('/already (been )?registered|already exists/i', $msg)) {
        return new HttpError(409, 'Ya existe una cuenta con ese email.', 'email_exists');
    }
    if (preg_match('/rate limit/i', $msg)) {
        return new HttpError(429, 'Se alcanzó el límite de emails de Supabase. Probá más tarde o cargá una contraseña inicial.', 'email_rate_limit');
    }
    return new HttpError(400, $msg);
}

function db_get_one($cfg, $table, $query) {
    [$status, $data] = sb_request($cfg, 'GET', "/rest/v1/$table?$query&limit=1");
    if ($status >= 300) throw new HttpError(500, $data['message'] ?? 'Error de base de datos');
    return $data[0] ?? null;
}

function db_update_profile($cfg, $id, $row) {
    [$status, $data] = sb_request($cfg, 'PATCH', '/rest/v1/profiles?id=eq.' . rawurlencode($id), $row, ['Prefer: return=representation']);
    if ($status >= 300) throw new HttpError(500, $data['message'] ?? 'Error de base de datos');
    return $data[0] ?? null;
}

function admin_update_user($cfg, $id, $attrs) {
    [$status, $data] = sb_request($cfg, 'PUT', '/auth/v1/admin/users/' . rawurlencode($id), $attrs);
    if ($status >= 300) throw auth_error($data);
}

/* ---------- Validación de campos ---------- */

function current_period() {
    return gmdate('Y-m') . '-01';
}

function clean_text($v, $max = 200) {
    return mb_substr(trim((string)($v ?? '')), 0, $max);
}

function clean_email($v) {
    $s = mb_strtolower(clean_text($v, 254));
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $s)) throw new HttpError(400, 'Email inválido.', 'invalid_email');
    return $s;
}

function clean_period($v, $label) {
    if (!preg_match('/^\d{4}-\d{2}-01$/', (string)$v)) throw new HttpError(400, "$label: mes inválido.", 'invalid_month');
    return $v;
}

function clean_fee($v) {
    if ($v === null || $v === '') return null;
    if (!is_numeric($v) || $v < 0) throw new HttpError(400, 'La cuota no puede ser negativa.', 'negative_fee');
    return round((float)$v, 2);
}

/* ---------- Permisos ---------- */

function load_caller($cfg, $token) {
    [$status, $user] = sb_request($cfg, 'GET', '/auth/v1/user', null, [], $token);
    if ($status >= 300 || empty($user['id'])) throw new HttpError(401, 'Sesión inválida. Volvé a ingresar.', 'invalid_session');
    $me = db_get_one($cfg, 'profiles', 'id=eq.' . rawurlencode($user['id']));
    if (!$me) throw new HttpError(403, 'Perfil no encontrado.', 'profile_not_found');
    $isAdmin = $me['role'] === 'admin';
    $isDirector = $me['role'] === 'director' && $me['active'] && $me['country_id'];
    if (!$isAdmin && !$isDirector) throw new HttpError(403, 'No tenés permisos para gestionar usuarios.', 'no_permission');
    return ['me' => $me, 'isAdmin' => $isAdmin];
}

function assert_can_manage($caller, $target, $action = '') {
    if (!$target) throw new HttpError(404, 'Usuario no encontrado.', 'not_found');
    if ($target['id'] === $caller['me']['id']) throw new HttpError(403, 'No podés modificar tu propia cuenta desde acá.', 'self');
    // A otro admin solo se le puede reenviar el acceso (y solo lo hace un admin).
    if ($target['role'] === 'admin' && !($caller['isAdmin'] && $action === 'resend')) {
        throw new HttpError(403, 'Las cuentas de administrador se gestionan desde la base de datos.', 'admin_account');
    }
    if ($caller['isAdmin']) return;
    if ($target['role'] !== 'instructor' || $target['country_id'] !== $caller['me']['country_id']) {
        throw new HttpError(403, 'Solo podés gestionar instructores de tu país.', 'only_own_country');
    }
}

function allowed_role($caller, $role) {
    $r = $role ?: 'instructor';
    if ($r === 'instructor') return $r;
    if ($r === 'director' && $caller['isAdmin']) return $r;
    throw new HttpError(403, 'Solo un administrador puede crear o asignar directores.', 'only_admin_director');
}

function resolve_country($cfg, $caller, $countryId) {
    if (!$caller['isAdmin']) return $caller['me']['country_id'];
    if (!$countryId) throw new HttpError(400, 'Elegí el país.', 'choose_country');
    if (!preg_match('/^[0-9a-f-]{36}$/i', $countryId)) throw new HttpError(400, 'País inexistente.', 'country_not_found');
    $c = db_get_one($cfg, 'countries', 'select=id&id=eq.' . rawurlencode($countryId));
    if (!$c) throw new HttpError(400, 'País inexistente.', 'country_not_found');
    return $c['id'];
}

/* ---------- Acciones ---------- */

function create_user($cfg, $caller, $data) {
    $email = clean_email($data['email'] ?? '');
    $full_name = clean_text($data['full_name'] ?? '');
    if ($full_name === '') throw new HttpError(400, 'Completá el nombre.', 'name_required');
    $role = allowed_role($caller, $data['role'] ?? null);
    $country_id = resolve_country($cfg, $caller, $data['country_id'] ?? null);
    $phone = clean_text($data['phone'] ?? '', 40) ?: null;
    $meta = ['full_name' => $full_name, 'phone' => $phone, 'country_id' => $country_id];

    $invited = false;
    if (!empty($data['password'])) {
        if (mb_strlen((string)$data['password']) < 8) {
            throw new HttpError(400, 'La contraseña inicial tiene que tener al menos 8 caracteres.', 'password_short');
        }
        [$status, $created] = sb_request($cfg, 'POST', '/auth/v1/admin/users', [
            'email' => $email,
            'password' => (string)$data['password'],
            'email_confirm' => true,
            'user_metadata' => $meta,
        ]);
        if ($status >= 300) throw auth_error($created);
        $userId = $created['id'] ?? ($created['user']['id'] ?? null);
    } else {
        $redirect = rtrim($cfg['site_url'] ?? '', '/');
        $path = '/auth/v1/invite' . ($redirect ? '?redirect_to=' . rawurlencode($redirect . '/index.html') : '');
        [$status, $created] = sb_request($cfg, 'POST', $path, ['email' => $email, 'data' => $meta]);
        if ($status >= 300) throw auth_error($created);
        $userId = $created['id'] ?? ($created['user']['id'] ?? null);
        $invited = true;
    }
    if (!$userId) throw new HttpError(500, 'Supabase no devolvió el usuario creado.');

    // El trigger ikmf_handle_new_user ya creó el perfil; completamos el resto.
    $profile = db_update_profile($cfg, $userId, [
        'full_name' => $full_name,
        'phone' => $phone,
        'country_id' => $country_id,
        'role' => $role,
        'active' => true,
        'end_month' => null,
        'monthly_fee' => clean_fee($data['monthly_fee'] ?? null),
        'start_month' => !empty($data['start_month']) ? clean_period($data['start_month'], 'Cobrar desde') : current_period(),
    ]);
    return ['user' => $profile, 'invited' => $invited];
}

function update_user($cfg, $caller, $target, $data) {
    $row = [];
    if (array_key_exists('full_name', $data)) {
        $row['full_name'] = clean_text($data['full_name']);
        if ($row['full_name'] === '') throw new HttpError(400, 'El nombre no puede quedar vacío.', 'name_required');
    }
    if (array_key_exists('phone', $data)) $row['phone'] = clean_text($data['phone'], 40) ?: null;
    if (array_key_exists('monthly_fee', $data)) $row['monthly_fee'] = clean_fee($data['monthly_fee']);
    if (array_key_exists('start_month', $data)) $row['start_month'] = clean_period($data['start_month'], 'Cobrar desde');
    if (isset($data['role']) && $data['role'] !== $target['role']) $row['role'] = allowed_role($caller, $data['role']);
    if (isset($data['country_id']) && $data['country_id'] !== $target['country_id']) {
        if (!$caller['isAdmin']) throw new HttpError(403, 'Solo un administrador puede cambiar el país.', 'only_admin_country');
        $row['country_id'] = resolve_country($cfg, $caller, $data['country_id']);
    }
    if (array_key_exists('email', $data)) {
        $email = clean_email($data['email']);
        if ($email !== $target['email']) {
            admin_update_user($cfg, $target['id'], ['email' => $email, 'email_confirm' => true]);
            $row['email'] = $email;
        }
    }
    if (!$row) return ['user' => $target];
    return ['user' => db_update_profile($cfg, $target['id'], $row)];
}

function deactivate_user($cfg, $target, $data) {
    $end = !empty($data['end_month']) ? clean_period($data['end_month'], 'Último mes') : current_period();
    if ($end < $target['start_month']) {
        throw new HttpError(400, 'El último mes no puede ser anterior al mes de inicio.', 'end_before_start');
    }
    admin_update_user($cfg, $target['id'], ['ban_duration' => BAN_FOREVER]);
    return ['user' => db_update_profile($cfg, $target['id'], ['active' => false, 'end_month' => $end])];
}

// Sirve tanto para reactivar una baja como para activar a alguien que se
// registró solo. Al volver de una baja se cobra desde el mes actual, para
// que los meses en que estuvo de baja no figuren como deuda.
function reactivate_user($cfg, $target) {
    admin_update_user($cfg, $target['id'], ['ban_duration' => 'none']);
    $row = ['active' => true, 'end_month' => null];
    if (!empty($target['end_month'])) $row['start_month'] = current_period();
    return ['user' => db_update_profile($cfg, $target['id'], $row)];
}

/*
 * Reenvía el acceso por email y, si quien pide es admin, además devuelve un
 * link de un solo uso para elegir contraseña (para mandarlo por WhatsApp si
 * el email no llega). El link no se le da a directores: les permitiría
 * entrar a la cuenta de un instructor.
 */
function resend_access($cfg, $caller, $target) {
    if (!empty($target['end_month'])) {
        throw new HttpError(400, 'La cuenta está dada de baja. Reactivala antes de reenviar el acceso.', 'user_left');
    }
    [$status, $user] = sb_request($cfg, 'GET', '/auth/v1/admin/users/' . rawurlencode($target['id']));
    if ($status >= 300) throw auth_error($user);
    $redirect = rtrim($cfg['site_url'] ?? '', '/');
    $query = $redirect ? '?redirect_to=' . rawurlencode($redirect . '/index.html') : '';
    $confirmed = !empty($user['email_confirmed_at']) || !empty($user['confirmed_at']);
    $result = ['email' => $target['email']];
    $sent = false;
    if (!$confirmed) {
        [$status, $data] = sb_request($cfg, 'POST', '/auth/v1/invite' . $query, ['email' => $target['email']]);
        if ($status < 300) { $sent = true; $result['sent'] = 'invite'; }
        // Si GoTrue no deja re-invitar, se cae al link de contraseña.
    }
    if (!$sent) {
        [$status, $data] = sb_request($cfg, 'POST', '/auth/v1/recover' . $query, ['email' => $target['email']]);
        if ($status < 300) $result['sent'] = 'reset';
        elseif (!$caller['isAdmin']) throw auth_error($data);
        else $result['email_error'] = auth_error($data)->getMessage();
    }
    if ($caller['isAdmin']) {
        [$status, $link] = sb_request($cfg, 'POST', '/auth/v1/admin/generate_link', [
            'type' => 'recovery',
            'email' => $target['email'],
            'redirect_to' => $redirect ? $redirect . '/index.html' : null,
        ]);
        $url = $link['action_link'] ?? ($link['properties']['action_link'] ?? null);
        if ($status < 300 && $url) $result['link'] = $url;
        elseif (empty($result['sent'])) throw auth_error($link);
    }
    return $result;
}

/* ---------- Handler ---------- */

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['error' => 'Method not allowed', 'code' => 'generic']);

    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) respond(400, ['error' => 'JSON inválido', 'code' => 'invalid_json']);
    $action = $body['action'] ?? '';
    $data = is_array($body['data'] ?? null) ? $body['data'] : [];

    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!$auth && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strtolower($k) === 'authorization') $auth = $v;
    }
    $token = preg_replace('/^Bearer\s+/i', '', $auth);
    if (!$token) respond(401, ['error' => 'Falta token de autenticación.', 'code' => 'missing_token']);

    $cfg = load_config();
    $caller = load_caller($cfg, $token);

    if ($action === 'create') respond(200, create_user($cfg, $caller, $data));

    $userId = (string)($body['userId'] ?? '');
    $target = preg_match('/^[0-9a-f-]{36}$/i', $userId) ? db_get_one($cfg, 'profiles', 'id=eq.' . rawurlencode($userId)) : null;
    assert_can_manage($caller, $target, $action);

    switch ($action) {
        case 'update':     respond(200, update_user($cfg, $caller, $target, $data));
        case 'deactivate': respond(200, deactivate_user($cfg, $target, $data));
        case 'reactivate': respond(200, reactivate_user($cfg, $target));
        case 'resend':     respond(200, resend_access($cfg, $caller, $target));
        default:           respond(400, ['error' => 'Acción desconocida.', 'code' => 'unknown_action']);
    }
} catch (HttpError $e) {
    respond($e->status, ['error' => $e->getMessage(), 'code' => $e->codeKey]);
} catch (Throwable $e) {
    respond(500, ['error' => $e->getMessage()]);
}
