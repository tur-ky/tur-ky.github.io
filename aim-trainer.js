const M_YAW = 0.022;
const DEG_TO_RAD = Math.PI / 180;
const AIM_UNITS_PER_RADIAN = 14000;
const OVERWATCH_FOV = 110;
const BASE_TRAINER_FOV = 90;
const VIEW_SCALE = OVERWATCH_FOV / BASE_TRAINER_FOV;
const CANTS_DWELL_MS = 350;

const scenarioMeta = {
    "1w6t": { label: "1W6T", radius: 28, score: 100, color: "#8aff8a" },
    pasu: { label: "PASU", radius: 22, score: 130, color: "#7affff" },
    cants: { label: "CANTS", radius: 24, score: 160, color: "#f9ff6f" },
    microadjust: { label: "MICROADJUST", radius: 10, score: 115, color: "#ff8f8f" }
};

const sharedSettings = window.TrainerSettings ? window.TrainerSettings.load() : window.TrainerSettings.defaults;

const state = {
    controlMode: sharedSettings.mode,
    sens: sharedSettings.sens,
    dpi: sharedSettings.dpi,
    cm360: sharedSettings.cm360,
    locked: false,
    pendingLockMode: "STANDARD POINTER",
    inputStatus: "WAITING FOR POINTER LOCK",
    scenario: "1w6t",
    runMode: "timed",
    duration: 60,
    timeLeft: 60,
    running: false,
    score: 0,
    shots: 0,
    hits: 0,
    misses: 0,
    kills: 0,
    streak: 0,
    bestStreak: 0,
    worldX: 0,
    worldY: 0,
    dwellProgressMs: 0,
    lastFrameTime: performance.now(),
    roundEnded: false
};

const crosshairDefaults = {
    preset: "green",
    custom: "#00ff66",
    alpha: 0.95,
    gap: 4,
    length: 10,
    thickness: 2,
    dotSize: 3,
    dot: false,
    outline: true,
    outlineSize: 1,
    tStyle: false
};

const crosshairState = { ...crosshairDefaults, ...(sharedSettings.crosshair || {}) };
const targets = [];
let microBase = null;

const $ = (id) => document.getElementById(id);
const canvas = $("trainer-canvas");
const ctx = canvas.getContext("2d");
const banner = $("banner");
const inpSens = $("inp-sens");
const inpDpi = $("inp-dpi");
const inpCm = $("inp-cm");
const inpDuration = $("inp-duration");
const modeSens = $("mode-sens");
const modeCm = $("mode-cm");
const statusEl = $("status");
const startRunBtn = $("start-run");
const resetRunBtn = $("reset-run");
const scenarioButtons = [...document.querySelectorAll(".scenario")];
const runModeButtons = [...document.querySelectorAll(".run-mode")];
const hudScenario = $("hud-scenario");
const hudMode = $("hud-mode");
const hudTime = $("hud-time");
const hudScore = $("hud-score");
const hudHits = $("hud-hits");
const hudMisses = $("hud-misses");
const hudAccuracy = $("hud-accuracy");
const hudKills = $("hud-kills");
const hudStreak = $("hud-streak");
const hudBest = $("hud-best");
const hudSpecial = $("hud-special");

