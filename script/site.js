/**
 * WorkColbeef Suite — Lógica del portal (frontend).
 * =============================================================================
 * Todo el comportamiento del portal vive dentro de una única IIFE para no
 * contaminar el ámbito global. No hay bundler ni módulos ES: es JavaScript ES5
 * plano cargado con <script defer>. El punto de entrada es init() (al final del
 * archivo), que registra cada subsistema con funciones `init*`.
 *
 * Subsistemas principales:
 *   - Ajustes/perfil  → localStorage "suite_settings_v2" (tema, preferencias…)
 *   - Navegación      → sidebar (escritorio), drawer (móvil), mosaico y menú
 *   - Accesos recientes → localStorage/sessionStorage según privacidad
 *   - Acceso admin    → contraseña maestra → JWT en cookie (validado por API)
 *   - PIN Power BI     → validado en servidor (cookie HttpOnly)
 *   - PIN Rendimientos → validado en cliente (ver nota en RENDIMIENTOS_PIN)
 *   - Métricas de uso  → POST /api/stats/event (telemetría no bloqueante)
 *   - Buscador, chat Beef (Gemini) y reporte de bugs/PQR
 *
 * Convención: la telemetría nunca debe interrumpir la navegación; por eso los
 * fetch de estadísticas capturan el error en silencio.
 *
 * @see DOCUMENTACION.md (sección 5.4)
 */
