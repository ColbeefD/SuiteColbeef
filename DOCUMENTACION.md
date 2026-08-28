# WorkColbeef Suite — Documentación Técnica

> Portal web corporativo de **Colbeef** (planta de beneficio de bovinos, Floridablanca, Santander) que centraliza el acceso a las aplicaciones internas: Gestión Humana, Logística, Calidad, Tesorería y Cartera, Administrativo, Control Operativo y Power BI.

**Versión del documento:** 1.0
**Última actualización:** Julio 2026
**Contacto:** desarrollo.tecnologia@colbeef.com

---

## Tabla de contenido

1. [Visión general](#1-visión-general)
2. [Lenguajes y stack tecnológico](#2-lenguajes-y-stack-tecnológico)
3. [Arquitectura general](#3-arquitectura-general)
4. [Estructura de carpetas](#4-estructura-de-carpetas)
5. [Frontend](#5-frontend)
6. [Catálogo de módulos y programas](#6-catálogo-de-módulos-y-programas)
7. [Backend Node.js (`server.js`)](#7-backend-nodejs-serverjs)
8. [Backend Laravel](#8-backend-laravel)
9. [Referencia de API](#9-referencia-de-api)
10. [Base de datos](#10-base-de-datos)
11. [Configuración y variables de entorno](#11-configuración-y-variables-de-entorno)
12. [Modelo de seguridad](#12-modelo-de-seguridad)
13. [Arranque y despliegue](#13-arranque-y-despliegue)
14. [Convenciones de código](#14-convenciones-de-código)
15. [Deuda técnica e inconsistencias conocidas](#15-deuda-técnica-e-inconsistencias-conocidas)
16. [Glosario](#16-glosario)

---

## 1. Visión general

WorkColbeef Suite es un **portal de acceso unificado** (single pane of glass) a las aplicaciones internas de Colbeef. No reemplaza a las aplicaciones; las **agrupa, protege y organiza** en un panel de módulos, con funciones transversales:

- **Panel de módulos** con tarjetas por área (Gestión Humana, Logística, Calidad, Tesorería y Cartera, Administrativo, Control Operativo, Power BI).
- **Accesos recientes** por navegador para retomar rápido el último programa usado.
- **Buscador** global de módulos, programas y herramientas.
- **Asistente virtual "Beef"** basado en Google Gemini (proxy en el backend).
- **Protección por PIN** para Power BI (servidor) y Rendimientos (cliente).
- **Ajustes** con perfil, preferencias, tema claro/oscuro, privacidad, estadísticas de uso y gestión de reportes de bugs (PQR).
- **Estadísticas de uso** por módulo y por programa específico.
- **Diseño responsive** con menú tipo drawer en móvil.

### Principios de diseño

| Principio | Aplicación |
|-----------|------------|
| **Cero fricción** | La raíz redirige directo a `site.html`; un clic abre cada programa. |
| **Sin build en el frontend** | HTML/CSS/JS plano; no requiere compilación ni framework en el portal. |
| **Backend intercambiable** | El mismo frontend funciona con Node **o** con Laravel. |
| **Secretos en el servidor** | La API key de Gemini y los hashes nunca llegan al navegador. |
| **Privacidad** | Las métricas usan un hash anónimo de visitante (no datos personales). |

---

## 2. Lenguajes y stack tecnológico

### Lenguajes utilizados

| Lenguaje | Uso en el proyecto |
|----------|--------------------|
| **HTML5** | Estructura del portal (`site.html`) y pantalla de carga (`index.html`). |
| **CSS3** | Sistema de diseño propio (`css/site.css`, ~3.400 líneas). Sin Tailwind en el portal. |
| **JavaScript (ES5 / IIFE)** | Lógica del portal (`script/site.js`, ~2.100 líneas). Sin bundler ni módulos ES. |
| **PHP 8.2+** | Backend Laravel (recomendado en producción). |
| **Node.js 18+** | Backend alternativo (`server.js`) y scripts de optimización de imágenes. |
| **PowerShell / Batch** | Scripts de arranque y despliegue en Windows. |
| **Python** | Únicamente un fragmento de referencia para el SSO en Flask (`laravel/sso_ghv_flask_snippet.py`). |

### Frameworks y librerías

**Backend Node (`package.json`)**

| Paquete | Versión | Rol |
|---------|---------|-----|
| `express` | ^4.21.2 | Servidor HTTP y archivos estáticos |
| `bcryptjs` | ^2.4.3 | Verificación de contraseña admin y PIN de Power BI |
| `jsonwebtoken` | ^9.0.2 | Emisión/verificación de JWT del admin |
| `cookie-parser` | ^1.4.7 | Lectura de cookies HttpOnly |
| `dotenv` | ^16.4.5 | Carga de variables de entorno |
| `compression` | ^1.8.1 | Compresión gzip de estáticos |
| `sharp` | ^0.34.5 (dev) | Optimización de imágenes (hero e íconos) |

**Backend Laravel (`laravel/composer.json`)**

| Paquete | Versión | Rol |
|---------|---------|-----|
| `laravel/framework` | ^12.0 (locked 12.55.1) | Núcleo del framework |
| `firebase/php-jwt` | ^7.0 | JWT del admin y tokens SSO |
| `laravel/tinker` | ^2.10.1 | REPL de desarrollo |

> Laravel usa `Hash` nativo (bcrypt) para contraseñas y PINs; no requiere una librería bcrypt extra.

---

## 3. Arquitectura general

WorkColbeef tiene una arquitectura **cliente–servidor con dos backends intercambiables** que sirven exactamente el mismo frontend estático y exponen endpoints `/api/*` equivalentes.

```
                          ┌─────────────────────────────┐
                          │          Navegador           │
                          │  site.html + site.css +      │
                          │  site.js  (SPA-lite / IIFE)  │
                          └───────────────┬─────────────┘
                                          │ HTTP + fetch /api/*
                          ┌───────────────┴─────────────┐
                          │       UNO de los dos:        │
                ┌─────────┴─────────┐        ┌───────────┴──────────┐
                │   Laravel (PHP)   │        │   Node.js (Express)  │
                │  puerto 8000      │   ó    │   puerto 3000        │
                │  (producción)     │        │   (alternativo)      │
                └─────────┬─────────┘        └───────────┬──────────┘
                          │                              │
        ┌─────────────────┼──────────────┐              │
        ▼                 ▼               ▼              ▼
   MySQL/SQLite     Google Gemini    Apps internas   data/usage-stats.json
   (usage_events,   (proxy chat)     (5000, 8004,    (métricas en Node)
    bug_reports)                      5009, 9030…)
```

### Decisión clave: ¿por qué dos backends?

- **Laravel** es el backend **recomendado para producción**: base de datos real, reportes de bugs, SSO y estadísticas por programa.
- **Node** es un backend **ligero y portátil** para levantar el portal rápido sin PHP ni base de datos (guarda métricas en un archivo JSON).

> **Regla operativa:** solo uno corre a la vez. En producción se usa Laravel sirviendo `laravel/public/`.

### Duplicación del frontend

El mismo frontend se mantiene en **dos árboles**:

| Árbol raíz (lo sirve Node) | Copia Laravel (producción) |
|----------------------------|----------------------------|
| `site.html` | `laravel/public/site.html` |
| `css/site.css` | `laravel/public/css/site.css` |
| `script/site.js` | `laravel/public/script/site.js` |
| `img/`, `data/` | `laravel/public/img/`, `laravel/public/data/` |

> ⚠️ **No existe paso de build automático.** Todo cambio en el portal debe copiarse a ambos árboles. Ver [Deuda técnica](#15-deuda-técnica-e-inconsistencias-conocidas).

---

## 4. Estructura de carpetas

```
Suite/
├── site.html                     # Portal principal (fuente canónica)
├── index.html                    # Pantalla de carga animada → site.html
├── server.js                     # Backend Node + servidor estático
├── package.json                  # Dependencias Node
├── .env.example                  # Plantilla de entorno para Node
├── README.md                     # Guía rápida de instalación
├── DOCUMENTACION.md              # (este documento)
├── iniciar-suite.bat             # Lanzador rápido (Laravel por defecto)
├── configurar-workcolbeef.bat    # Configura el alias WorkColbeef en hosts
│
├── css/
│   ├── site.css                  # Estilos del portal (sistema de diseño)
│   └── style.css                 # Estilos de la pantalla de carga
├── script/
│   ├── site.js                   # Lógica del portal
│   └── script.js                 # Lógica de la pantalla de carga
├── img/
│   ├── site/                     # Assets del portal (hero, íconos, robot)
│   └── pantallaCarga/            # Assets de la animación de carga
├── data/
│   └── suite-settings-default.json   # Perfil de ajustes por defecto
├── scripts/
│   ├── optimize-hero-image.js    # Genera variantes webp del hero
│   ├── optimize-menu-icons.js    # Optimiza íconos del menú
│   └── windows/
│       ├── autostart.ps1         # Instala arranque automático (Run/Task)
│       ├── run-laravel.ps1       # Levanta Laravel oculto en segundo plano
│       ├── run-node.ps1          # Levanta Node oculto en segundo plano
│       └── setup-workcolbeef-host.ps1  # Escribe el alias en el hosts
│
└── laravel/                      # Backend Laravel (recomendado)
    ├── app/
    │   ├── Http/Controllers/     # AdminAuth, ChatProxy, PowerBiPin,
    │   │                         # UsageStats, BugReport, Sso
    │   ├── Http/Middleware/      # VerifyAdminJwt (alias admin.jwt)
    │   └── Models/               # UsageEvent, BugReport, User
    ├── config/                   # admin.php, powerbi.php, sso.php, …
    ├── database/migrations/      # usage_events, bug_reports, defaults
    ├── public/                   # Document root + copia del frontend
    ├── routes/
    │   ├── api.php               # Endpoints /api/*
    │   └── web.php               # / → redirige a site.html
    ├── scripts/
    │   ├── make-master-hash.php  # Genera hash bcrypt en Base64
    │   └── verify-b64-env.php    # Verifica el hash del .env
    └── .env.example
```

---

## 5. Frontend

### 5.1 `index.html` — Pantalla de carga

Animación de marca ("Work" verde + "Colbeef" rojo) que precede al portal. Al terminar redirige a `site.html` (`script/script.js`). En Laravel, la ruta `/` va directo a `site.html`, por lo que la animación solo se ve al entrar por `index.html`.

### 5.2 `site.html` — Estructura del portal

| Sección | IDs / clases principales | Descripción |
|---------|--------------------------|-------------|
| Layout | `#suiteLayout`, `#sidebar`, `#sidebarBackdrop` | Grid barra lateral + panel principal |
| Menú de apps | `#appsMenu` | 5 módulos con ícono y nombre |
| Menú utilidades | `#settingsOpenBtn`, `#searchOpenBtn`, `#bugReportOpenBtn` | Ajustes, buscador, reportar bug |
| Barra superior | `#mobileNavToggle`, `#backFromSettingsBtn` | Hamburguesa móvil y "Volver" |
| Vista inicio | `#viewHome`, `#moduleMosaic`, `#recentAccessSection` | Hero + mosaico de módulos + accesos recientes |
| Vista ajustes | `#viewSettings` | Pestañas: Mi Cuenta, Preferencias, Notificaciones, Privacidad, Estadísticas, Bugs |
| Modales | `#searchModal`, `#adminAccessModal`, `#powerBiPinModal`, `#feedbackModal` | Buscador, acceso admin, PIN Power BI, reporte PQR |
| Chat | `#colbeefChat`, `#colbeefChatPanel`, `#colbeefChatToggle` | Widget flotante "Beef" |

### 5.3 `css/site.css` — Sistema de diseño

**Tokens de diseño** (`:root`):

```css
--green: #084d26;          /* Verde corporativo */
--red:   #d61f2c;          /* Rojo corporativo */
--brand-gradient: linear-gradient(135deg, var(--green), var(--red));
--accent-strip:   linear-gradient(90deg,  var(--green), var(--red));
```

**Tema oscuro:** se activa con `body[data-suite-theme="oscuro"]`, que sobrescribe los tokens de color base (`--text`, `--bg`, `--panel`, `--sidebar-bg`, etc.).

**Breakpoints responsive:**

| Breakpoint | Comportamiento |
|------------|----------------|
| `min-width: 1100px` | Tipografía del hero más grande |
| `min-width: 640px` | Formularios de ajustes en 2 columnas |
| `max-width: 900px` | **Menú tipo drawer**, barra superior fija, mosaico en 1 columna, sidebar `translateX(-105%)` |

### 5.4 `script/site.js` — Arquitectura de la lógica

Todo el código vive dentro de una **IIFE** (`(function () { ... })();`) para no contaminar el ámbito global. El punto de entrada es `init()`, que registra todos los subsistemas.

```
init()
 ├── applySettingsToUI(loadSettings())   → perfil, tema, preferencias
 ├── initSidebarHover / initMobileNav     → navegación escritorio/móvil
 ├── initMenuTracking / initDashboardMosaic
 ├── initPowerBiNav / initLogisticaNav / initGestionHumanaNav / initCalidadNav / initTesoreriaNav / initAdministrativoNav
 ├── initRecentAccess                     → accesos recientes
 ├── initAdminAccessModal / initSettings* → panel de ajustes (con JWT)
 ├── initPowerBiPinModal                  → flujo de PIN de Power BI
 ├── initUsageStatsPeriod / initBugStats* → estadísticas y bugs (admin)
 ├── initSearchModal                      → buscador
 ├── initColbeefChat                      → asistente Gemini
 └── initBugReportModal                   → reporte de PQR
```

**Claves de almacenamiento local:**

| Clave | Tipo | Propósito |
|-------|------|-----------|
| `suite_settings_v2` | localStorage | Perfil de preferencias del usuario |
| `WorkColbeef_recent_access_v1` | localStorage | Accesos recientes (persistente) |
| `WorkColbeef_recent_access_session_v1` | sessionStorage | Accesos recientes (modo "borrar al cerrar") |
| `WorkColbeef_admin_unlocked_v1` | sessionStorage | Bandera de "ya ingresó la contraseña" por pestaña |
| `WorkColbeef_usage_pv` | sessionStorage | Un `page_view` por pestaña |

**Funciones destacadas por área:**

| Área | Funciones clave |
|------|-----------------|
| Ajustes | `loadSettings`, `saveSettingsModel`, `applySettingsToUI`, `collectSettingsFromUI` |
| Navegación | `navigateToModule`, `moduleMetaFromLink`, `initMenuTracking` |
| Accesos recientes | `recordRecentAccess`, `renderRecentAccess`, `buildRecentEntry` |
| PIN Power BI | `requirePowerBiPinThenOpen`, `initPowerBiPinModal` |
| PIN Rendimientos | `requireRendimientosPinThenOpen` |
| Estadísticas | `sendUsageEvent`, `loadUsageStats`, `renderUsageStats` |
| Chat | `sendColbeefChatMessage`, `initColbeefChat` |

#### Flujo de PIN de Power BI

1. El usuario hace clic en un informe → `requirePowerBiPinThenOpen(href, meta)`.
2. Se abre el modal y se envía `POST /api/powerbi/pin` con `{ pin }`.
3. Si es correcto: el servidor deja una **cookie HttpOnly**, se registra el acceso reciente y se navega al informe.

#### Flujo de accesos recientes

`recordRecentAccess()` guarda hasta 8 entradas (`programId`, `programLabel`, `appId`, `href`, `ts`) respetando la preferencia de privacidad (`historialPaginas`): 7 días, 30 días o borrar al cerrar sesión. Si no hay entradas, la sección se oculta por completo.

---

## 6. Catálogo de módulos y programas

Todas las URLs están configuradas en `site.html` (mosaico y buscador).

### Control Operativo
| Programa | URL | PIN |
|----------|-----|-----|
| Control operativo | `http://192.168.100.241:5001/` | No |

### Gestión Humana
| Programa | URL | PIN |
|----------|-----|-----|
| Gestión humana | `http://192.168.20.205:5000/login` | No |
| Contratista | `http://192.168.20.205:8009/login` | No |

### Logística
| Programa | URL | PIN |
|----------|-----|-----|
| Desposte | `http://192.168.20.205:8004/login` | No |
| Inventarios | `http://192.168.20.205:8501/` | No |
| App Logística | `http://192.168.20.205:8088/login.php` | No |
| Rendimientos | `http://192.168.20.205:8090/` | **Sí** (cliente, `250626`) |
| Lenguas | `http://192.168.20.205:8005/` | No |

### Calidad
| Programa | URL | PIN |
|----------|-----|-----|
| Canales | `http://192.168.20.205:8006/login` | No |
| Colbeef-Ops | `http://192.168.20.205:8081` | No |

### Tesorería y cartera
| Programa | URL | PIN |
|----------|-----|-----|
| Pago proveedores | `http://192.168.20.205:8100/` | No |

### Administrativo
| Programa | URL | PIN |
|----------|-----|-----|
| Juricombeef | `http://192.168.20.205:8010/app/login.html` | No |

### Power BI (todos protegidos con PIN de servidor)
| Programa | URL |
|----------|-----|
| Datos y cifras Colbeef | `https://app.powerbi.com/view?r=…` |
| Control PQRS | `https://app.powerbi.com/view?r=…` |
| Analyzer | `http://192.168.20.205:9030/analyzer` |

---

## 7. Backend Node.js (`server.js`)

Servidor Express que sirve los estáticos de la raíz y expone `/api/*`. Guarda métricas en `data/usage-stats.json` (sin base de datos).

**Middleware:** `compression()`, `express.json({ limit: "1mb" })`, `cookieParser()`.

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/admin/login` | — | Verifica contraseña (bcrypt), rate limit 5/IP/15min, emite JWT en cookie |
| GET | `/api/admin/session` | — | `{ authenticated }` |
| POST | `/api/admin/logout` | — | Borra la cookie |
| GET | `/api/admin/ping` | JWT | Salud del admin |
| GET | `/api/powerbi/pin/session` | — | `{ unlocked }` según cookie |
| POST | `/api/powerbi/pin` | — | Valida PIN (bcrypt) → cookie HttpOnly |
| POST | `/api/stats/event` | — | Añade evento al JSON (120 req/min/IP) |
| GET | `/api/admin/stats` | JWT | Resumen de métricas |
| POST | `/api/chat` | — | Proxy a Gemini con el prompt del sistema |

**Chat:** el prompt de sistema (`COLBEEF_CHAT_SYSTEM`) describe la empresa y los módulos, para que el asistente responda con contexto y no invente datos.

**Hash de visitante:** HMAC-SHA256 de `IP|User-Agent` firmado con `ADMIN_JWT_SECRET` (anonimización).

> El backend Node **no** implementa reportes de bugs, SSO ni el desglose por programa (`program_id`). Para esas funciones se requiere Laravel.

---

## 8. Backend Laravel

Backend recomendado. Sirve `laravel/public/` y monta `routes/api.php` bajo `/api`.

**Controladores:**

| Controlador | Responsabilidad |
|-------------|-----------------|
| `AdminAuthController` | Login/logout/sesión del admin; JWT con `firebase/php-jwt`; rate limit 30/5min |
| `ChatProxyController` | Proxy a Gemini (prompt más breve que el de Node) |
| `PowerBiPinController` | Verificación del PIN de Power BI; rate limit 12/10min; cookie de desbloqueo |
| `UsageStatsController` | Registro y resumen de métricas (incluye **desglose por programa**) |
| `BugReportController` | Alta pública de PQR y panel admin (totales, tiempo medio, resolver) |
| `SsoController` | Emite JWT corto para SSO hacia la app Flask de Gestión Humana |

**Middleware `VerifyAdminJwt`** (alias `admin.jwt`): lee la cookie, decodifica el JWT y exige `scope === "admin"`. Devuelve 401 (API) o redirige a `/` (HTML).

---

## 9. Referencia de API

Endpoints comunes (paridad Node/Laravel salvo lo indicado).

### Autenticación admin

```http
POST /api/admin/login
Content-Type: application/json

{ "password": "••••••••" }
```
**200** → cookie HttpOnly con JWT (`scope: admin`). **401** contraseña incorrecta. **429** demasiados intentos.

```http
GET  /api/admin/session        → { "authenticated": true|false }
POST /api/admin/logout         → borra cookie
```

### Power BI

```http
GET  /api/powerbi/pin/session  → { "unlocked": true|false }
POST /api/powerbi/pin          { "pin": "••••••" }  → cookie de desbloqueo
```

### Métricas de uso

```http
POST /api/stats/event
{
  "event": "module_click",         // page_view | module_click | search_open | chat_open | chat_message
  "app_id": "logistica",
  "program_id": "192-168-20-205-8004-login",  // solo Laravel
  "program_label": "Logística · Desposte"      // solo Laravel
}

GET  /api/admin/stats?days=30   (admin)  → totales, by_app, by_program, daily
```

### Reportes de bugs / PQR (solo Laravel)

```http
POST  /api/bugs/report                       (público, throttle 20/min)
GET   /api/admin/bugs/summary?days=30        (admin)
PATCH /api/admin/bugs/{id}/resolve           (admin)
```

### Chat (asistente Beef)

```http
POST /api/chat
{ "message": "¿Dónde ingreso las lenguas?" }
→ respuesta de Gemini (la API key permanece en el servidor)
```

---

## 10. Base de datos

Solo aplica al backend **Laravel**. Node usa `data/usage-stats.json`.

> El flujo de interacción de la persona con el portal está disponible en [DIAGRAMA_FLUJO_DATOS.mmd](DIAGRAMA_FLUJO_DATOS.mmd). WorkColbeef centraliza y abre aplicaciones mediante sus URLs; no consulta las bases de datos internas de esos programas.

### Tabla `usage_events`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | bigint PK | |
| `event` | string(48) | Tipo de evento |
| `app_id` | string(96), null | Módulo principal |
| `program_id` | string(160), null | Programa específico (derivado de la URL) |
| `program_label` | string(160), null | Nombre legible del programa |
| `visitor_hash` | string(64), null | Hash anónimo de visitante |
| `user_label` | string(160), null | Reservado (hoy siempre NULL) |
| `created_at` | timestamp | Sin `updated_at` |

Índices: `(event, created_at)`, `(app_id, created_at)`, `(program_id, created_at)`, `(user_label, created_at)`.

### Tabla `bug_reports`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | bigint PK | |
| `ticket_code` | string(40), único | Ej: `WB-20260716-A1B2C3` |
| `software` | string(64) | Módulo afectado |
| `tema` | string(120) | Categoría |
| `detalle` | string(200) | Subcategoría |
| `mensaje` | text | Mínimo 10 caracteres |
| `status` | string(24) | `open` / `resolved` |
| `visitor_hash` | string(64), null | Hash anónimo |
| `resolved_at` | timestamp, null | Fecha de resolución |
| `created_at`, `updated_at` | timestamps | |

**Modelos:** `UsageEvent` (`$timestamps = false`), `BugReport` (timestamps estándar). `User` es el modelo por defecto de Laravel y **no** se usa para el admin (la autenticación es por contraseña maestra + JWT).

---

## 11. Configuración y variables de entorno

### El truco del hash en Base64

Los hashes bcrypt contienen el carácter `$`, que rompe el parseo de un `.env` sin comillas. Por eso las contraseñas y PINs se guardan **codificados en Base64**:

1. Generar: `php laravel/scripts/make-master-hash.php "TuClave"` → imprime `MASTER_PASSWORD_HASH_B64=...`
2. Pegar esa línea (una sola línea) en `.env`.
3. El servidor la decodifica al arrancar.
4. Verificar: `php laravel/scripts/verify-b64-env.php "TuClave"` y luego `php artisan config:clear`.

### Variables (Node — `.env.example`)

| Variable | Propósito |
|----------|-----------|
| `PORT` | Puerto de Node (3000) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Chat con Gemini |
| `ADMIN_PASSWORD_HASH_B64` | Contraseña maestra (bcrypt en Base64) |
| `ADMIN_JWT_SECRET` | Firma del JWT del admin |
| `ADMIN_JWT_EXPIRES` | Vigencia del token (`8h`) |
| `ADMIN_COOKIE_NAME` | Nombre de la cookie admin |
| `POWERBI_PIN_HASH_B64` | PIN de Power BI (bcrypt en Base64) |
| `NODE_ENV` | Entorno |

> Node además lee: `ADMIN_PASSWORD_HASH`, `POWERBI_PIN_HASH`, `POWERBI_PIN_COOKIE`, `POWERBI_PIN_TTL_MINUTES`, `ADMIN_COOKIE_SECURE`.

### Variables (Laravel — `laravel/.env.example`)

Además de las estándar de Laravel:

| Variable | Propósito |
|----------|-----------|
| `MASTER_PASSWORD_HASH_B64` | Contraseña maestra del admin |
| `ADMIN_JWT_SECRET` | Firma del JWT |
| `ADMIN_JWT_TTL_MINUTES` | Vigencia (480) |
| `ADMIN_COOKIE_NAME` | Nombre de la cookie |
| `POWERBI_PIN_HASH_B64` | PIN de Power BI |
| `POWERBI_PIN_TTL_MINUTES` | TTL de la cookie de desbloqueo |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Chat |
| `SSO_GH_SECRET` / `SSO_GH_AUDIENCE` | SSO con la app Flask de GH |
| `GH_APP_BASE_URL` / `GH_SSO_ADMIN_USER_ID` / `SSO_GH_TTL_SECONDS` | Parámetros del SSO |

**Config resuelta:** `config/admin.php` y `config/powerbi.php` prefieren la variante `_B64`; si no existe, usan el hash en crudo.

---

## 12. Modelo de seguridad

| Mecanismo | Implementación |
|-----------|----------------|
| **Acceso admin** | Contraseña maestra → verificación bcrypt → **JWT en cookie HttpOnly** |
| **Desbloqueo de UI admin** | Bandera adicional en `sessionStorage` (solo UX; la API valida siempre la cookie) |
| **Flag secure de cookie** | Laravel: `$request->secure()`; Node: `ADMIN_COOKIE_SECURE`. **En HTTP LAN debe ser false.** |
| **PIN Power BI** | Hash bcrypt en servidor → cookie HttpOnly (TTL 120 min) |
| **PIN Rendimientos** | **Solo en cliente**, valor fijo en JS — protección débil |
| **Rate limiting** | Node: login 5/15min; Laravel: login 30/5min, PIN 12/10min, stats 120/min, bugs 20/min |
| **API key de Gemini** | Solo en el servidor; el navegador llama a `/api/chat` |
| **Privacidad de visitantes** | HMAC de IP+User-Agent (no es dato personal) |
| **SSO** | JWT corto firmado con secreto compartido; requiere sesión admin |

> **Limitación conocida:** el PIN de Power BI protege el acceso **desde el portal**, pero si alguien copia la URL directa del informe público, puede abrirla por fuera (documentado en `config/powerbi.php`).

---

## 13. Arranque y despliegue

### Arranque rápido (`iniciar-suite.bat`)

- Por defecto levanta **Laravel** en `192.168.20.205:8000` y abre `http://WorkColbeef:8000/`.
- `iniciar-suite.bat node` → levanta Node en `http://localhost:3000/site.html`.

### Alias "WorkColbeef" en el navegador

`configurar-workcolbeef.bat` (como administrador) agrega `WorkColbeef → 192.168.20.205` al archivo `hosts` de Windows y crea un acceso directo en el escritorio. Así se entra con `http://WorkColbeef:8000/` en vez de la IP.

### Arranque automático al iniciar sesión

```powershell
# Laravel (recomendado)
.\scripts\windows\autostart.ps1 -Action install -Mode laravel -Method runkey -HostAddress 0.0.0.0 -Port 8000

# Node
.\scripts\windows\autostart.ps1 -Action install -Mode node -Method runkey
```

- `runkey`: registro `HKCU\...\Run` (sin admin).
- `task`: tarea programada al iniciar sesión (puede requerir admin).
- Logs en `%LOCALAPPDATA%\WorkColbeefSuite\logs\`.

### Despliegue en producción (Laravel)

1. Ubicar el repo (ej. `C:\laragon\www\WorkColbeef`).
2. Document root → `laravel/public`.
3. `cd laravel && composer install`
4. `copy .env.example .env && php artisan key:generate`
5. Configurar `.env` (hashes, Gemini, SSO) y `php artisan migrate`
6. `php artisan serve --host=192.168.20.205 --port=8000`

---

## 14. Convenciones de código

### JavaScript (`script/site.js`)

- **Un solo IIFE**; sin variables globales salvo las expuestas explícitamente.
- Estilo **ES5** (`var`, `function`) por compatibilidad y para evitar un paso de build.
- Funciones agrupadas por dominio con prefijo `init*` para los registradores de eventos.
- Toda llamada de red usa `fetch` con manejo de error silencioso en telemetría (nunca rompe la navegación del usuario).
- Comentarios solo donde el "por qué" no es evidente (decisiones, límites, `ponytail:`).

### PHP (Laravel)

- Un controlador por dominio; métodos con firma tipada (`Request`, `JsonResponse`).
- Validación con `$request->validate()` en cada endpoint público.
- Rate limiting con `RateLimiter` por IP.
- Secretos y hashes resueltos vía `config/*.php`, nunca hardcodeados.

### Sincronización de archivos

Al tocar `site.html`, `css/site.css` o `script/site.js`, **copiar la misma versión** a `laravel/public/`.

---

## 15. Deuda técnica e inconsistencias conocidas

> Registradas para transparencia y priorización futura. No bloquean la operación.

1. **Doble árbol del frontend sin build:** riesgo de desplegar una copia desactualizada en `laravel/public/`. *Mitigación futura:* script de copia o symlink.
2. **`RENDIMIENTOS_PIN` fijo en el JS** (`script/site.js`): visible en el código fuente y validado solo en cliente. *Mejora:* moverlo a validación de servidor como Power BI.
3. **Cookie de sesión de Power BI sin uso en el frontend:** `GET /api/powerbi/pin/session` existe pero no se consulta, por lo que el PIN se pide en cada clic aunque la cookie siga vigente.
4. **Variable `powerBiPinOk` sin efecto** (código muerto) en `site.js`.
5. **Paridad de métricas Node vs Laravel:** el frontend envía `program_id`/`program_label`, pero Node los ignora (solo Laravel guarda el desglose por programa).
6. **Columna `user_label`** creada pero siempre NULL (las estadísticas por usuario se retiraron a propósito).
7. **Prompts de chat distintos** entre Node (`server.js`) y Laravel (`ChatProxyController`).
8. **Límites de rate limiting distintos** entre ambos backends para el login.
9. **`data/suite-settings-default.json`** trae `paginaInicioPorDefecto: "inventario"`, pero el JS usa `"control-operativo"` (archivo probablemente obsoleto).
10. **`server.js` sirve `./admin`** como estático, pero no existe la carpeta `admin/` en el repo.
11. **Endpoint SSO** (`POST /api/admin/sso/gh`) implementado sin UI que lo invoque (integración futura).
12. **Dos hosts con puerto 5001:** Control operativo usa `192.168.100.241:5001`; el README menciona Locker en `192.168.20.205:5001` (fácil de confundir).

---

## 16. Glosario

| Término | Significado |
|---------|-------------|
| **Módulo** | Área funcional del portal (Gestión Humana, Logística, Calidad, Tesorería y Cartera, Administrativo, Control Operativo, Power BI). |
| **Programa** | Aplicación concreta dentro de un módulo (Desposte, Canales, Pago proveedores, Juricombeef, Analyzer, etc.). |
| **PIN** | Clave numérica que protege el acceso a Power BI (servidor) o Rendimientos (cliente). |
| **JWT** | JSON Web Token; credencial firmada que autoriza al admin, guardada en cookie HttpOnly. |
| **Hash B64** | Hash bcrypt codificado en Base64 para poder guardarlo en `.env` sin romper el parseo. |
| **Visitor hash** | Identificador anónimo (HMAC de IP + navegador) para métricas sin datos personales. |
| **Beef** | Asistente virtual del portal, basado en Google Gemini vía proxy en el backend. |
| **Drawer** | Menú lateral deslizable que aparece en móvil (≤900px). |

---

*Documento mantenido por el equipo de Desarrollo y Tecnología de Colbeef.*