const xhPreset = $("xh-preset");
const xhCustom = $("xh-custom");
const xhAlpha = $("xh-alpha");
const xhGap = $("xh-gap");
const xhLength = $("xh-length");
const xhThickness = $("xh-thickness");
const xhDotSize = $("xh-dot-size");
const xhOutlineSize = $("xh-outline-size");
const xhDot = $("xh-dot");
const xhOutline = $("xh-outline");
const xhTStyle = $("xh-tstyle");
const xhReset = $("xh-reset");
const crosshair = { up: $("c-up"), down: $("c-down"), left: $("c-left"), right: $("c-right"), dot: $("c-dot") };

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function num(value, fallback) { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : fallback; }
function parseDraftNumber(value) {
    const trimmed = String(value).trim();
    if (!trimmed || trimmed === "-" || trimmed === "." || trimmed === "-." || /[eE+\-]$/.test(trimmed)) {
        return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}
function readNumericDraft(input, fallback, min, max, { commit = false, integer = false } = {}) {
    const parsed = parseDraftNumber(input.value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    const normalized = integer ? Math.round(parsed) : parsed;
    if (!commit && (normalized < min || normalized > max)) {
        return fallback;
    }
    return clamp(normalized, min, max);
}
function bindNumberInput(input, handler) {
    input.addEventListener("input", (event) => handler({ source: event.target }));
    input.addEventListener("change", () => handler({ commit: true }));
    input.addEventListener("blur", () => handler({ commit: true }));
}
function rand(min, max) { return Math.random() * (max - min) + min; }
function randSign() { return Math.random() < 0.5 ? -1 : 1; }
function cm360FromSens(sens, dpi) { return (360 / (M_YAW * sens * dpi)) * 2.54; }
function sensFromCm(cm360, dpi) { return 360 / ((cm360 / 2.54) * dpi * M_YAW); }
function radiansPerCount() { return state.sens * M_YAW * DEG_TO_RAD; }
function worldUnitsPerCount() { return radiansPerCount() * AIM_UNITS_PER_RADIAN; }
function viewWidth() { return canvas.clientWidth || window.innerWidth; }
function viewHeight() { return canvas.clientHeight || window.innerHeight; }
function worldViewWidth() { return viewWidth() * VIEW_SCALE; }
function worldViewHeight() { return viewHeight() * VIEW_SCALE; }

function persistSharedSettings() {
    if (!window.TrainerSettings) { return; }
    window.TrainerSettings.save({
        mode: state.controlMode,
        sens: state.sens,
        dpi: state.dpi,
        cm360: state.cm360,
        crosshair: { ...crosshairState }
    });
}

function hydrateStoredControls() {
    inpSens.value = state.sens.toFixed(2);
    inpDpi.value = String(state.dpi);
    inpCm.value = state.cm360.toFixed(2);
    inpDuration.value = String(state.duration);
    xhPreset.value = crosshairState.preset;
    xhCustom.value = crosshairState.custom;
    xhAlpha.value = crosshairState.alpha.toFixed(2);
    xhGap.value = String(crosshairState.gap);
    xhLength.value = String(crosshairState.length);
    xhThickness.value = String(crosshairState.thickness);
    xhDotSize.value = String(crosshairState.dotSize);
    xhOutlineSize.value = String(crosshairState.outlineSize);
    xhDot.checked = crosshairState.dot;
    xhOutline.checked = crosshairState.outline;
    xhTStyle.checked = crosshairState.tStyle;
}

function syncSensitivity({ commit = false, source = null } = {}) {
    state.dpi = readNumericDraft(inpDpi, state.dpi, 100, 6400, { commit, integer: true });
    if (state.controlMode === "sens") {
        state.sens = readNumericDraft(inpSens, state.sens, 0.01, 10, { commit });
        state.cm360 = cm360FromSens(state.sens, state.dpi);
    } else {
        state.cm360 = readNumericDraft(inpCm, state.cm360, 1, 200, { commit });
        state.sens = sensFromCm(state.cm360, state.dpi);
    }
    if (commit || source !== inpSens) {
        inpSens.value = state.sens.toFixed(2);
    }
    if (commit || source !== inpDpi) {
        inpDpi.value = String(state.dpi);
    }
    if (commit || source !== inpCm) {
        inpCm.value = state.cm360.toFixed(2);
    }
    persistSharedSettings();
}

function setControlMode(mode) {
    state.controlMode = mode === "cm" ? "cm" : "sens";
    modeSens.classList.toggle("active", state.controlMode === "sens");
    modeCm.classList.toggle("active", state.controlMode === "cm");
    inpSens.readOnly = state.controlMode !== "sens";
    inpCm.readOnly = state.controlMode !== "cm";
    syncSensitivity({ commit: true });
}

function syncDuration({ commit = false, source = null } = {}) {
    state.duration = readNumericDraft(inpDuration, state.duration, 5, 600, { commit, integer: true });
    if (commit || source !== inpDuration) {
        inpDuration.value = String(state.duration);
    }
    if (!state.running && state.runMode === "timed") {
        state.timeLeft = state.duration;
    }
    updateHud();
}

function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    const safe = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
    return {
        r: Number.parseInt(safe.slice(0, 2), 16),
        g: Number.parseInt(safe.slice(2, 4), 16),
        b: Number.parseInt(safe.slice(4, 6), 16)
    };
}

function crosshairHex() {
    const presets = { green: "#00ff66", yellow: "#f9ff5a", cyan: "#58fff5", red: "#ff5a5a", white: "#f5f5f5" };
    return crosshairState.preset === "custom" ? crosshairState.custom : presets[crosshairState.preset];
}

function stylePiece(element, width, height, left, top, visible) {
    element.style.width = width + "px";
    element.style.height = height + "px";
    element.style.left = left + "px";
    element.style.top = top + "px";
    element.style.display = visible ? "block" : "none";
}

function applyCrosshair() {
    const rgb = hexToRgb(crosshairHex());
    const color = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(crosshairState.alpha, 0.1, 1)})`;
    const outline = crosshairState.outline ? crosshairState.outlineSize : 0;
    const shadow = outline ? `0 0 0 ${outline}px rgba(0,0,0,.95)` : "none";
    const halfThickness = crosshairState.thickness / 2;
    const halfDot = crosshairState.dotSize / 2;
    Object.values(crosshair).forEach((piece) => {
        piece.style.background = color;
        piece.style.boxShadow = shadow;
        piece.style.borderRadius = "1px";
    });
    stylePiece(crosshair.left, crosshairState.length, crosshairState.thickness, -(crosshairState.gap + crosshairState.length), -halfThickness, true);
    stylePiece(crosshair.right, crosshairState.length, crosshairState.thickness, crosshairState.gap, -halfThickness, true);
    stylePiece(crosshair.up, crosshairState.thickness, crosshairState.length, -halfThickness, -(crosshairState.gap + crosshairState.length), !crosshairState.tStyle);
    stylePiece(crosshair.down, crosshairState.thickness, crosshairState.length, -halfThickness, crosshairState.gap, true);
    stylePiece(crosshair.dot, crosshairState.dotSize, crosshairState.dotSize, -halfDot, -halfDot, crosshairState.dot);
    xhCustom.disabled = crosshairState.preset !== "custom";
}

function syncCrosshair() {
    crosshairState.preset = xhPreset.value;
    crosshairState.custom = xhCustom.value;
    crosshairState.alpha = clamp(num(xhAlpha.value, crosshairState.alpha), 0.1, 1);
    crosshairState.gap = clamp(num(xhGap.value, crosshairState.gap), 0, 20);
    crosshairState.length = clamp(num(xhLength.value, crosshairState.length), 2, 28);
    crosshairState.thickness = clamp(num(xhThickness.value, crosshairState.thickness), 1, 8);
    crosshairState.dotSize = clamp(num(xhDotSize.value, crosshairState.dotSize), 1, 10);
    crosshairState.outlineSize = clamp(num(xhOutlineSize.value, crosshairState.outlineSize), 0, 4);
    crosshairState.dot = xhDot.checked;
    crosshairState.outline = xhOutline.checked;
    crosshairState.tStyle = xhTStyle.checked;
    xhAlpha.value = crosshairState.alpha.toFixed(2);
    xhGap.value = String(crosshairState.gap);
    xhLength.value = String(crosshairState.length);
    xhThickness.value = String(crosshairState.thickness);
    xhDotSize.value = String(crosshairState.dotSize);
    xhOutlineSize.value = String(crosshairState.outlineSize);
    applyCrosshair();
    persistSharedSettings();
}

function resetCrosshair() {
    Object.assign(crosshairState, crosshairDefaults);
    hydrateStoredControls();
    applyCrosshair();
    persistSharedSettings();
}

function setupPanels() {
    document.querySelectorAll(".box").forEach((box, index) => {
        const titleEl = box.querySelector("h1,h2");
        const title = titleEl ? titleEl.textContent.trim() : `PANEL ${index + 1}`;
        const children = [...box.childNodes];
        const head = document.createElement("div");
        const label = document.createElement("span");
        const toggle = document.createElement("button");
        const body = document.createElement("div");
        head.className = "panel-head";
        label.className = "panel-label";
        label.textContent = title;
        toggle.className = "panel-toggle";
        toggle.type = "button";
        toggle.textContent = "-";
        toggle.setAttribute("aria-label", `Minimize ${title}`);
        body.className = "panel-body";
        box.innerHTML = "";
        children.forEach((child) => {
            if (child !== titleEl) {
                body.appendChild(child);
            }
        });
        toggle.addEventListener("click", () => {
            const collapsed = box.classList.toggle("collapsed");
            toggle.textContent = collapsed ? "+" : "-";
            toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Minimize"} ${title}`);
        });
        head.append(label, toggle);
        box.append(head, body);
    });
}

