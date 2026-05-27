# Workbeef (Suite)

Portal web (HTML/CSS/JS) para navegar los módulos del sistema **Workbeef**, con:

- **Buscador en tiempo real** de módulos.
- **Panel “Ajustes” protegido** por contraseña maestra (JWT en cookie HttpOnly).
- **Asistente (chat) con Gemini** vía proxy (la API key vive en `.env`, nunca en el navegador).
- **Accesos a apps externas** (Control Operativo, Gestión Humana, Logística, Inventario, Canales, Locker/Lockerbeef).

Este repositorio incluye **dos formas de ejecutar**:

- **Laravel** (recomendado): `Suite/laravel/` sirve los estáticos desde `laravel/public/` y expone los endpoints `/api/*`.
- **Node (opcional)**: `server.js` sirve la carpeta raíz y expone endpoints `/api/*` equivalentes.

---

## Estructura del proyecto

- `site.html`, `css/`, `script/`, `img/`, `data/`: frontend estático (Workbeef).
- `server.js`: servidor Node opcional (proxy Gemini + admin login JWT + sirve estáticos).
- `laravel/`: app Laravel (proxy Gemini + admin login JWT + middleware) y carpeta pública `laravel/public/` con el frontend.

---

## Requisitos

### Opción A (recomendada): Laravel

- **PHP** 8.2+ (ideal)
- **Composer**
- (Opcional) **MySQL/MariaDB** si vas a usar migraciones/DB (no es estrictamente necesario para chat/login).

### Opción B (opcional): Node

- **Node.js** 18+ (recomendado)
- npm

---

## Ubicación recomendada de instalación (Windows)

Pon el proyecto en una ruta **sin espacios** y corta. Recomendado:

- **Laragon**: `C:\laragon\www\workbeef`
- **Sin Laragon (carpeta normal)**: `C:\workbeef`

Ejemplo (si vas a moverlo):

```bash
mkdir C:\workbeef
```

---

## Instalación y ejecución (Laravel)

### 1) Entrar al proyecto

```bash
cd laravel
```

### 2) Instalar dependencias

```bash
composer install
```

### 3) Configurar `.env`

```bash
copy .env.example .env
php artisan key:generate
```

Edita `laravel/.env` y configura, como mínimo:

- `APP_URL` (para tu red): `http://192.168.20.205:8000`
- `GEMINI_API_KEY` (para el chat)
- `MASTER_PASSWORD_HASH` y `ADMIN_JWT_SECRET` (para Ajustes)
- `ADMIN_COOKIE_NAME` (por defecto `workbeef_admin_token`)

### 4) (Opcional) Base de datos

Laravel trae migraciones por defecto (`users`, `cache`, `jobs`). Si quieres tenerlas creadas:

```bash
php artisan migrate
```

> Nota: el **chat proxy** y el **login admin JWT** ya funcionan sin crear tablas propias; las migraciones son opcionales si no vas a usar `users`.

### 5) Ejecutar

Local:

```bash
php artisan serve
```

Red local (para abrir desde otro PC/cel):

```bash
php artisan serve --host=192.168.20.205 --port=8000
```

Abrir:

- `http://192.168.20.205:8000/` (redirige a `site.html`)

---

## Instalación y ejecución (Node, opcional)

> Útil si quieres servir el HTML de la raíz sin Laravel.

### 1) Instalar dependencias

```bash
npm install
```

### 2) Configurar `.env` (raíz)

```bash
copy .env.example .env
```

Completa al menos:

- `GEMINI_API_KEY`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_JWT_SECRET`

### 3) Ejecutar

```bash
npm start
```

Abrir:

- `http://localhost:3000/site.html`

---

## Endpoints principales

### Laravel

- **Chat (proxy Gemini)**: `POST /api/chat`
- **Admin login**: `POST /api/admin/login`
- **Admin session**: `GET /api/admin/session`
- **Admin logout**: `POST /api/admin/logout`
- **Ping protegido**: `GET /api/admin/ping` (requiere cookie admin)
- **Registrar evento de uso** (público, con límite de frecuencia): `POST /api/stats/event`
- **Resumen de estadísticas** (admin): `GET /api/admin/stats?days=30`

### Node

