<?php
/*
 * Copiar este archivo FUERA de public_html, con el nombre:
 *
 *   /home/ikmf/ikmf-pagos-config.php
 *
 * y completar los valores. La service_role key es SECRETA: con ella se
 * saltea toda la seguridad de la base. Nunca la subas a public_html ni al
 * repositorio.
 */
return [
    'supabase_url'     => 'https://TU-PROYECTO.supabase.co',
    'service_role_key' => 'TU-SERVICE-ROLE-KEY',
    // Para el link del email de invitación.
    'site_url'         => 'https://instructorfee.ikmfpassport.com',
];