function setBanner(message, isError) {
    banner.innerHTML = message;
    banner.style.borderColor = isError ? "#ff5454" : "var(--red)";
    banner.style.color = isError ? "#ff9090" : "var(--red)";
}

async function requestLock() {
    if (document.pointerLockElement === canvas) { return; }
    if (!canvas.requestPointerLock) {
        state.inputStatus = "POINTER LOCK UNSUPPORTED";
        updateHud();
        setBanner("&gt; POINTER LOCK IS NOT AVAILABLE IN THIS BROWSER", true);
        return;
    }
    state.pendingLockMode = "RAW INPUT";
    try {
        const attempt = canvas.requestPointerLock({ unadjustedMovement: true });
        if (attempt && typeof attempt.then === "function") { await attempt; }
    } catch (error) {
        state.pendingLockMode = "STANDARD POINTER";
        try {
            const fallback = canvas.requestPointerLock();
            if (fallback && typeof fallback.then === "function") { await fallback; }
        } catch (fallbackError) {
            state.inputStatus = "LOCK REQUEST BLOCKED";
            updateHud();
            setBanner("&gt; POINTER LOCK REQUEST FAILED<br><small>OPEN THIS PAGE DIRECTLY IN ITS OWN TAB OR WINDOW</small>", true);
        }
    }
}

