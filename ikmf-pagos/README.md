# IKMF Pagos

**URL:** https://instructorfee.ikmfpassport.com
**Servidor:** `/home/ikmf/public_html/instructorfee.ikmfpassport.com` (Apache + PHP)

Sitio para controlar las cuotas mensuales de los instructores de IKMF, con tres niveles de
acceso y aprobación de pagos mediante comprobante. Disponible en **español, inglés, hebreo
(de derecha a izquierda), francés, alemán e italiano**.

> Proyecto independiente de KALVIO: comparte el repo pero tiene su propio proyecto de
> Supabase y se publica en su propio servidor.

## Qué hace

| Rol | Puede |
|---|---|
| **Instructor** | Ver su estado mes por mes (aprobado / en revisión / rechazado / adeuda), cargar el pago de un mes **subiendo el comprobante** (imagen o PDF, máx. 5 MB), corregir y re-enviar un pago rechazado. |
| **Director de país** | Entra a un **dashboard de su país** (pagos aprobados del mes, pendientes de aprobación, alertas de falta de pago). Ve solo a los instructores de **su país**: pagos del mes con totales (recaudado vs. esperado), comprobantes, pagos pendientes, exportar CSV. **Crear, editar, activar, dar de baja y reactivar instructores** de su país. Puede registrar un pago en nombre de un instructor (ej. efectivo), que queda **pendiente de aprobación del admin**. **No aprueba ni rechaza pagos.** |
| **Admin** | Entra a un **dashboard general**: pagos aprobados del mes, pagos por validar, alertas de falta de pago (quién debe, cuántos meses y cuánto) y resumen por país, con filtro por país y mes. **Es el único que aprueba o rechaza pagos** (el rechazo exige motivo), con una bandeja de pendientes de **todos los países**. Ve cualquier país (selector arriba). En *Administración*: **crear, editar, dar de baja y reactivar directores e instructores** de cualquier país (incluye cambiar rol y país), y alta/edición de países (moneda + cuota por defecto). |

Flujo: el instructor sube el comprobante → queda **En revisión** → el **admin** lo
**aprueba** o lo **rechaza con motivo** → si se rechazó, el instructor lo corrige y vuelve a
revisión.

**Alta de usuarios:** se carga nombre, email, teléfono, cuota y mes de inicio. Si se deja
vacía la contraseña inicial, Supabase le manda un **email de invitación** para que elija la
suya; si se completa, la cuenta queda lista para entrar con esa contraseña. Los instructores
también pueden registrarse solos y quedan *pendientes* hasta que el director los activa.

**Baja:** se elige el último mes que se le cobra. La cuenta queda bloqueada (no puede
ingresar), deja de generar deuda después de ese mes y **se conserva todo su historial de
pagos**. Se puede reactivar: vuelve a cobrarse desde el mes en curso. No hay borrado
definitivo desde la web.

**Idiomas:** selector en el login y en la barra superior; se recuerda por navegador y, la
primera vez, se toma el idioma del navegador. Fechas y montos se formatean según el idioma.
Las traducciones están en `js/i18n.js` (conviene que un hablante nativo las revise antes del
lanzamiento). Los nombres de países y los comentarios que escribe la gente no se traducen.

## Seguridad

Todas las reglas viven en la base (`supabase/schema.sql`), no en el JS:

- RLS: cada usuario ve solo sus pagos; un director solo ve perfiles, pagos y comprobantes
  de instructores de su país; un admin ve todo.
- **Solo un admin puede pasar un pago a Aprobado o Rechazado.** Todo lo que carga un
  instructor o un director queda forzado a "En revisión", aunque se manipule el JS.
- Un instructor no puede cambiarse el rol, el país, la cuota ni activarse.
- Un pago aprobado no se puede editar ni borrar (salvo un admin).
- Alta, cambio de email y baja de cuentas pasan por `api/manage-user.php`, que usa la
  `service_role` (nunca llega al navegador) y valida el rol de quien llama: un director solo
  puede tocar instructores de su país; nadie gestiona admins desde la web.
- La `service_role` vive en un archivo **fuera de `public_html`**.
- Comprobantes en un bucket **privado** de Storage; se ven con links firmados de 10 minutos.
  Los archivos no se pueden pisar ni borrar (queda registro); solo un admin puede borrarlos.

## Estructura