- **Chat (proxy Gemini)**: `POST /api/chat`
- **Admin login**: `POST /api/admin/login`
- **Admin session**: `GET /api/admin/session`
- **Admin logout**: `POST /api/admin/logout`
- **Ping protegido**: `GET /api/admin/ping` (requiere cookie admin)
- **Registrar evento de uso**: `POST /api/stats/event`
- **Resumen de estadísticas** (admin): `GET /api/admin/stats?days=30`

---

## Estadísticas de uso (Workbeef)

El portal registra en el servidor eventos anónimos (visitas al portal, clics en módulos, búsqueda, chat). El resumen se ve en **Ajustes → Estadísticas** (requiere contraseña maestra).

- **Laravel**: hace falta la tabla de eventos. Desde `laravel/` ejecuta `php artisan migrate` (usa tu base configurada en `.env`).
- **Node (`npm start`)**: los eventos se guardan en `data/usage-stats.json` (ignorado por Git). No requiere base de datos.

Los “visitantes únicos” son una **estimación** por hash (IP + navegador), no identifican personas por nombre.

---

## URLs de módulos (apps externas)

Estas URLs se abren desde las tarjetas del panel (mosaico), y la información del módulo queda en el detalle dentro de `site.html`:

- **Control operativo**: `http://192.168.100.241:5001/`
- **Gestión humana**: `http://192.168.20.205:5000/login`
- **Logística — Desposte (login)**: `http://192.168.20.205:8004/login`
- **Logística — Inventarios**: `http://192.168.20.205:8501/`
- **Logística — ERP logístico (login)**: `http://192.168.20.205:8088/login.php`
- **Logística — Lenguas**: `http://192.168.20.205:8005/`
- **Canales**: `http://192.168.20.205:8006/login`
- **Locker (Lockerbeef)**: `http://192.168.20.205:5001/login`

---

## Seguridad (importante)

- **Nunca subas** `.env` a Git. Este repo ya lo ignora.
- La API key de Gemini se usa **solo en el backend** (Laravel/Node) y **no viaja al navegador**.
- El acceso a Ajustes usa **JWT en cookie HttpOnly** (recomendado) y rate limiting básico para intentos de login (Node).

---

## Notas para Laragon (si lo vas a usar)

- Coloca el repo en `C:\laragon\www\workbeef`
- Asegura que el **document root** apunte a: `C:\laragon\www\workbeef\laravel\public`
- Crea `laravel/.env` y corre `composer install` + `php artisan key:generate`

---

## Troubleshooting rápido

- **El chat responde error 503**: falta `GEMINI_API_KEY` en el `.env` del backend que estés usando.
- **No entra a Ajustes / contraseña “incorrecta” siempre**: usa **`MASTER_PASSWORD_HASH_B64`** / **`ADMIN_PASSWORD_HASH_B64`** en el `.env` (sin caracteres `$`; genera con `php laravel/scripts/make-master-hash.php "Colbeef2026*"`). En Laravel: `php artisan config:clear` tras cambiar el `.env`. Con **HTTP** (no HTTPS), la cookie admin solo funciona si `secure` es false (Laravel ya usa `$request->secure()`; en Node no pongas `ADMIN_COOKIE_SECURE=true` salvo HTTPS).
- **Cookie de admin cambió**: si cambiaste `ADMIN_COOKIE_NAME`, tendrás que iniciar sesión otra vez.

---

## Inicio automático en Windows (al iniciar sesión)

Este repo trae scripts para crear una **Tarea Programada** que arranca el servidor en segundo plano al iniciar sesión.

### Instalar auto-inicio (Laravel recomendado)

En PowerShell, desde la raíz del proyecto:

```powershell
.\scripts\windows\autostart.ps1 -Action install -Mode laravel -Method runkey -HostAddress 0.0.0.0 -Port 8000
```

### Instalar auto-inicio (Node opcional)

```powershell
.\scripts\windows\autostart.ps1 -Action install -Mode node -Method runkey
```

### Desinstalar / desactivar

```powershell
.\scripts\windows\autostart.ps1 -Action uninstall -Method runkey
```

> Si tu PC permite crear tareas, también puedes usar `-Method task` (a veces requiere abrir PowerShell como Administrador).

### Logs

Los logs se guardan en:

- `%LOCALAPPDATA%\WorkbeefSuite\logs\`