function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resetStats() {
    state.timeLeft = state.duration;
    state.score = 0;
    state.shots = 0;
    state.hits = 0;
    state.misses = 0;
    state.kills = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.dwellProgressMs = 0;
    state.roundEnded = false;
}

function clearTargets() {
    targets.length = 0;
    microBase = null;
}

function candidateTooClose(candidate, existing) {
    return existing.some((target) => Math.hypot(candidate.x - target.x, candidate.y - target.y) < candidate.radius + target.radius + 24);
}

function spawnStaticTarget(radius, existing = [], options = {}) {
    const width = worldViewWidth();
    const height = worldViewHeight();
    const baseX = options.baseX ?? state.worldX;
    const baseY = options.baseY ?? state.worldY;
    const spanX = options.spanX ?? width * 0.36;
    const spanY = options.spanY ?? height * 0.26;
    let fallback = { x: baseX, y: baseY, radius };
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const candidate = {
            x: baseX + rand(-spanX, spanX),
            y: baseY + rand(-spanY, spanY),
            radius
        };
        fallback = candidate;
        if (!candidateTooClose(candidate, existing)) {
            return candidate;
        }
    }
    return fallback;
}

function makeTarget(base) {
    return {
        id: Math.random().toString(36).slice(2),
        x: base.x,
        y: base.y,
        displayX: base.x,
        displayY: base.y,
        radius: base.radius,
        color: base.color,
        vx: base.vx || 0,
        vy: base.vy || 0,
        boundsX: base.boundsX || 0,
        boundsY: base.boundsY || 0,
        homeX: base.homeX ?? base.x,
        homeY: base.homeY ?? base.y,
        arcAmp: base.arcAmp || 0,
        arcSpeed: base.arcSpeed || 0,
        arcPhase: base.arcPhase || 0,
        arcTime: 0,
        directionTimer: base.directionTimer || 0,
        type: base.type || state.scenario
    };
}

function spawnDynamicTarget(type) {
    const width = worldViewWidth();
    const height = worldViewHeight();
    const radius = scenarioMeta[type].radius;
    const homeX = state.worldX + rand(-width * 0.12, width * 0.12);
    const homeY = state.worldY + rand(-height * 0.1, height * 0.1);
    if (type === "pasu") {
        return makeTarget({
            x: homeX,
            y: homeY,
            radius,
            color: scenarioMeta[type].color,
            homeX,
            homeY,
            boundsX: width * 0.26,
            boundsY: height * 0.2,
            vx: randSign() * rand(190, 280),
            vy: randSign() * rand(90, 180),
            arcAmp: rand(24, 68),
            arcSpeed: rand(2.2, 4.3),
            arcPhase: rand(0, Math.PI * 2),
            type
        });
    }

    return makeTarget({
        x: homeX,
        y: homeY,
        radius,
        color: scenarioMeta[type].color,
        homeX,
        homeY,
        boundsX: width * 0.28,
        boundsY: height * 0.18,
        vx: randSign() * rand(270, 420),
        vy: randSign() * rand(90, 190),
        arcAmp: rand(18, 52),
        arcSpeed: rand(4.8, 7.2),
        arcPhase: rand(0, Math.PI * 2),
        directionTimer: rand(0.18, 0.42),
        type
    });
}
function spawnMicroTarget(previous) {
    const width = worldViewWidth();
    const height = worldViewHeight();
    const radius = scenarioMeta.microadjust.radius;
    const anchor = previous ? { x: previous.x, y: previous.y } : { x: state.worldX, y: state.worldY };
    const candidate = spawnStaticTarget(radius, [], {
        baseX: anchor.x,
        baseY: anchor.y,
        spanX: Math.min(width * 0.1, 90),
        spanY: Math.min(height * 0.1, 90)
    });
    microBase = candidate;
    return makeTarget({ ...candidate, color: scenarioMeta.microadjust.color, type: "microadjust" });
}

