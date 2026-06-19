/**
 * Sirve la carpeta del proyecto y reenvía el chat a Gemini usando GEMINI_API_KEY del .env
 * (la clave no viaja al navegador).
 */
require("dotenv").config();

var path = require("path");
var fs = require("fs");
var crypto = require("crypto");
var express = require("express");
var compression = require("compression");
var bcrypt = require("bcryptjs");
var jwt = require("jsonwebtoken");
var cookieParser = require("cookie-parser");

var app = express();
var PORT = process.env.PORT || 3000;
var GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
var GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function loadAdminPasswordHash() {
  var b64 = process.env.ADMIN_PASSWORD_HASH_B64;
  if (b64 && String(b64).trim() !== "") {
    try {
      var s = Buffer.from(String(b64).trim(), "base64").toString("utf8");
      if (s.length >= 50) {
        return s.trim();
      }
    } catch (e) {
      /* fall through */
    }
  }
  return String(process.env.ADMIN_PASSWORD_HASH || "").trim();
}

var ADMIN_PASSWORD_HASH = loadAdminPasswordHash();
var ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";
var ADMIN_JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES || "8h";
var ADMIN_COOKIE_NAME = process.env.ADMIN_COOKIE_NAME || "WorkColbeef_admin_token";
/** Solo true si sirves HTTPS; en http://IP en red local debe ser false o la cookie no se guarda. */
var COOKIE_SECURE =
  process.env.ADMIN_COOKIE_SECURE === "1" || String(process.env.ADMIN_COOKIE_SECURE || "").toLowerCase() === "true";

function loadPowerBiPinHash() {
  var b64 = process.env.POWERBI_PIN_HASH_B64;
  if (b64 && String(b64).trim() !== "") {
    try {
      var s = Buffer.from(String(b64).trim(), "base64").toString("utf8");
      if (s.length >= 50) {
        return s.trim();
      }
    } catch (e) {
      /* fall through */
    }
  }
  return String(process.env.POWERBI_PIN_HASH || "").trim();
}

var POWERBI_PIN_HASH = loadPowerBiPinHash();
var POWERBI_PIN_COOKIE = process.env.POWERBI_PIN_COOKIE || "WorkColbeef_powerbi_unlocked";
var POWERBI_PIN_TTL_MINUTES = parseInt(String(process.env.POWERBI_PIN_TTL_MINUTES || "120"), 10) || 120;

function normalizeModelName(rawModel) {
  var model = String(rawModel || "").trim().toLowerCase();
  if (!model) return "gemini-2.5-flash";
  model = model.replace(/\s+/g, "-");
  if (model === "2.5-flash" || model === "2.5flash") return "gemini-2.5-flash";
  if (model === "2.0-flash" || model === "2.0flash") return "gemini-2.0-flash";
  if (model === "1.5-flash" || model === "1.5flash") return "gemini-1.5-flash-latest";
  if (model.indexOf("gemini-") !== 0) model = "gemini-" + model;
  return model;
}

