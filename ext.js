var curvaseApp = (function() {
    "use strict";
    var csInterface, editor;

    var sel = {ci: -1, pi: -1};
    var drag = null;

    var categories = [
        { name: "Standard", open: true, items: [
            { name: "Linear",      x1: 0.00, y1: 0.00, x2: 1.00, y2: 1.00 },
            { name: "Ease",        x1: 0.25, y1: 0.10, x2: 0.25, y2: 1.00 },
            { name: "Ease In",     x1: 0.42, y1: 0.00, x2: 1.00, y2: 1.00 },
            { name: "Ease Out",    x1: 0.00, y1: 0.00, x2: 0.58, y2: 1.00 },
            { name: "Ease In Out", x1: 0.42, y1: 0.00, x2: 0.58, y2: 1.00 }
        ]},
        { name: "Fast", open: true, items: [
            { name: "Fast 1", x1: 0.00, y1: 1.00, x2: 1.00, y2: 1.00 },
            { name: "Fast 2", x1: 0.00, y1: 1.00, x2: 0.50, y2: 1.00 },
            { name: "Fast 3", x1: 0.00, y1: 1.00, x2: 0.00, y2: 1.00 }
        ]},
        { name: "Slow", open: true, items: [
            { name: "Slow 1", x1: 1.00, y1: 0.00, x2: 0.00, y2: 0.00 },
            { name: "Slow 2", x1: 0.50, y1: 0.00, x2: 0.00, y2: 0.00 },
            { name: "Slow 3", x1: 0.00, y1: 0.00, x2: 0.00, y2: 0.00 }
        ]},
        { name: "Custom", open: true, items: [
            { name: "Urgent",  x1: 0.00, y1: 1.00, x2: 0.00, y2: 0.00 },
            { name: "Brisk",   x1: 1.00, y1: 1.00, x2: 0.00, y2: 1.00 },
            { name: "Uniform", x1: 1.00, y1: 0.00, x2: 1.00, y2: 1.00 },
            { name: "Stark",   x1: 0.00, y1: 0.00, x2: 1.00, y2: 0.00 },
            { name: "None",    x1: 0.00, y1: 0.00, x2: 0.00, y2: 1.00 },
            { name: "Rough",   x1: 1.00, y1: 0.00, x2: 0.00, y2: 1.00 },
            { name: "Exposed", x1: 1.00, y1: 1.00, x2: 0.00, y2: 0.00 },
            { name: "Inverse", x1: 1.00, y1: 1.00, x2: 1.00, y2: 1.00 },
            { name: "Default", x1: 0.00, y1: 0.00, x2: 0.00, y2: 0.00 }
        ]}
    ];

    function clamp01(v) {
        if (v < 0) return 0;
        if (v > 1) return 1;
        return v;
    }

    function predictEaseFromBezier(x1, y1, x2, y2, avg) {
        var outInf = Math.min(100, Math.max(0.1, x1 * 100));
        var inInf = Math.min(100, Math.max(0.1, (1 - x2) * 100));
        var outSpd = (x1 > 0.001 && Math.abs(avg) > 1e-12) ? avg * (y1 / x1) : 0;
        var omx = 1 - x2;
        var inSpd = (omx > 0.001 && Math.abs(avg) > 1e-12) ? avg * ((1 - y2) / omx) : 0;
        return { outInf: outInf, inInf: inInf, outSpd: outSpd, inSpd: inSpd };
    }

    function refineBezierToApplyModel(b, k1, k2, outLinear, inLinear, primaryDim, dvPri, dt) {
        if (!b || Math.abs(dvPri) < 1e-9 || !(dt > 0)) return b;
        if (outLinear || inLinear) return b;
        var oe = k1.outEase || [];
        var ie = k2.inEase || [];
        var od = Math.min(primaryDim, Math.max(0, oe.length - 1));
        var id = Math.min(primaryDim, Math.max(0, ie.length - 1));
        var outE = oe[od] || { speed: 0, influence: 33 };
        var inE = ie[id] || { speed: 0, influence: 33 };
        var avg = dvPri / dt;
        var x1 = b.px1, y1 = b.py1, x2 = b.px2, y2 = b.py2;
        for (var it = 0; it < 5; it++) {
            var p = predictEaseFromBezier(x1, y1, x2, y2, avg);
            var dOI = Number(outE.influence) - p.outInf;
            var dII = Number(inE.influence) - p.inInf;
            var dOS = Number(outE.speed) - p.outSpd;
            var dIS = Number(inE.speed) - p.inSpd;
            if (Math.abs(dOI) + Math.abs(dII) + Math.abs(dOS) + Math.abs(dIS) < 0.08) break;
            x1 += dOI * 0.008;
            x2 -= dII * 0.008;
            x1 = clamp01(x1);
            x2 = clamp01(x2);
            if (x1 > 0.001 && Math.abs(avg) > 1e-12) y1 += (dOS / avg) * x1 * 0.35;
            var omx = 1 - x2;
            if (omx > 0.001 && Math.abs(avg) > 1e-12) y2 += -(dIS / avg) * omx * 0.35;
        }
        return { px1: x1, py1: y1, px2: x2, py2: y2 };
    }

    function easePairToNormalizedBezier(k1, k2, propData) {
        var dt = k2.time - k1.time;
        if (!(dt > 0)) return null;
        if (k1.outType === "HOLD" || k2.inType === "HOLD") return null;

        var outLinear = k1.outType === "LINEAR";
        var inLinear = k2.inType === "LINEAR";

        if (outLinear && inLinear) {
            return { px1: 0, py1: 0, px2: 1, py2: 1 };
        }

        var oe = k1.outEase || [];
        var ie = k2.inEase || [];
        var spatial = !!propData.spatial;
        var shape = !!propData.shape;
        var dims = propData.dimensions | 0;

        function dvAtDim(d) {
            if (shape) return 100;
            if (spatial) {
                var a = Array.isArray(k1.value) ? k1.value : [k1.value, 0, 0];
                var b = Array.isArray(k2.value) ? k2.value : [k2.value, 0, 0];
                var up = dims > 0 ? dims : 2;
                var sq = 0;
                for (var i = 0; i < up; i++) {
                    var dd = (Number(b[i]) || 0) - (Number(a[i]) || 0);
                    sq += dd * dd;
                }
                return Math.sqrt(sq);
            }
            if (dims <= 1) return Number(k2.value) - Number(k1.value);
            var a2 = Array.isArray(k1.value) ? k1.value : [k1.value];
            var b2 = Array.isArray(k2.value) ? k2.value : [k2.value];
            return (Number(b2[d]) || 0) - (Number(a2[d]) || 0);
        }

        var dimCount;
        if (shape || spatial) dimCount = 1;
        else dimCount = Math.max(oe.length || 0, ie.length || 0, dims || 1, 1);

        var sumW = 0;
        var ax1 = 0, ay1 = 0, ax2 = 0, ay2 = 0;
        var primaryDim = 0;
        var primaryAbs = 0;
        var primaryDv = 0;

        for (var d = 0; d < dimCount; d++) {
            var dv = dvAtDim(d);
            var w = Math.abs(dv);
            if (w < 1e-12) w = 1e-12;
            if (!spatial && !shape && Math.abs(dv) > primaryAbs) {
                primaryAbs = Math.abs(dv);
                primaryDim = d;
                primaryDv = dv;
            }
            if (spatial || shape) {
                primaryDim = 0;
                primaryDv = dv;
                primaryAbs = Math.abs(dv);
            }

            var outE = oe[Math.min(d, Math.max(0, oe.length - 1))] || { speed: 0, influence: 33 };
            var inE = ie[Math.min(d, Math.max(0, ie.length - 1))] || { speed: 0, influence: 33 };
            var avg = dv / dt;

            var x1, y1, x2, y2;
            if (outLinear) {
                x1 = 0;
                y1 = 0;
            } else {
                var oinf = Number(outE.influence);
                x1 = clamp01(oinf / 100);
                y1 = (Math.abs(avg) > 1e-12 && x1 > 1e-12) ? (Number(outE.speed) / avg) * x1 : 0;
            }
            if (inLinear) {
                x2 = 1;
                y2 = 1;
            } else {
                var iinf = Number(inE.influence);
                x2 = clamp01(1 - iinf / 100);
                var omx = 1 - x2;
                y2 = (Math.abs(avg) > 1e-12 && omx > 1e-12)
                    ? 1 - (Number(inE.speed) / avg) * omx
                    : 1;
            }

            ax1 += x1 * w;
            ay1 += y1 * w;
            ax2 += x2 * w;
            ay2 += y2 * w;
            sumW += w;
        }

        if (sumW < 1e-12) return null;

        var b = {
            px1: ax1 / sumW,
            py1: ay1 / sumW,
            px2: ax2 / sumW,
            py2: ay2 / sumW
        };
        b = refineBezierToApplyModel(b, k1, k2, outLinear, inLinear, primaryDim, primaryDv, dt);
        if (!isFinite(b.px1) || !isFinite(b.py1) || !isFinite(b.px2) || !isFinite(b.py2)) return null;
        b.px1 = clamp01(b.px1);
        b.px2 = clamp01(b.px2);
        return b;
    }

    var applyEaseToHost = null;

    function animClass(el, cls, duration) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        setTimeout(function() { el.classList.remove(cls); }, duration || 700);
    }

    function init() {
        try { csInterface = new CSInterface(); } catch(e) { return; }

        (function suppressHostContextMenu() {
            function allowNativeMenu(target) {
                var el = target;
                while (el) {
                    if (!el.tagName) break;
                    var tag = el.tagName.toUpperCase();
                    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
                    try {
                        if (el.getAttribute && el.getAttribute("contenteditable") === "true") return true;
                    } catch (x) {}
                    el = el.parentElement;
                }
                return false;
            }
            function kill(ev) {
                if (!ev || allowNativeMenu(ev.target)) return;
                ev.preventDefault();
            }
            if (window.addEventListener) {
                window.addEventListener("contextmenu", kill, true);
                document.addEventListener("contextmenu", kill, true);
            }
            document.oncontextmenu = function(ev) {
                if (ev && allowNativeMenu(ev.target)) return true;
                return false;
            };
        })();

        var toastEl = document.getElementById("status-toast");
        var toastTimer = null;
        var toastQueue = [];
        var toastActive = false;
        function showToast(message, variant) {
            if (!toastEl || !message) return;
            toastQueue.push({ message: message, variant: variant });
            processToastQueue();
        }
        function processToastQueue() {
            if (toastActive || toastQueue.length === 0) return;
            toastActive = true;
            var current = toastQueue.shift();
            function displayNext() {
                toastEl.textContent = current.message;
                toastEl.classList.remove("is-error", "is-info", "is-success");
                if (current.variant === "error") toastEl.classList.add("is-error");
                else if (current.variant === "info") toastEl.classList.add("is-info");
                else if (current.variant === "success") toastEl.classList.add("is-success");
                toastEl.classList.add("is-visible");
                if (toastTimer) clearTimeout(toastTimer);
                toastTimer = setTimeout(function() {
                    toastEl.classList.remove("is-visible");
                    setTimeout(function() {
                        toastActive = false;
                        processToastQueue();
                    }, 300);
                }, 3000);
            }
            if (toastEl.classList.contains("is-visible")) {
                toastEl.classList.remove("is-visible");
                setTimeout(displayNext, 250);
            } else {
                displayNext();
            }
        }

        var curveGraphCtxEl = null;
        var curveGraphOutsideClose = null;
        var curveGraphLastRmbMs = 0;

        function hideCurveGraphContextMenu() {
            if (curveGraphCtxEl) curveGraphCtxEl.style.display = "none";
            if (curveGraphOutsideClose) {
                document.removeEventListener("mousedown", curveGraphOutsideClose, true);
                curveGraphOutsideClose = null;
            }
        }

        editor = new Curvase.BezierEditor("curve-canvas");
        editor.onUpdate = syncInputs;
        editor.onHistoryChange = function() {
            var u = document.getElementById("btn-undo");
            var r = document.getElementById("btn-redo");
            if (u) u.disabled = !editor._history.length;
            if (r) r.disabled = !editor._future.length;
        };
        editor.onHistoryChange();

        loadData();
        render();

        var demakLogic = "if (typeof $._demak === 'undefined') { $._demak = {}; }" +
            "$._demak.moveAnchor = function(x, y) {" +
            "  app.beginUndoGroup('Move Anchor');" +
            "  var comp = app.project.activeItem;" +
            "  if (!(comp instanceof CompItem)) { app.endUndoGroup(); return; }" +
            "  var sel = comp.selectedLayers;" +
            "  if (sel.length === 0) { app.endUndoGroup(); return; }" +
            "  for (var i = 0; i < sel.length; i++) {" +
            "    var L = sel[i];" +
            "    if (!L.source && L.nullLayer) continue;" +
            "    var oldAnchor = L.anchorPoint.value;" +
            "    var newAnchor = [];" +
            "    for (var a = 0; a < oldAnchor.length; a++) newAnchor.push(oldAnchor[a]);" +
            "    var r;" +
            "    try { r = L.sourceRectAtTime(comp.time, false); } catch(e) { continue; }" +
            "    if (x === 'left')   newAnchor[0] = r.left;" +
            "    if (x === 'center') newAnchor[0] = r.left + r.width / 2;" +
            "    if (x === 'right')  newAnchor[0] = r.left + r.width;" +
            "    if (y === 'top')    newAnchor[1] = r.top;" +
            "    if (y === 'middle') newAnchor[1] = r.top + r.height / 2;" +
            "    if (y === 'bottom') newAnchor[1] = r.top + r.height;" +
            "    var anchorDelta = [];" +
            "    for (var d = 0; d < oldAnchor.length; d++) anchorDelta.push(newAnchor[d] - oldAnchor[d]);" +
            "    L.anchorPoint.setValue(newAnchor);" +
            "    var oldPos = L.position.value;" +
            "    var newPos = [];" +
            "    for (var p = 0; p < oldPos.length; p++) {" +
            "      var sv = (L.scale.value[p] !== undefined) ? (L.scale.value[p] / 100) : 1;" +
            "      var dv = (anchorDelta[p] !== undefined) ? anchorDelta[p] : 0;" +
            "      newPos.push(oldPos[p] + dv * sv);" +
            "    }" +
            "    L.position.setValue(newPos);" +
            "  }" +
            "  app.endUndoGroup();" +
            "};" +
            "$._demak.alignLayer = function(x, y) {" +
            "  app.beginUndoGroup('Align Layer');" +
            "  var comp = app.project.activeItem;" +
            "  if (!(comp instanceof CompItem)) { app.endUndoGroup(); return; }" +
            "  var sel = comp.selectedLayers;" +
            "  if (sel.length === 0) { app.endUndoGroup(); return; }" +
            "  for (var i = 0; i < sel.length; i++) {" +
            "    var L = sel[i];" +
            "    var pos = L.position.value;" +
            "    var newPos = [];" +
            "    for (var p = 0; p < pos.length; p++) newPos.push(pos[p]);" +
            "    var scaleX = L.scale.value[0] / 100;" +
            "    var scaleY = L.scale.value[1] / 100;" +
            "    var rect;" +
            "    try { rect = L.sourceRectAtTime(comp.time, false); } catch(e) { continue; }" +
            "    var anchorX = L.anchorPoint.value[0];" +
            "    var anchorY = L.anchorPoint.value[1];" +
            "    var layerW = rect.width  * scaleX;" +
            "    var layerH = rect.height * scaleY;" +
            "    var offX = (anchorX - rect.left) * scaleX;" +
            "    var offY = (anchorY - rect.top)  * scaleY;" +
            "    if (x === 'left')   newPos[0] = offX;" +
            "    else if (x === 'center') newPos[0] = (comp.width  / 2) - (layerW / 2) + offX;" +
            "    else if (x === 'right')  newPos[0] = comp.width  - layerW + offX;" +
            "    if (y === 'top')    newPos[1] = offY;" +
            "    else if (y === 'middle') newPos[1] = (comp.height / 2) - (layerH / 2) + offY;" +
            "    else if (y === 'bottom') newPos[1] = comp.height - layerH + offY;" +
            "    L.position.setValue(newPos);" +
            "  }" +
            "  app.endUndoGroup();" +
            "};";
        csInterface.evalScript(demakLogic);

        var btnMode = document.getElementById("ext-name");
        var viewCurve = document.getElementById("view-curve");
        var viewTools = document.getElementById("view-tools");
        var isToolsMode = false;

        var inspectorTimeout = null;
        var isInspecting = false;

        var INSP_PROPS = [
            { mn: "ADBE Position",    label: "Position",    dims: 3, dl: ["X","Y","Z"] },
            { mn: "ADBE Anchor Point",label: "Anchor",      dims: 3, dl: ["X","Y","Z"] },
            { mn: "ADBE Scale",       label: "Scale",       dims: 3, dl: ["X","Y","Z"] },
            { mn: "ADBE Rotate Z",    label: "Rotation",    dims: 1, dl: ["Z"] },
            { mn: "ADBE Orientation", label: "Orientation", dims: 3, dl: ["X","Y","Z"] },
            { mn: "ADBE Opacity",     label: "Opacity",     dims: 1, dl: [""] }
        ];

        function renderInspector(data) {
            var nameEl = document.getElementById("inspector-layer-name");
            var rows   = document.getElementById("inspector-rows");
            if (!rows) return;

            if (!data || data.error) {
                nameEl.textContent = data && data.error === "no_layer" ? "— no layer selected —" : "— no comp —";
                rows.innerHTML = "";
                return;
            }

            nameEl.textContent = data.name;

            var valMap = {
                "ADBE Position":     data.pos,
                "ADBE Anchor Point": data.anc,
                "ADBE Scale":        data.scl,
                "ADBE Rotate Z":     data.rot,
                "ADBE Orientation":  data.ori,
                "ADBE Opacity":      data.opa
            };

            if (rows.dataset.layer !== data.name) {
                rows.innerHTML = "";
                rows.dataset.layer = data.name;

                INSP_PROPS.forEach(function(prop) {
                    var val = valMap[prop.mn];
                    var actualDims = (val !== null && val !== undefined && Array.isArray(val))
                        ? val.length : 1;
                    if (!data.is3D && (prop.mn === "ADBE Orientation")) return;

                    var row = document.createElement("div");
                    row.className = "insp-row";
                    row.dataset.mn = prop.mn;

                    var lbl = document.createElement("span");
                    lbl.className = "insp-label";
                    lbl.textContent = prop.label;
                    row.appendChild(lbl);

                    var fields = document.createElement("div");
                    fields.className = "insp-fields";

                    var useDims = Math.min(actualDims, data.is3D ? 3 : 2);
                    if (prop.dims === 1) useDims = 1;

                    for (var d = 0; d < useDims; d++) {
                        (function(dimIdx) {
                            var wrap = document.createElement("div");
                            wrap.className = "insp-field";

                            if (prop.dl[dimIdx]) {
                                var dlbl = document.createElement("span");
                                dlbl.className = "insp-dim-label";
                                dlbl.textContent = prop.dl[dimIdx];
                                wrap.appendChild(dlbl);
                            }

                            var inp = document.createElement("input");
                            inp.type = "number";
                            inp.className = "insp-input";
                            inp.step = (prop.mn === "ADBE Scale" || prop.mn === "ADBE Opacity") ? "1" : "0.1";
                            inp.dataset.dim = dimIdx;

                            inp.addEventListener("change", function() {
                                var v = parseFloat(this.value);
                                if (isNaN(v)) return;
                                csInterface.evalScript(
                                    "$._curvase.setLayerProp('" + prop.mn + "'," + dimIdx + "," + v + ")"
                                );
                            });

                            inp.addEventListener("keydown", function(e) {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                    this.blur();
                                }
                            });

                            wrap.appendChild(inp);
                            fields.appendChild(wrap);
                        })(d);
                    }

                    row.appendChild(fields);
                    rows.appendChild(row);
                });
            }

            INSP_PROPS.forEach(function(prop) {
                var val = valMap[prop.mn];
                var rowEl = rows.querySelector('[data-mn="' + prop.mn + '"]');
                if (!rowEl) return;

                var flag = data.anim && data.anim[prop.mn];
                var lbl = rowEl.querySelector(".insp-label");
                if (lbl) {
                    lbl.classList.toggle("is-animated", flag >= 1);
                    lbl.classList.toggle("is-at-key",   flag === 2);
                }

                var inputs = rowEl.querySelectorAll(".insp-input");
                inputs.forEach(function(inp, d) {
                    if (document.activeElement === inp) return;
                    var v = Array.isArray(val) ? val[d] : val;
                    if (v !== null && v !== undefined) {
                        inp.value = Math.round(v * 100) / 100;
                    }
                });
            });
        }

        function startInspector() {
            if (isInspecting) return;
            isInspecting = true;
            pollInspector();
        }

        function pollInspector() {
            if (!isInspecting) return;
            csInterface.evalScript("$._curvase.getLayerProps()", function(res) {
                if (!isInspecting) return;
                try {
                    renderInspector(JSON.parse(res));
                } catch(e) {
                    renderInspector(null);
                }
                inspectorTimeout = setTimeout(pollInspector, 350);
            });
        }

        function stopInspector() {
            isInspecting = false;
            if (inspectorTimeout) {
                clearTimeout(inspectorTimeout);
                inspectorTimeout = null;
            }
            var rows = document.getElementById("inspector-rows");
            if (rows) { rows.innerHTML = ""; rows.dataset.layer = ""; }
            var nameEl = document.getElementById("inspector-layer-name");
            if (nameEl) nameEl.textContent = "";
        }

        var modeBadge = document.getElementById("header-mode-badge");


        btnMode.onclick = function() {
            isToolsMode = !isToolsMode;
            var from = isToolsMode ? viewCurve : viewTools;
            var to   = isToolsMode ? viewTools  : viewCurve;
            animClass(btnMode, "brand-pop", 560);
            if (modeBadge) {
                modeBadge.textContent = isToolsMode ? "Tools" : "Curve";
                modeBadge.classList.toggle("mode-badge--tools", isToolsMode);
                animClass(modeBadge, "mode-badge--pop", 680);
            }
            from.classList.add("view-exit");
            setTimeout(function() {
                from.style.display = "none";
                from.classList.remove("view-exit");
                to.style.display = isToolsMode ? "flex" : "flex";
                to.classList.add("view-enter");

                if (isToolsMode) {
                    var layout = to.querySelector(".tools-layout");
                    if (layout) {
                        layout.classList.remove("tools-enter");
                        void layout.offsetWidth;
                        layout.classList.add("tools-enter");
                        setTimeout(function() { layout.classList.remove("tools-enter"); }, 600);
                    }
                }
                setTimeout(function() { to.classList.remove("view-enter"); }, 480);
            }, 300);
            btnMode.classList.toggle("tools-active", isToolsMode);
            isToolsMode ? startInspector() : stopInspector();
        };

        function bindDemakBtn(id, scriptStr) {
            var el = document.getElementById(id);
            if (!el) return;
            el.onclick = function(e) {

                var ripple = document.createElement("span");
                ripple.className = "btn-ripple";
                var rect = el.getBoundingClientRect();
                ripple.style.left = (e.clientX - rect.left) + "px";
                ripple.style.top  = (e.clientY - rect.top)  + "px";
                el.appendChild(ripple);
                setTimeout(function() { ripple.remove(); }, 520);
                csInterface.evalScript(scriptStr);
            };
        }

        bindDemakBtn("anc-tl", "$._demak.moveAnchor('left', 'top')");
        bindDemakBtn("anc-tc", "$._demak.moveAnchor('center', 'top')");
        bindDemakBtn("anc-tr", "$._demak.moveAnchor('right', 'top')");
        bindDemakBtn("anc-ml", "$._demak.moveAnchor('left', 'middle')");
        bindDemakBtn("anc-mc", "$._demak.moveAnchor('center', 'middle')");
        bindDemakBtn("anc-mr", "$._demak.moveAnchor('right', 'middle')");
        bindDemakBtn("anc-bl", "$._demak.moveAnchor('left', 'bottom')");
        bindDemakBtn("anc-bc", "$._demak.moveAnchor('center', 'bottom')");
        bindDemakBtn("anc-br", "$._demak.moveAnchor('right', 'bottom')");

        bindDemakBtn("ali-tl", "$._demak.alignLayer('left', 'top')");
        bindDemakBtn("ali-tc", "$._demak.alignLayer('center', 'top')");
        bindDemakBtn("ali-tr", "$._demak.alignLayer('right', 'top')");
        bindDemakBtn("ali-ml", "$._demak.alignLayer('left', 'middle')");
        bindDemakBtn("ali-mc", "$._demak.alignLayer('center', 'middle')");
        bindDemakBtn("ali-mr", "$._demak.alignLayer('right', 'middle')");
        bindDemakBtn("ali-bl", "$._demak.alignLayer('left', 'bottom')");
        bindDemakBtn("ali-bc", "$._demak.alignLayer('center', 'bottom')");
        bindDemakBtn("ali-br", "$._demak.alignLayer('right', 'bottom')");

        var GRID_CELL_XY = {
            tl: ["left", "top"], tc: ["center", "top"], tr: ["right", "top"],
            ml: ["left", "middle"], mc: ["center", "middle"], mr: ["right", "middle"],
            bl: ["left", "bottom"], bc: ["center", "bottom"], br: ["right", "bottom"]
        };
        function flipGridAxisX(x) {
            if (x === "left") return "right";
            if (x === "right") return "left";
            return "center";
        }
        function flipGridAxisY(y) {
            if (y === "top") return "bottom";
            if (y === "bottom") return "top";
            return "middle";
        }

        var gridCtxMenuEl = null;
        var gridCtxPendingBtnId = "";
        var gridCtxOutsideClose = null;
        var gridCtxLastPointerOpenMs = 0;

        function hideGridContextMenu() {
            if (gridCtxMenuEl) gridCtxMenuEl.style.display = "none";
            gridCtxPendingBtnId = "";
            if (gridCtxOutsideClose) {
                document.removeEventListener("mousedown", gridCtxOutsideClose, true);
                gridCtxOutsideClose = null;
            }
        }

        function ensureGridContextMenu() {
            if (gridCtxMenuEl) return gridCtxMenuEl;
            gridCtxMenuEl = document.createElement("div");
            gridCtxMenuEl.className = "grid-context-menu";
            gridCtxMenuEl.style.display = "none";
            var item = document.createElement("button");
            item.type = "button";
            item.className = "grid-context-menu-item";
            item.textContent = "Reverse value";
            item.addEventListener("mousedown", function(ev) { ev.stopPropagation(); });
            item.addEventListener("click", function() {
                var id = gridCtxPendingBtnId;
                if (!id) { hideGridContextMenu(); return; }
                var dash = id.indexOf("-");
                if (dash < 0) { hideGridContextMenu(); return; }
                var prefix = id.substring(0, dash);
                var cell = id.substring(dash + 1);
                var xy = GRID_CELL_XY[cell];
                if (!xy) { hideGridContextMenu(); return; }
                var rx = flipGridAxisX(xy[0]);
                var ry = flipGridAxisY(xy[1]);
                if (prefix === "anc") {
                    csInterface.evalScript("$._demak.moveAnchor('" + rx + "','" + ry + "')");
                } else if (prefix === "ali") {
                    csInterface.evalScript("$._demak.alignLayer('" + rx + "','" + ry + "')");
                }
                hideGridContextMenu();
            });
            gridCtxMenuEl.appendChild(item);
            return gridCtxMenuEl;
        }

        function showGridContextMenu(e, btnId) {
            if (e.preventDefault) e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            hideGridContextMenu();
            hideCurveGraphContextMenu();
            gridCtxPendingBtnId = btnId;
            var menu = ensureGridContextMenu();
            var host = document.getElementById("curvase-app") || document.body;
            if (menu.parentNode !== host) host.appendChild(menu);
            var br = host.getBoundingClientRect();
            menu.style.position = "absolute";
            menu.style.display = "block";
            var lx = e.clientX - br.left + (host.scrollLeft || 0);
            var ly = e.clientY - br.top + (host.scrollTop || 0);
            menu.style.left = lx + "px";
            menu.style.top = ly + "px";
            gridCtxOutsideClose = function(ev) {
                if (gridCtxMenuEl && gridCtxMenuEl.contains(ev.target)) return;
                hideGridContextMenu();
            };
            document.addEventListener("mousedown", gridCtxOutsideClose, true);
        }

        (function bindGridReverseMenusDelegated() {
            var vt = document.getElementById("view-tools");
            if (!vt) return;

            function gridBtnFromTarget(t) {
                while (t && t !== vt) {
                    if (t.classList && t.classList.contains("grid-btn")) return t;
                    t = t.parentElement;
                }
                return null;
            }

            vt.addEventListener("mousedown", function(ev) {
                if (ev.button !== 2) return;
                var btn = gridBtnFromTarget(ev.target);
                if (!btn) return;
                ev.preventDefault();
                ev.stopPropagation();
                gridCtxLastPointerOpenMs = Date.now();
                showGridContextMenu(ev, btn.id);
            }, true);

            vt.addEventListener("contextmenu", function(ev) {
                var btn = gridBtnFromTarget(ev.target);
                if (!btn) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (Date.now() - gridCtxLastPointerOpenMs < 600) return;
                showGridContextMenu(ev, btn.id);
            });
        })();

        function getCompRatio() {
            var ratioEl = document.getElementById("tool-comp-ratio");
            return ratioEl ? ratioEl.value : "16:9";
        }

        function addRipple(el, e) {
            var ripple = document.createElement("span");
            ripple.className = "btn-ripple";
            var rect = el.getBoundingClientRect();
            ripple.style.left = (e.clientX - rect.left) + "px";
            ripple.style.top  = (e.clientY - rect.top)  + "px";
            el.appendChild(ripple);
            setTimeout(function() { ripple.remove(); }, 580);
        }

        function spawnParticles(el) {
            var rect = el.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var colors = ["#00d4aa", "#4a9eff", "#ff8c42", "#ffffff"];
            for (var i = 0; i < 10; i++) {
                (function(idx) {
                    var p = document.createElement("div");
                    p.className = "apply-particle";
                    var angle = (idx / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
                    var dist = 28 + Math.random() * 32;
                    p.style.setProperty("--px", Math.cos(angle) * dist + "px");
                    p.style.setProperty("--py", Math.sin(angle) * dist + "px");
                    p.style.left = cx + "px";
                    p.style.top  = cy + "px";
                    p.style.background = colors[idx % colors.length];
                    p.style.animationDelay = (idx * 28) + "ms";
                    document.body.appendChild(p);
                    setTimeout(function() { p.remove(); }, 800);
                })(i);
            }
        }

        function bindToolBtn(id, scriptFn) {
            var el = document.getElementById(id);
            if (!el) return;
            el.onclick = function(e) {
                addRipple(el, e);
                csInterface.evalScript(scriptFn());
            };
        }

        bindToolBtn("tool-make-comp",  function() { return "buatCompCustom('" + getCompRatio() + "')"; });
        bindToolBtn("tool-solid-fill", function() { return "buatSolidFill('" + getCompRatio() + "')"; });
        bindToolBtn("tool-cam-15",     function() { return "buatKamera15mm('" + getCompRatio() + "')"; });
        bindToolBtn("tool-null-parent",function() { return "buatNullParent()"; });
        bindToolBtn("tool-text-center",function() { return "buatTeksTengah('" + getCompRatio() + "')"; });
        bindToolBtn("tool-adj-comp",   function() { return "buatAdjComp()"; });
        bindToolBtn("tool-adj-layer",  function() { return "buatAdjLayer()"; });
        bindToolBtn("tool-precomp",    function() { return "buatPrecompose()"; });
        bindToolBtn("tool-light",      function() { return "buatLight('" + getCompRatio() + "')"; });

        var btnSpeed = document.getElementById("btn-speed-mode");
        btnSpeed.onclick = function() {
            if (editor.toggleMode) editor.toggleMode();
            this.classList.toggle("active", editor.isSpeedMode);
            animClass(this, "pop", 520);
        };

        document.getElementById("preset-search").addEventListener("input", function() {
            applyFilter(this.value);
        });
        document.getElementById("preset-search").addEventListener("keydown", function(e) {
            e.stopPropagation();
        });

        var savePresetModal = document.getElementById("save-preset-modal");
        var savePresetNameEl = document.getElementById("save-preset-name");
        var savePresetCatEl = document.getElementById("save-preset-cat");
        var savePresetNewCatEl = document.getElementById("save-preset-newcat");

        function openSavePresetModal() {
            savePresetNameEl.value = "";
            savePresetNewCatEl.value = "";
            savePresetNewCatEl.style.display = "none";
            savePresetCatEl.innerHTML = "";
            for (var ci = 0; ci < categories.length; ci++) {
                var opt = document.createElement("option");
                opt.value = String(ci);
                opt.textContent = categories[ci].name;
                savePresetCatEl.appendChild(opt);
            }
            var newOpt = document.createElement("option");
            newOpt.value = "new";
            newOpt.textContent = "New category…";
            savePresetCatEl.appendChild(newOpt);
            savePresetModal.classList.remove("modal-closing");
            savePresetModal.classList.add("modal-open");
            setTimeout(function() { savePresetNameEl.focus(); }, 60);
        }

        function closeSavePresetModal() {
            savePresetModal.classList.add("modal-closing");
            setTimeout(function() {
                savePresetModal.classList.remove("modal-open", "modal-closing");
            }, 150);
        }

        savePresetCatEl.onchange = function() {
            savePresetNewCatEl.style.display = this.value === "new" ? "block" : "none";
        };

        savePresetModal.addEventListener("click", function(e) {
            if (e.target === savePresetModal) closeSavePresetModal();
        });

        document.getElementById("btn-save-preset-cancel").onclick = closeSavePresetModal;

        savePresetNameEl.addEventListener("keydown", function(e) {
            e.stopPropagation();
            if (e.key === "Enter") document.getElementById("btn-save-preset-confirm").click();
        });
        savePresetNewCatEl.addEventListener("keydown", function(e) {
            e.stopPropagation();
            if (e.key === "Enter") document.getElementById("btn-save-preset-confirm").click();
        });

        document.getElementById("btn-save-preset-confirm").onclick = function() {
            var name = savePresetNameEl.value.trim();
            if (!name) { showToast("Enter a preset name.", "error"); return; }
            var catIdx = savePresetCatEl.value;
            var targetCat;
            if (catIdx === "new") {
                var newName = savePresetNewCatEl.value.trim();
                if (!newName) { showToast("Enter a category name.", "error"); return; }
                targetCat = { name: newName, open: true, items: [] };
                categories.push(targetCat);
            } else {
                targetCat = categories[parseInt(catIdx, 10)];
            }
            if (!targetCat) { showToast("Invalid category.", "error"); return; }
            var v = editor.getValues();
            targetCat.items.push({ name: name, x1: v[0], y1: v[1], x2: v[2], y2: v[3] });
            saveData();
            scheduleRender();
            closeSavePresetModal();
            showToast("Preset \"" + name + "\" saved.", "success");
        };

        document.getElementById("btn-save-preset").onclick = openSavePresetModal;

        document.getElementById("btn-delete-selected").onclick = function() {
            if (sel.ci === -1) return;
            if (sel.ci === 0) {
                if (sel.pi === -1) {
                    showToast("Cannot delete Favorites category.", "info");
                    return;
                }
                var favItem = favoritesList[sel.pi];
                if (favItem) {
                    toggleFavorite(favItem, true);
                }
            } else {
                var realCatIdx = sel.ci - 1;
                if (sel.pi === -1) {
                    var catName = categories[realCatIdx] ? categories[realCatIdx].name : "";
                    var btn = this;
                    if (btn.dataset.pendingDelete === catName) {
                        categories.splice(realCatIdx, 1);
                        sel = {ci: -1, pi: -1};
                        saveData();
                        scheduleRender();
                        delete btn.dataset.pendingDelete;
                        showToast("Category deleted.", "info");
                    } else {
                        btn.dataset.pendingDelete = catName;
                        showToast("Click delete again to confirm removing \"" + catName + "\".", "info");
                        var self = this;
                        setTimeout(function() { delete self.dataset.pendingDelete; }, 3500);
                    }
                    return;
                } else {
                    var targetPreset = categories[realCatIdx].items[sel.pi];
                    if (targetPreset) {
                        var targetId = getPresetId(targetPreset);
                        favoritesList = favoritesList.filter(function(fp) {
                            return getPresetId(fp) !== targetId;
                        });
                        saveFavorites();
                    }
                    categories[realCatIdx].items.splice(sel.pi, 1);
                }
            }
            sel = {ci: -1, pi: -1};
            saveData();
            scheduleRender();
        };

        document.getElementById("btn-export-preset").onclick = function() {
            if (window.cep && window.cep.fs) {
                var data = JSON.stringify(categories, null, 2);
                var result = window.cep.fs.showSaveDialogEx("Save Presets", "", ["json"], "curvase_presets.json");
                if (result.data) {
                    if (window.cep.fs.writeFile(result.data, data).err !== 0) alert("Save failed.");
                }
            } else { alert("CEP filesystem not available."); }
        };

        document.getElementById("btn-import-preset").onclick = function() {
            if (window.cep && window.cep.fs) {
                var result = window.cep.fs.showOpenDialogEx(false, false, "Import Presets", "", ["json"]);
                if (result.data && result.data.length > 0) {
                    var readResult = window.cep.fs.readFile(result.data[0]);
                    if (readResult.err === 0) {
                        try {
                            var imported = JSON.parse(readResult.data);

                            if (Array.isArray(imported) && imported.length && imported[0].items) {

                                imported.forEach(function(ic) {
                                    var existing = categories.filter(function(c) { return c.name === ic.name; })[0];
                                    if (existing) existing.items = existing.items.concat(ic.items);
                                    else categories.push(ic);
                                });
                            } else if (Array.isArray(imported)) {

                                var last = categories[categories.length - 1];
                                last.items = last.items.concat(imported);
                            } else { alert("Invalid preset format."); return; }
                            saveData(); render();
                        } catch(err) { alert("Failed to read preset file."); }
                    } else { alert("Failed to open file."); }
                }
            } else { alert("CEP filesystem not available."); }
        };

        var editModal = document.getElementById("edit-modal");
        var bezierDisplay = document.getElementById("bezier-display");

        bezierDisplay.onclick = function() {
            var v = editor.getValues();
            document.getElementById("m-bezier-val").value = v[0].toFixed(2) + ", " + v[1].toFixed(2) + ", " + v[2].toFixed(2) + ", " + v[3].toFixed(2);
            editModal.classList.remove("modal-closing");
            editModal.classList.add("modal-open");
            setTimeout(function() {
                var inp = document.getElementById("m-bezier-val");
                if (inp) { inp.focus(); inp.select(); }
            }, 50);
        };

        function closeModal() {
            editModal.classList.add("modal-closing");
            setTimeout(function() {
                editModal.classList.remove("modal-open", "modal-closing");
            }, 150);
        }

        editModal.addEventListener("click", function(e) {
            if (e.target === editModal) closeModal();
        });
        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape" && editModal.classList.contains("modal-open")) {
                closeModal();
            } else if (e.key === "Escape" && themeModal && themeModal.classList.contains("modal-open")) {
                closeThemeModal();
            } else if (e.key === "Escape" && bounceModal && bounceModal.classList.contains("modal-open")) {
                closeBounceModal();
            } else if (e.key === "Escape" && loopModal && loopModal.classList.contains("modal-open")) {
                closeLoopModal();
            }
        });

        document.getElementById("btn-modal-cancel").onclick = closeModal;

        document.getElementById("m-bezier-val").addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("btn-modal-save").click();
            }
        });

        document.getElementById("btn-modal-save").onclick = function() {
            var valStr = document.getElementById("m-bezier-val").value;
            var parts = valStr.split(",");

            if (parts.length === 4) {
                var nx1 = parseFloat(parts[0].trim());
                var ny1 = parseFloat(parts[1].trim());
                var nx2 = parseFloat(parts[2].trim());
                var ny2 = parseFloat(parts[3].trim());

                if (!isNaN(nx1) && !isNaN(ny1) && !isNaN(nx2) && !isNaN(ny2)) {
                    editor.setEndHandles(nx1, ny1, nx2, ny2);
                    syncInputs();
                    closeModal();
                    showToast("Curve values updated.", "success");
                } else {
                    showToast("Enter four valid numbers separated by commas.", "error");
                }
            } else {
                showToast("Need four values: x1, y1, x2, y2 — e.g. 0.25, 0.1, 0.25, 1", "error");
            }
        };

        var resizer = document.getElementById("resizer");
        var presetsPanel = document.getElementById("presets-panel");
        var controlsPanel = document.getElementById("controls");
        var isResizing = false;
        var startY, startHeight;
        var resizeRafId = 0;

        function updatePresetsCollapsedState(heightPx) {
            if (!controlsPanel) return;
            controlsPanel.classList.toggle("presets-collapsed", heightPx <= 6);
        }

        updatePresetsCollapsedState(parseInt(window.getComputedStyle(presetsPanel).height, 10) || 0);

        resizer.addEventListener('mousedown', function(e) {
            isResizing = true;
            startY = e.clientY;
            startHeight = parseInt(window.getComputedStyle(presetsPanel).height, 10);
            document.documentElement.style.cursor = 'ns-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', function(e) {
            if (!isResizing) return;
            var dy = e.clientY - startY;
            var newHeight = startHeight - dy;

            if (newHeight < 16) {
                newHeight = 0;
            } else if (newHeight < 32) {
                newHeight = 32;
            }

            var maxH = window.innerHeight - 200;
            if (newHeight > maxH) newHeight = maxH;

            presetsPanel.style.height = newHeight + 'px';
            updatePresetsCollapsedState(newHeight);

            if (resizeRafId) cancelAnimationFrame(resizeRafId);
            resizeRafId = requestAnimationFrame(function() {
                resizeRafId = 0;
                editor.resize();
            });
        });

        window.addEventListener('mouseup', function() {
            if (isResizing) {
                isResizing = false;
                document.documentElement.style.cursor = 'default';
                if (resizeRafId) { cancelAnimationFrame(resizeRafId); resizeRafId = 0; }
                editor.resize();
            }
        });

        document.getElementById("btn-bg").onclick = function() { document.getElementById("bg-file-input").click(); };
        document.getElementById("bg-file-input").onchange = function(e) {
            var file = e.target.files[0];
            if (file) {
                var audioControls = document.getElementById('audio-controls');
                if (file.type.startsWith('video/')) {
                    if (audioControls) audioControls.classList.add('show-audio');
                    var reader = new FileReader();
                    reader.onload = function(ev) {
                        editor.setBackgroundImage(ev.target.result, "video");
                        setTimeout(function() {
                            if (editor.bgVideoElement) {
                                editor.bgVideoElement.muted = false;
                                editor.bgVideoElement.play();
                            }
                        }, 300);
                    };
                    reader.readAsDataURL(file);
                } else {
                    if (audioControls) audioControls.classList.remove('show-audio');
                    var reader = new FileReader();
                    reader.onload = function(ev) {
                        editor.setBackgroundImage(ev.target.result, "image");
                    };
                    reader.readAsDataURL(file);
                }
            }
        };

        var btnMute = document.getElementById("btn-mute");
        if (btnMute) {
            btnMute.onclick = function() {
                var isMuted = editor.toggleMute();
                this.textContent = isMuted ? "🔈" : "🔊";
            };
        }

        var volumeSlider = document.getElementById("volume-slider");
        if (volumeSlider) {
            volumeSlider.oninput = function() {
                editor.setVolume(parseFloat(this.value));
                if (btnMute) {
                    btnMute.textContent = parseFloat(this.value) === 0 ? "🔈" : "🔊";
                }
            };
        }

        (function initSpectrum() {
            var btnSpectrum = document.getElementById("btn-spectrum");
            if (!btnSpectrum) return;

            var audioCtxSpectrum  = null;
            var analyser          = null;
            var sourceNode        = null;
            var freqBuffer        = null;
            var rafId             = 0;
            var isRunning         = false;
            var connectedElement  = null;

            var FFT_SIZE  = 256;
            var SMOOTHING = 0.80;

            function ensureContext() {
                if (audioCtxSpectrum) {
                    if (audioCtxSpectrum.state === "suspended") audioCtxSpectrum.resume();
                    return true;
                }
                try {
                    audioCtxSpectrum = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) {
                    showToast("Web Audio API not available.", "error");
                    return false;
                }
                analyser = audioCtxSpectrum.createAnalyser();
                analyser.fftSize               = FFT_SIZE;
                analyser.smoothingTimeConstant  = SMOOTHING;
                analyser.connect(audioCtxSpectrum.destination);
                freqBuffer = new Uint8Array(analyser.frequencyBinCount);
                return true;
            }

            function findSourceElement() {
                if (editor.bgVideoElement && !editor.bgVideoElement.paused) {
                    return editor.bgVideoElement;
                }
                return null;
            }

            function connectSource(element) {
                if (!ensureContext()) return false;

                if (sourceNode && connectedElement !== element) {
                    try { sourceNode.disconnect(); } catch (e) {}
                    sourceNode       = null;
                    connectedElement = null;
                }

                if (!sourceNode) {
                    var existingNode = element._curvaseSourceNode;
                    if (existingNode) {
                        sourceNode = existingNode;
                    } else {
                        try {
                            sourceNode = audioCtxSpectrum.createMediaElementSource(element);
                            element._curvaseSourceNode = sourceNode;
                        } catch (e) {
                            showToast("Could not connect audio source.", "error");
                            return false;
                        }
                    }
                    sourceNode.connect(analyser);
                    connectedElement = element;
                }

                if (audioCtxSpectrum.state === "suspended") audioCtxSpectrum.resume();
                return true;
            }

            var HISTORY_LEN    = 30;
            var BEAT_THRESHOLD = 1.08;
            var COOLDOWN_MS    = 160;

            var energyHistory  = new Float32Array(HISTORY_LEN);
            var historyHead    = 0;
            var historyFilled  = 0;
            var lastBeatTime   = 0;

            function frameEnergy(buf) {
                var useBins = Math.floor(buf.length / 2);
                var sum = 0;
                for (var i = 0; i < useBins; i++) {
                    var v = buf[i] / 255;
                    sum += v * v;
                }
                return sum / useBins;
            }

            function detectBeat() {
                var now    = performance.now();
                var energy = frameEnergy(freqBuffer);

                energyHistory[historyHead] = energy;
                historyHead = (historyHead + 1) % HISTORY_LEN;
                if (historyFilled < HISTORY_LEN) historyFilled++;

                if (historyFilled < Math.floor(HISTORY_LEN / 2)) return;

                var total = 0;
                var count = historyFilled < HISTORY_LEN ? historyFilled : HISTORY_LEN;
                for (var i = 0; i < count; i++) total += energyHistory[i];
                var avg = total / count;

                if (avg < 0.0001) return;

                if (energy > avg * BEAT_THRESHOLD && (now - lastBeatTime) > COOLDOWN_MS) {
                    lastBeatTime = now;

                    var strength = Math.min(1, (energy / avg - BEAT_THRESHOLD) / BEAT_THRESHOLD);

                    if (strength < 0.6) strength = 0.6;
                    editor.notifyBeat(strength);
                }
            }

            function pollLoop() {
                if (!isRunning) return;

                var el = findSourceElement();
                if (el && el !== connectedElement) {
                    connectSource(el);
                }

                if (analyser && connectedElement) {
                    analyser.getByteFrequencyData(freqBuffer);

                    detectBeat();
                    editor.setSpectrumData(freqBuffer);

                    editor._rafId = 0;
                    editor._draw();
                }

                rafId = requestAnimationFrame(pollLoop);
            }

            function startSpectrum() {
                var el = findSourceElement();
                if (!el) {
                    showToast("No audio source. Load a background video first.", "info");
                    return false;
                }
                if (!connectSource(el)) return false;
                isRunning = true;
                rafId = requestAnimationFrame(pollLoop);
                return true;
            }

            function stopSpectrum() {
                isRunning = false;
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                editor.clearSpectrumData();
            }

            btnSpectrum.onclick = function() {
                if (isRunning) {
                    stopSpectrum();
                    btnSpectrum.classList.remove("active", "active--radial");
                    btnSpectrum.setAttribute("aria-pressed", "false");
                    btnSpectrum.title = "Spectrum — live FFT overlay from background video or audio. Requires a video or audio source.";
                } else {
                    var started = startSpectrum();
                    if (started) {
                        var isRadial = editor.spectrumMode === "radial";
                        btnSpectrum.classList.add("active");
                        btnSpectrum.classList.toggle("active--radial", isRadial);
                        btnSpectrum.setAttribute("aria-pressed", "true");
                        btnSpectrum.title = "Spectrum — click to stop · right-click to switch mode";
                    }
                }
            };

            btnSpectrum.addEventListener("contextmenu", function(e) {
                e.preventDefault();
                var newMode = editor.toggleSpectrumMode();
                var isRadial = newMode === "radial";
                btnSpectrum.classList.toggle("active--radial", isRadial);
                showToast("Spectrum: " + (isRadial ? "Radial" : "Bars") + " mode", "info");
            });

            var _origClearBg = editor.clearBackgroundImage.bind(editor);
            editor.clearBackgroundImage = function() {
                _origClearBg();
                if (isRunning && !findSourceElement()) {
                    stopSpectrum();
                    btnSpectrum.classList.remove("active");
                    btnSpectrum.setAttribute("aria-pressed", "false");
                }
            };
        })();

        applyEaseToHost = function(rippleEl, e) {
            var particleOrigin = rippleEl || document.getElementById("btn-apply");
            var btnApply = document.getElementById("btn-apply");
            if (rippleEl && e) {
                var r = document.createElement("span");
                r.className = "ripple";
                var rect = rippleEl.getBoundingClientRect();
                r.style.left = (e.clientX - rect.left) + "px";
                r.style.top  = (e.clientY - rect.top)  + "px";
                rippleEl.appendChild(r);
                setTimeout(function() { r.remove(); }, 550);
            }

            var segs = editor.getSegments();
            var mids = editor.getMidPoints();

            var segsJson, midsJson;
            try {
                segsJson = JSON.stringify(segs);
                midsJson = JSON.stringify(mids);
                if (!segsJson || !segs.length) throw new Error("empty segs");
                for (var _si = 0; _si < segs.length; _si++) {
                    var _s = segs[_si];
                    if (!isFinite(_s.x1) || !isFinite(_s.y1) || !isFinite(_s.x2) || !isFinite(_s.y2)) {
                        throw new Error("non-finite segment");
                    }
                }
            } catch (serErr) {
                showToast("Curve data is invalid. Reset the curve and try again.", "error");
                return;
            }

            if (btnApply) btnApply.classList.add("is-processing");
            csInterface.evalScript(
                "$._curvase.applySegmentsEase('" + segsJson + "','" + midsJson + "',null,true)",
                function(result) {
                    if (btnApply) btnApply.classList.remove("is-processing");
                    var msg = (result && String(result).trim()) ? String(result).trim() : "";
                    var looksErr = /^Error/i.test(msg) || /^No /i.test(msg);
                    if (looksErr) {
                        showToast(msg, "error");
                    } else if (msg) {
                        showToast(msg, "success");
                        spawnParticles(particleOrigin);
                    } else {
                        showToast("Apply finished.", "info");
                    }
                }
            );
            if (btnApply) animClass(btnApply, "success", 980);
            animClass(document.getElementById("canvas-container"), "pulse", 900);
        };

        function applyEaseRelativeFromCurveMenu() {
            var segs = editor.getSegments();
            var mids = editor.getMidPoints();
            var segsJson, midsJson;
            try {
                segsJson = JSON.stringify(segs);
                midsJson = JSON.stringify(mids);
                if (!segsJson || !segs.length) throw new Error("empty segs");
                for (var _si = 0; _si < segs.length; _si++) {
                    var _s = segs[_si];
                    if (!isFinite(_s.x1) || !isFinite(_s.y1) || !isFinite(_s.x2) || !isFinite(_s.y2)) {
                        throw new Error("non-finite segment");
                    }
                }
            } catch (relErr) {
                showToast("Curve data is invalid.", "error");
                return;
            }
            csInterface.evalScript(
                "$._curvase.applySegmentsEase('" + segsJson + "','" + midsJson + "','relative',true)",
                function(result) {
                    var msg = (result && String(result).trim()) ? String(result).trim() : "";
                    var looksErr = /^Error/i.test(msg) || /^No /i.test(msg);
                    showToast(msg, looksErr ? "error" : (msg ? "success" : "info"));
                }
            );
        }

        function fmtCurveNum(n) {
            if (!isFinite(n)) return "0";
            var r = Math.round(n * 1000) / 1000;
            return (Math.abs(r - (r | 0)) < 1e-9) ? String(r | 0) : String(r);
        }

        function copyCurvePlain(text) {
            try {
                var ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            } catch (cx) {}
        }

        function copyCurveAsCssBezier() {
            var v = editor.getValues();
            var s = "cubic-bezier(" + fmtCurveNum(v[0]) + ", " + fmtCurveNum(v[1]) + ", " + fmtCurveNum(v[2]) + ", " + fmtCurveNum(v[3]) + ")";
            copyCurvePlain(s);
            showToast("Copied CSS cubic-bezier()", "success");
        }

        function copyCurveAsFourNums() {
            var v = editor.getValues();
            var s = fmtCurveNum(v[0]) + ", " + fmtCurveNum(v[1]) + ", " + fmtCurveNum(v[2]) + ", " + fmtCurveNum(v[3]);
            copyCurvePlain(s);
            showToast("Copied four numbers", "success");
        }

        function copyCurveAsJsonSegs() {
            copyCurvePlain(JSON.stringify(editor.getSegments()));
            showToast("Copied JSON segments", "success");
        }

        function ensureCurveGraphContextMenu() {
            if (curveGraphCtxEl) return curveGraphCtxEl;

            function sep(parent) {
                var hr = document.createElement("div");
                hr.className = "ae-graph-ctx-sep";
                parent.appendChild(hr);
            }

            function plain(parent, label, fn) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "ae-graph-ctx-item";
                b.textContent = label;
                b.addEventListener("mousedown", function(ev) { ev.stopPropagation(); });
                b.addEventListener("click", function() {
                    hideCurveGraphContextMenu();
                    fn();
                });
                parent.appendChild(b);
            }

            function flyout(parent, label, items) {
                var wrap = document.createElement("div");
                wrap.className = "ae-graph-ctx-flyout-wrap";
                var row = document.createElement("button");
                row.type = "button";
                row.className = "ae-graph-ctx-item ae-graph-ctx-item--fly";
                row.innerHTML = "<span>" + label + '</span><span class="ae-graph-ctx-chevron">\u25B8</span>';
                row.addEventListener("mousedown", function(ev) { ev.stopPropagation(); });
                var panel = document.createElement("div");
                panel.className = "ae-graph-ctx-flyout-panel";
                for (var fi = 0; fi < items.length; fi++) {
                    (function(it) {
                        var ib = document.createElement("button");
                        ib.type = "button";
                        ib.className = "ae-graph-ctx-item ae-graph-ctx-item--flychild";
                        ib.textContent = it.label;
                        ib.addEventListener("mousedown", function(ev) { ev.stopPropagation(); });
                        ib.addEventListener("click", function() {
                            hideCurveGraphContextMenu();
                            it.fn();
                        });
                        panel.appendChild(ib);
                    })(items[fi]);
                }
                wrap.appendChild(row);
                wrap.appendChild(panel);
                wrap.addEventListener("mouseenter", function() { panel.style.display = "block"; });
                wrap.addEventListener("mouseleave", function() { panel.style.display = "none"; });
                parent.appendChild(wrap);
            }

            curveGraphCtxEl = document.createElement("div");
            curveGraphCtxEl.className = "ae-graph-ctx-menu";
            curveGraphCtxEl.style.display = "none";

            plain(curveGraphCtxEl, "Apply", function() {
                applyEaseToHost(null, null);
            });

            flyout(curveGraphCtxEl, "Apply to keys", [
                { label: "Ease only", fn: function() { applyEaseToHost(null, null); } },
                { label: "Reflect inner keys (relative)", fn: applyEaseRelativeFromCurveMenu }
            ]);

            plain(curveGraphCtxEl, "Apply to expression", function() {
                showToast("Expressions use AE syntax — use Apply for timeline easing.", "info");
            });

            sep(curveGraphCtxEl);

            plain(curveGraphCtxEl, "Reverse value", function() {
                if (editor.reverseBezierHandles && editor.reverseBezierHandles()) {
                    syncInputs();
                    showToast("Bezier handles reversed.", "success");
                }
            });

            sep(curveGraphCtxEl);

            flyout(curveGraphCtxEl, "Copy value as", [
                { label: "CSS cubic-bezier()", fn: copyCurveAsCssBezier },
                { label: "Four numbers", fn: copyCurveAsFourNums },
                { label: "JSON segments", fn: copyCurveAsJsonSegs }
            ]);

            return curveGraphCtxEl;
        }

        function showCurveGraphContextMenu(ev) {
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopPropagation) ev.stopPropagation();
            hideGridContextMenu();
            hideCurveGraphContextMenu();
            var menu = ensureCurveGraphContextMenu();
            var host = document.getElementById("curvase-app") || document.body;
            if (menu.parentNode !== host) host.appendChild(menu);
            var br = host.getBoundingClientRect();
            menu.style.display = "block";
            menu.style.position = "absolute";
            var lx = ev.clientX - br.left + (host.scrollLeft || 0);
            var ly = ev.clientY - br.top + (host.scrollTop || 0);
            menu.style.left = lx + "px";
            menu.style.top = ly + "px";
            curveGraphOutsideClose = function(e2) {
                if (curveGraphCtxEl && curveGraphCtxEl.contains(e2.target)) return;
                hideCurveGraphContextMenu();
            };
            document.addEventListener("mousedown", curveGraphOutsideClose, true);
        }

        (function bindCurveGraphContextMenu() {
            var cvWrap = document.getElementById("canvas-container");
            if (!cvWrap) return;

            cvWrap.addEventListener("mousedown", function(ev) {
                if (ev.button !== 2) return;
                curveGraphLastRmbMs = Date.now();
                ev.preventDefault();
                ev.stopPropagation();
                showCurveGraphContextMenu(ev);
            }, true);

            cvWrap.addEventListener("contextmenu", function(ev) {
                if (ev.preventDefault) ev.preventDefault();
                ev.stopPropagation();
                if (Date.now() - curveGraphLastRmbMs < 600) return;
                showCurveGraphContextMenu(ev);
            }, false);
        })();

        document.getElementById("btn-match-vel").onclick = function(e) {
            addRipple(this, e);
            csInterface.evalScript("$._curvase.matchVelocity()", function(result) {
                var msg = (result && String(result).trim()) ? String(result).trim() : "";
                var looksErr = /^Error/i.test(msg) || /^No /i.test(msg);
                showToast(msg || "Velocity matched.", looksErr ? "error" : "success");
            });
        };

        var bounceModal = document.getElementById("bounce-modal");
        document.getElementById("btn-bounce-gen").onclick = function(e) {
            addRipple(this, e);
            bounceModal.classList.remove("modal-closing");
            bounceModal.classList.add("modal-open");
        };

        function closeBounceModal() {
            bounceModal.classList.add("modal-closing");
            setTimeout(function() {
                bounceModal.classList.remove("modal-open", "modal-closing");
            }, 150);
        }

        bounceModal.addEventListener("click", function(e) {
            if (e.target === bounceModal) closeBounceModal();
        });

        document.getElementById("btn-bounce-cancel").onclick = closeBounceModal;

        document.getElementById("btn-bounce-apply").onclick = function() {
            var amp = parseFloat(document.getElementById("b-amp").value);
            var freq = parseFloat(document.getElementById("b-freq").value);
            var decay = parseFloat(document.getElementById("b-decay").value);
            
            csInterface.evalScript("$._curvase.generateOvershoot(" + amp + "," + freq + "," + decay + ")", function(result) {
                var msg = (result && String(result).trim()) ? String(result).trim() : "";
                var looksErr = /^Error/i.test(msg) || /^No /i.test(msg);
                showToast(msg || "Overshoot generated.", looksErr ? "error" : "success");
                if (!looksErr) closeBounceModal();
            });
        };

        var loopModal = document.getElementById("loop-modal");
        document.getElementById("btn-loop-gen").onclick = function(e) {
            addRipple(this, e);
            loopModal.classList.remove("modal-closing");
            loopModal.classList.add("modal-open");
        };

        function closeLoopModal() {
            loopModal.classList.add("modal-closing");
            setTimeout(function() {
                loopModal.classList.remove("modal-open", "modal-closing");
            }, 150);
        }

        loopModal.addEventListener("click", function(e) {
            if (e.target === loopModal) closeLoopModal();
        });

        document.getElementById("btn-loop-cancel").onclick = closeLoopModal;

        var THEME_PRESETS = {
            default: {
                "--bg": "#141414",
                "--surface": "#222222",
                "--surface2": "#2a2a2a",
                "--border": "#ffffff",
                "--border2": "#ffffff",
                "--text": "#f0f0f0",
                "--text-dim": "#a0a0a0",
                "--text-mute": "#666666",
                "--accent": "#ffffff",
                "--accent2": "#ff8c42",
                "--blue": "#4a9eff",
                "--white": "#ffffff",
                "--graph-inner-bg": "#000000",
                "--graph-grid": "#ffffff",
                "--graph-box-border": "#ffffff",
                "--graph-diagonal": "#ffffff",
                "--graph-canvas-bg": "#141414",
                "--curve-main": "#00e5ff",
                "--curve-endpoint": "#888888",
                "--curve-handle-out": "#ff9d5c",
                "--curve-handle-in": "#5bb0ff"
            },
            cyberpunk: {
                "--bg": "#0b0713",
                "--surface": "#190c28",
                "--surface2": "#231237",
                "--border": "#ff007f",
                "--border2": "#ff007f",
                "--text": "#ffffff",
                "--text-dim": "#a39ec4",
                "--text-mute": "#544f73",
                "--accent": "#ff007f",
                "--accent2": "#ffd700",
                "--blue": "#00f5ff",
                "--white": "#ffffff",
                "--graph-inner-bg": "#07040d",
                "--graph-grid": "#ff007f",
                "--graph-box-border": "#ff007f",
                "--graph-diagonal": "#ff007f",
                "--graph-canvas-bg": "#0b0713",
                "--curve-main": "#ff007f",
                "--curve-endpoint": "#ffd700",
                "--curve-handle-out": "#00f5ff",
                "--curve-handle-in": "#ffd700"
            },
            ae: {
                "--bg": "#232323",
                "--surface": "#2d2d2d",
                "--surface2": "#373737",
                "--border": "#ffffff",
                "--border2": "#ffffff",
                "--text": "#e1e1e1",
                "--text-dim": "#a8a8a8",
                "--text-mute": "#626262",
                "--accent": "#ffffff",
                "--accent2": "#7caeff",
                "--blue": "#7caeff",
                "--white": "#ffffff",
                "--graph-inner-bg": "#1a1a1a",
                "--graph-grid": "#ffffff",
                "--graph-box-border": "#ffffff",
                "--graph-diagonal": "#ffffff",
                "--graph-canvas-bg": "#232323",
                "--curve-main": "#ffffff",
                "--curve-endpoint": "#626262",
                "--curve-handle-out": "#7caeff",
                "--curve-handle-in": "#a8d5ff"
            },
            nordic: {
                "--bg": "#0f131a",
                "--surface": "#1a202c",
                "--surface2": "#222a3a",
                "--border": "#7dd3fc",
                "--border2": "#7dd3fc",
                "--text": "#f1f5f9",
                "--text-dim": "#94a3b8",
                "--text-mute": "#475569",
                "--accent": "#7dd3fc",
                "--accent2": "#c084fc",
                "--blue": "#a5b4fc",
                "--white": "#ffffff",
                "--graph-inner-bg": "#0b0d12",
                "--graph-grid": "#7dd3fc",
                "--graph-box-border": "#7dd3fc",
                "--graph-diagonal": "#7dd3fc",
                "--graph-canvas-bg": "#0f131a",
                "--curve-main": "#7dd3fc",
                "--curve-endpoint": "#475569",
                "--curve-handle-out": "#c084fc",
                "--curve-handle-in": "#a5b4fc"
            },
            sunset: {
                "--bg": "#110905",
                "--surface": "#1e0f08",
                "--surface2": "#2a160c",
                "--border": "#ff8c42",
                "--border2": "#ff8c42",
                "--text": "#fafaf9",
                "--text-dim": "#a8a29e",
                "--text-mute": "#57534e",
                "--accent": "#ff8c42",
                "--accent2": "#ffd54f",
                "--blue": "#f43f5e",
                "--white": "#ffffff",
                "--graph-inner-bg": "#0a0503",
                "--graph-grid": "#ff8c42",
                "--graph-box-border": "#ff8c42",
                "--graph-diagonal": "#ff8c42",
                "--graph-canvas-bg": "#110905",
                "--curve-main": "#ff8c42",
                "--curve-endpoint": "#ffd54f",
                "--curve-handle-out": "#ffd54f",
                "--curve-handle-in": "#f43f5e"
            }
        };

        function hexToRgba(hex, alpha) {
            var c = hex.substring(1);
            if (c.length === 3) {
                c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
            }
            var r = parseInt(c.substring(0, 2), 16);
            var g = parseInt(c.substring(2, 4), 16);
            var b = parseInt(c.substring(4, 6), 16);
            return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
        }

        function applyTheme(themeObj) {
            for (var prop in themeObj) {
                var val = themeObj[prop];
                if (typeof val === "string" && val.startsWith("#")) {
                    if (prop === "--bg") {
                        val = hexToRgba(val, 0.4);
                    } else if (prop === "--surface") {
                        val = hexToRgba(val, 0.4);
                    } else if (prop === "--surface2") {
                        val = hexToRgba(val, 0.5);
                    } else if (prop === "--border") {
                        val = hexToRgba(val, 0.1);
                    } else if (prop === "--border2") {
                        val = hexToRgba(val, 0.18);
                    } else if (prop === "--graph-inner-bg") {
                        val = hexToRgba(val, 0.25);
                    } else if (prop === "--graph-grid") {
                        val = hexToRgba(val, 0.08);
                    } else if (prop === "--graph-box-border") {
                        val = hexToRgba(val, 0.2);
                    } else if (prop === "--graph-diagonal") {
                        val = hexToRgba(val, 0.06);
                    } else if (prop === "--graph-canvas-bg") {
                        val = hexToRgba(val, 0.25);
                    }
                }
                document.documentElement.style.setProperty(prop, val);
            }
            var inputs = document.querySelectorAll("#theme-grid input[type='color']");
            for (var i = 0; i < inputs.length; i++) {
                var vName = inputs[i].getAttribute("data-theme-var");
                if (themeObj[vName]) {
                    inputs[i].value = themeObj[vName];
                }
            }
            if (editor) {
                editor._scheduleRender();
            }
            var allPresets = [];
            try { allPresets = favoritesList; } catch(ex) {}
            for (var _ti = 0; _ti < allPresets.length; _ti++) { delete allPresets[_ti]._thumb; }
            for (var _ci = 0; _ci < categories.length; _ci++) {
                var _items = categories[_ci].items || [];
                for (var _pi = 0; _pi < _items.length; _pi++) { delete _items[_pi]._thumb; }
            }
        }

        var themeModal = document.getElementById("theme-modal");

        document.getElementById("btn-theme-selector").onclick = function(e) {
            addRipple(this, e);
            themeModal.classList.remove("modal-closing");
            themeModal.classList.add("modal-open");
        };

        function closeThemeModal() {
            themeModal.classList.add("modal-closing");
            setTimeout(function() {
                themeModal.classList.remove("modal-open", "modal-closing");
            }, 150);
        }

        themeModal.addEventListener("click", function(e) {
            if (e.target === themeModal) closeThemeModal();
        });

        document.getElementById("btn-theme-close").onclick = closeThemeModal;

        var presetBtns = document.querySelectorAll(".theme-preset-btn");
        for (var i = 0; i < presetBtns.length; i++) {
            presetBtns[i].onclick = function() {
                for (var j = 0; j < presetBtns.length; j++) {
                    presetBtns[j].classList.remove("active");
                }
                this.classList.add("active");
                var key = this.getAttribute("data-theme-preset");
                if (THEME_PRESETS[key]) {
                    applyTheme(THEME_PRESETS[key]);
                    localStorage.setItem("curvase-theme-name", key);
                    localStorage.setItem("curvase-theme-custom", JSON.stringify(THEME_PRESETS[key]));
                }
            };
        }

        var customPickers = document.querySelectorAll("#theme-grid input[type='color']");
        for (var i = 0; i < customPickers.length; i++) {
            customPickers[i].oninput = function() {
                for (var j = 0; j < presetBtns.length; j++) {
                    presetBtns[j].classList.remove("active");
                }
                var vName = this.getAttribute("data-theme-var");
                var val = this.value;
                
                var customObj = {};
                var savedCustom = localStorage.getItem("curvase-theme-custom");
                if (savedCustom) {
                    try { customObj = JSON.parse(savedCustom); } catch(e) {}
                }
                customObj[vName] = val;
                applyTheme(customObj);
                
                localStorage.setItem("curvase-theme-name", "custom");
                localStorage.setItem("curvase-theme-custom", JSON.stringify(customObj));
            };
        }

        document.getElementById("btn-theme-reset").onclick = function() {
            var btnDefault = document.querySelector(".theme-preset-btn[data-theme-preset='default']");
            if (btnDefault) btnDefault.click();
        };

        var savedThemeName = localStorage.getItem("curvase-theme-name") || "default";
        var savedCustomObj = localStorage.getItem("curvase-theme-custom");
        var activeBtn = document.querySelector(".theme-preset-btn[data-theme-preset='" + savedThemeName + "']");
        if (activeBtn) activeBtn.classList.add("active");
        
        if (savedThemeName === "custom" && savedCustomObj) {
            try { applyTheme(JSON.parse(savedCustomObj)); } catch(e) {}
        } else if (THEME_PRESETS[savedThemeName]) {
            applyTheme(THEME_PRESETS[savedThemeName]);
        }

        document.getElementById("btn-loop-apply").onclick = function() {
            var type = document.getElementById("l-type").value;
            var amp = parseFloat(document.getElementById("l-amp").value);
            var freq = parseFloat(document.getElementById("l-freq").value);
            var dur = parseFloat(document.getElementById("l-dur").value);
            var decay = parseFloat(document.getElementById("l-decay").value);
            
            csInterface.evalScript("$._curvase.generateLoop('" + type + "'," + amp + "," + freq + "," + dur + "," + decay + ")", function(result) {
                var msg = (result && String(result).trim()) ? String(result).trim() : "";
                var looksErr = /^Error/i.test(msg) || /^No /i.test(msg);
                showToast(msg || "Loop wave generated successfully.", looksErr ? "error" : "success");
                if (!looksErr) closeLoopModal();
            });
        };

        var btnSymmetry = document.getElementById("btn-symmetry-mode");
        btnSymmetry.onclick = function() {
            editor.isSymmetryMode = !editor.isSymmetryMode;
            this.classList.toggle("active", editor.isSymmetryMode);
            animClass(this, "pop", 520);
        };

        var selMorphStyle = document.getElementById("select-morph-style");
        selMorphStyle.onchange = function() {
            editor.morphStyle = this.value;
        };

        document.getElementById("btn-apply").onclick = function(e) {
            applyEaseToHost(this, e);
        };

        document.getElementById("btn-undo").onclick = function() { editor.undo(); };
        document.getElementById("btn-redo").onclick = function() { editor.redo(); };

        document.getElementById("btn-read").onclick = function() {
            csInterface.evalScript("$._curvase.readKeyframeData()", function(res) {
                if (!res) {
                    showToast("No response from After Effects.", "error");
                    return;
                }
                try {
                    var data = JSON.parse(res);
                    if (data.error) {
                        showToast(data.error, "error");
                        return;
                    }
                    if (!data.properties || !data.properties.length) {
                        showToast("Select keyframed properties in the timeline, then try again.", "info");
                        return;
                    }

                    var pickedSegments = null;
                    var pickedPropName = "";

                    for (var i = 0; i < data.properties.length; i++) {
                        var prop = data.properties[i];
                        var kfs = prop.keyframes;
                        if (!kfs || kfs.length < 2) continue;
                        var propSegments = [];

                        for (var j = 0; j < kfs.length - 1; j++) {
                            var k1 = kfs[j], k2 = kfs[j + 1];

                            if (k1.outType === "HOLD" || k2.inType === "HOLD") continue;

                            var b = easePairToNormalizedBezier(k1, k2, prop);
                            if (!b) continue;
                            propSegments.push(b);
                        }

                        if (propSegments.length) {
                            pickedSegments = propSegments;
                            pickedPropName = prop.property || prop.name || "";
                            break;
                        }
                    }

                    if (pickedSegments && pickedSegments.length > 0) {
                        setCurveFromReadSegments(pickedSegments);
                        syncInputs();
                        var segCount = pickedSegments.length;
                        var keyCount = segCount + 1;
                        var msg = "Curve read from " + keyCount + " selected keyframe" + (keyCount !== 1 ? "s" : "") + ".";
                        if (pickedPropName) msg += " (" + pickedPropName + ")";
                        showToast(msg, "success");
                    } else {
                        showToast("No readable segments. Use adjacent keys (same index + 1), not HOLD.", "info");
                    }
                } catch(err) {
                    showToast("Could not parse keyframe data.", "error");
                }
            });
        };

        window.addEventListener('resize', function() { editor.resize(); });

        window.addEventListener("unload", function() {
            stopInspector();
        });

        document.addEventListener("visibilitychange", function() {
            if (document.hidden) {
                stopInspector();
            } else if (isToolsMode) {
                startInspector();
            }
        });
        ["x1","y1","x2","y2"].forEach(function(id) {
            document.getElementById(id).oninput = function() {
                editor.setEndHandles(parseFloat(document.getElementById("x1").value), parseFloat(document.getElementById("y1").value), parseFloat(document.getElementById("x2").value), parseFloat(document.getElementById("y2").value));
            };
        });

    }

    var favoritesList = [];
    var favoritesOpen = true;

    function getPresetId(p) {
        return [
            Math.round(p.x1 * 1000),
            Math.round(p.y1 * 1000),
            Math.round(p.x2 * 1000),
            Math.round(p.y2 * 1000),
            p.name.replace(/[^a-zA-Z0-9]/g, "")
        ].join("_");
    }

    function saveFavorites() {
        try {
            localStorage.setItem("curvase_favorites_v3", JSON.stringify(favoritesList));
            localStorage.setItem("curvase_favorites_open", JSON.stringify(favoritesOpen));
        } catch(e) {}
    }

    function loadFavorites() {
        var raw = localStorage.getItem("curvase_favorites_v3");
        if (raw) {
            try {
                favoritesList = JSON.parse(raw);
            } catch(e) {}
        }
        if (!Array.isArray(favoritesList)) {
            favoritesList = [];
        }
        var op = localStorage.getItem("curvase_favorites_open");
        if (op) {
            try {
                favoritesOpen = JSON.parse(op);
            } catch(e) {}
        }
    }

    function makeThumb(p) {
        if (p._thumb) return p._thumb;
        var c = document.createElement("canvas");
        c.width = 54; c.height = 40;
        var ctx = c.getContext("2d");
        var padX = 6, padY = 6;
        var cw = c.width - padX*2, ch = c.height - padY*2;
        var sx = padX, sy = c.height - padY, ex = c.width - padX, ey = padY;
        var cp1x = sx + p.x1*cw, cp1y = sy - p.y1*ch;
        var cp2x = sx + p.x2*cw, cp2y = sy - p.y2*ch;

        var accentColor = getComputedStyle(document.documentElement).getPropertyValue("--curve-main").trim() || "#00e5ff";
        var handleOutColor = getComputedStyle(document.documentElement).getPropertyValue("--curve-handle-out").trim() || "#ff9d5c";
        var handleInColor = getComputedStyle(document.documentElement).getPropertyValue("--curve-handle-in").trim() || "#5bb0ff";
        var endpointColor = getComputedStyle(document.documentElement).getPropertyValue("--curve-endpoint").trim() || "#888888";

        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(cp1x,cp1y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(cp2x,cp2y); ctx.stroke();

        ctx.fillStyle = handleOutColor;
        ctx.beginPath(); ctx.arc(cp1x,cp1y,2,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = handleInColor;
        ctx.beginPath(); ctx.arc(cp2x,cp2y,2,0,Math.PI*2); ctx.fill();

        ctx.strokeStyle = accentColor; ctx.lineWidth = 1.5;
        ctx.shadowColor = accentColor; ctx.shadowBlur = 3;
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,ex,ey); ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = endpointColor;
        ctx.beginPath(); ctx.arc(sx,sy,1.5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex,ey,1.5,0,Math.PI*2); ctx.fill();
        p._thumb = c.toDataURL();
        return p._thumb;
    }

    function toggleFavorite(p, isFav) {
        var targetId = getPresetId(p);
        if (isFav) {
            for (var fi = 0; fi < favoritesList.length; fi++) {
                if (getPresetId(favoritesList[fi]) === targetId) {
                    favoritesList.splice(fi, 1);
                    break;
                }
            }
            showToast("Removed from favorites.", "info");
        } else {
            favoritesList.push({
                name: p.name,
                x1: p.x1,
                y1: p.y1,
                x2: p.x2,
                y2: p.y2
            });
            showToast("Added to favorites.", "success");
        }
        saveFavorites();

        var targetStars = document.querySelectorAll('[data-star-id="' + targetId + '"]');
        for (var i = 0; i < targetStars.length; i++) {
            var starEl = targetStars[i];
            if (isFav) {
                starEl.classList.remove("active");
                starEl.title = "Add to Favorites";
            } else {
                starEl.classList.add("active");
                starEl.title = "Remove from Favorites";
            }
        }

        var favHeaderCount = document.querySelector('[data-ci="0"] .cat-count');
        if (favHeaderCount) {
            favHeaderCount.textContent = favoritesList.length;
        }

        var favGrid = document.querySelector('[data-grid-cat="⭐ Favorites"]');
        if (favGrid) {
            if (isFav) {
                var cardInFav = favGrid.querySelector('[data-preset-id="' + targetId + '"]');
                if (cardInFav) {
                    cardInFav.style.animation = "none";
                    void cardInFav.offsetWidth;
                    cardInFav.style.animation = "presetOut 0.25s ease forwards";
                    setTimeout(function() {
                        cardInFav.remove();
                    }, 250);
                }
            } else {
                var item = document.createElement("div");
                item.className = "preset-item";
                item.style.animation = "presetIn 0.38s ease-out both";
                item.draggable = true;
                item.setAttribute("data-preset-id", targetId);

                var img = document.createElement("img");
                img.src = makeThumb(p);
                img.className = "preset-icon";
                var label = document.createElement("span");
                label.textContent = p.name;
                item.appendChild(img);
                item.appendChild(label);

                var star = document.createElement("span");
                star.className = "preset-fav-star active";
                star.innerHTML = "★";
                star.title = "Remove from Favorites";
                star.setAttribute("data-star-id", targetId);
                star.addEventListener("click", function(ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    var currentlyFav = star.classList.contains("active");
                    toggleFavorite(p, currentlyFav);
                });
                item.appendChild(star);

                item.addEventListener("click", function() {
                    var items = favGrid.querySelectorAll(".preset-item");
                    var pi = Array.prototype.indexOf.call(items, item);
                    sel = {ci: 0, pi: pi};
                    editor.morphTo(p.x1, p.y1, p.x2, p.y2);
                    scheduleRender();
                });

                item.addEventListener("dragstart", function(ev) {
                    var items = favGrid.querySelectorAll(".preset-item");
                    var pi = Array.prototype.indexOf.call(items, item);
                    drag = {type: "preset", ci: 0, pi: pi};
                    ev.dataTransfer.effectAllowed = "move";
                    setTimeout(function() { item.classList.add("dragging"); }, 0);
                });
                item.addEventListener("dragend", function() {
                    item.classList.remove("dragging");
                    drag = null;
                    document.querySelectorAll(".drag-over").forEach(function(el) { el.classList.remove("drag-over"); });
                });

                favGrid.appendChild(item);
            }
        }
    }

    var renderPending = false;
    function scheduleRender() {
        if (renderPending) return;
        renderPending = true;
        setTimeout(function() {
            renderPending = false;
            render();
        }, 0);
    }

    function render() {
        var panel = document.getElementById("presets-panel");
        var scrollTop = panel.scrollTop;
        panel.innerHTML = "";

        var viewCategories = [
            { name: "⭐ Favorites", open: favoritesOpen, items: favoritesList, isVirtualFav: true }
        ].concat(categories.filter(function(c) { return c.name !== "⭐ Favorites"; }));

        var favSet = {};
        favoritesList.forEach(function(fp) {
            favSet[getPresetId(fp)] = true;
        });

        viewCategories.forEach(function(cat, ci) {

            var header = document.createElement("div");
            header.className = "cat-header";
            header.draggable = !cat.isVirtualFav;
            header.dataset.ci = ci;
            header.innerHTML =
                '<span class="cat-chevron">' + (cat.open ? '▾' : '▸') + '</span>' +
                '<span class="cat-name">' + cat.name + '</span>' +
                '<span class="cat-count">' + cat.items.length + '</span>';

            header.addEventListener("click", function(e) {
                if (e.target.classList.contains("cat-name")) {
                    return;
                }
                if (cat.isVirtualFav) {
                    favoritesOpen = !favoritesOpen;
                    saveFavorites();
                } else {
                    cat.open = !cat.open;
                    saveData();
                }
                scheduleRender();
            });

            header.querySelector(".cat-name").addEventListener("dblclick", function(e) {
                e.stopPropagation();
                if (cat.isVirtualFav) return;
                var nameSpan = this;
                var oldName = cat.name;
                var inp = document.createElement("input");
                inp.type = "text";
                inp.value = oldName;
                inp.className = "cat-inline-edit";
                inp.style.cssText = "background:var(--surface);border:1px solid var(--accent);color:var(--text);font-size:10px;font-weight:600;letter-spacing:0.05em;border-radius:2px;padding:0 4px;width:90px;outline:none;";
                nameSpan.replaceWith(inp);
                inp.focus();
                inp.select();
                function commit() {
                    var n = inp.value.trim();
                    if (n && n !== oldName) { cat.name = n; saveData(); scheduleRender(); return; }
                    scheduleRender();
                }
                inp.addEventListener("blur", commit);
                inp.addEventListener("keydown", function(ev) {
                    ev.stopPropagation();
                    if (ev.key === "Enter") { inp.blur(); }
                    else if (ev.key === "Escape") { inp.value = oldName; inp.blur(); }
                });
            });

            header.addEventListener("dragstart", function(e) {
                if (cat.isVirtualFav) { e.preventDefault(); return; }
                drag = {type: "cat", ci: ci};
                e.dataTransfer.effectAllowed = "move";
                setTimeout(function() { header.classList.add("dragging"); }, 0);
            });
            header.addEventListener("dragend", function() {
                header.classList.remove("dragging");
                drag = null;
                document.querySelectorAll(".drag-over").forEach(function(el) { el.classList.remove("drag-over"); });
            });
            header.addEventListener("dragover", function(e) {
                e.preventDefault();
                if (!drag || cat.isVirtualFav) return;
                header.classList.add("drag-over");
            });
            header.addEventListener("dragleave", function() { header.classList.remove("drag-over"); });
            header.addEventListener("drop", function(e) {
                e.preventDefault();
                header.classList.remove("drag-over");
                if (cat.isVirtualFav) return;
                if (!drag || drag.ci === ci) return;
                if (drag.type === "cat") {
                    var moved = categories.splice(drag.ci - 1, 1)[0];
                    var targetIdx = (ci > drag.ci ? ci - 1 : ci) - 1;
                    if (targetIdx < 0) targetIdx = 0;
                    if (targetIdx > categories.length) targetIdx = categories.length;
                    categories.splice(targetIdx, 0, moved);
                } else if (drag.type === "preset") {
                    var movedP;
                    if (drag.ci === 0) {
                        movedP = favoritesList[drag.pi];
                    } else {
                        movedP = categories[drag.ci - 1].items.splice(drag.pi, 1)[0];
                    }
                    if (movedP) {
                        cat.items.push(movedP);
                    }
                }
                sel = {ci: -1, pi: -1};
                saveData(); scheduleRender();
            });

            header.addEventListener("mousedown", function(e) {
                if (e.target.classList.contains("cat-name") || e.target.classList.contains("cat-chevron") || e.target.classList.contains("cat-count")) {
                    sel = {ci: ci, pi: -1};
                }
            });

            panel.appendChild(header);

            if (!cat.open) return;

            var grid = document.createElement("div");
            grid.className = "cat-grid";
            grid.setAttribute("data-grid-cat", cat.name);

            cat.items.forEach(function(p, pi) {
                var item = document.createElement("div");
                var isSel = sel.ci === ci && sel.pi === pi;
                item.className = "preset-item" + (isSel ? " selected" : "");
                item.style.animationDelay = Math.min(pi * 42, 320) + "ms";
                item.draggable = true;

                var pid = getPresetId(p);
                item.setAttribute("data-preset-id", pid);

                var img = document.createElement("img");
                img.src = makeThumb(p);
                img.className = "preset-icon";
                var label = document.createElement("span");
                label.textContent = p.name;
                item.appendChild(img);
                item.appendChild(label);

                var isFav = favSet[pid] === true;
                var star = document.createElement("span");
                star.className = "preset-fav-star" + (isFav ? " active" : "");
                star.innerHTML = "★";
                star.title = isFav ? "Remove from Favorites" : "Add to Favorites";
                star.setAttribute("data-star-id", pid);
                star.addEventListener("click", function(ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    var currentlyFav = star.classList.contains("active");
                    toggleFavorite(p, currentlyFav);
                });
                item.appendChild(star);

                item.addEventListener("click", function() {
                    sel = {ci: ci, pi: pi};

                    editor.morphTo(p.x1, p.y1, p.x2, p.y2);
                    scheduleRender();
                    requestAnimationFrame(function() {
                        var selected = document.querySelector(".preset-item.selected");
                        if (selected) animClass(selected, "preset-select-pop", 560);
                    });
                });

                item.addEventListener("dblclick", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    sel = {ci: ci, pi: pi};
                    editor.setEndHandles(p.x1, p.y1, p.x2, p.y2);
                    syncInputs();
                    scheduleRender();
                    requestAnimationFrame(function() {
                        var selected = document.querySelector(".preset-item.selected");
                        if (selected) animClass(selected, "preset-select-pop", 560);
                    });
                    if (applyEaseToHost) applyEaseToHost(item, e);
                });

                item.addEventListener("dragstart", function(e) {
                    drag = {type: "preset", ci: ci, pi: pi};
                    e.dataTransfer.effectAllowed = "move";
                    setTimeout(function() { item.classList.add("dragging"); }, 0);
                });
                item.addEventListener("dragend", function() {
                    item.classList.remove("dragging");
                    drag = null;
                    document.querySelectorAll(".drag-over").forEach(function(el) { el.classList.remove("drag-over"); });
                });
                item.addEventListener("dragover", function(e) {
                    e.preventDefault();
                    if (!drag || drag.type !== "preset") return;
                    item.classList.add("drag-over");
                });
                item.addEventListener("dragleave", function() { item.classList.remove("drag-over"); });
                item.addEventListener("drop", function(e) {
                    e.preventDefault();
                    item.classList.remove("drag-over");
                    if (!drag || drag.type !== "preset") return;
                    if (drag.ci === ci && drag.pi === pi) return;
                    var movedP;
                    if (drag.ci === 0) {
                        movedP = favoritesList.splice(drag.pi, 1)[0];
                        saveFavorites();
                    } else {
                        var srcCat = categories[drag.ci - 1];
                        if (!srcCat) return;
                        movedP = srcCat.items.splice(drag.pi, 1)[0];
                    }
                    if (!movedP) return;
                    var insertAt = (drag.ci === ci && drag.pi < pi) ? pi - 1 : pi;
                    if (insertAt < 0) insertAt = 0;
                    cat.items.splice(insertAt, 0, movedP);
                    sel = {ci: ci, pi: insertAt};
                    saveData(); scheduleRender();
                });

                grid.appendChild(item);
            });

            panel.appendChild(grid);
        });

        var q = document.getElementById("preset-search");
        if (q && q.value.trim()) applyFilter(q.value);
        panel.scrollTop = scrollTop;
    }

    function applyFilter(q) {
        var term = q.trim().toLowerCase();
        var panel = document.getElementById("presets-panel");
        if (!panel) return;

        var headers = panel.querySelectorAll(".cat-header");
        var grids   = panel.querySelectorAll(".cat-grid");

        if (!term) {

            headers.forEach(function(h) { h.style.display = ""; });
            grids.forEach(function(g) {
                g.style.display = "";
                g.querySelectorAll(".preset-item").forEach(function(it) { it.style.display = ""; });
            });
            return;
        }

        headers.forEach(function(header, idx) {
            var grid = grids[idx];
            if (!grid) return;
            var items = grid.querySelectorAll(".preset-item");
            var anyVisible = false;
            items.forEach(function(item) {
                var labelEl = item.querySelector("span:not(.preset-fav-star)");
                var name = labelEl ? labelEl.textContent : "";
                var match = name.toLowerCase().indexOf(term) !== -1;
                item.style.display = match ? "" : "none";
                if (match) anyVisible = true;
            });

            header.style.display = anyVisible ? "" : "none";
            grid.style.display   = anyVisible ? "" : "none";
        });
    }

    function setCurveFromReadSegments(segments) {
        if (!segments || !segments.length) return false;

        var pointCount = segments.length + 1;
        var points = [];
        var i;

        for (i = 0; i < pointCount; i++) {
            var t = (pointCount === 1) ? 0 : (i / (pointCount - 1));
            points.push({
                x: Math.round(t * 100) / 100,
                y: Math.round(t * 100) / 100,
                hInX: null, hInY: null,
                hOutX: null, hOutY: null
            });
        }

        for (i = 0; i < segments.length; i++) {
            var a = points[i];
            var b = points[i + 1];
            var seg = segments[i];
            var dx = b.x - a.x;
            var dy = b.y - a.y;
            a.hOutX = Math.round((a.x + seg.px1 * dx) * 100) / 100;
            a.hOutY = Math.round((a.y + seg.py1 * dy) * 100) / 100;
            b.hInX = Math.round((a.x + seg.px2 * dx) * 100) / 100;
            b.hInY = Math.round((a.y + seg.py2 * dy) * 100) / 100;
        }

        editor._cancelMorph();
        editor._commit();
        editor.points = points;
        if (editor._future) editor._future = [];
        editor._scheduleRender();
        if (editor.onUpdate) editor.onUpdate();
        if (editor.onHistoryChange) editor.onHistoryChange();
        return true;
    }

    function syncInputs() {
        var v = editor.getValues();
        var isFiniteVal = isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2]) && isFinite(v[3]);

        if (document.getElementById("x1")) {
            document.getElementById("x1").value = isFiniteVal ? v[0].toFixed(2) : "0.00";
            document.getElementById("y1").value = isFiniteVal ? v[1].toFixed(2) : "0.00";
            document.getElementById("x2").value = isFiniteVal ? v[2].toFixed(2) : "1.00";
            document.getElementById("y2").value = isFiniteVal ? v[3].toFixed(2) : "1.00";
        }

        var displayEl = document.getElementById("bezier-display");
        if (displayEl) {
            var pointCount = editor.getPointCount();
            var displayText;
            if (pointCount > 2) {
                displayText = pointCount + " points — " + (pointCount - 1) + " segments";
            } else if (isFiniteVal) {
                displayText = v[0].toFixed(2) + ", " + v[1].toFixed(2) + ", " + v[2].toFixed(2) + ", " + v[3].toFixed(2);
            } else {
                displayText = "0.00, 0.00, 1.00, 1.00";
            }
            displayEl.innerText = displayText;
            displayEl.classList.remove("flash");
            void displayEl.offsetWidth;
            displayEl.classList.add("flash");
            setTimeout(function() { displayEl.classList.remove("flash"); }, 580);
        }
    }

    function saveData() {
        try {
            localStorage.setItem("curvase_presets_v2", JSON.stringify(categories));
        } catch(e) {}
    }

    function loadData() {
        loadFavorites();
        var raw = localStorage.getItem("curvase_presets_v2");
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    var migratedFavs = [];
                    var filtered = parsed.filter(function(cat) {
                        if (cat.name === "⭐ Favorites") {
                            migratedFavs = cat.items || [];
                            return false;
                        }
                        return true;
                    });
                    if (filtered.length > 0) {
                        categories = filtered;
                    }
                    if (migratedFavs.length > 0 && favoritesList.length === 0) {
                        favoritesList = migratedFavs;
                        saveFavorites();
                    }
                }
            } catch(e) {}
        }
        var old = localStorage.getItem("curvase_presets_final");
        if (old) {
            try {
                var flat = JSON.parse(old);
                if (Array.isArray(flat) && flat.length) {
                    categories[categories.length - 1].items =
                        categories[categories.length - 1].items.concat(flat);
                    saveData();
                }
            } catch(e) {}
            try { localStorage.removeItem("curvase_presets_final"); } catch(e) {}
        }
    }

    return { init: init };
})();
window.onload = curvaseApp.init;