function initializeScenarioTargets() {
    clearTargets();
    if (state.scenario === "1w6t") {
        for (let index = 0; index < 6; index += 1) {
            const target = spawnStaticTarget(scenarioMeta["1w6t"].radius, targets);
            targets.push(makeTarget({ ...target, color: scenarioMeta["1w6t"].color, type: "1w6t" }));
        }
        return;
    }
    if (state.scenario === "microadjust") {
        targets.push(spawnMicroTarget(null));
        return;
    }
    targets.push(spawnDynamicTarget(state.scenario));
}

function setScenario(id) {
    state.scenario = scenarioMeta[id] ? id : "1w6t";
    scenarioButtons.forEach((button) => button.classList.toggle("active", button.dataset.scenario === state.scenario));
    resetRun();
}

function setRunMode(mode) {
    state.runMode = mode === "freeplay" ? "freeplay" : "timed";
    runModeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === state.runMode));
    resetRun();
}

function updateHud() {
    const accuracy = state.shots > 0 ? (state.hits / state.shots) * 100 : 0;
    hudScenario.textContent = scenarioMeta[state.scenario].label;
    hudMode.textContent = state.runMode === "timed" ? "TIMED" : "FREEPLAY";
    hudTime.textContent = state.runMode === "timed" ? `${Math.max(state.timeLeft, 0).toFixed(1)}S` : "FREEPLAY";
    hudScore.textContent = String(state.score);
    hudHits.textContent = String(state.hits);
    hudMisses.textContent = String(state.misses);
    hudAccuracy.textContent = `${accuracy.toFixed(1)}%`;
    hudKills.textContent = String(state.kills);
    hudStreak.textContent = String(state.streak);
    hudBest.textContent = String(state.bestStreak);
    hudSpecial.textContent = state.scenario === "cants" ? `${Math.min(100, (state.dwellProgressMs / CANTS_DWELL_MS) * 100).toFixed(0)}% DWELL` : (state.running ? "LIVE" : (state.roundEnded ? "ROUND END" : "READY"));
    statusEl.textContent = state.inputStatus;
}

function resetRun() {
    state.running = false;
    resetStats();
    initializeScenarioTargets();
    updateHud();
}

function startRun() {
    resetStats();
    initializeScenarioTargets();
    state.running = true;
    state.lastFrameTime = performance.now();
    updateHud();
}

function screenFromWorld(x, y) {
    return {
        x: viewWidth() * 0.5 + ((x - state.worldX) / VIEW_SCALE),
        y: viewHeight() * 0.5 + ((y - state.worldY) / VIEW_SCALE)
    };
}

function activePosition(target) {
    return { x: target.displayX ?? target.x, y: target.displayY ?? target.y };
}

function crosshairInsideTarget(target) {
    const position = activePosition(target);
    return Math.hypot(position.x - state.worldX, position.y - state.worldY) <= target.radius;
}

function registerHit(points, countShot) {
    if (countShot) { state.shots += 1; }
    state.hits += 1;
    state.kills += 1;
    state.score += points;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    updateHud();
}

function registerMiss() {
    state.shots += 1;
    state.misses += 1;
    state.streak = 0;
    updateHud();
}

function replaceTarget(target) {
    const index = targets.findIndex((entry) => entry.id === target.id);
    if (index === -1) { return; }
    if (state.scenario === "1w6t") {
        const next = spawnStaticTarget(scenarioMeta["1w6t"].radius, targets.filter((entry) => entry.id !== target.id));
        targets[index] = makeTarget({ ...next, color: scenarioMeta["1w6t"].color, type: "1w6t" });
        return;
    }
    if (state.scenario === "microadjust") {
        targets[index] = spawnMicroTarget(target);
        return;
    }
    targets[index] = spawnDynamicTarget(state.scenario);
}