var COLBEEF_CHAT_SYSTEM =
  "Eres el asistente virtual del sistema WorkColbeef de Colbeef. Respondes de forma breve, amable y profesional en español. CONTEXTO DE LA EMPRESA: Colbeef es un matadero de bovinos ubicado en el municipio de Floridablanca (Santander, Colombia); allí se presta el servicio de faena o beneficio de bovinos. La suite WorkColbeef agrupa el acceso a las aplicaciones internas; no inventes datos operativos ni cifras que no estén en esta descripción. MÓDULOS: 1) GESTIÓN HUMANA — Es el espacio donde se concentran los temas de talento y bienestar del personal: app principal en http://192.168.20.205:5000/login; módulo Contratista en http://192.168.20.205:8009/login (acceso desde la tarjeta Gestión humana en WorkColbeef, botón Contratista). Accesos rápidos típicos como gráficos, cumpleaños y tarjeta del mes, aniversario laboral, áreas de trabajo, EPS, fondo de pensiones, personal activo, hijos activos, solicitudes de permiso y de vacaciones, entre otros. Orienta al usuario a usar ese módulo para RRHH, beneficios y trámites de personal. 2) CONTROL OPERATIVO — Corresponde a la operación de planta y consulta operativa: ingreso de vehículos, plan de faena, pesaje, corrales, insensibilización, rendimientos, consulta de facturas, ranking de clientes, panel o monitor operativo, historial/descargas según la app, etc. 3) LOGÍSTICA — El módulo de Desposte está en http://192.168.20.205:8004/login (acceso desde la tarjeta Logística en WorkColbeef, botón Desposte); Inventarios en http://192.168.20.205:8501/ ; ERP logístico (App Logística) en http://192.168.20.205:8088/login.php ; Lenguas en http://192.168.20.205:8005/ . 4) CALIDAD — Qualapp en http://192.168.20.205:5009/admin/login/ ; Canales en http://192.168.20.205:8006/login ; Colbeef-Ops en http://192.168.20.205:8081 ; acceso desde la tarjeta Calidad en WorkColbeef (botones Qualapp, Canales y Colbeef-Ops). 5) POWER BI — Datos y cifras Colbeef, Control PQRS (informes Microsoft Power BI en vista web) y Analyzer en http://192.168.20.205:9030/analyzer ; acceso desde la tarjeta Power BI en WorkColbeef (botones Datos y cifras Colbeef, Control PQRS y Analyzer; todos piden PIN). Enlaces Power BI: Datos y cifras Colbeef → https://app.powerbi.com/view?r=eyJrIjoiOTVmN2UwN2QtNDMyYy00NjZlLTlmMWItYzQyNzNmMTFjYTY1IiwidCI6ImRkNGU4NmViLTcyMGEtNGQ4MC1iNjE2LTliOWNmOTU1ODZmNCJ9 ; Control PQRS → https://app.powerbi.com/view?r=eyJrIjoiZmViY2FjN2MtZDk2Yy00YWEwLTg2YjQtZjIxZWRlMjMzYzY2IiwidCI6ImRkNGU4NmViLTcyMGEtNGQ4MC1iNjE2LTliOWNmOTU1ODZmNCJ9 ; Analyzer → http://192.168.20.205:9030/analyzer . Si preguntan algo fuera de esta suite o de Colbeef como empresa genérica sin relación con estas herramientas, indica amablemente que solo puedes orientar sobre el uso de WorkColbeef y los módulos descritos.";

var rootDir = path.join(__dirname);
var STATS_FILE = path.join(rootDir, "data", "usage-stats.json");
var statsPostByIp = new Map();
var loginAttemptsByIp = new Map();
var MAX_ATTEMPTS = 5;
var ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

function getClientIp(req) {
  return req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  var ip = String(getClientIp(req));
  var now = Date.now();
  var state = loginAttemptsByIp.get(ip);
  if (!state || now - state.start > ATTEMPT_WINDOW_MS) {
    loginAttemptsByIp.set(ip, { start: now, count: 0 });
    return false;
  }
  return state.count >= MAX_ATTEMPTS;
}

function registerFailedAttempt(req) {
  var ip = String(getClientIp(req));
  var now = Date.now();
  var state = loginAttemptsByIp.get(ip);
  if (!state || now - state.start > ATTEMPT_WINDOW_MS) {
    loginAttemptsByIp.set(ip, { start: now, count: 1 });
    return;
  }
  state.count += 1;
}

function clearAttempts(req) {
  loginAttemptsByIp.delete(String(getClientIp(req)));
}

function isStatsPostRateLimited(req) {
  var ip = String(getClientIp(req));
  var now = Date.now();
  var windowMs = 60 * 1000;
  var state = statsPostByIp.get(ip);
  if (!state || now - state.start > windowMs) {
    statsPostByIp.set(ip, { start: now, count: 1 });
    return false;
  }
  if (state.count >= 120) {
    return true;
  }
  state.count += 1;
  return false;
}

function visitorHashNode(req) {
  var ip = String(getClientIp(req));
  var ua = String(req.headers["user-agent"] || "").slice(0, 512);
  var secret = ADMIN_JWT_SECRET && ADMIN_JWT_SECRET.length >= 8 ? ADMIN_JWT_SECRET : "WorkColbeef-node-stats";
  return crypto.createHmac("sha256", secret).update(ip + "|" + ua).digest("hex").slice(0, 32);
}