(function () {
  /* v2: ignora caché v1 para no mostrar datos viejos (nombre/cargo) tras cambios de perfil por defecto */
  var SETTINGS_KEY = "suite_settings_v2";

  /** Historial del chat; el prompt del sistema va en el servidor (server.js + .env). */
  var geminiChatHistory = [];
  var hasAdminSession = false;
  var pendingAdminAccessResolver = null;
  var ADMIN_UNLOCKED_KEY = "WorkColbeef_admin_unlocked_v1";

  /** Modelo por defecto (alineado con data/suite-settings-default.json) */
  var DEFAULT_SETTINGS = {
    version: 1,
    cuenta: {
      empleadoId: "",
      nombreCompleto: "WorkColbeef",
      cargo: "ninguno",
      departamento: "santander",
      fotoUrl: null,
      iniciales: "W",
      autenticacionDosPasosActiva: false
    },
    preferencias: {
      paginaInicioPorDefecto: "control-operativo",
      tema: "claro",
      idioma: "es-CO",
      zonaHoraria: "America/Bogota"
    },
    notificaciones: {
      alertasInventario: true,
      actualizacionesLogistica: true,
      avisosSistema: true,
      canalCorreo: true,
      canalApp: true
    },
    privacidad: {
      historialPaginas: "guardar_30_dias"
    }
  };

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== "object") return base;
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(patch).forEach(function (k) {
      var pv = patch[k];
      if (pv && typeof pv === "object" && !Array.isArray(pv) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], pv);
      } else {
        out[k] = pv;
      }
    });
    return out;
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return deepMerge({}, DEFAULT_SETTINGS);
      var parsed = JSON.parse(raw);
      return deepMerge(DEFAULT_SETTINGS, parsed);
    } catch (e) {
      return deepMerge({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettingsModel(model) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(model));
  }

  var RECENT_ACCESS_KEY = "WorkColbeef_recent_access_v1";
  var RECENT_ACCESS_SESSION_KEY = "WorkColbeef_recent_access_session_v1";
  var RECENT_MAX_ITEMS = 8;
  var pendingRecentAccessMeta = null;

  var APP_ID_LABELS = {
    "control-operativo": "Control operativo",
    "gestion-humana": "Gestión humana",
    logistica: "Logística",
    calidad: "Calidad",
    "tesoreria-cartera": "Tesorería y cartera",
    administrativo: "Administrativo",
    "power-bi": "Power BI"
  };

  function getHistorialMode() {
    var s = loadSettings();
    return (s.privacidad && s.privacidad.historialPaginas) || "guardar_30_dias";
  }

  function getRecentStorageBackend() {
    if (getHistorialMode() === "borrar_al_cerrar") {
      try {
        return sessionStorage;
      } catch (e) {
        return localStorage;
      }
    }
    return localStorage;
  }

  function getRecentStorageKey() {
    return getHistorialMode() === "borrar_al_cerrar" ? RECENT_ACCESS_SESSION_KEY : RECENT_ACCESS_KEY;
  }

  function getRecentRetentionMs() {
    var mode = getHistorialMode();
    if (mode === "guardar_7_dias") return 7 * 24 * 60 * 60 * 1000;
    if (mode === "guardar_30_dias") return 30 * 24 * 60 * 60 * 1000;
    return Infinity;
  }

  function buildRecentEntry(label, href, appId, pinType, programId, programLabel) {
    return {
      id: String(href),
      label: String(label || "Módulo").trim(),
      href: String(href),
      appId: appId || "",
      programId: programId || programIdFromHref(href),
      programLabel: programLabel || label || "Módulo",
      pinType: pinType || "",
      ts: Date.now()
    };
  }

  function purgeRecentAccessList(arr) {
    var now = Date.now();
    var retention = getRecentRetentionMs();
    return arr.filter(function (item) {
      if (!item || !item.href || !item.ts) return false;
      if (retention !== Infinity && now - item.ts > retention) return false;
      return true;
    });
  }

  function loadRecentAccessList() {
    try {
      var raw = getRecentStorageBackend().getItem(getRecentStorageKey());
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return purgeRecentAccessList(parsed);
    } catch (e) {
      return [];
    }
  }

  function saveRecentAccessList(arr) {
    try {
      getRecentStorageBackend().setItem(getRecentStorageKey(), JSON.stringify(arr.slice(0, RECENT_MAX_ITEMS)));
    } catch (e) {}
  }

  /**
   * Inserta un acceso al inicio de la lista de "recientes" (patrón MRU).
   *
   * Deduplica por id/href (si ya existía, sube al tope), recorta a
   * RECENT_MAX_ITEMS y re-renderiza. El backend de almacenamiento
   * (localStorage vs sessionStorage) lo decide la preferencia de privacidad.
   *
   * @param {{id?:string,label?:string,href:string,appId?:string,programId?:string,programLabel?:string,pinType?:string}} entry
   */
  function recordRecentAccess(entry) {
    if (!entry || !entry.href) return;
    var list = loadRecentAccessList();
    var id = entry.id || entry.href;
    list = list.filter(function (x) {
      return x.id !== id;
    });
    list.unshift({
      id: id,
      label: entry.label || "Módulo",
      href: entry.href,
      appId: entry.appId || "",
      programId: entry.programId || programIdFromHref(entry.href),
      programLabel: entry.programLabel || entry.label || "Módulo",
      pinType: entry.pinType || "",
      ts: Date.now()
    });
    saveRecentAccessList(list.slice(0, RECENT_MAX_ITEMS));
    renderRecentAccess();
  }

  function formatRecentTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return "Hace un momento";
    if (diff < 3600000) return "Hace " + Math.max(1, Math.floor(diff / 60000)) + " min";
    if (diff < 86400000) return "Hace " + Math.max(1, Math.floor(diff / 3600000)) + " h";
    if (diff < 172800000) return "Ayer";
    if (diff < 604800000) return "Hace " + Math.floor(diff / 86400000) + " días";
    try {
      return new Date(ts).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
    } catch (e) {
      return "Antes";
    }
  }

  function renderRecentAccess() {
    var section = document.getElementById("recentAccessSection");
    var listEl = document.getElementById("recentAccessList");
    var emptyEl = document.getElementById("recentAccessEmpty");
    var clearBtn = document.getElementById("recentAccessClearBtn");
    if (!listEl || !emptyEl) return;

    var items = loadRecentAccessList();
    listEl.textContent = "";

    if (!items.length) {
      if (section) section.hidden = true;
      emptyEl.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      return;
    }

    if (section) section.hidden = false;
    emptyEl.hidden = true;
    if (clearBtn) clearBtn.hidden = false;

    items.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "historyItem historyItem--action";
      btn.setAttribute("role", "listitem");
      btn.setAttribute("data-href", item.href);
      btn.setAttribute("data-app-id", item.appId || "");
      btn.setAttribute("data-pin-type", item.pinType || "");

      var main = document.createElement("span");
      main.className = "historyItemMain";

      var moduleLabel = APP_ID_LABELS[item.appId] || "";
      if (moduleLabel) {
        var mod = document.createElement("span");
        mod.className = "historyItemModule";
        mod.textContent = moduleLabel;
        main.appendChild(mod);
      }

      var name = document.createElement("span");
      name.className = "historyItemName";
      name.textContent = item.label;
      main.appendChild(name);

      var time = document.createElement("span");
      time.className = "historyItemTime";
      time.textContent = formatRecentTime(item.ts);

      btn.appendChild(main);
      btn.appendChild(time);
      btn.addEventListener("click", function () {
        openRecentAccessItem(item);
      });
      listEl.appendChild(btn);
    });
  }

  function openRecentAccessItem(item) {
    if (!item || !item.href) return;
    if (item.appId) {
      sendUsageEvent("module_click", item.appId);
      setActiveMenuByAppId(item.appId);
    }
    closeSettingsView();
    navigateToModule(item.href, {
      label: item.label,
      appId: item.appId,
        programId: item.programId || programIdFromHref(item.href),
        programLabel: item.programLabel || item.label,
      pinType: item.pinType,
      skipRecord: true
    });
  }

  function clearRecentAccess() {
    try {
      getRecentStorageBackend().removeItem(getRecentStorageKey());
    } catch (e) {}
    renderRecentAccess();
  }

  /**
   * Punto único de navegación hacia un programa externo.
   *
   * Centraliza tres responsabilidades para que cada tarjeta/enlace no las repita:
   *   1) Interceptar los flujos de PIN (Power BI en servidor, Rendimientos en cliente).
   *   2) Registrar el acceso reciente (salvo meta.skipRecord).
   *   3) Emitir la métrica "module_click" antes de abrir el destino.
   *
   * Valida que href sea http(s) para evitar navegar a esquemas inseguros.
   *
   * @param {string} href URL absoluta del programa.
   * @param {{label?:string,appId?:string,programId?:string,programLabel?:string,pinType?:string,skipRecord?:boolean}} [meta]
   */
  function navigateToModule(href, meta) {
    if (!href || !/^https?:\/\//i.test(String(href))) return;
    meta = meta || {};

    if (meta.pinType === "powerbi") {
      requirePowerBiPinThenOpen(href, meta);
      return;
    }
    if (meta.pinType === "rendimientos") {
      requireRendimientosPinThenOpen(href, meta);
      return;
    }

    if (!meta.skipRecord) {
      recordRecentAccess(buildRecentEntry(meta.label, href, meta.appId, "", meta.programId, meta.programLabel));
    }
    sendUsageEvent("module_click", meta.appId, meta);
    window.location.href = href;
  }

  /**
   * Construye el objeto `meta` de un enlace de programa a partir del DOM.
   *
   * Deriva una etiqueta legible ("Módulo · Programa"), el identificador de
   * programa desde la URL y el tipo de PIN requerido (data-requires-pin o, por
   * convención, "powerbi" para todo el módulo Power BI). Así navigateToModule()
   * recibe siempre la misma forma sin importar de qué tarjeta venga el clic.
   *
   * @param {HTMLAnchorElement} el Enlace del programa.
   * @param {string} appId Id del módulo contenedor.
   * @returns {{label:string,appId:string,programId:string,programLabel:string,pinType:string}}
   */
  function moduleMetaFromLink(el, appId) {
    var label = (el.textContent || "").replace(/\s+/g, " ").trim();
    var tile = el.closest(".moduleTile");
    var tileName = tile && tile.querySelector(".moduleTileName");
    var moduleName = tileName ? tileName.textContent.trim() : APP_ID_LABELS[appId] || "";
    if (moduleName && label && label !== moduleName) {
      label = moduleName + " · " + label;
    } else if (!label && moduleName) {
      label = moduleName;
    }
    return {
      label: label || moduleName || "Módulo",
      appId: appId || (tile && tile.getAttribute("data-app-id")) || "",
      programId: programIdFromHref(el.getAttribute("href") || label),
      programLabel: label || moduleName || "Módulo",
      pinType: el.getAttribute("data-requires-pin") === "rendimientos" ? "rendimientos" : appId === "power-bi" ? "powerbi" : ""
    };
  }

  function initRecentAccess() {
    renderRecentAccess();
    var clearBtn = document.getElementById("recentAccessClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        clearRecentAccess();
      });
    }
  }

  function applyTheme(tema) {
    document.body.setAttribute("data-suite-theme", tema === "oscuro" ? "oscuro" : "claro");
  }

  function applySettingsToUI(model) {
    var c = model.cuenta || {};
    var nombre = document.getElementById("settingsNombreCompleto");
    var cargo = document.getElementById("settingsCargo");
    var dep = document.getElementById("settingsDepartamento");
    var avatar = document.getElementById("settingsProfileAvatar");
    if (nombre) nombre.textContent = c.nombreCompleto || "";
    if (cargo) cargo.textContent = c.cargo || "";
    if (dep) dep.textContent = c.departamento || "";
    if (avatar) {
      var ini = (c.iniciales || "").trim();
      if (!ini) {
        var nom = (c.nombreCompleto || "").trim();
        if (nom.length >= 2) ini = nom.slice(0, 2).toUpperCase();
        else if (nom.length === 1) ini = nom.toUpperCase();
        else ini = "C";
      }
      avatar.textContent = ini;
    }

    var p = model.preferencias || {};
    var elPag = document.getElementById("prefPaginaInicio");
    var elTema = document.getElementById("prefTema");
    var elIdi = document.getElementById("prefIdioma");
    var elZ = document.getElementById("prefZona");
    if (elPag) elPag.value = p.paginaInicioPorDefecto || "control-operativo";
    if (elTema) elTema.value = p.tema === "oscuro" ? "oscuro" : "claro";
    if (elIdi) elIdi.value = p.idioma || "es-CO";
    if (elZ) elZ.value = p.zonaHoraria || "America/Bogota";
    applyTheme(p.tema);

    var n = model.notificaciones || {};
    function setSw(id, on) {
      var el = document.getElementById(id);
      if (!el) return;
      el.checked = !!on;
      el.setAttribute("aria-checked", on ? "true" : "false");
    }
    setSw("notifInventario", n.alertasInventario);
    setSw("notifLogistica", n.actualizacionesLogistica);
    setSw("notifSistema", n.avisosSistema);
    var ce = document.getElementById("canalEmail");
    var ca = document.getElementById("canalApp");
    if (ce) ce.checked = !!n.canalCorreo;
    if (ca) ca.checked = !!n.canalApp;

    var priv = model.privacidad || {};
    var elH = document.getElementById("privHistorial");
    if (elH) elH.value = priv.historialPaginas || "guardar_30_dias";
  }

  function collectSettingsFromUI() {
    var base = loadSettings();
    var c = base.cuenta || {};
    var p = base.preferencias || {};
    var n = base.notificaciones || {};
    var priv = base.privacidad || {};

    var elTema = document.getElementById("prefTema");
    var elPag = document.getElementById("prefPaginaInicio");
    var elIdi = document.getElementById("prefIdioma");
    var elZ = document.getElementById("prefZona");
    p.tema = elTema && elTema.value === "oscuro" ? "oscuro" : "claro";
    p.paginaInicioPorDefecto = elPag ? elPag.value : p.paginaInicioPorDefecto;
    p.idioma = elIdi ? elIdi.value : p.idioma;
    p.zonaHoraria = elZ ? elZ.value : p.zonaHoraria;

    function getSw(id) {
      var el = document.getElementById(id);
      return el ? !!el.checked : false;
    }
    n.alertasInventario = getSw("notifInventario");
    n.actualizacionesLogistica = getSw("notifLogistica");
    n.avisosSistema = getSw("notifSistema");
    var ce = document.getElementById("canalEmail");
    var ca = document.getElementById("canalApp");
    n.canalCorreo = ce ? !!ce.checked : n.canalCorreo;
    n.canalApp = ca ? !!ca.checked : n.canalApp;

    var elH = document.getElementById("privHistorial");
    priv.historialPaginas = elH ? elH.value : priv.historialPaginas;

    return {
      version: base.version || DEFAULT_SETTINGS.version,
      cuenta: c,
      preferencias: p,
      notificaciones: n,
      privacidad: priv
    };
  }

  function setActiveMenuByAppId(appId) {
    var links = Array.prototype.slice.call(document.querySelectorAll(".menuItem"));
    links.forEach(function (x) {
      x.classList.toggle("active", x.getAttribute("data-app-id") === appId);
    });
  }

  function showView(which) {
    var home = document.getElementById("viewHome");
    var settings = document.getElementById("viewSettings");
    var backBtn = document.getElementById("backFromSettingsBtn");
    if (which === "settings") {
      if (home) {
        home.classList.remove("mainView--active");
        home.hidden = true;
      }
      if (settings) {
        settings.hidden = false;
        settings.classList.add("mainView--active");
      }
      if (backBtn) backBtn.hidden = false;
    } else {
      if (settings) {
        settings.hidden = true;
        settings.classList.remove("mainView--active");
      }
      if (home) {
        home.hidden = false;
        home.classList.add("mainView--active");
      }
      if (backBtn) backBtn.hidden = true;
    }
  }

  function openSettingsView() {
    applySettingsToUI(loadSettings());
    activateSettingsTab("cuenta");
    showView("settings");
  }

  function closeSettingsView() {
    showView("home");
  }

  function setAdminAccessError(msg) {
    var err = document.getElementById("adminAccessError");
    if (!err) return;
    var hasMsg = !!(msg && String(msg).trim());
    err.hidden = !hasMsg;
    err.textContent = hasMsg ? String(msg) : "";
  }

  function openAdminAccessModal() {
    closeSearchModal();
    closeFeedbackModal();
    var modal = document.getElementById("adminAccessModal");
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setAdminAccessError("");
    var pwd = document.getElementById("adminAccessPassword");
    if (pwd) {
      pwd.value = "";
      pwd.focus();
    }
  }

  function closeAdminAccessModal() {
    var modal = document.getElementById("adminAccessModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setAdminAccessError("");
  }

  function resolvePendingAdminAccess(ok) {
    if (!pendingAdminAccessResolver) return;
    pendingAdminAccessResolver(!!ok);
    pendingAdminAccessResolver = null;
  }

  function checkAdminSession() {
    return fetch("/api/admin/session", {
      method: "GET",
      credentials: "include"
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) return false;
          return !!(data && data.authenticated);
        });
      })
      .catch(function () {
        return false;
      });
  }

  function requestAdminAccess() {
    if (hasAdminSession) return Promise.resolve(true);
    // Requiere contraseña por pestaña: solo recuerda en sessionStorage.
    // Si cierras el navegador/la pestaña (sales del programa), vuelve a pedirla.
    try {
      if (sessionStorage.getItem(ADMIN_UNLOCKED_KEY) === "1") {
        hasAdminSession = true;
        return Promise.resolve(true);
      }
    } catch (e) {}

    if (pendingAdminAccessResolver) return Promise.resolve(false);
    openAdminAccessModal();
    return new Promise(function (resolve) {
      pendingAdminAccessResolver = resolve;
    });
  }

  function activateSettingsTab(tabId) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".settingsTab"));
    var panels = Array.prototype.slice.call(document.querySelectorAll(".settingsPanel"));
    tabs.forEach(function (btn) {
      var id = btn.getAttribute("data-tab");
      var active = id === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(function (panel) {
      var pid = panel.id.replace("panel-", "");
      var active = pid === tabId;
      panel.classList.toggle("is-visible", active);
      panel.hidden = !active;
    });
    if (tabId === "estadisticas") {
      loadUsageStats();
    }
    if (tabId === "bugs") {
      loadBugAdminStats();
    }
  }

  function initSettingsTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".settingsTab"));
    tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-tab");
        if (id) activateSettingsTab(id);
      });
    });
  }

  function initToggleAria() {
    var ids = ["notifInventario", "notifLogistica", "notifSistema"];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        el.setAttribute("aria-checked", el.checked ? "true" : "false");
      });
    });
  }

  function initSettingsOpen() {
    var btn = document.getElementById("settingsOpenBtn");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      requestAdminAccess().then(function (ok) {
        if (ok) openSettingsView();
      });
    });
  }

  function initAdminAccessModal() {
    var modal = document.getElementById("adminAccessModal");
    var form = document.getElementById("adminAccessForm");
    var backdrop = document.getElementById("adminAccessBackdrop");
    var closeBtn = document.getElementById("adminAccessClose");
    var cancelBtn = document.getElementById("adminAccessCancel");
    var submitBtn = document.getElementById("adminAccessSubmit");
    var pwd = document.getElementById("adminAccessPassword");
    if (!modal || !form) return;

    function cancelFlow() {
      closeAdminAccessModal();
      resolvePendingAdminAccess(false);
    }

    if (backdrop) backdrop.addEventListener("click", cancelFlow);
    if (closeBtn) closeBtn.addEventListener("click", cancelFlow);
    if (cancelBtn) cancelBtn.addEventListener("click", cancelFlow);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var password = ((pwd && pwd.value) || "").trim();
      if (!password) {
        setAdminAccessError("Ingresa la contraseña maestra.");
        return;
      }
      setAdminAccessError("");
      if (submitBtn) submitBtn.disabled = true;
      if (pwd) pwd.disabled = true;

      fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: password })
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (out) {
          var res = out.res;
          var data = out.data;
          if (!res.ok) {
            setAdminAccessError((data && data.error) || "No se pudo validar el acceso.");
            return;
          }
          hasAdminSession = true;
          try { sessionStorage.setItem(ADMIN_UNLOCKED_KEY, "1"); } catch (e) {}
          closeAdminAccessModal();
          resolvePendingAdminAccess(true);
        })
        .catch(function () {
          setAdminAccessError("Error de conexión con el servidor.");
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
          if (pwd) {
            pwd.disabled = false;
            pwd.focus();
          }
        });
    });
  }

  // --- PIN para Power BI (privacidad) ---
  var powerBiPinOk = false;
  var pendingPowerBiHref = null;
  /**
   * PIN de Rendimientos validado EN CLIENTE.
   * ponytail: es una barrera de conveniencia, no de seguridad — el valor es
   * visible en el fuente. Ceiling conocido: no protege el acceso directo a la
   * URL. Upgrade path: replicar el flujo de Power BI (validación en servidor
   * con hash bcrypt + cookie HttpOnly) si se requiere protección real.
   */
  var RENDIMIENTOS_PIN = "250626";

  function setPowerBiPinError(msg) {
    var err = document.getElementById("powerBiPinError");
    if (!err) return;
    var hasMsg = !!(msg && String(msg).trim());
    err.hidden = !hasMsg;
    err.textContent = hasMsg ? String(msg) : "";
  }

  function openPowerBiPinModal() {
    closeSearchModal();
    closeFeedbackModal();
    var modal = document.getElementById("powerBiPinModal");
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setPowerBiPinError("");
    var inp = document.getElementById("powerBiPinInput");
    if (inp) {
      inp.value = "";
      inp.focus();
    }
  }

  function closePowerBiPinModal() {
    var modal = document.getElementById("powerBiPinModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setPowerBiPinError("");
    pendingPowerBiHref = null;
    pendingRecentAccessMeta = null;
  }

  /**
   * Difiere la apertura de un informe Power BI hasta validar el PIN en servidor.
   * Guarda el destino y su meta, y abre el modal; la validación real y la
   * navegación ocurren al enviar el formulario (initPowerBiPinModal).
   *
   * @param {string} href URL del informe Power BI.
   * @param {object} [meta] Metadatos para telemetría y accesos recientes.
   */
  function requirePowerBiPinThenOpen(href, meta) {
    if (!href || !/^https?:\/\//i.test(String(href))) return;
    pendingPowerBiHref = href;
    pendingRecentAccessMeta = meta || null;
    openPowerBiPinModal();
  }

  /**
   * Solicita el PIN de Rendimientos (validación en cliente) y, si es correcto,
   * registra la métrica/acceso reciente y navega. Ver nota de RENDIMIENTOS_PIN
   * sobre la limitación de seguridad de este flujo.
   *
   * @param {string} href URL de Rendimientos.
   * @param {object} [meta] Metadatos opcionales.
   */
  function requireRendimientosPinThenOpen(href, meta) {
    if (!href || !/^https?:\/\//i.test(String(href))) return;
    var pin = window.prompt("Ingresa el PIN para abrir Rendimientos:");
    if (pin === null) return;
    if (String(pin).trim() !== RENDIMIENTOS_PIN) {
      window.alert("PIN incorrecto.");
      return;
    }
    closeSettingsView();
    setActiveMenuByAppId("logistica");
    meta = meta || { label: "Logística · Rendimientos", appId: "logistica", pinType: "rendimientos" };
    meta.programId = meta.programId || programIdFromHref(href);
    meta.programLabel = meta.programLabel || meta.label;
    sendUsageEvent("module_click", "logistica", meta);
    recordRecentAccess(buildRecentEntry(meta.label, href, meta.appId, "rendimientos", meta.programId, meta.programLabel));
    window.location.href = href;
  }

  function initPowerBiPinModal() {
    var modal = document.getElementById("powerBiPinModal");
    var form = document.getElementById("powerBiPinForm");
    var backdrop = document.getElementById("powerBiPinBackdrop");
    var closeBtn = document.getElementById("powerBiPinClose");
    var cancelBtn = document.getElementById("powerBiPinCancel");
    var submitBtn = document.getElementById("powerBiPinSubmit");
    var inp = document.getElementById("powerBiPinInput");
    if (!modal || !form) return;

    function cancelFlow() {
      closePowerBiPinModal();
    }

    if (backdrop) backdrop.addEventListener("click", cancelFlow);
    if (closeBtn) closeBtn.addEventListener("click", cancelFlow);
    if (cancelBtn) cancelBtn.addEventListener("click", cancelFlow);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pin = ((inp && inp.value) || "").trim();
      if (!pin) {
        setPowerBiPinError("Ingresa el PIN.");
        return;
      }
      setPowerBiPinError("");
      if (submitBtn) submitBtn.disabled = true;
      if (inp) inp.disabled = true;

      fetch("/api/powerbi/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin: pin })
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (out) {
          var res = out.res;
          var data = out.data;
          if (!res.ok) {
            setPowerBiPinError((data && data.error) || "PIN incorrecto.");
            return;
          }
          powerBiPinOk = true;
          var href = pendingPowerBiHref;
          var meta = pendingRecentAccessMeta;
          closePowerBiPinModal();
          if (href) {
            if (meta) {
              meta.programId = meta.programId || programIdFromHref(href);
              meta.programLabel = meta.programLabel || meta.label;
              sendUsageEvent("module_click", "power-bi", meta);
              recordRecentAccess(buildRecentEntry(meta.label, href, meta.appId, "powerbi", meta.programId, meta.programLabel));
            } else {
              sendUsageEvent("module_click", "power-bi", { programId: programIdFromHref(href), programLabel: "Power BI" });
              recordRecentAccess(buildRecentEntry("Power BI", href, "power-bi", "powerbi", programIdFromHref(href), "Power BI"));
            }
            window.location.href = href;
          }
        })
        .catch(function () {
          setPowerBiPinError("Error de conexión con el servidor.");
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
          if (inp) {
            inp.disabled = false;
            inp.focus();
          }
        });
    });
  }

  function initBackFromSettings() {
    var b = document.getElementById("backFromSettingsBtn");
    if (!b) return;
    b.addEventListener("click", function () {
      closeSettingsView();
    });
  }

  function persistSettingsFromUI() {
    var model = collectSettingsFromUI();
    saveSettingsModel(model);
    applyTheme(model.preferencias && model.preferencias.tema);
    renderRecentAccess();
  }

  /** Sin botón Guardar: preferencias, notificaciones y privacidad se guardan al cambiar. */
  function initSettingsAutoSave() {
    var selects = ["prefPaginaInicio", "prefTema", "prefIdioma", "prefZona", "privHistorial"];
    selects.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        persistSettingsFromUI();
      });
    });
    ["notifInventario", "notifLogistica", "notifSistema", "canalEmail", "canalApp"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        persistSettingsFromUI();
      });
    });
  }

  /**
   * Convierte una URL en un identificador de programa estable y seguro para
   * usar como clave de métricas (slug). Ej: "http://192.168.20.205:8004/login"
   * → "192-168-20-205-8004-login". Recorta a 160 chars (límite de la columna).
   *
   * @param {string} href
   * @returns {string} Slug del programa.
   */
  function programIdFromHref(href) {
    return String(href || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160);
  }

  /**
   * Envía un evento de telemetría a /api/stats/event (fire-and-forget).
   *
   * Es intencionalmente no bloqueante: cualquier error de red se ignora para
   * que la recolección de métricas jamás afecte la navegación del usuario.
   * program_id/program_label solo los persiste el backend Laravel.
   *
   * @param {"page_view"|"module_click"|"search_open"|"chat_open"|"chat_message"} event
   * @param {string} [appId] Id del módulo.
   * @param {{programId?:string,programLabel?:string}} [meta]
   */
  function sendUsageEvent(event, appId, meta) {
    var payload = { event: event };
    if (appId) {
      payload.app_id = String(appId);
    }
    meta = meta || {};
    if (meta.programId) {
      payload.program_id = String(meta.programId);
    }
    if (meta.programLabel) {
      payload.program_label = String(meta.programLabel);
    }
    fetch("/api/stats/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  function recordPageViewOnce() {
    try {
      if (sessionStorage.getItem("WorkColbeef_usage_pv") === "1") {
        return;
      }
      sessionStorage.setItem("WorkColbeef_usage_pv", "1");
    } catch (e) {
      return;
    }
    sendUsageEvent("page_view");
  }

  function escapeForUsageHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function loadUsageStats() {
    var root = document.getElementById("usageStatsRoot");
    var daysEl = document.getElementById("usageStatsDays");
    if (!root) {
      return;
    }
    var days = daysEl ? parseInt(daysEl.value, 10) || 30 : 30;
    root.innerHTML = '<p class="usageStatsPlaceholder">Cargando…</p>';

    fetch("/api/admin/stats?days=" + encodeURIComponent(String(days)), {
      credentials: "include"
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (out) {
        var res = out.res;
        var data = out.data;
        if (!res.ok || !data || data.ok === false) {
          var msg =
            (data && data.error) ||
            (res.status === 401 ? "Inicia con la contraseña maestra en Ajustes." : "No se pudieron cargar las estadísticas.");
          root.innerHTML = '<p class="usageStatsErr">' + escapeForUsageHtml(msg) + "</p>";
          return;
        }
        renderUsageStats(data);
      })
      .catch(function () {
        root.innerHTML =
          '<p class="usageStatsErr">Sin conexión al servidor o falta migrar la base en Laravel (<code>php artisan migrate</code>).</p>';
      });
  }

  function renderUsageStats(data) {
    var root = document.getElementById("usageStatsRoot");
    if (!root) {
      return;
    }
    root.textContent = "";

    var totals = data.totals || {};
    var order = [
      ["page_view", "Visitas al portal"],
      ["module_click", "Aperturas de módulos"],
      ["search_open", "Búsquedas abiertas"],
      ["chat_open", "Aperturas del chat"],
      ["chat_message", "Mensajes al asistente"]
    ];

    var intro = document.createElement("p");
    intro.className = "usageStatsPlaceholder";
    var u = data.unique_visitors_estimate;
    intro.textContent =
      "Período: " +
      (data.days || "—") +
      " día(s). Visitantes únicos (estimado): " +
      (u != null ? String(u) : "—");
    root.appendChild(intro);

    var grid = document.createElement("div");
    grid.className = "usageStatsSummary";
    order.forEach(function (pair) {
      var key = pair[0];
      var label = pair[1];
      var pill = document.createElement("div");
      pill.className = "usageStatPill";
      var strong = document.createElement("strong");
      strong.textContent = String(totals[key] != null ? totals[key] : 0);
      var span = document.createElement("span");
      span.textContent = label;
      pill.appendChild(strong);
      pill.appendChild(span);
      grid.appendChild(pill);
    });
    root.appendChild(grid);

    var byApp = Array.isArray(data.by_app) ? data.by_app : [];
    if (byApp.length) {
      var sub = document.createElement("h4");
      sub.className = "usageStatsSubTitle";
      sub.textContent = "Uso por módulo principal";
      root.appendChild(sub);
      var maxC = 0;
      byApp.forEach(function (row) {
        if (row.clicks > maxC) {
          maxC = row.clicks;
        }
      });
      if (maxC < 1) {
        maxC = 1;
      }
      var list = document.createElement("div");
      list.className = "usageBarList";
      byApp.forEach(function (row) {
        var rowEl = document.createElement("div");
        rowEl.className = "usageBarRow";
        var name = document.createElement("span");
        name.textContent = row.label || row.app_id || "";
        var count = document.createElement("span");
        count.className = "usageBarCount";
        count.textContent = String(row.clicks != null ? row.clicks : 0);
        var track = document.createElement("div");
        track.className = "usageBarTrack";
        var fill = document.createElement("div");
        fill.className = "usageBarFill";
        var pct = (row.clicks / maxC) * 100;
        fill.style.width = pct + "%";
        track.appendChild(fill);
        rowEl.appendChild(name);
        rowEl.appendChild(count);
        rowEl.appendChild(track);
        list.appendChild(rowEl);
      });
      root.appendChild(list);
    }

    var byProgram = Array.isArray(data.by_program) ? data.by_program : [];
    if (byProgram.length) {
      var psub = document.createElement("h4");
      psub.className = "usageStatsSubTitle";
      psub.textContent = "Uso por programa / acceso específico";
      root.appendChild(psub);

      var maxProgram = 1;
      byProgram.forEach(function (row) {
        if (row.clicks > maxProgram) maxProgram = row.clicks;
      });

      var programList = document.createElement("div");
      programList.className = "usageBarList";
      byProgram.forEach(function (row) {
        var rowEl = document.createElement("div");
        rowEl.className = "usageBarRow";
        var name = document.createElement("span");
        name.textContent =
          (row.module_label ? row.module_label + " · " : "") +
          (row.label || row.program_id || "");
        var count = document.createElement("span");
        count.className = "usageBarCount";
        count.textContent = String(row.clicks != null ? row.clicks : 0) + " uso(s)";
        var track = document.createElement("div");
        track.className = "usageBarTrack";
        var fill = document.createElement("div");
        fill.className = "usageBarFill";
        fill.style.width = ((row.clicks / maxProgram) * 100) + "%";
        track.appendChild(fill);
        rowEl.appendChild(name);
        rowEl.appendChild(count);
        rowEl.appendChild(track);
        programList.appendChild(rowEl);
      });
      root.appendChild(programList);
    }

    var daily = Array.isArray(data.daily) ? data.daily : [];
    if (daily.length) {
      var dsub = document.createElement("h4");
      dsub.className = "usageStatsSubTitle";
      dsub.textContent = "Actividad por día";
      root.appendChild(dsub);
      var ul = document.createElement("ul");
      ul.className = "usageDailyList";
      daily.slice(-14).forEach(function (d) {
        var li = document.createElement("li");
        li.textContent = (d.date || "—") + ": " + (d.events != null ? d.events : 0) + " evento(s)";
        ul.appendChild(li);
      });
      root.appendChild(ul);
    }
  }

  function initUsageStatsPeriod() {
    var sel = document.getElementById("usageStatsDays");
    if (!sel) {
      return;
    }
    sel.addEventListener("change", function () {
      loadUsageStats();
    });
  }

  function formatBugReportDateTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) {
        return String(iso || "—");
      }
      return d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return "—";
    }
  }

  function loadBugAdminStats() {
    var root = document.getElementById("bugStatsRoot");
    var daysEl = document.getElementById("bugStatsDays");
    if (!root) {
      return;
    }
    var days = daysEl ? parseInt(daysEl.value, 10) || 30 : 30;
    root.innerHTML = '<p class="usageStatsPlaceholder">Cargando…</p>';

    fetch("/api/admin/bugs/summary?days=" + encodeURIComponent(String(days)), {
      credentials: "include"
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (out) {
        var res = out.res;
        var data = out.data;
        if (!res.ok || !data || data.ok === false) {
          var msg =
            (data && data.error) ||
            (res.status === 401 ? "Inicia con la contraseña maestra en Ajustes." : "No se pudieron cargar los bugs.");
          root.innerHTML = '<p class="usageStatsErr">' + escapeForUsageHtml(msg) + "</p>";
          return;
        }
        renderBugAdminStats(data);
      })
      .catch(function () {
        root.innerHTML =
          '<p class="usageStatsErr">Sin conexión o falta migrar la base (<code>php artisan migrate</code>).</p>';
      });
  }

  function renderBugAdminStats(data) {
    var root = document.getElementById("bugStatsRoot");
    if (!root) {
      return;
    }
    root.textContent = "";

    var totals = data.totals || {};
    var intro = document.createElement("p");
    intro.className = "usageStatsPlaceholder";
    intro.textContent =
      "Período: " +
      (data.days || "—") +
      " día(s). Reportados en período: " +
      (totals.reported_in_period != null ? totals.reported_in_period : "—") +
      " | Abiertos ahora (todos): " +
      (totals.open_global != null ? totals.open_global : "—") +
      " | Resueltos en período: " +
      (totals.resolved_in_period != null ? totals.resolved_in_period : "—") +
      " | Tiempo medio hasta resolver: " +
      (data.avg_resolution_hours != null ? data.avg_resolution_hours + " h" : "— (sin resueltos en el período)");
    root.appendChild(intro);

    var bySoft = Array.isArray(data.by_software) ? data.by_software : [];
    var sub = document.createElement("h4");
    sub.className = "usageStatsSubTitle";
    sub.textContent = "Casos por software (creados en el período)";
    root.appendChild(sub);
    var grid = document.createElement("div");
    grid.className = "usageStatsSummary";
    bySoft.forEach(function (row) {
      if (!row.total) {
        return;
      }
      var pill = document.createElement("div");
      pill.className = "usageStatPill";
      var strong = document.createElement("strong");
      strong.textContent = String(row.total);
      var span = document.createElement("span");
      span.textContent = row.label || row.software;
      pill.appendChild(strong);
      pill.appendChild(span);
      grid.appendChild(pill);
    });
    if (grid.childNodes.length) {
      root.appendChild(grid);
    }

    var recent = Array.isArray(data.recent) ? data.recent : [];
    var h4 = document.createElement("h4");
    h4.className = "usageStatsSubTitle";
    h4.textContent = "Casos recientes";
    root.appendChild(h4);
    if (!recent.length) {
      var p = document.createElement("p");
      p.className = "usageStatsPlaceholder";
      p.textContent = "No hay casos en este período.";
      root.appendChild(p);
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "bugStatsTableWrap";
    var table = document.createElement("table");
    table.className = "bugStatsTable";
    var thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>ID</th><th>Software</th><th>Tema</th><th>Fecha petición</th><th>Estado</th><th>Resuelto / acción</th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    recent.forEach(function (r) {
      var tr = document.createElement("tr");
      var tdId = document.createElement("td");
      var code = document.createElement("code");
      code.textContent = r.ticket_code || "";
      tdId.appendChild(code);
      tr.appendChild(tdId);
      var tdSoft = document.createElement("td");
      tdSoft.textContent = r.software_label || r.software || "";
      tr.appendChild(tdSoft);
      var tdTema = document.createElement("td");
      tdTema.textContent = (r.tema || "") + (r.detalle ? " — " + r.detalle : "");
      tr.appendChild(tdTema);
      var tdWhen = document.createElement("td");
      tdWhen.textContent = formatBugReportDateTime(r.created_at);
      tr.appendChild(tdWhen);
      var tdSt = document.createElement("td");
      tdSt.textContent = r.status === "resolved" ? "Resuelto" : "Abierto";
      tr.appendChild(tdSt);
      var tdAct = document.createElement("td");
      if (r.status !== "resolved") {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bugResolveBtn";
        btn.textContent = "Marcar resuelto";
        btn.setAttribute("data-bug-resolve-id", String(r.id));
        tdAct.appendChild(btn);
      } else {
        tdAct.textContent = formatBugReportDateTime(r.resolved_at);
      }
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);
  }

  function initBugStatsPeriod() {
    var sel = document.getElementById("bugStatsDays");
    if (!sel) {
      return;
    }
    sel.addEventListener("change", function () {
      loadBugAdminStats();
    });
  }

  function initBugStatsResolveDelegation() {
    var root = document.getElementById("bugStatsRoot");
    if (!root || root.getAttribute("data-bug-delegation") === "1") {
      return;
    }
    root.setAttribute("data-bug-delegation", "1");
    root.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) {
        return;
      }
      var id = t.getAttribute("data-bug-resolve-id");
      if (!id) {
        return;
      }
      t.disabled = true;
      fetch("/api/admin/bugs/" + encodeURIComponent(id) + "/resolve", {
        method: "PATCH",
        credentials: "include",
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (out) {
          if (!out.res.ok || !out.data || out.data.ok === false) {
            window.alert((out.data && out.data.error) || "No se pudo actualizar.");
            t.disabled = false;
            return;
          }
          loadBugAdminStats();
        })
        .catch(function () {
          window.alert("Error de red.");
          t.disabled = false;
        });
    });
  }

  var FEEDBACK_EMAIL = "desarrollo.tecnologia@colbeef.com";
  var lastBugMailtoPayload = null;
  var DETALLES_POR_TEMA = {
    "Error o fallo": ["Pantalla en blanco", "Mensaje de error visible", "No carga un módulo", "Comportamiento inesperado", "Otro"],
    "Rendimiento o lentitud": ["Carga lenta en general", "Solo un módulo lento", "Timeout o cierre de sesión", "Otro"],
    "Sugerencia de mejora": ["Interfaz", "Nuevo reporte o dato", "Flujo de trabajo", "Otro"],
    "Acceso o sesión": ["No puedo iniciar sesión", "Sesión se cierra sola", "Permisos o roles", "Otro"],
    "Otro": ["Describir en el cuadro de abajo"]
  };

  function fillFeedbackDetalleOptions(tema) {
    var sel = document.getElementById("feedbackDetalle");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccionar detalles del tema</option>';
    var arr = DETALLES_POR_TEMA[tema];
    if (!arr || !tema) {
      sel.disabled = true;
      return;
    }
    arr.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      sel.appendChild(o);
    });
    sel.disabled = false;
  }

  function openSearchModal() {
    sendUsageEvent("search_open");
    closeFeedbackModal();
    var modal = document.getElementById("searchModal");
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var inp = document.getElementById("searchModalInput");
    if (inp) {
      inp.value = "";
      inp.focus();
    }
    filterSearchResults();
  }

  function normalizeSearchText(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function filterSearchResults() {
    var list = document.getElementById("searchModalRecentList");
    var input = document.getElementById("searchModalInput");
    var live = document.getElementById("searchModalLive");
    var emptyEl = document.getElementById("searchModalEmpty");
    if (!list || !input) return;
    var q = normalizeSearchText(input.value.trim());
    var items = list.querySelectorAll(".searchModal-item");
    var visible = 0;
    items.forEach(function (li) {
      var anchors = li.querySelectorAll("a.searchModal-link");
      var heading = li.querySelector(".searchModal-powerBiHeading, .searchModal-logisticaHeading, .searchModal-gestionHumanaHeading");
      var headingText = heading ? normalizeSearchText(heading.textContent) : "";
      if (!anchors.length) return;
      var match = !q;
      if (q) {
        match = false;
        if (headingText && headingText.indexOf(q) !== -1) match = true;
        anchors.forEach(function (a) {
          var label = normalizeSearchText(a.textContent);
          var extra = normalizeSearchText(a.getAttribute("data-search") || "");
          if (label.indexOf(q) !== -1 || extra.indexOf(q) !== -1) match = true;
        });
      }
      li.classList.toggle("is-search-hidden", !match);
      if (match) visible++;
    });
    if (emptyEl) {
      emptyEl.hidden = visible > 0 || !q;
    }
    if (live) {
      if (!q) {
        live.textContent = "";
      } else {
        live.textContent = visible === 1 ? "1 resultado" : visible + " resultados";
      }
    }
  }

  function getFirstVisibleSearchLink() {
    var list = document.getElementById("searchModalRecentList");
    if (!list) return null;
    var first = list.querySelector(".searchModal-item:not(.is-search-hidden) a.searchModal-link");
    return first;
  }

  function closeSearchModal() {
    var modal = document.getElementById("searchModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function openFeedbackModal() {
    closeSearchModal();
    var modal = document.getElementById("feedbackModal");
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var form = document.getElementById("feedbackForm");
    if (form) form.reset();
    var ticketBox = document.getElementById("feedbackTicketBox");
    if (ticketBox) ticketBox.hidden = true;
    lastBugMailtoPayload = null;
    var sw = document.getElementById("feedbackSoftware");
    if (sw) sw.value = "WorkColbeef-portal";
    fillFeedbackDetalleOptions("");
    var firstField = document.getElementById("feedbackTema");
    if (firstField) firstField.focus();
  }

  function closeFeedbackModal() {
    var modal = document.getElementById("feedbackModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function initSearchModal() {
    var openBtn = document.getElementById("searchOpenBtn");
    var backdrop = document.getElementById("searchModalBackdrop");
    var closeBtn = document.getElementById("searchModalClose");

    if (openBtn) {
      openBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openSearchModal();
      });
    }
    if (backdrop) backdrop.addEventListener("click", closeSearchModal);
    if (closeBtn) closeBtn.addEventListener("click", closeSearchModal);

    var searchInput = document.getElementById("searchModalInput");
    if (searchInput) {
      searchInput.addEventListener("input", filterSearchResults);
      searchInput.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var link = getFirstVisibleSearchLink();
        if (link) {
          e.preventDefault();
          link.click();
        }
      });
    }

    var links = Array.prototype.slice.call(document.querySelectorAll(".searchModal-link"));
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        var href = a.getAttribute("href") || "";
        e.preventDefault();
        closeSearchModal();
        closeSettingsView();
        var li = a.closest(".searchModal-item");
        var appId = li && li.getAttribute("data-app");
        if (appId) {
          setActiveMenuByAppId(appId);
        }
        if (/^https?:\/\//i.test(href)) {
          var meta = moduleMetaFromLink(a, appId || "");
          if (appId === "power-bi") {
            meta.pinType = "powerbi";
            meta.appId = "power-bi";
            requirePowerBiPinThenOpen(href, meta);
          } else if (a.getAttribute("data-requires-pin") === "rendimientos") {
            meta.pinType = "rendimientos";
            meta.appId = meta.appId || "logistica";
            requireRendimientosPinThenOpen(href, meta);
          } else {
            navigateToModule(href, meta);
          }
        } else if (href && href !== "#") {
          window.location.href = href;
        }
      });
    });
  }

  function openColbeefChatPanel() {
    sendUsageEvent("chat_open");
    var panel = document.getElementById("colbeefChatPanel");
    var fab = document.getElementById("colbeefChatToggle");
    if (!panel) return;
    panel.hidden = false;
    if (fab) fab.setAttribute("aria-expanded", "true");
    var wrap = document.getElementById("colbeefChatMessages");
    if (wrap && !wrap.dataset.welcomeShown) {
      appendColbeefChatMsg("bot", COLBEEF_CHAT_WELCOME);
      wrap.dataset.welcomeShown = "true";
    }
    var inp = document.getElementById("colbeefChatInput");
    if (inp) setTimeout(function () { inp.focus(); }, 0);
  }

  function closeColbeefChatPanel() {
    var panel = document.getElementById("colbeefChatPanel");
    var fab = document.getElementById("colbeefChatToggle");
    if (!panel) return;
    panel.hidden = true;
    if (fab) fab.setAttribute("aria-expanded", "false");
  }

  function colbeefChatScrollToBottom() {
    var el = document.getElementById("colbeefChatMessages");
    if (el) el.scrollTop = el.scrollHeight;
  }

  var COLBEEF_CHAT_BOT_AVATAR = "./img/site/Graident Ai Robot.png";
  var COLBEEF_CHAT_WELCOME = "Hola soy Beef tu asistente virtual en que te puedo ayudar?";

  function escapeColbeefChatHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatColbeefChatAsteriskMarkdown(text) {
    // README-style: *texto* o **texto** -> subrayado
    var safe = escapeColbeefChatHtml(text);
    safe = safe.replace(/\*\*(.+?)\*\*/g, "<u>$1</u>");
    safe = safe.replace(/\*(.+?)\*/g, "<u>$1</u>");
    return safe.replace(/\n/g, "<br>");
  }

  function colbeefChatAppendBotAvatar(container) {
    var img = document.createElement("img");
    img.className = "colbeefChat-msgAvatar";
    img.src = COLBEEF_CHAT_BOT_AVATAR;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.decoding = "async";
    container.appendChild(img);
  }

  function appendColbeefChatMsg(role, text) {
    var wrap = document.getElementById("colbeefChatMessages");
    if (!wrap) return;
    var div = document.createElement("div");
    div.className = "colbeefChat-msg colbeefChat-msg--" + (role === "user" ? "user" : "bot");
    if (role === "user") {
      div.textContent = text;
    } else {
      colbeefChatAppendBotAvatar(div);
      var body = document.createElement("div");
      body.className = "colbeefChat-msgBody";
      body.innerHTML = formatColbeefChatAsteriskMarkdown(text);
      div.appendChild(body);
    }
    wrap.appendChild(div);
    colbeefChatScrollToBottom();
  }

  function colbeefChatSetThinking(on) {
    var wrap = document.getElementById("colbeefChatMessages");
    if (!wrap) return;
    var old = document.getElementById("colbeefChatThinking");
    if (old) old.remove();
    if (!on) return;
    var div = document.createElement("div");
    div.id = "colbeefChatThinking";
    div.className = "colbeefChat-msg colbeefChat-msg--bot colbeefChat-msg--thinking";
    colbeefChatAppendBotAvatar(div);
    var body = document.createElement("div");
    body.className = "colbeefChat-msgBody";
    body.textContent = "Pensando...";
    div.appendChild(body);
    wrap.appendChild(div);
    colbeefChatScrollToBottom();
  }

  function sendColbeefChatMessage() {
    var inp = document.getElementById("colbeefChatInput");
    var sendBtn = document.getElementById("colbeefChatSend");
    if (!inp) return;
    var text = (inp.value || "").trim();
    if (!text) return;
    inp.value = "";
    appendColbeefChatMsg("user", text);
    geminiChatHistory.push({ role: "user", parts: [{ text: text }] });
    colbeefChatSetThinking(true);
    if (sendBtn) sendBtn.disabled = true;
    inp.disabled = true;

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: geminiChatHistory })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (out) {
        var res = out.res;
        var data = out.data;
        if (!res.ok) {
          var errMsg =
            (typeof (data && data.error) === "string" && data.error) ||
            (data && data.error && data.error.message) ||
            (res.status + " " + res.statusText);
          appendColbeefChatMsg("bot", "No pude obtener respuesta: " + errMsg);
          geminiChatHistory.pop();
          return;
        }
        var botText =
          (data.candidates &&
            data.candidates[0] &&
            data.candidates[0].content &&
            data.candidates[0].content.parts &&
            data.candidates[0].content.parts[0] &&
            data.candidates[0].content.parts[0].text) ||
          "";
        if (!botText) {
          appendColbeefChatMsg("bot", "Respuesta vacía (revisa bloqueos de seguridad o el modelo).");
          geminiChatHistory.pop();
          return;
        }
        geminiChatHistory.push({ role: "model", parts: [{ text: botText }] });
        colbeefChatSetThinking(false);
        appendColbeefChatMsg("bot", botText);
        sendUsageEvent("chat_message");
      })
      .catch(function (err) {
        geminiChatHistory.pop();
        colbeefChatSetThinking(false);
        appendColbeefChatMsg(
          "bot",
          "Error de conexión con el servidor. ¿Estás en http://localhost (npm start)? Detalle: " +
            (err && err.message ? err.message : String(err))
        );
      })
      .finally(function () {
        colbeefChatSetThinking(false);
        if (sendBtn) sendBtn.disabled = false;
        inp.disabled = false;
        inp.focus();
      });
  }

  function initColbeefChat() {
    var fab = document.getElementById("colbeefChatToggle");
    var panel = document.getElementById("colbeefChatPanel");
    var closeBtn = document.getElementById("colbeefChatClose");
    var sendBtn = document.getElementById("colbeefChatSend");
    var inp = document.getElementById("colbeefChatInput");
    if (!fab || !panel) return;

    fab.addEventListener("click", function (e) {
      e.preventDefault();
      if (panel.hidden) openColbeefChatPanel();
      else closeColbeefChatPanel();
    });
    if (closeBtn) closeBtn.addEventListener("click", closeColbeefChatPanel);
    if (sendBtn) {
      sendBtn.addEventListener("click", function (e) {
        e.preventDefault();
        sendColbeefChatMessage();
      });
    }
    if (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        sendColbeefChatMessage();
      });
    }
  }

  function initBugReportModal() {
    var openBtn = document.getElementById("bugReportOpenBtn");
    var backdrop = document.getElementById("feedbackModalBackdrop");
    var closeBtn = document.getElementById("feedbackModalClose");
    var cancelBtn = document.getElementById("feedbackCancelBtn");
    var form = document.getElementById("feedbackForm");
    var temaEl = document.getElementById("feedbackTema");
    var mailBtn = document.getElementById("feedbackMailtoBtn");
    var copyBtn = document.getElementById("feedbackCopyIdBtn");
    var submitBtn = document.getElementById("feedbackSubmitBtn");

    if (openBtn) {
      openBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openFeedbackModal();
      });
    }

    if (temaEl) {
      temaEl.addEventListener("change", function () {
        fillFeedbackDetalleOptions(temaEl.value);
      });
    }

    if (backdrop) backdrop.addEventListener("click", closeFeedbackModal);
    if (closeBtn) closeBtn.addEventListener("click", closeFeedbackModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeFeedbackModal);

    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var codeEl = document.getElementById("feedbackTicketCode");
        var code = codeEl ? codeEl.textContent : "";
        if (!code) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(
            function () {
              window.alert("ID copiado al portapapeles.");
            },
            function () {
              window.alert(code);
            }
          );
        } else {
          window.prompt("Copia el ID:", code);
        }
      });
    }

    if (mailBtn) {
      mailBtn.addEventListener("click", function () {
        if (!lastBugMailtoPayload) {
          window.alert("Primero registra el caso con el botón «Registrar caso».");
          return;
        }
        var p = lastBugMailtoPayload;
        var subject = "[WorkColbeef] " + p.tema + " — " + p.detalle + " [" + p.ticket_code + "]";
        var body =
          "ID caso: " +
          p.ticket_code +
          "\nFecha registro: " +
          p.reported_at_label +
          "\nSoftware: " +
          p.software_label +
          "\n\nTema: " +
          p.tema +
          "\nDetalle: " +
          p.detalle +
          "\n\nDescripción:\n" +
          p.mensaje +
          "\n\n---\nWorkColbeef (bugs / PQR)";
        var url =
          "mailto:" + FEEDBACK_EMAIL +
          "?subject=" + encodeURIComponent(subject) +
          "&body=" + encodeURIComponent(body);
        window.location.href = url;
      });
    }

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var software = ((document.getElementById("feedbackSoftware") || {}).value || "").trim();
        var tema = (document.getElementById("feedbackTema") || {}).value || "";
        var detalle = (document.getElementById("feedbackDetalle") || {}).value || "";
        var mensaje = ((document.getElementById("feedbackMensaje") || {}).value || "").trim();

        if (!software) {
          window.alert("Selecciona el software o módulo.");
          return;
        }
        if (!tema) {
          window.alert("Selecciona un tema.");
          return;
        }
        if (!detalle) {
          window.alert("Selecciona el detalle del tema.");
          return;
        }
        if (mensaje.length < 10) {
          window.alert("Describe el problema con al menos unas pocas líneas (mínimo 10 caracteres).");
          return;
        }

        if (submitBtn) submitBtn.disabled = true;

        fetch("/api/bugs/report", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            software: software,
            tema: tema,
            detalle: detalle,
            mensaje: mensaje
          })
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { res: res, data: data };
            });
          })
          .then(function (out) {
            if (submitBtn) submitBtn.disabled = false;
            var data = out.data;
            if (!out.res.ok || !data || data.ok === false) {
              var err =
                (data && (data.error || data.message)) || "No se pudo registrar el caso.";
              if (data && data.errors) {
                err = err + " " + JSON.stringify(data.errors);
              }
              window.alert(err);
              return;
            }
            var ticket = data.ticket_code || "—";
            var whenIso = data.reported_at || "";
            var whenLabel = formatBugReportDateTime(whenIso);
            var swLabel = data.software_label || software;
            var codeEl = document.getElementById("feedbackTicketCode");
            var whenEl = document.getElementById("feedbackTicketWhen");
            var box = document.getElementById("feedbackTicketBox");
            if (codeEl) codeEl.textContent = ticket;
            if (whenEl) whenEl.textContent = whenLabel;
            if (box) box.hidden = false;
            lastBugMailtoPayload = {
              ticket_code: ticket,
              reported_at_label: whenLabel,
              software_label: swLabel,
              tema: tema,
              detalle: detalle,
              mensaje: mensaje
            };
          })
          .catch(function () {
            if (submitBtn) submitBtn.disabled = false;
            window.alert("No hay conexión con el servidor o falta migrar la base (Laravel + migrate).");
          });
      });
    }
  }

  function initPowerBiNav() {
    var els = document.querySelectorAll(".moduleTile--powerBi .moduleTileBtn");
    els.forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var href = el.getAttribute("href");
        if (!href) return;
        closeSettingsView();
        setActiveMenuByAppId("power-bi");
        var meta = moduleMetaFromLink(el, "power-bi");
        meta.pinType = "powerbi";
        requirePowerBiPinThenOpen(href, meta);
      });
    });
  }

  function initLogisticaNav() {
    var els = document.querySelectorAll(".moduleTile--logistica .moduleTileBtn");
    els.forEach(function (el) {
      el.addEventListener("click", function (e) {
        var href = el.getAttribute("href");
        if (!href) return;
        closeSettingsView();
        setActiveMenuByAppId("logistica");
        var meta = moduleMetaFromLink(el, "logistica");
        if (el.getAttribute("data-requires-pin") === "rendimientos") {
          if (e && e.preventDefault) e.preventDefault();
          meta.pinType = "rendimientos";
          requireRendimientosPinThenOpen(href, meta);
          return;
        }
        if (e && e.preventDefault) e.preventDefault();
        navigateToModule(href, meta);
      });
    });
  }

  function initGestionHumanaNav() {
    var els = document.querySelectorAll(".moduleTile--gestion-humana .moduleTileBtn");
    els.forEach(function (el) {
      el.addEventListener("click", function (e) {
        var href = el.getAttribute("href");
        if (!href) return;
        closeSettingsView();
        setActiveMenuByAppId("gestion-humana");
        if (e && e.preventDefault) e.preventDefault();
        navigateToModule(href, moduleMetaFromLink(el, "gestion-humana"));
      });
    });
  }

  function initCalidadNav() {
    var els = document.querySelectorAll(".moduleTile--calidad .moduleTileBtn");
    els.forEach(function (el) {
      el.addEventListener("click", function (e) {
        var href = el.getAttribute("href");
        if (!href) return;
        closeSettingsView();
        setActiveMenuByAppId("calidad");
        if (e && e.preventDefault) e.preventDefault();
        navigateToModule(href, moduleMetaFromLink(el, "calidad"));
      });
    });
  }

  function initTesoreriaNav() {
    var els = document.querySelectorAll(".moduleTile--tesoreria .moduleTileBtn");
    els.forEach(function (el) {
      el.addEventListener("click", function (e) {
        var href = el.getAttribute("href");
        if (!href) return;
        closeSettingsView();
        setActiveMenuByAppId("tesoreria-cartera");
        if (e && e.preventDefault) e.preventDefault();
        navigateToModule(href, moduleMetaFromLink(el, "tesoreria-cartera"));
      });
    });
  }

  function initAdministrativoNav() {
    var els = document.querySelectorAll(".moduleTile--administrativo .moduleTileBtn");
    els.forEach(function (el) {
      el.addEventListener("click", function (e) {
        var href = el.getAttribute("href");
        if (!href) return;
        closeSettingsView();
        setActiveMenuByAppId("administrativo");
        if (e && e.preventDefault) e.preventDefault();
        navigateToModule(href, moduleMetaFromLink(el, "administrativo"));
      });
    });
  }

  function initMenuTracking() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".menuItem"));
    links.forEach(function (a) {
      a.addEventListener("click", function (evt) {
        evt.preventDefault();
        links.forEach(function (x) { x.classList.remove("active"); });
        a.classList.add("active");

        closeSettingsView();

        var appId = a.getAttribute("data-app-id") || "";
        var targetUrl = a.getAttribute("data-target-url");
        if (targetUrl && String(targetUrl).trim() !== "" && targetUrl !== "#") {
          navigateToModule(targetUrl, {
            label: a.getAttribute("data-app-name") || APP_ID_LABELS[appId] || "Módulo",
            appId: appId,
            programId: programIdFromHref(targetUrl),
            programLabel: a.getAttribute("data-app-name") || APP_ID_LABELS[appId] || "Módulo"
          });
          return;
        }
        if (appId) {
          sendUsageEvent("module_click", appId);
        }
        if (appId === "power-bi") {
          var tilePb = document.querySelector(".moduleTile--powerBi");
          if (tilePb && tilePb.scrollIntoView) {
            window.requestAnimationFrame(function () {
              tilePb.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
          }
          return;
        }
        if (appId === "logistica") {
          var tileLog = document.querySelector(".moduleTile--logistica");
          if (tileLog && tileLog.scrollIntoView) {
            window.requestAnimationFrame(function () {
              tileLog.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
          }
          return;
        }
        if (appId === "gestion-humana") {
          var tileGh = document.querySelector(".moduleTile--gestion-humana");
          if (tileGh && tileGh.scrollIntoView) {
            window.requestAnimationFrame(function () {
              tileGh.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
          }
          return;
        }
        if (appId === "calidad") {
          var tileCal = document.querySelector(".moduleTile--calidad");
          if (tileCal && tileCal.scrollIntoView) {
            window.requestAnimationFrame(function () {
              tileCal.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
          }
          return;
        }
        if (appId) {
          var tile = document.querySelector('.moduleTile[data-app-id="' + appId + '"]');
          var href = tile && tile.getAttribute("href");
          if (href && /^https?:\/\//i.test(href)) {
            navigateToModule(href, {
              label: tile.getAttribute("data-app-name") || APP_ID_LABELS[appId] || "Módulo",
              appId: appId,
              programId: programIdFromHref(href),
              programLabel: tile.getAttribute("data-app-name") || APP_ID_LABELS[appId] || "Módulo"
            });
            return;
          }
          if (tile && tile.scrollIntoView) {
            window.requestAnimationFrame(function () {
              tile.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
          }
        }
      });
    });
  }

  function initDashboardMosaic() {
    var tiles = Array.prototype.slice.call(document.querySelectorAll(".moduleTile"));
    tiles.forEach(function (tile) {
      tile.addEventListener("click", function (evt) {
        if (evt.target && evt.target.closest && evt.target.closest(".moduleTileBtn")) {
          return;
        }
        var id = tile.getAttribute("data-app-id");
        var href = tile.getAttribute("href");
        if (href && /^https?:\/\//i.test(href) && tile.tagName === "A") {
          if (evt && evt.preventDefault) evt.preventDefault();
          if (id) setActiveMenuByAppId(id);
          navigateToModule(href, {
            label: tile.getAttribute("data-app-name") || (tile.querySelector(".moduleTileName") || {}).textContent || "Módulo",
            appId: id || "",
            programId: programIdFromHref(href),
            programLabel: tile.getAttribute("data-app-name") || (tile.querySelector(".moduleTileName") || {}).textContent || "Módulo"
          });
          return;
        }
        if (id) {
          sendUsageEvent("module_click", id);
          setActiveMenuByAppId(id);
        }
      });
    });
  }

  function initMobileNav() {
    var layout = document.getElementById("suiteLayout");
    var toggle = document.getElementById("mobileNavToggle");
    var backdrop = document.getElementById("sidebarBackdrop");
    if (!layout || !toggle) return;

    var mq = window.matchMedia("(max-width: 900px)");

    function isMobile() {
      return mq.matches;
    }

    function setMobileNavOpen(open) {
      if (!isMobile()) {
        layout.classList.remove("mobile-nav-open");
        document.body.classList.remove("mobile-nav-locked");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Abrir menú");
        if (backdrop) backdrop.setAttribute("aria-hidden", "true");
        return;
      }

      layout.classList.toggle("mobile-nav-open", open);
      document.body.classList.toggle("mobile-nav-locked", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      if (backdrop) backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    }

    toggle.addEventListener("click", function () {
      setMobileNavOpen(!layout.classList.contains("mobile-nav-open"));
    });

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        setMobileNavOpen(false);
      });
    }

    var navLinks = document.querySelectorAll("#appsMenu .menuItem, #utilityMenu .toolItem");
    navLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        if (isMobile()) setMobileNavOpen(false);
      });
    });

    mq.addEventListener("change", function () {
      setMobileNavOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!isMobile() || !layout.classList.contains("mobile-nav-open")) return;
      setMobileNavOpen(false);
    });
  }

  function initSidebarHover() {
    var layout = document.getElementById("suiteLayout");
    var sidebar = document.getElementById("sidebar");
    var zone = document.getElementById("sidebarHoverZone");
    if (!layout || !sidebar || !zone) return;

    if (window.matchMedia("(max-width: 900px)").matches) {
      return;
    }

    var closeTimer = null;

    function openSidebar() {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      layout.classList.add("sidebar-open");
    }

    function closeSidebarSoon() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(function () {
        layout.classList.remove("sidebar-open");
      }, 140);
    }

    zone.addEventListener("mouseenter", openSidebar);
    sidebar.addEventListener("mouseenter", openSidebar);
    sidebar.addEventListener("mouseleave", closeSidebarSoon);

    document.addEventListener("mouseleave", function () {
      layout.classList.remove("sidebar-open");
    });
    window.addEventListener("blur", function () {
      layout.classList.remove("sidebar-open");
    });
  }

  function init() {
    // Si recargas en la misma pestaña, mantiene el desbloqueo.
    // Si cierras y vuelves a abrir, sessionStorage se pierde y vuelve a pedir contraseña.
    try { hasAdminSession = sessionStorage.getItem(ADMIN_UNLOCKED_KEY) === "1"; } catch (e) {}
    powerBiPinOk = false;

    applySettingsToUI(loadSettings());
    initSidebarHover();
    initMobileNav();
    initMenuTracking();
    initPowerBiNav();
    initPowerBiPinModal();
    initLogisticaNav();
    initGestionHumanaNav();
    initCalidadNav();
    initTesoreriaNav();
    initAdministrativoNav();
    initDashboardMosaic();
    initRecentAccess();
    initAdminAccessModal();
    initSettingsOpen();
    initBackFromSettings();
    initSettingsTabs();
    initToggleAria();
    initSettingsAutoSave();
    initUsageStatsPeriod();
    initBugStatsPeriod();
    initBugStatsResolveDelegation();
    initSearchModal();
    initColbeefChat();
    initBugReportModal();
    recordPageViewOnce();

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var am = document.getElementById("adminAccessModal");
      if (am && !am.hidden) {
        closeAdminAccessModal();
        resolvePendingAdminAccess(false);
        return;
      }
      var pm = document.getElementById("powerBiPinModal");
      if (pm && !pm.hidden) {
        closePowerBiPinModal();
        return;
      }
      var chatPanel = document.getElementById("colbeefChatPanel");
      if (chatPanel && !chatPanel.hidden) {
        closeColbeefChatPanel();
        return;
      }
      var sm = document.getElementById("searchModal");
      var fm = document.getElementById("feedbackModal");
      if (sm && !sm.hidden) {
        closeSearchModal();
      } else if (fm && !fm.hidden) {
        closeFeedbackModal();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