function findClickedTarget() {
    const hitTargets = targets.filter((target) => crosshairInsideTarget(target));
    if (hitTargets.length === 0) { return null; }
    hitTargets.sort((a, b) => Math.hypot(activePosition(a).x - state.worldX, activePosition(a).y - state.worldY) - Math.hypot(activePosition(b).x - state.worldX, activePosition(b).y - state.worldY));
    return hitTargets[0];
}

function handleShot() {
    if (!state.running || !state.locked || state.scenario === "cants") { return; }
    const target = findClickedTarget();
    if (!target) {
        registerMiss();
        return;
    }
    registerHit(scenarioMeta[state.scenario].score, true);
    replaceTarget(target);
}

function updateDynamicTarget(target, dt) {
    target.x += target.vx * dt;
    target.y += target.vy * dt;
    if (Math.abs(target.x - target.homeX) >= target.boundsX) {
        target.x = target.homeX + Math.sign(target.x - target.homeX) * target.boundsX;
        target.vx *= -1;
    }
    if (Math.abs(target.y - target.homeY) >= target.boundsY) {
        target.y = target.homeY + Math.sign(target.y - target.homeY) * target.boundsY;
        target.vy *= -1;
    }
    if (target.type === "cants") {
        target.directionTimer -= dt;
        if (target.directionTimer <= 0) {
            target.vx = randSign() * rand(260, 430);
            target.vy = randSign() * rand(80, 220);
            target.directionTimer = rand(0.18, 0.42);
        }
    }
    target.arcTime += dt;
    target.displayX = target.x;
    target.displayY = target.y + Math.sin(target.arcTime * target.arcSpeed + target.arcPhase) * target.arcAmp;
}

function updateScenario(dt) {
    if (!state.running) { return; }
    if (state.runMode === "timed") {
        state.timeLeft = Math.max(0, state.timeLeft - dt);
        if (state.timeLeft <= 0) {
            state.running = false;
            state.roundEnded = true;
            updateHud();
            return;
        }
    }
    if (state.scenario === "pasu" || state.scenario === "cants") {
        targets.forEach((target) => updateDynamicTarget(target, dt));
    }
    if (state.scenario === "cants" && targets[0]) {
        if (crosshairInsideTarget(targets[0])) {
            state.dwellProgressMs += dt * 1000;
            if (state.dwellProgressMs >= CANTS_DWELL_MS) {
                registerHit(scenarioMeta.cants.score, true);
                state.dwellProgressMs = 0;
                replaceTarget(targets[0]);
            }
        } else {
            state.dwellProgressMs = 0;
        }
        updateHud();
    }
}

function drawGrid() {
    const width = viewWidth();
    const height = viewHeight();
    const spacing = 140;
    const worldLeft = state.worldX - worldViewWidth() * 0.5 - spacing;
    const worldRight = state.worldX + worldViewWidth() * 0.5 + spacing;
    const worldTop = state.worldY - worldViewHeight() * 0.5 - spacing;
    const worldBottom = state.worldY + worldViewHeight() * 0.5 + spacing;
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,102,0.08)";
    ctx.lineWidth = 1;
    const startX = Math.floor(worldLeft / spacing) * spacing;
    const startY = Math.floor(worldTop / spacing) * spacing;
    for (let worldX = startX; worldX <= worldRight; worldX += spacing) {
        const screen = screenFromWorld(worldX, state.worldY);
        ctx.beginPath();
        ctx.moveTo(screen.x, 0);
        ctx.lineTo(screen.x, height);
        ctx.stroke();
    }
    for (let worldY = startY; worldY <= worldBottom; worldY += spacing) {
        const screen = screenFromWorld(state.worldX, worldY);
        ctx.beginPath();
        ctx.moveTo(0, screen.y);
        ctx.lineTo(width, screen.y);
        ctx.stroke();
    }
    ctx.restore();
}