function appendUsageEvent(ev) {
  var dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  var data = { events: [] };
  try {
    data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch (e) {
    data = { events: [] };
  }
  if (!data.events) {
    data.events = [];
  }
  data.events.push(ev);
  if (data.events.length > 12000) {
    data.events = data.events.slice(-10000);
  }
  fs.writeFileSync(STATS_FILE, JSON.stringify(data));
}

function ymdFromTs(ts) {
  var d = new Date(ts);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function buildUsageSummary(days) {
  var EVENT_ORDER = ["page_view", "module_click", "search_open", "chat_open", "chat_message"];
  var APP_LABELS = {
    "control-operativo": "Control operativo",
    "gestion-humana": "Gestión humana",
    logistica: "Logística",
    calidad: "Calidad",
    "power-bi": "Power BI"
  };
  var data = { events: [] };
  try {
    data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch (e) {
    data = { events: [] };
  }
  var events = Array.isArray(data.events) ? data.events : [];
  var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  var filtered = events.filter(function (e) {
    return e && typeof e.t === "number" && e.t >= cutoff;
  });

  var totals = {};
  EVENT_ORDER.forEach(function (k) {
    totals[k] = 0;
  });
  var byAppMap = {};
  var dailyMap = {};
  var uniq = {};

  filtered.forEach(function (e) {
    var ev = e.event;
    if (EVENT_ORDER.indexOf(ev) !== -1) {
      totals[ev] += 1;
    }
    if (ev === "module_click" && e.app_id) {
      var aid = String(e.app_id);
      byAppMap[aid] = (byAppMap[aid] || 0) + 1;
    }
    var dk = ymdFromTs(e.t);
    dailyMap[dk] = (dailyMap[dk] || 0) + 1;
    if (e.visitor_hash) {
      uniq[e.visitor_hash] = true;
    }
  });

  var byApp = Object.keys(byAppMap)
    .map(function (id) {
      return {
        app_id: id,
        label: APP_LABELS[id] || id,
        clicks: byAppMap[id]
      };
    })
    .sort(function (a, b) {
      return b.clicks - a.clicks;
    });

  var daily = Object.keys(dailyMap)
    .sort()
    .map(function (d) {
      return { date: d, events: dailyMap[d] };
    });

  var sinceIso = new Date(cutoff).toISOString();

  return {
    ok: true,
    days: days,
    since: sinceIso,
    totals: totals,
    unique_visitors_estimate: Object.keys(uniq).length,
    by_app: byApp,
    daily: daily
  };
}

function issueAdminCookie(res) {
  var token = jwt.sign({ scope: "admin" }, ADMIN_JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES });
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000
  });
}

function verifyAdminFromRequest(req) {
  var token = req.cookies && req.cookies[ADMIN_COOKIE_NAME];
  if (!token) return false;
  try {
    var payload = jwt.verify(token, ADMIN_JWT_SECRET);
    return !!(payload && payload.scope === "admin");
  } catch (e) {
    return false;
  }
}

function requireAdminJwt(req, res, next) {
  if (!verifyAdminFromRequest(req)) {
    var acceptsHtml = (req.headers.accept || "").indexOf("text/html") !== -1;
    if (acceptsHtml) {
      res.redirect("/site.html");
      return;
    }
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }
  next();
}

if (!ADMIN_PASSWORD_HASH) {
  console.warn("[ADMIN] Falta ADMIN_PASSWORD_HASH o ADMIN_PASSWORD_HASH_B64 en .env; acceso admin deshabilitado.");
}
if (!ADMIN_JWT_SECRET || ADMIN_JWT_SECRET.length < 24) {
  console.warn("[ADMIN] Falta ADMIN_JWT_SECRET robusto en .env (mínimo recomendado: 24 caracteres).");
}

app.post("/api/admin/login", function (req, res) {
  if (!ADMIN_PASSWORD_HASH || !ADMIN_JWT_SECRET) {
    res.status(503).json({ ok: false, error: "Auth admin no configurada en servidor." });
    return;
  }
  if (isRateLimited(req)) {
    res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos." });
    return;
  }

  var password = req.body && req.body.password;
  if (typeof password !== "string") {
    res.status(400).json({ ok: false, error: "Contraseña inválida." });
    return;
  }
  password = password.trim();
  if (password.length < 6) {
    res.status(400).json({ ok: false, error: "Contraseña inválida." });
    return;
  }

  bcrypt
    .compare(password, ADMIN_PASSWORD_HASH)
    .then(function (ok) {
      if (!ok) {
        registerFailedAttempt(req);
        res.status(401).json({ ok: false, error: "Contraseña incorrecta." });
        return;
      }
      clearAttempts(req);
      issueAdminCookie(res);
      res.json({ ok: true });
    })
    .catch(function () {
      res.status(500).json({ ok: false, error: "No se pudo validar la contraseña." });
    });
});