```
index.html          Ingresar / crear cuenta / recuperar contraseña
dashboard.html      Dashboard (inicio del admin: todos los países; del director: su país)
instructor.html     Mis pagos (todos los roles)
director.html       Panel de país (director y admin)
admin.html          Países y usuarios (admin)
css/style.css
js/config.js        URL y anon key de Supabase  ← completar
js/i18n.js          Traducciones (ES / EN / HE / FR / DE / IT) + motor
js/common.js        Cliente, sesión, navegación, helpers, comprobantes
js/*.js             Lógica de cada pantalla
api/manage-user.php       Alta / edición / baja de usuarios (service_role)
api/config.example.php    Modelo del archivo de secretos (va FUERA de public_html)
.htaccess           HTTPS, header Authorization para PHP, bloquea archivos internos
supabase/schema.sql Tablas + RLS + triggers + bucket de Storage
```

Sin build step: HTML/CSS/JS estático + `supabase-js` por CDN + un endpoint PHP (necesita
PHP 7.4+ con la extensión `curl`, estándar en cPanel).

## Puesta en marcha

### 1. Supabase

1. [supabase.com](https://supabase.com) → New project (uno nuevo, no el de KALVIO/InstructorLog).
2. SQL Editor → pegar y correr completo `supabase/schema.sql`. Crea tablas, policies, el
   bucket `receipts` y algunos países de ejemplo (editables después). Se puede volver a
   correr sobre una base existente para actualizarla.
3. Project Settings → API → copiar **Project URL** y **anon/publishable key** en
   `js/config.js`. Copiar también la **service_role key** (es secreta, va en el paso 2.3).
4. Authentication → URL Configuration:
   - **Site URL** = `https://instructorfee.ikmfpassport.com`
   - **Redirect URLs** = `https://instructorfee.ikmfpassport.com/**`

   (Hace falta para los mails de confirmación, invitación y recuperar contraseña.)

### 2. Servidor

1. Subir **el contenido** de la carpeta `ikmf-pagos/` a
   `/home/ikmf/public_html/instructorfee.ikmfpassport.com/` (incluido `.htaccess`).
   No hace falta subir `supabase/` ni `README.md` (y si se suben, `.htaccess` los bloquea).
2. Verificar que el subdominio tenga **HTTPS** (cPanel → SSL/TLS Status → AutoSSL).
3. Crear el archivo de secretos **fuera** de `public_html`, a partir de
   `api/config.example.php`:

   ```
   /home/ikmf/ikmf-pagos-config.php
   ```

   con la Project URL, la service_role key y `site_url`. Permisos recomendados: `600`.

   En este hosting `public_html` apunta a `/home/ikmf/ikmf/public`, así que el endpoint
   busca el archivo un nivel arriba de esa carpeta: hoy está en
   `/home/ikmf/ikmf/ikmf-pagos-config.php` (fuera de la carpeta pública).

Ejemplo por SSH desde la carpeta del repo:

```bash
rsync -av --exclude supabase --exclude README.md \
  ikmf-pagos/ ikmf@<servidor>:/home/ikmf/public_html/instructorfee.ikmfpassport.com/
scp ikmf-pagos/api/config.example.php ikmf@<servidor>:/home/ikmf/ikmf-pagos-config.php
ssh ikmf@<servidor> 'chmod 600 /home/ikmf/ikmf-pagos-config.php && nano /home/ikmf/ikmf-pagos-config.php'
```

### 3. Primeros usuarios

1. Entrar al sitio, crear tu cuenta y convertirla en admin desde el SQL Editor:
   ```sql
   update public.profiles set role = 'admin', active = true
   where email = 'tu-mail@ejemplo.com';
   ```
2. En *Administración → Países* cargar moneda y cuota por defecto de cada país.
3. En *Administración → Usuarios → + Nuevo usuario* crear cada director (rol **Director de
   país** + su país).
4. Cada director crea a sus instructores desde *Mi país → Instructores → + Nuevo
   instructor* (o los instructores se registran solos y el director los activa).

> El servicio de email que trae Supabase tiene un límite bajo de envíos por hora. Para dar de
> alta muchos usuarios por invitación conviene configurar un SMTP propio (Authentication →
> Emails → SMTP) o cargar una contraseña inicial.

## Pendiente / ideas

- Avisos por email (comprobante nuevo al admin, aprobado/rechazado al instructor).
- Recordatorio automático a quien adeuda (cron del servidor).
- Reportes anuales por país.
- Traducir los mails de Supabase (confirmación, invitación, recuperar contraseña): se editan
  en Authentication → Email Templates.
