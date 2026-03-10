window.TrainerSettings = (() => {
    const STORAGE_KEY = "turky_trainer_settings_v1";

    const defaults = {
        mode: "sens",
        sens: 1,
        dpi: 800,
        cm360: 41.59,
        crosshair: {
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
        }
    };

    function cloneDefaults() {
        return JSON.parse(JSON.stringify(defaults));
    }

    function mergeCrosshair(input) {
        return { ...defaults.crosshair, ...(input || {}) };
    }

    function sanitize(input) {
        const safe = cloneDefaults();
        if (!input || typeof input !== "object") {
            return safe;
        }

        safe.mode = input.mode === "cm" ? "cm" : "sens";

        if (Number.isFinite(input.sens)) {
            safe.sens = input.sens;
        }
        if (Number.isFinite(input.dpi)) {
            safe.dpi = input.dpi;
        }
        if (Number.isFinite(input.cm360)) {
            safe.cm360 = input.cm360;
        }

        safe.crosshair = mergeCrosshair(input.crosshair);
        return safe;
    }

    function load() {
        try {
            return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
        } catch (error) {
            return cloneDefaults();
        }
    }

    function save(partial) {
        const current = load();
        const next = sanitize({
            ...current,
            ...(partial || {}),
            crosshair: {
                ...current.crosshair,
                ...((partial && partial.crosshair) || {})
            }
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
    }

    return {
        defaults: cloneDefaults(),
        load,
        save
    };
})();