app.get("/api/admin/session", function (req, res) {
  if (!ADMIN_JWT_SECRET) {
    res.status(503).json({ ok: false, error: "Auth admin no configurada en servidor." });
    return;
  }
  res.json({ ok: true, authenticated: verifyAdminFromRequest(req) });
});

app.post("/api/admin/logout", function (req, res) {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/"
  });
  res.json({ ok: true });
});

app.get("/api/admin/ping", requireAdminJwt, function (req, res) {
  res.json({ ok: true, status: "authenticated" });
});

app.get("/api/powerbi/pin/session", function (req, res) {
  var val = req.cookies && req.cookies[POWERBI_PIN_COOKIE];
  res.json({ ok: true, unlocked: val === "1" });
});

app.post("/api/powerbi/pin", function (req, res) {
  if (!POWERBI_PIN_HASH) {
    res.status(503).json({ ok: false, error: "PIN de Power BI no configurado en servidor." });
    return;
  }
  var pin = req.body && req.body.pin;
  if (typeof pin !== "string") {
    res.status(400).json({ ok: false, error: "PIN inválido." });
    return;
  }
  pin = pin.trim();
  if (pin.length < 4) {
    res.status(400).json({ ok: false, error: "PIN inválido." });
    return;
  }
  bcrypt
    .compare(pin, POWERBI_PIN_HASH)
    .then(function (ok) {
      if (!ok) {
        res.status(401).json({ ok: false, error: "PIN incorrecto." });
        return;
      }
      res.cookie(POWERBI_PIN_COOKIE, "1", {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: "lax",
        path: "/",
        maxAge: POWERBI_PIN_TTL_MINUTES * 60 * 1000
      });
      res.json({ ok: true, unlocked: true });
    })
    .catch(function () {
      res.status(500).json({ ok: false, error: "No se pudo validar el PIN." });
    });
});

app.post("/api/stats/event", function (req, res) {
  if (isStatsPostRateLimited(req)) {
    res.status(429).json({ ok: false, error: "Demasiadas solicitudes." });
    return;
  }
  var allowed = ["page_view", "module_click", "search_open", "chat_open", "chat_message"];
  var body = req.body || {};
  var event = body.event;
  if (typeof event !== "string" || allowed.indexOf(event) === -1) {
    res.status(422).json({ ok: false, error: "evento inválido" });
    return;
  }
  var appId = body.app_id;
  if (appId != null && typeof appId !== "string") {
    appId = null;
  }
  if (appId && appId.length > 96) {
    appId = appId.slice(0, 96);
  }
  appendUsageEvent({
    t: Date.now(),
    event: event,
    app_id: appId || null,
    visitor_hash: visitorHashNode(req)
  });
  res.json({ ok: true });
});

app.get("/api/admin/stats", requireAdminJwt, function (req, res) {
  var days = parseInt(String(req.query.days || "7"), 10);
  if (isNaN(days) || days < 1) {
    days = 1;
  }
  if (days > 90) {
    days = 90;
  }
  res.json(buildUsageSummary(days));
});

app.post("/api/chat", function (req, res) {
  if (!GEMINI_API_KEY) {
    res.status(503).json({
      error: "GEMINI_API_KEY no está definida. Crea un archivo .env con GEMINI_API_KEY=tu_clave y reinicia el servidor (npm start)."
    });
    return;
  }

  var contents = req.body && req.body.contents;
  if (!Array.isArray(contents)) {
    res.status(400).json({ error: "Se esperaba un array contents." });
    return;
  }

  var modelName = normalizeModelName(GEMINI_MODEL);
  var url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(modelName) +
    ":generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY);

  var body = {
    systemInstruction: {
      parts: [{ text: COLBEEF_CHAT_SYSTEM }]
    },
    contents: contents
  };

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
    .then(function (r) {
      return r.json().then(function (data) {
        res.status(r.status).json(data);
      });
    })
    .catch(function (err) {
      res.status(500).json({
        error: err && err.message ? err.message : String(err)
      });
    });
});

app.use("/admin", requireAdminJwt, express.static(path.join(rootDir, "admin")));
app.use(express.static(rootDir));

app.listen(PORT, function () {
  console.log("WorkColbeef → http://localhost:" + PORT + "/site.html");
  console.log("La API Key de Gemini se lee solo desde .env (no expuesta al navegador).");
  console.log("Modelo Gemini activo → " + normalizeModelName(GEMINI_MODEL));
  console.log("Auth admin activa → " + (ADMIN_PASSWORD_HASH && ADMIN_JWT_SECRET ? "SI" : "NO"));
});