function drawTarget(target) {
    const position = screenFromWorld(activePosition(target).x, activePosition(target).y);
    const glow = crosshairInsideTarget(target) ? 1 : 0.45;
    const renderRadius = target.radius / VIEW_SCALE;
    ctx.save();
    ctx.beginPath();
    ctx.arc(position.x, position.y, renderRadius, 0, Math.PI * 2);
    ctx.fillStyle = target.color;
    ctx.globalAlpha = glow;
    ctx.shadowColor = target.color;
    ctx.shadowBlur = crosshairInsideTarget(target) ? 26 : 14;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.stroke();
    if (state.scenario === "cants") {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 3;
        ctx.arc(position.x, position.y, renderRadius + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, state.dwellProgressMs / CANTS_DWELL_MS));
        ctx.stroke();
    }
    ctx.restore();
}

function renderScene() {
    ctx.clearRect(0, 0, viewWidth(), viewHeight());
    drawGrid();
    targets.forEach((target) => drawTarget(target));
    if (!state.running) {
        ctx.save();
        ctx.fillStyle = "rgba(0,255,102,0.7)";
        ctx.font = "700 18px Courier Prime";
        ctx.textAlign = "center";
        ctx.fillText(state.roundEnded ? "ROUND COMPLETE // PRESS START TO RUN AGAIN" : "PRESS START TO BEGIN", viewWidth() * 0.5, viewHeight() * 0.72);
        ctx.restore();
    }
}

function loop(now) {
    const dt = Math.min(0.05, (now - state.lastFrameTime) / 1000 || 0);
    state.lastFrameTime = now;
    updateScenario(dt);
    renderScene();
    requestAnimationFrame(loop);
}

modeSens.addEventListener("click", () => setControlMode("sens"));
modeCm.addEventListener("click", () => setControlMode("cm"));
bindNumberInput(inpSens, syncSensitivity);
bindNumberInput(inpDpi, syncSensitivity);
bindNumberInput(inpCm, syncSensitivity);
bindNumberInput(inpDuration, syncDuration);
scenarioButtons.forEach((button) => button.addEventListener("click", () => setScenario(button.dataset.scenario)));
runModeButtons.forEach((button) => button.addEventListener("click", () => setRunMode(button.dataset.mode)));
startRunBtn.addEventListener("click", startRun);
resetRunBtn.addEventListener("click", resetRun);
[xhPreset, xhCustom, xhAlpha, xhGap, xhLength, xhThickness, xhDotSize, xhOutlineSize, xhDot, xhOutline, xhTStyle].forEach((control) => {
    control.addEventListener("input", syncCrosshair);
    control.addEventListener("change", syncCrosshair);
});
xhReset.addEventListener("click", resetCrosshair);

document.addEventListener("keydown", (event) => {
    if (event.repeat || event.code !== "KeyL") { return; }
    const active = document.activeElement;
    const tag = active && active.tagName ? active.tagName : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || active?.isContentEditable) { return; }
    if (!state.locked) { requestLock(); }
});

document.addEventListener("pointerlockchange", () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) {
        banner.style.display = "none";
        state.inputStatus = state.pendingLockMode;
    } else {
        banner.style.display = "block";
        state.inputStatus = "WAITING FOR POINTER LOCK";
        setBanner("&gt; PRESS L TO LOCK MOUSE AND START AIM TRAINING<br><small>USE START TO BEGIN A RUN, ESC TO RELEASE POINTER LOCK</small>", false);
    }
    updateHud();
});

document.addEventListener("pointerlockerror", () => {
    state.inputStatus = "LOCK REQUEST BLOCKED";
    updateHud();
    setBanner("&gt; POINTER LOCK REQUEST FAILED<br><small>OPEN THIS PAGE DIRECTLY IN ITS OWN TAB OR WINDOW</small>", true);
});

document.addEventListener("mousemove", (event) => {
    if (!state.locked) { return; }
    const units = worldUnitsPerCount();
    state.worldX += event.movementX * units;
    state.worldY += event.movementY * units;
});

document.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
        handleShot();
    }
});

window.addEventListener("resize", () => {
    resizeCanvas();
    initializeScenarioTargets();
});

setupPanels();
hydrateStoredControls();
setControlMode(state.controlMode);
syncDuration();
syncCrosshair();
setScenario("1w6t");
setRunMode("timed");
resizeCanvas();
setBanner("&gt; PRESS L TO LOCK MOUSE AND START AIM TRAINING<br><small>USE START TO BEGIN A RUN, ESC TO RELEASE POINTER LOCK</small>", false);
updateHud();
requestAnimationFrame(loop);



