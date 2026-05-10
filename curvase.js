var Curvase = (function() {
    "use strict";

    var HANDLE_RADIUS = 7;
    var ANCHOR_RADIUS = 5;
    var HIT_RADIUS = 15;
    var PADDING = 40;
    var Y_MIN = 0;
    var Y_MAX = 1;
    var Y_RANGE = Y_MAX - Y_MIN;
    var MAX_SPEED = 3.0;

    var RESET_VALUES = [0.42, 0, 0.58, 1.0];

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function makeDefaultPoints() {
        return [
            {x: 0, y: 0, hInX: null, hInY: null, hOutX: 0.25, hOutY: 0.1},
            {x: 1, y: 1, hInX: 0.25, hInY: 1.0, hOutX: null, hOutY: null}
        ];
    }

    function BezierEditor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        this.dpr = window.devicePixelRatio || 1;
        this.points = makeDefaultPoints();
        this.dragging = null;
        this.hovering = null;
        this.onUpdate = null;
        this._rafId = 0;
        this.size = 0;
        this.graphSize = 0;
        this.bgImage = null;
        this.bgVideoElement = null;
        this.selected = [];
        this.boxSelecting = false;
        this.boxStartPx = null;
        this.boxEndPx = null;
        this.zoomLevel = 1;
        this.viewXMin = 0;
        this.viewXMax = 1;
        this.viewYMin = 0;
        this.viewYMax = 1;
        this.onZoomChange = null;
        this.isSpeedMode = false;
        this._savedPositions = [];
        this._dragStartX = 0;
        this._dragStartY = 0;
        this.scrubT = null;
        this._history = [];
        this._future  = [];
        this._morphRafId = 0;

        this.waveformData    = null;
        this.waveformVisible = true;
        this.waveformOpacity = 0;
        this._waveformFadeRaf = 0;

        this.spectrumData    = null;
        this.spectrumVisible = true;
        this.spectrumMode    = "bars";

        this._beatEnergy = 0;
        this._beatDecay  = 0.88;
        this._segBeatEnergy = new Float32Array(8);
        this._segBeatDecay  = 0.88;
        this._initCanvas();
        this._bindEvents();
        this._draw();
    }

    BezierEditor.prototype.toggleMode = function() {
        this.isSpeedMode = !this.isSpeedMode;
        this._scheduleRender();
    };

    BezierEditor.prototype.setVolume = function(val) {
        if (this.bgVideoElement) {
            this.bgVideoElement.volume = Math.max(0, Math.min(1, val));
            if (this.bgVideoElement.volume > 0) {
                this.bgVideoElement.muted = false;
            }
        }
    };

    BezierEditor.prototype.toggleMute = function() {
        if (this.bgVideoElement) {
            this.bgVideoElement.muted = !this.bgVideoElement.muted;
            return this.bgVideoElement.muted;
        }
        return false;
    };

    BezierEditor.prototype._initCanvas = function() {
        var container = this.canvas.parentElement;
        var rect = container.getBoundingClientRect();
        var w = Math.floor(rect.width) || 320;
        var header = document.getElementById("header");
        var controls = document.getElementById("controls");
        var usedH = (header ? header.offsetHeight : 0) + (controls ? controls.offsetHeight : 0) + 20;
        var maxH = Math.floor(window.innerHeight - usedH);
        var size = Math.min(w, maxH);
        if (size < 200) size = 200;
        this.canvas.width = size * this.dpr;
        this.canvas.height = size * this.dpr;
        this.canvas.style.width = size + "px";
        this.canvas.style.height = size + "px";
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.size = size;
        this.graphSize = size - PADDING * 2;
    };

    BezierEditor.prototype._bindEvents = function() {
        var self = this;
        this.canvas.addEventListener("mousedown", function(e) {
            self._onMouseDown(e);
        });
        window.addEventListener("mousemove", function(e) {
            self._onMouseMove(e);
        });
        window.addEventListener("mouseup", function() {
            self._onMouseUp();
        });
        this.canvas.addEventListener("dblclick", function(e) {
            self._onDoubleClick(e);
        });
        window.addEventListener("keydown", function(e) {
            self._onKeyDown(e);
        });
        this.canvas.addEventListener("wheel", function(e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? -0.1 : 0.1;
            var nz = Math.round(Math.max(0.5, Math.min(5, self.zoomLevel + delta)) * 10) / 10;
            self.setZoom(nz);
        }, {passive: false});
    };

    BezierEditor.prototype._toX = function(v) {
        return PADDING + (v - this.viewXMin) / (this.viewXMax - this.viewXMin) * this.graphSize;
    };

    BezierEditor.prototype._toY = function(v) {
        return PADDING + (this.viewYMax - v) / (this.viewYMax - this.viewYMin) * this.graphSize;
    };

    BezierEditor.prototype._fromX = function(px) {
        return this.viewXMin + (px - PADDING) / this.graphSize * (this.viewXMax - this.viewXMin);
    };

    BezierEditor.prototype._fromY = function(py) {
        return this.viewYMax - (py - PADDING) / this.graphSize * (this.viewYMax - this.viewYMin);
    };

    BezierEditor.prototype._dist = function(ax, ay, bx, by) {
        var dx = ax - bx;
        var dy = ay - by;
        return Math.sqrt(dx * dx + dy * dy);
    };

    BezierEditor.prototype._hitTest = function(mx, my) {
        var bestDist = HIT_RADIUS;
        var best = null;

        for (var i = 0; i < this.points.length; i++) {
            var p = this.points[i];
            if (p.hOutX !== null) {
                var visOutX = this.isSpeedMode ? p.hOutX * 0.5 : p.hOutX;
                var visOutY = this.isSpeedMode ? (p.hOutY / Math.max(0.001, p.hOutX)) / MAX_SPEED : p.hOutY;
                var d = this._dist(mx, my, this._toX(visOutX), this._toY(visOutY));
                if (d < bestDist) {
                    bestDist = d;
                    best = {type: "hOut", index: i};
                }
            }
            if (p.hInX !== null) {
                var visInX = this.isSpeedMode ? 1 - ((1 - p.hInX) * 0.5) : p.hInX;
                var visInY = this.isSpeedMode ? ((1 - p.hInY) / Math.max(0.001, 1 - p.hInX)) / MAX_SPEED : p.hInY;
                var d2 = this._dist(mx, my, this._toX(visInX), this._toY(visInY));
                if (d2 < bestDist) {
                    bestDist = d2;
                    best = {type: "hIn", index: i};
                }
            }
        }

        if(!this.isSpeedMode) {
            for (var j = 1; j < this.points.length - 1; j++) {
                var ap = this.points[j];
                var da = this._dist(mx, my, this._toX(ap.x), this._toY(ap.y));
                if (da < bestDist) {
                    bestDist = da;
                    best = {type: "anchor", index: j};
                }
            }
        }

        return best;
    };

    BezierEditor.prototype._findNearestOnCurve = function(mx, my) {
        var best = {segIndex: 0, t: 0.5, dist: Infinity};
        var steps = 50;

        for (var si = 0; si < this.points.length - 1; si++) {
            var a = this.points[si];
            var b = this.points[si + 1];
            var p0x = a.x, p0y = a.y;
            var p1x = a.hOutX, p1y = a.hOutY;
            var p2x = b.hInX, p2y = b.hInY;
            var p3x = b.x, p3y = b.y;

            for (var s = 0; s <= steps; s++) {
                var t = s / steps;
                var mt = 1 - t;
                var cx = mt * mt * mt * p0x + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * p3x;
                var cy = mt * mt * mt * p0y + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * p3y;
                var d = this._dist(mx, my, this._toX(cx), this._toY(cy));
                if (d < best.dist) {
                    best = {segIndex: si, t: t, dist: d};
                }
            }
        }

        return best;
    };

    BezierEditor.prototype._splitSegment = function(segIndex, t) {
        var a = this.points[segIndex];
        var b = this.points[segIndex + 1];

        var p0x = a.x, p0y = a.y;
        var p1x = a.hOutX, p1y = a.hOutY;
        var p2x = b.hInX, p2y = b.hInY;
        var p3x = b.x, p3y = b.y;

        var q0x = lerp(p0x, p1x, t), q0y = lerp(p0y, p1y, t);
        var q1x = lerp(p1x, p2x, t), q1y = lerp(p1y, p2y, t);
        var q2x = lerp(p2x, p3x, t), q2y = lerp(p2y, p3y, t);
        var r0x = lerp(q0x, q1x, t), r0y = lerp(q0y, q1y, t);
        var r1x = lerp(q1x, q2x, t), r1y = lerp(q1y, q2y, t);
        var sx = lerp(r0x, r1x, t), sy = lerp(r0y, r1y, t);

        a.hOutX = q0x;
        a.hOutY = q0y;
        b.hInX = q2x;
        b.hInY = q2y;

        var newPoint = {
            x: Math.round(sx * 100) / 100,
            y: Math.round(sy * 100) / 100,
            hInX: r0x, hInY: r0y,
            hOutX: r1x, hOutY: r1y
        };

        this.points.splice(segIndex + 1, 0, newPoint);
    };

    BezierEditor.prototype._onMouseDown = function(e) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;

        this._cancelMorph();

        if (e.ctrlKey || e.metaKey) {
            for (var ci = 1; ci < this.points.length - 1; ci++) {
                if (this._dist(mx, my, this._toX(this.points[ci].x), this._toY(this.points[ci].y)) < HIT_RADIUS) {
                    this._commit();
                    this.points.splice(ci, 1);
                    this.hovering = null;
                    this._scheduleRender();
                    if (this.onUpdate) this.onUpdate();
                    e.preventDefault();
                    return;
                }
            }
            var nearest = this._findNearestOnCurve(mx, my);
            if (nearest.dist < 30 && !this.isSpeedMode) {
                this._commit();
                this._splitSegment(nearest.segIndex, nearest.t);
                this.dragging = {type: "anchor", index: nearest.segIndex + 1};
                this.canvas.style.cursor = "grabbing";
                this._scheduleRender();
                if (this.onUpdate) this.onUpdate();
                e.preventDefault();
                return;
            }
        }

        if (e.altKey && !this.isSpeedMode) {
            for (var ai = 0; ai < this.points.length; ai++) {
                if (this._dist(mx, my, this._toX(this.points[ai].x), this._toY(this.points[ai].y)) < HIT_RADIUS) {
                    this._pullOutHandles(ai);
                    var dragType = this.points[ai].hOutX !== null ? "hOut" : "hIn";
                    this.dragging = {type: dragType, index: ai};
                    this.canvas.style.cursor = "grabbing";
                    this._scheduleRender();
                    if (this.onUpdate) this.onUpdate();
                    e.preventDefault();
                    return;
                }
            }
        }

        var hit = this._hitTest(mx, my);

        if (e.shiftKey && !hit) {
            this.boxSelecting = true;
            this.boxStartPx = {x: mx, y: my};
            this.boxEndPx = {x: mx, y: my};
            this.canvas.style.cursor = "crosshair";
            e.preventDefault();
            return;
        }

        if (hit && this._isSelected(hit)) {
            this.dragging = {type: "group", ref: hit};
            this._dragStartX = this._fromX(mx);
            this._dragStartY = this._fromY(my);
            this._saveSelectedPositions();
            this.canvas.style.cursor = "grabbing";
            e.preventDefault();
            return;
        }

        if (hit) {
            if (!e.shiftKey) this.selected = [];
            this.dragging = hit;
            this.canvas.style.cursor = "grabbing";
            e.preventDefault();
        } else if (!e.shiftKey) {
            this.selected = [];
            this._scheduleRender();
        }
    };

    BezierEditor.prototype._onMouseMove = function(e) {
        var rect = this.canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;

        if (this.boxSelecting) {
            this.boxEndPx = {x: mx, y: my};
            this._scheduleRender();
            return;
        }

        if (this.dragging) {
            if (this.dragging.type === "group") {
                var gdx = this._fromX(mx) - this._dragStartX;
                var gdy = this._fromY(my) - this._dragStartY;
                this._moveSelected(gdx, gdy);
                this._scheduleRender();
                if (this.onUpdate) this.onUpdate();
                return;
            }
            var x = this._fromX(mx);
            var y = this._fromY(my);
            y = Math.round(Math.max(-2, Math.min(3, y)) * 100) / 100;

            var d = this.dragging;
            var p = this.points[d.index];

            if (d.type === "anchor" && !this.isSpeedMode) {
                var prevX = this.points[d.index - 1].x;
                var nextX = this.points[d.index + 1].x;
                x = Math.round(Math.max(prevX + 0.01, Math.min(nextX - 0.01, x)) * 100) / 100;
                var dx = x - p.x;
                var dy = y - p.y;
                p.x = x;
                p.y = y;
                if (p.hInX !== null) { p.hInX += dx; p.hInY += dy; }
                if (p.hOutX !== null) { p.hOutX += dx; p.hOutY += dy; }
            } else if (d.type === "hOut") {
                x = Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
                if (e.shiftKey) { y = 0; }

                if (this.isSpeedMode) {
                    y = Math.max(0, y);
                    p.hOutX = Math.round(Math.min(1, x * 2) * 100) / 100;
                    var speed = y * MAX_SPEED;
                    p.hOutY = Math.round((speed * Math.max(0.001, p.hOutX)) * 100) / 100;
                } else {
                    p.hOutX = x;
                    p.hOutY = y;
                }

                if (!e.altKey && !this.isSpeedMode && p.hInX !== null && d.index > 0 && d.index < this.points.length - 1) {
                    p.hInX = Math.round(Math.max(0, Math.min(1, 2 * p.x - p.hOutX)) * 100) / 100;
                    p.hInY = Math.round(Math.max(-2, Math.min(3, 2 * p.y - p.hOutY)) * 100) / 100;
                }
            } else if (d.type === "hIn") {
                x = Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
                if (e.shiftKey) {
                    if (this.isSpeedMode) { y = 0; }
                    else { y = 1; }
                }

                if (this.isSpeedMode) {
                    y = Math.max(0, y);
                    p.hInX = Math.round((1 - Math.min(1, (1 - x) * 2)) * 100) / 100;
                    var speed = y * MAX_SPEED;
                    p.hInY = Math.round((1 - (speed * Math.max(0.001, 1 - p.hInX))) * 100) / 100;
                } else {
                    p.hInX = x;
                    p.hInY = y;
                }

                if (!e.altKey && !this.isSpeedMode && p.hOutX !== null && d.index > 0 && d.index < this.points.length - 1) {
                    p.hOutX = Math.round(Math.max(0, Math.min(1, 2 * p.x - p.hInX)) * 100) / 100;
                    p.hOutY = Math.round(Math.max(-2, Math.min(3, 2 * p.y - p.hInY)) * 100) / 100;
                }
            }

            this._scheduleRender();
            if (this.onUpdate) this.onUpdate();
        } else {
            var hover = this._hitTest(mx, my);
            var newCursor = hover ? "grab" : "crosshair";
            if (e.ctrlKey || e.metaKey) {
                if (hover && hover.type === "anchor") {
                    newCursor = "pointer";
                } else if (!hover) {
                    newCursor = "copy";
                }
            }
            if (e.altKey && hover && hover.type === "anchor") {
                newCursor = "pointer";
            }
            this.hovering = hover;
            this.canvas.style.cursor = newCursor;
        }
    };

    BezierEditor.prototype._onMouseUp = function() {
        if (this.boxSelecting) {
            this._computeBoxSelection();
            this.boxSelecting = false;
            this.boxStartPx = null;
            this.boxEndPx = null;
            this._scheduleRender();
            return;
        }
        if (this.dragging) {
            this.dragging = null;
            this.canvas.style.cursor = this.hovering ? "grab" : "crosshair";
            this._commit();
        }
    };

    BezierEditor.prototype._onDoubleClick = function(e) {
        e.preventDefault();
        var first = this.points[0];
        var last  = this.points[this.points.length - 1];
        var alreadyDefault = (
            this.points.length === 2 &&
            first.hOutX === RESET_VALUES[0] && first.hOutY === RESET_VALUES[1] &&
            last.hInX  === RESET_VALUES[2] && last.hInY  === RESET_VALUES[3]
        );
        if (!alreadyDefault) {
            this._commit();
        }
        this.points = [
            {x: 0, y: 0, hInX: null, hInY: null, hOutX: RESET_VALUES[0], hOutY: RESET_VALUES[1]},
            {x: 1, y: 1, hInX: RESET_VALUES[2], hInY: RESET_VALUES[3], hOutX: null, hOutY: null}
        ];
        this._scheduleRender();
        if (this.onUpdate) this.onUpdate();
    };

    BezierEditor.prototype._onKeyDown = function(e) {
        if (e.ctrlKey && !e.shiftKey && e.key === "z") { this.undo(); e.preventDefault(); return; }
        if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"))) { this.redo(); e.preventDefault(); return; }

        if ((e.key === "Delete" || e.key === "Backspace") && this.hovering && this.hovering.type === "anchor" && !this.isSpeedMode) {
            var idx = this.hovering.index;
            if (idx > 0 && idx < this.points.length - 1) {
                this._commit();
                this.points.splice(idx, 1);
                this.hovering = null;
                this._scheduleRender();
                if (this.onUpdate) this.onUpdate();
                e.preventDefault();
            }
        }
    };

    BezierEditor.prototype._pullOutHandles = function(index) {
        var p = this.points[index];
        var prev = index > 0 ? this.points[index - 1] : null;
        var next = index < this.points.length - 1 ? this.points[index + 1] : null;
        if (prev && next) {
            var dx = next.x - prev.x;
            var dy = next.y - prev.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            var hLen = len > 0.001 ? len * 0.25 : 0.1;
            var nx = len > 0.001 ? dx / len : 1;
            var ny = len > 0.001 ? dy / len : 0;
            p.hOutX = Math.round(Math.max(0, Math.min(1, p.x + nx * hLen)) * 100) / 100;
            p.hOutY = Math.round(Math.max(-2, Math.min(3, p.y + ny * hLen)) * 100) / 100;
            p.hInX = Math.round(Math.max(0, Math.min(1, p.x - nx * hLen)) * 100) / 100;
            p.hInY = Math.round(Math.max(-2, Math.min(3, p.y - ny * hLen)) * 100) / 100;
        } else if (next && p.hOutX !== null) {
            var hLen = (next.x - p.x) * 0.33;
            p.hOutX = Math.round(Math.max(0, Math.min(1, p.x + hLen)) * 100) / 100;
            p.hOutY = p.y;
        } else if (prev && p.hInX !== null) {
            var hLen = (p.x - prev.x) * 0.33;
            p.hInX = Math.round(Math.max(0, Math.min(1, p.x - hLen)) * 100) / 100;
            p.hInY = p.y;
        }
    };

    BezierEditor.prototype._scheduleRender = function() {
        if (this._rafId) return;
        var self = this;
        this._rafId = requestAnimationFrame(function() {
            self._rafId = 0;
            self._draw();
        });
    };

    BezierEditor.prototype._draw = function() {
        var ctx = this.ctx;
        var s = this.size;
        var gs = this.graphSize;

        ctx.clearRect(0, 0, s, s);

        var boxTop = this._toY(1);
        var boxBottom = this._toY(0);
        var boxLeft = this._toX(0);
        var boxRight = this._toX(1);
        var boxW = boxRight - boxLeft;
        var boxH = boxBottom - boxTop;

        if (this.bgImage) {
            var container = document.getElementById('curvase-media-bg');
            if (container) {
                var canvasOffsetX = this.canvas.offsetLeft;
                var canvasOffsetY = this.canvas.offsetTop;
                container.style.left = (canvasOffsetX + boxLeft) + 'px';
                container.style.top = (canvasOffsetY + boxTop) + 'px';
                container.style.width = boxW + 'px';
                container.style.height = boxH + 'px';
            }
        }

        var hasBg = !!this.bgImage;

        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);

        ctx.strokeStyle = hasBg ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        for (var i = 1; i < 4; i++) {
            var gx = this._toX(i / 4);
            ctx.beginPath(); ctx.moveTo(gx, boxTop); ctx.lineTo(gx, boxBottom); ctx.stroke();
            var gy = this._toY(i / 4);
            ctx.beginPath(); ctx.moveTo(boxLeft, gy); ctx.lineTo(boxRight, gy); ctx.stroke();
        }

        ctx.strokeStyle = hasBg ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);

        this._drawWaveform(ctx, boxLeft, boxTop, boxW, boxH);

        this._drawSpectrum(ctx, boxLeft, boxTop, boxW, boxH);

        this._beatEnergy = this._beatEnergy * this._beatDecay;
        if (this._beatEnergy < 0.001) this._beatEnergy = 0;
        var beatE = this._beatEnergy;

        if (!this.isSpeedMode) {

            ctx.beginPath();
            ctx.strokeStyle = hasBg ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)";
            ctx.lineWidth = 1;
            ctx.moveTo(this._toX(0), this._toY(0));
            ctx.lineTo(this._toX(1), this._toY(1));
            ctx.stroke();

            ctx.strokeStyle = hasBg ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.25)";
            ctx.lineWidth = hasBg ? 1.5 : 1;
            for (var pi = 0; pi < this.points.length; pi++) {
                var pt = this.points[pi];
                if (pt.hOutX !== null) {
                    ctx.beginPath(); ctx.moveTo(this._toX(pt.x), this._toY(pt.y)); ctx.lineTo(this._toX(pt.hOutX), this._toY(pt.hOutY)); ctx.stroke();
                }
                if (pt.hInX !== null) {
                    ctx.beginPath(); ctx.moveTo(this._toX(pt.x), this._toY(pt.y)); ctx.lineTo(this._toX(pt.hInX), this._toY(pt.hInY)); ctx.stroke();
                }
            }
            ctx.setLineDash([]);

            var glowBlur   = 10 + beatE * 42;

            var glowAlpha  = 0.18 + beatE * 0.55;

            var glowWidth  = 8 + beatE * 12;

            if (beatE > 0.15) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = "rgba(180,255,240," + (beatE * 0.18).toFixed(3) + ")";
                ctx.lineWidth = glowWidth + 10;
                ctx.shadowColor = "#ffffff";
                ctx.shadowBlur = glowBlur * 1.8;
                ctx.moveTo(this._toX(this.points[0].x), this._toY(this.points[0].y));
                for (var si = 0; si < this.points.length - 1; si++) {
                    var a = this.points[si]; var b = this.points[si + 1];
                    ctx.bezierCurveTo(this._toX(a.hOutX), this._toY(a.hOutY), this._toX(b.hInX), this._toY(b.hInY), this._toX(b.x), this._toY(b.y));
                }
                ctx.stroke();
                ctx.restore();
            }

            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "rgba(0,212,170," + glowAlpha.toFixed(3) + ")";
            ctx.lineWidth = glowWidth;
            ctx.shadowColor = "#00d4aa";
            ctx.shadowBlur = glowBlur;
            ctx.moveTo(this._toX(this.points[0].x), this._toY(this.points[0].y));
            for (var si = 0; si < this.points.length - 1; si++) {
                var a = this.points[si]; var b = this.points[si + 1];
                ctx.bezierCurveTo(this._toX(a.hOutX), this._toY(a.hOutY), this._toX(b.hInX), this._toY(b.hInY), this._toX(b.x), this._toY(b.y));
            }
            ctx.stroke();
            ctx.restore();

            ctx.beginPath();
            ctx.strokeStyle = "#00d4aa";
            ctx.lineWidth = 2;
            ctx.moveTo(this._toX(this.points[0].x), this._toY(this.points[0].y));
            for (var si = 0; si < this.points.length - 1; si++) {
                var a = this.points[si]; var b = this.points[si + 1];
                ctx.bezierCurveTo(this._toX(a.hOutX), this._toY(a.hOutY), this._toX(b.hInX), this._toY(b.hInY), this._toX(b.x), this._toY(b.y));
            }
            ctx.stroke();

            ctx.beginPath(); ctx.fillStyle = "#777"; ctx.arc(this._toX(this.points[0].x), this._toY(this.points[0].y), 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.fillStyle = "#777"; var lastPt = this.points[this.points.length - 1]; ctx.arc(this._toX(lastPt.x), this._toY(lastPt.y), 4, 0, Math.PI * 2); ctx.fill();

            for (var ai = 1; ai < this.points.length - 1; ai++) {
                this._drawAnchor(ctx, this.points[ai].x, this.points[ai].y);
            }

            for (var hi = 0; hi < this.points.length; hi++) {
                var hp = this.points[hi];
                var activeOut = (this.dragging || this.hovering) && ((this.dragging || this.hovering).type === "hOut") && ((this.dragging || this.hovering).index === hi);
                var activeIn  = (this.dragging || this.hovering) && ((this.dragging || this.hovering).type === "hIn")  && ((this.dragging || this.hovering).index === hi);
                if (hp.hOutX !== null) this._drawHandle(ctx, hp.hOutX, hp.hOutY, "#ff8c42", activeOut);
                if (hp.hInX !== null)  this._drawHandle(ctx, hp.hInX,  hp.hInY,  "#4a9eff", activeIn);
            }

        } else {

            var p0 = this.points[0];
            var p1 = this.points[this.points.length - 1];

            ctx.beginPath();
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 8;
            ctx.shadowColor = "rgba(255,255,255,0.4)";
            ctx.shadowBlur = 8;

            var steps = 100;

            var currentMaxSpeed = MAX_SPEED;
            for (var k = 0; k <= steps; k++) {
                var t = k / steps;
                var mt = 1 - t;
                var dxdt = 3*mt*mt*p0.hOutX + 6*mt*t*(p1.hInX - p0.hOutX) + 3*t*t*(1 - p1.hInX);
                var dydt = 3*mt*mt*p0.hOutY + 6*mt*t*(p1.hInY - p0.hOutY) + 3*t*t*(1 - p1.hInY);
                var speed = 0;
                if (Math.abs(dxdt) > 0.0001) speed = dydt / dxdt;
                if (speed > currentMaxSpeed) currentMaxSpeed = speed;
            }

            for (var k = 0; k <= steps; k++) {
                var t = k / steps;
                var mt = 1 - t;
                var xt = 3*mt*mt*t*p0.hOutX + 3*mt*t*t*p1.hInX + t*t*t;
                var dxdt = 3*mt*mt*p0.hOutX + 6*mt*t*(p1.hInX - p0.hOutX) + 3*t*t*(1 - p1.hInX);
                var dydt = 3*mt*mt*p0.hOutY + 6*mt*t*(p1.hInY - p0.hOutY) + 3*t*t*(1 - p1.hInY);
                var speed = 0;
                if (Math.abs(dxdt) > 0.0001) speed = dydt / dxdt;
                var px = this._toX(xt);

                var py = this._toY(speed / currentMaxSpeed);
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.beginPath();
            ctx.strokeStyle = "#cccccc";
            ctx.lineWidth = 2;
            for (var k = 0; k <= steps; k++) {
                var t = k / steps;
                var mt = 1 - t;
                var xt = 3*mt*mt*t*p0.hOutX + 3*mt*t*t*p1.hInX + t*t*t;
                var dxdt = 3*mt*mt*p0.hOutX + 6*mt*t*(p1.hInX - p0.hOutX) + 3*t*t*(1 - p1.hInX);
                var dydt = 3*mt*mt*p0.hOutY + 6*mt*t*(p1.hInY - p0.hOutY) + 3*t*t*(1 - p1.hInY);
                var speed = 0;
                if (Math.abs(dxdt) > 0.0001) speed = dydt / dxdt;
                var px = this._toX(xt);
                var py = this._toY(speed / currentMaxSpeed);
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            var cp1x = p0.hOutX * 0.5;
            var cp1y = Math.max(0, (p0.hOutY / Math.max(0.001, p0.hOutX)) / MAX_SPEED);

            var cp2x = 1 - ((1 - p1.hInX) * 0.5);
            var cp2y = Math.max(0, ((1 - p1.hInY) / Math.max(0.001, 1 - p1.hInX)) / MAX_SPEED);

            ctx.strokeStyle = "#d1a000";
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(this._toX(0), this._toY(cp1y)); ctx.lineTo(this._toX(cp1x), this._toY(cp1y)); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(this._toX(1), this._toY(cp2y)); ctx.lineTo(this._toX(cp2x), this._toY(cp2y)); ctx.stroke();

            ctx.fillStyle = "#fff";
            ctx.fillRect(this._toX(0)-3, this._toY(cp1y)-3, 6, 6);
            ctx.fillRect(this._toX(1)-3, this._toY(cp2y)-3, 6, 6);

            ctx.fillStyle = "#d1a000";
            ctx.beginPath(); ctx.arc(this._toX(cp1x), this._toY(cp1y), 4, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(this._toX(cp2x), this._toY(cp2y), 4, 0, Math.PI*2); ctx.fill();
        }

        for (var si2 = 0; si2 < this.selected.length; si2++) {
            var sel = this.selected[si2];
            var sp = this.points[sel.index];
            var scx, scy;

            if (!this.isSpeedMode) {
                if (sel.type === "anchor") { scx = this._toX(sp.x); scy = this._toY(sp.y); }
                else if (sel.type === "hOut" && sp.hOutX !== null) { scx = this._toX(sp.hOutX); scy = this._toY(sp.hOutY); }
                else if (sel.type === "hIn" && sp.hInX !== null) { scx = this._toX(sp.hInX); scy = this._toY(sp.hInY); }
            } else {
                if (sel.type === "hOut" && sp.hOutX !== null) {
                    scx = this._toX(sp.hOutX * 0.5);
                    scy = this._toY(Math.max(0, (sp.hOutY / Math.max(0.001, sp.hOutX)) / MAX_SPEED));
                }
                else if (sel.type === "hIn" && sp.hInX !== null) {
                    scx = this._toX(1 - (1 - sp.hInX) * 0.5);
                    scy = this._toY(Math.max(0, ((1 - sp.hInY) / Math.max(0.001, 1 - sp.hInX)) / MAX_SPEED));
                }
            }

            if (scx !== undefined) {
                ctx.beginPath();
                ctx.strokeStyle = "rgba(74,158,255,0.9)";
                ctx.lineWidth = 2;
                ctx.arc(scx, scy, 10, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        if (this.boxSelecting && this.boxStartPx && this.boxEndPx) {
            ctx.strokeStyle = "rgba(74,158,255,0.8)";
            ctx.fillStyle = "rgba(74,158,255,0.15)";
            ctx.lineWidth = 1;
            var bx = Math.min(this.boxStartPx.x, this.boxEndPx.x);
            var by = Math.min(this.boxStartPx.y, this.boxEndPx.y);
            var bw2 = Math.abs(this.boxEndPx.x - this.boxStartPx.x);
            var bh2 = Math.abs(this.boxEndPx.y - this.boxStartPx.y);
            ctx.fillRect(bx, by, bw2, bh2);
            ctx.strokeRect(bx, by, bw2, bh2);
        }

        if (this.scrubT !== null && !this.isSpeedMode) {
            var t = this.scrubT;

            var p0s = this.points[0], p1s = this.points[this.points.length - 1];
            var mt = 1 - t;
            var sx = mt*mt*mt*p0s.x + 3*mt*mt*t*p0s.hOutX + 3*mt*t*t*p1s.hInX + t*t*t*p1s.x;
            var sy = mt*mt*mt*p0s.y + 3*mt*mt*t*p0s.hOutY + 3*mt*t*t*p1s.hInY + t*t*t*p1s.y;
            var dotX = this._toX(sx);
            var dotY = this._toY(sy);

            ctx.save();
            ctx.strokeStyle = "rgba(255,255,255,0.18)";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(dotX, boxTop);
            ctx.lineTo(dotX, boxBottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            ctx.save();
            ctx.beginPath();
            ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.shadowColor = "#ffffff";
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();

            ctx.beginPath();
            ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        var PADDING = 40;
        ctx.fillStyle = hasBg ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.22)";
        ctx.font = "9px 'Segoe UI', sans-serif";
        var xMinL = this.zoomLevel === 1 ? "0" : this.viewXMin.toFixed(1);
        var xMaxL = this.zoomLevel === 1 ? "1" : this.viewXMax.toFixed(1);
        var yMinL = this.zoomLevel === 1 ? "0" : this.viewYMin.toFixed(1);
        var yMaxL = this.zoomLevel === 1 ? "1" : this.viewYMax.toFixed(1);
        ctx.textAlign = "center";
        ctx.fillText(xMinL, PADDING, PADDING + gs + 14);
        ctx.fillText(xMaxL, PADDING + gs, PADDING + gs + 14);
        if (this.zoomLevel === 1) ctx.fillText("0.5", PADDING + gs * 0.5, PADDING + gs + 14);
        ctx.textAlign = "right";
        ctx.fillText(yMinL, PADDING - 5, PADDING + gs + 3);
        ctx.fillText(yMaxL, PADDING - 5, PADDING + 3);
        if (this.zoomLevel === 1) { ctx.textAlign = "right"; ctx.fillText("0.5", PADDING - 5, PADDING + gs * 0.5 + 3); }
    };

    BezierEditor.prototype._drawHandle = function(ctx, x, y, color, isActive) {
        var cx = this._toX(x);
        var cy = this._toY(y);
        if (isActive) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, HANDLE_RADIUS + 4, 0, Math.PI * 2);
            ctx.fillStyle = color.replace(")", ",0.2)").replace("rgb", "rgba");
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.restore();
        }
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(cx, cy, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.5;
        ctx.arc(cx, cy, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
    };

    BezierEditor.prototype._drawAnchor = function(ctx, x, y) {
        var cx = this._toX(x);
        var cy = this._toY(y);
        ctx.beginPath();
        ctx.fillStyle = "#fff";
        ctx.arc(cx, cy, ANCHOR_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1.5;
        ctx.arc(cx, cy, ANCHOR_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
    };

    BezierEditor.prototype.setValues = function(x1, y1, x2, y2) {
        this._commit();
        this.points = [
            {x: 0, y: 0, hInX: null, hInY: null, hOutX: x1, hOutY: y1},
            {x: 1, y: 1, hInX: x2, hInY: y2, hOutX: null, hOutY: null}
        ];
        this._scheduleRender();
    };

    BezierEditor.prototype.setEndHandles = function(x1, y1, x2, y2) {
        this._cancelMorph();
        this._commit();
        this.points[0].hOutX = x1;
        this.points[0].hOutY = y1;
        var last = this.points[this.points.length - 1];
        last.hInX = x2;
        last.hInY = y2;
        this._scheduleRender();
    };

    BezierEditor.prototype.morphTo = function(x1, y1, x2, y2, durationMs) {
        this._cancelMorph();
        this._commit();

        var duration = (typeof durationMs === "number" && durationMs > 0) ? durationMs : 420;

        var fromX1 = this.points[0].hOutX;
        var fromY1 = this.points[0].hOutY;
        var last   = this.points[this.points.length - 1];
        var fromX2 = last.hInX;
        var fromY2 = last.hInY;

        if (fromX1 === x1 && fromY1 === y1 && fromX2 === x2 && fromY2 === y2) return;

        var self      = this;
        var startTime = null;

        function springEase(t) {
            if (t <= 0) return 0;
            if (t >= 1) return 1;
            var t2 = t * t;
            var t3 = t2 * t;
            var t4 = t3 * t;
            var t5 = t4 * t;
            return (-2.4 * t5) + (7.2 * t4) + (-8.1 * t3) + (3.9 * t2) + (1.4 * t);
        }

        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            var elapsed = timestamp - startTime;
            var rawT    = Math.min(elapsed / duration, 1);
            var easedT  = springEase(rawT);

            self.points[0].hOutX = fromX1 + (x1 - fromX1) * easedT;
            self.points[0].hOutY = fromY1 + (y1 - fromY1) * easedT;
            var lastPt = self.points[self.points.length - 1];
            lastPt.hInX = fromX2 + (x2 - fromX2) * easedT;
            lastPt.hInY = fromY2 + (y2 - fromY2) * easedT;

            if (rawT < 1) {
                self._scheduleRender();
                if (self.onUpdate) self.onUpdate();
                self._morphRafId = requestAnimationFrame(step);
            } else {
                self.points[0].hOutX = x1;
                self.points[0].hOutY = y1;
                var finalPt = self.points[self.points.length - 1];
                finalPt.hInX = x2;
                finalPt.hInY = y2;
                self._morphRafId = 0;
                self._scheduleRender();
                if (self.onUpdate) self.onUpdate();
            }
        }

        this._morphRafId = requestAnimationFrame(step);
    };

    BezierEditor.prototype._cancelMorph = function() {
        if (this._morphRafId) {
            cancelAnimationFrame(this._morphRafId);
            this._morphRafId = 0;
        }
    };

    BezierEditor.prototype.getValues = function() {
        var first = this.points[0];
        var last = this.points[this.points.length - 1];
        return [first.hOutX, first.hOutY, last.hInX, last.hInY];
    };

    BezierEditor.prototype.getSegments = function() {
        var segs = [];
        for (var i = 0; i < this.points.length - 1; i++) {
            var a = this.points[i];
            var b = this.points[i + 1];
            var dx = b.x - a.x;
            var dy = b.y - a.y;
            var sx1, sy1, sx2, sy2;
            if (dx > 0.0001) {
                sx1 = (a.hOutX - a.x) / dx;
                sx2 = (b.hInX  - a.x) / dx;
            } else {
                sx1 = 0;
                sx2 = 1;
            }
            if (Math.abs(dy) > 0.0001) {
                sy1 = (a.hOutY - a.y) / dy;
                sy2 = (b.hInY  - a.y) / dy;
            } else {
                sy1 = sx1;
                sy2 = sx2;
            }
            if (!isFinite(sx1)) sx1 = 0;
            if (!isFinite(sy1)) sy1 = 0;
            if (!isFinite(sx2)) sx2 = 1;
            if (!isFinite(sy2)) sy2 = 1;
            segs.push({x1: sx1, y1: sy1, x2: sx2, y2: sy2});
        }
        return segs;
    };

    BezierEditor.prototype.getMidPoints = function() {
        var mids = [];
        for (var i = 1; i < this.points.length - 1; i++) {
            mids.push(this.points[i].x);
            mids.push(this.points[i].y);
        }
        return mids;
    };

    BezierEditor.prototype.getPointCount = function() {
        return this.points.length;
    };

    BezierEditor.prototype.reverseBezierHandles = function() {
        this._cancelMorph();
        this._commit();
        var pts = this.points;
        if (pts.length < 2) return false;

        for (var i = 0; i < pts.length - 1; i++) {
            var a = pts[i];
            var b = pts[i + 1];
            var dx = b.x - a.x;
            var dy = b.y - a.y;

            var sx1, sy1, sx2, sy2;
            if (dx > 0.0001) {
                sx1 = (a.hOutX - a.x) / dx;
                sx2 = (b.hInX - a.x) / dx;
            } else {
                sx1 = 0;
                sx2 = 1;
            }
            if (Math.abs(dy) > 0.0001) {
                sy1 = (a.hOutY - a.y) / dy;
                sy2 = (b.hInY - a.y) / dy;
            } else {
                sy1 = sx1;
                sy2 = sx2;
            }
            if (!isFinite(sx1)) sx1 = 0;
            if (!isFinite(sy1)) sy1 = 0;
            if (!isFinite(sx2)) sx2 = 1;
            if (!isFinite(sy2)) sy2 = 1;

            var nsx1 = 1 - sx2;
            var nsy1 = 1 - sy2;
            var nsx2 = 1 - sx1;
            var nsy2 = 1 - sy1;

            if (dx > 0.0001) {
                a.hOutX = a.x + nsx1 * dx;
                b.hInX = a.x + nsx2 * dx;
            }
            if (Math.abs(dy) > 0.0001) {
                a.hOutY = a.y + nsy1 * dy;
                b.hInY = a.y + nsy2 * dy;
            }
        }

        this._scheduleRender();
        if (this.onUpdate) this.onUpdate();
        return true;
    };

    BezierEditor.prototype.setZoom = function(level) {
        this.zoomLevel = level;
        var half = 0.5 / level;
        this.viewXMin = 0.5 - half;
        this.viewXMax = 0.5 + half;
        this.viewYMin = 0.5 - half;
        this.viewYMax = 0.5 + half;
        this._scheduleRender();
        if (this.onZoomChange) this.onZoomChange(level);
    };

    BezierEditor.prototype._isSelected = function(hit) {
        for (var i = 0; i < this.selected.length; i++) {
            if (this.selected[i].type === hit.type && this.selected[i].index === hit.index) return true;
        }
        return false;
    };

    BezierEditor.prototype._saveSelectedPositions = function() {
        this._savedPositions = [];
        for (var i = 0; i < this.selected.length; i++) {
            var sel = this.selected[i];
            var p = this.points[sel.index];
            if (sel.type === "anchor") {
                this._savedPositions.push({x: p.x, y: p.y, hInX: p.hInX, hInY: p.hInY, hOutX: p.hOutX, hOutY: p.hOutY});
            } else if (sel.type === "hOut") {
                if (this.isSpeedMode) {
                    this._savedPositions.push({x: p.hOutX * 0.5, y: (p.hOutY / Math.max(0.001, p.hOutX)) / MAX_SPEED});
                } else {
                    this._savedPositions.push({x: p.hOutX, y: p.hOutY});
                }
            } else if (sel.type === "hIn") {
                if (this.isSpeedMode) {
                    this._savedPositions.push({x: 1 - ((1 - p.hInX) * 0.5), y: ((1 - p.hInY) / Math.max(0.001, 1 - p.hInX)) / MAX_SPEED});
                } else {
                    this._savedPositions.push({x: p.hInX, y: p.hInY});
                }
            }
        }
    };

    BezierEditor.prototype._moveSelected = function(dx, dy) {
        for (var i = 0; i < this.selected.length; i++) {
            var sel = this.selected[i];
            var saved = this._savedPositions[i];
            var p = this.points[sel.index];
            if (sel.type === "anchor" && !this.isSpeedMode) {
                var prevX = sel.index > 0 ? this.points[sel.index - 1].x : -Infinity;
                var nextX = sel.index < this.points.length - 1 ? this.points[sel.index + 1].x : Infinity;
                var nx = Math.round(Math.max(prevX + 0.01, Math.min(nextX - 0.01, saved.x + dx)) * 100) / 100;
                var ny = Math.round(Math.max(-2, Math.min(3, saved.y + dy)) * 100) / 100;
                var adx = nx - saved.x;
                var ady = ny - saved.y;
                p.x = nx;
                p.y = ny;
                if (p.hInX !== null) { p.hInX = Math.round((saved.hInX + adx) * 100) / 100; p.hInY = Math.round((saved.hInY + ady) * 100) / 100; }
                if (p.hOutX !== null) { p.hOutX = Math.round((saved.hOutX + adx) * 100) / 100; p.hOutY = Math.round((saved.hOutY + ady) * 100) / 100; }
            } else if (sel.type === "hOut") {
                if (this.isSpeedMode) {
                    var newVisX = Math.max(0, Math.min(1, saved.x + dx));
                    p.hOutX = Math.round(Math.min(1, newVisX * 2) * 100) / 100;
                    var speed = Math.max(0, saved.y + dy) * MAX_SPEED;
                    p.hOutY = Math.round((speed * Math.max(0.001, p.hOutX)) * 100) / 100;
                } else {
                    p.hOutX = Math.round(Math.max(0, Math.min(1, saved.x + dx)) * 100) / 100;
                    p.hOutY = Math.round(Math.max(-2, Math.min(3, saved.y + dy)) * 100) / 100;
                }
            } else if (sel.type === "hIn") {
                if (this.isSpeedMode) {
                    var newVisX = Math.max(0, Math.min(1, saved.x + dx));
                    p.hInX = Math.round((1 - Math.min(1, (1 - newVisX) * 2)) * 100) / 100;
                    var speed = Math.max(0, saved.y + dy) * MAX_SPEED;
                    p.hInY = Math.round((1 - (speed * Math.max(0.001, 1 - p.hInX))) * 100) / 100;
                } else {
                    p.hInX = Math.round(Math.max(0, Math.min(1, saved.x + dx)) * 100) / 100;
                    p.hInY = Math.round(Math.max(-2, Math.min(3, saved.y + dy)) * 100) / 100;
                }
            }
        }
    };

    BezierEditor.prototype._computeBoxSelection = function() {
        if (!this.boxStartPx || !this.boxEndPx) return;
        var x1 = Math.min(this.boxStartPx.x, this.boxEndPx.x);
        var y1 = Math.min(this.boxStartPx.y, this.boxEndPx.y);
        var x2 = Math.max(this.boxStartPx.x, this.boxEndPx.x);
        var y2 = Math.max(this.boxStartPx.y, this.boxEndPx.y);
        this.selected = [];
        for (var i = 0; i < this.points.length; i++) {
            var p = this.points[i];

            if(!this.isSpeedMode) {
                var px = this._toX(p.x), py = this._toY(p.y);
                if (i > 0 && i < this.points.length - 1 && px >= x1 && px <= x2 && py >= y1 && py <= y2) {
                    this.selected.push({type: "anchor", index: i});
                }
            }

            if (p.hOutX !== null) {
                var visOutX = this.isSpeedMode ? p.hOutX * 0.5 : p.hOutX;
                var visOutY = this.isSpeedMode ? (p.hOutY / Math.max(0.001, p.hOutX)) / MAX_SPEED : p.hOutY;
                var hx = this._toX(visOutX), hy = this._toY(visOutY);
                if (hx >= x1 && hx <= x2 && hy >= y1 && hy <= y2) {
                    this.selected.push({type: "hOut", index: i});
                }
            }
            if (p.hInX !== null) {
                var visInX = this.isSpeedMode ? 1 - ((1 - p.hInX) * 0.5) : p.hInX;
                var visInY = this.isSpeedMode ? ((1 - p.hInY) / Math.max(0.001, 1 - p.hInX)) / MAX_SPEED : p.hInY;
                var hix = this._toX(visInX), hiy = this._toY(visInY);
                if (hix >= x1 && hix <= x2 && hiy >= y1 && hiy <= y2) {
                    this.selected.push({type: "hIn", index: i});
                }
            }
        }
    };

    BezierEditor.prototype.resize = function() {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this._initCanvas();
        this._draw();
    };

    BezierEditor.prototype.setBackgroundImage = function(mediaUrl, mediaType) {
        this.clearBackgroundImage();
        var container = document.getElementById('curvase-media-bg');
        if (!container) {
            container = document.createElement('div');
            container.id = 'curvase-media-bg';
            container.style.position = 'absolute';
            container.style.pointerEvents = 'none';
            container.style.zIndex = '0';

            this.canvas.style.position = 'relative';
            this.canvas.style.zIndex = '1';
            this.canvas.parentElement.style.position = 'relative';
            this.canvas.parentElement.insertBefore(container, this.canvas);
        }

        container.innerHTML = '';

        if (mediaType === 'video') {
            var vid = document.createElement('video');
            vid.autoplay = true;
            vid.loop = true;
            vid.muted = false;
            vid.playsInline = true;
            vid.src = mediaUrl;
            vid.style.width = '100%';
            vid.style.height = '100%';
            vid.style.objectFit = 'contain';
            vid.style.opacity = '1';
            this.bgVideoElement = vid;
            container.appendChild(vid);
        } else {
            var img = document.createElement('img');
            img.src = mediaUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.opacity = '1';
            container.appendChild(img);
        }

        this.bgImage = true;
        this._scheduleRender();
    };

    BezierEditor.prototype.clearBackgroundImage = function() {
        var container = document.getElementById('curvase-media-bg');
        if (container) {
            container.innerHTML = '';
        }
        this.bgImage = null;
        this.bgVideoElement = null;
        this._scheduleRender();
    };

    BezierEditor.prototype._commit = function() {
        this._history.push(JSON.stringify(this.points));
        if (this._history.length > 50) this._history.shift();
        this._future = [];
        if (this.onHistoryChange) this.onHistoryChange();
    };

    BezierEditor.prototype.undo = function() {
        if (!this._history.length) return;
        this._cancelMorph();
        this._future.push(JSON.stringify(this.points));
        this.points = JSON.parse(this._history.pop());
        this._scheduleRender();
        if (this.onUpdate) this.onUpdate();
        if (this.onHistoryChange) this.onHistoryChange();
    };

    BezierEditor.prototype.redo = function() {
        if (!this._future.length) return;
        this._cancelMorph();
        this._history.push(JSON.stringify(this.points));
        this.points = JSON.parse(this._future.pop());
        this._scheduleRender();
        if (this.onUpdate) this.onUpdate();
        if (this.onHistoryChange) this.onHistoryChange();
    };

    BezierEditor.prototype.setScrubT = function(t) {
        this.scrubT = Math.max(0, Math.min(1, t));
        this._scheduleRender();
    };

    BezierEditor.prototype.clearScrubT = function() {
        this.scrubT = null;
        this._scheduleRender();
    };

    BezierEditor.prototype.setWaveform = function(rawSamples, targetBins) {
        var bins = (typeof targetBins === "number" && targetBins > 0) ? targetBins : 512;
        var samplesPerBin = Math.max(1, Math.floor(rawSamples.length / bins));
        var envelope = new Float32Array(bins);
        var peak = 0;

        for (var b = 0; b < bins; b++) {
            var start = b * samplesPerBin;
            var end   = Math.min(start + samplesPerBin, rawSamples.length);
            var sum   = 0;
            for (var s = start; s < end; s++) {
                sum += rawSamples[s] * rawSamples[s];
            }
            var rms = Math.sqrt(sum / (end - start));
            envelope[b] = rms;
            if (rms > peak) peak = rms;
        }

        if (peak > 0) {
            for (var i = 0; i < bins; i++) envelope[i] /= peak;
        }

        this.waveformData    = envelope;
        this.waveformVisible = true;
        this.waveformOpacity = 0;
        this._startWaveformFade();
    };

    BezierEditor.prototype.clearWaveform = function() {
        var self = this;
        if (this._waveformFadeRaf) {
            cancelAnimationFrame(this._waveformFadeRaf);
            this._waveformFadeRaf = 0;
        }

        var startOpacity = this.waveformOpacity;
        var startTime    = null;
        var FADE_OUT_MS  = 200;

        function fadeOut(ts) {
            if (!startTime) startTime = ts;
            var t = Math.min((ts - startTime) / FADE_OUT_MS, 1);
            self.waveformOpacity = startOpacity * (1 - t);
            self._rafId = 0;
            self._draw();
            if (t < 1) {
                self._waveformFadeRaf = requestAnimationFrame(fadeOut);
            } else {
                self.waveformData    = null;
                self.waveformOpacity = 0;
                self._waveformFadeRaf = 0;
                self._draw();
            }
        }

        if (this.waveformData) {
            this._waveformFadeRaf = requestAnimationFrame(fadeOut);
        } else {
            this.waveformData    = null;
            this.waveformOpacity = 0;
        }
    };

    BezierEditor.prototype.toggleWaveform = function() {
        if (!this.waveformData) return false;
        this.waveformVisible = !this.waveformVisible;
        if (this.waveformVisible) {
            this._startWaveformFade();
        } else {

            if (this._waveformFadeRaf) {
                cancelAnimationFrame(this._waveformFadeRaf);
                this._waveformFadeRaf = 0;
            }
            this.waveformOpacity = 0;
            this._scheduleRender();
        }
        return this.waveformVisible;
    };

    BezierEditor.prototype._startWaveformFade = function() {
        var self = this;
        if (this._waveformFadeRaf) {
            cancelAnimationFrame(this._waveformFadeRaf);
            this._waveformFadeRaf = 0;
        }
        var startOpacity = this.waveformOpacity;
        var startTime    = null;
        var FADE_IN_MS   = 350;

        function fadeIn(ts) {
            if (!startTime) startTime = ts;
            var t = Math.min((ts - startTime) / FADE_IN_MS, 1);

            var eased = 1 - (1 - t) * (1 - t);
            self.waveformOpacity = startOpacity + (1 - startOpacity) * eased;
            self._rafId = 0;
            self._draw();
            if (t < 1) {
                self._waveformFadeRaf = requestAnimationFrame(fadeIn);
            } else {
                self.waveformOpacity  = 1;
                self._waveformFadeRaf = 0;
                self._draw();
            }
        }

        this._waveformFadeRaf = requestAnimationFrame(fadeIn);
    };

    BezierEditor.prototype._drawWaveform = function(ctx, boxLeft, boxTop, boxW, boxH) {
        if (!this.waveformData || !this.waveformVisible || this.waveformOpacity <= 0) return;

        var data   = this.waveformData;
        var bins   = data.length;
        var midY   = boxTop + boxH / 2;
        var halfH  = boxH / 2;

        var maxAmp = halfH * 0.80;

        ctx.save();

        ctx.beginPath();
        ctx.rect(boxLeft, boxTop, boxW, boxH);
        ctx.clip();

        ctx.beginPath();
        for (var i = 0; i < bins; i++) {
            var x = boxLeft + (i / (bins - 1)) * boxW;
            var amp = data[i] * maxAmp;
            if (i === 0) {
                ctx.moveTo(x, midY - amp);
            } else {
                ctx.lineTo(x, midY - amp);
            }
        }

        for (var j = bins - 1; j >= 0; j--) {
            var xj  = boxLeft + (j / (bins - 1)) * boxW;
            var ampj = data[j] * maxAmp;
            ctx.lineTo(xj, midY + ampj);
        }
        ctx.closePath();

        var grad = ctx.createLinearGradient(0, boxTop, 0, boxTop + boxH);
        var alpha = this.waveformOpacity * 0.13;
        grad.addColorStop(0,    "rgba(0,212,170," + (alpha * 0.3).toFixed(3) + ")");
        grad.addColorStop(0.35, "rgba(0,212,170," + alpha.toFixed(3) + ")");
        grad.addColorStop(0.5,  "rgba(0,212,170," + (alpha * 1.4).toFixed(3) + ")");
        grad.addColorStop(0.65, "rgba(0,212,170," + alpha.toFixed(3) + ")");
        grad.addColorStop(1,    "rgba(0,212,170," + (alpha * 0.3).toFixed(3) + ")");
        ctx.fillStyle = grad;
        ctx.fill();

        var strokeAlpha = this.waveformOpacity * 0.35;
        ctx.beginPath();
        for (var k = 0; k < bins; k++) {
            var xk  = boxLeft + (k / (bins - 1)) * boxW;
            var ampk = data[k] * maxAmp;
            if (k === 0) ctx.moveTo(xk, midY - ampk);
            else         ctx.lineTo(xk, midY - ampk);
        }
        ctx.strokeStyle = "rgba(0,212,170," + strokeAlpha.toFixed(3) + ")";
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.beginPath();
        for (var m = 0; m < bins; m++) {
            var xm  = boxLeft + (m / (bins - 1)) * boxW;
            var ampm = data[m] * maxAmp;
            if (m === 0) ctx.moveTo(xm, midY + ampm);
            else         ctx.lineTo(xm, midY + ampm);
        }
        ctx.strokeStyle = "rgba(0,212,170," + (strokeAlpha * 0.5).toFixed(3) + ")";
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(boxLeft,  midY);
        ctx.lineTo(boxLeft + boxW, midY);
        ctx.strokeStyle = "rgba(0,212,170," + (this.waveformOpacity * 0.12).toFixed(3) + ")";
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.restore();
    };

    BezierEditor.prototype.setSpectrumData = function(byteFreqData) {

        if (!this.spectrumData || this.spectrumData.length !== byteFreqData.length) {
            this.spectrumData = new Uint8Array(byteFreqData.length);
        }
        this.spectrumData.set(byteFreqData);
    };

    BezierEditor.prototype.clearSpectrumData = function() {
        this.spectrumData = null;
        this._scheduleRender();
    };

    BezierEditor.prototype.toggleSpectrum = function() {
        this.spectrumVisible = !this.spectrumVisible;
        this._scheduleRender();
        return this.spectrumVisible;
    };

    BezierEditor.prototype.notifyBeat = function(strength) {
        var s = (typeof strength === "number") ? strength : 1;
        if (s < 0) s = 0;
        if (s > 1) s = 1;
        if (s > this._beatEnergy) this._beatEnergy = s;
    };

    BezierEditor.prototype.setSegmentBandEnergies = function(energies) {
        var n = Math.min(energies.length, this._segBeatEnergy.length);
        for (var i = 0; i < n; i++) {
            if (energies[i] > this._segBeatEnergy[i]) {
                this._segBeatEnergy[i] = energies[i];
            }
        }
    };

    BezierEditor.prototype._drawSpectrum = function(ctx, boxLeft, boxTop, boxW, boxH) {
        if (!this.spectrumData || !this.spectrumVisible) return;
        if (this.spectrumMode === "radial") {
            this._drawSpectrumRadial(ctx, boxLeft, boxTop, boxW, boxH);
            return;
        }

        var data      = this.spectrumData;

        var useBins   = Math.floor(data.length / 2);

        var BAR_COUNT = 64;
        var binsPerBar = Math.max(1, Math.floor(useBins / BAR_COUNT));
        var barW      = boxW / BAR_COUNT;
        var GAP       = Math.max(1, Math.floor(barW * 0.15));
        var fillW     = Math.max(1, barW - GAP);

        if (!this._spectrumPeaks || this._spectrumPeaks.length !== BAR_COUNT) {
            this._spectrumPeaks = new Float32Array(BAR_COUNT);
        }

        var DECAY = 0.018;

        ctx.save();
        ctx.beginPath();
        ctx.rect(boxLeft, boxTop, boxW, boxH);
        ctx.clip();

        var MASTER_ALPHA = 0.55;

        var beatE = this._beatEnergy;

        var topR = Math.round(0   + beatE * 255);
        var topG = Math.round(212 + beatE * (255 - 212));
        var topB = Math.round(170 + beatE * (255 - 170));

        var midR = Math.round(0   + beatE * 180);
        var midG = Math.round(180 + beatE * (255 - 180));
        var midB = Math.round(150 + beatE * (255 - 150));

        for (var b = 0; b < BAR_COUNT; b++) {

            var binStart = b * binsPerBar;
            var sum = 0;
            for (var k = 0; k < binsPerBar; k++) {
                sum += data[binStart + k];
            }
            var avg = sum / binsPerBar;

            var norm = avg / 255;

            norm = Math.log(1 + norm * 1.5) / Math.log(2.5);
            if (norm > 1) norm = 1;

            if (norm >= this._spectrumPeaks[b]) {
                this._spectrumPeaks[b] = norm;
            } else {
                this._spectrumPeaks[b] = Math.max(0, this._spectrumPeaks[b] - DECAY);
            }

            var barH    = norm * boxH;
            var peakH   = this._spectrumPeaks[b] * boxH;
            var barX    = boxLeft + b * barW;
            var barY    = boxTop  + boxH - barH;
            var peakY   = boxTop  + boxH - peakH;

            if (barH < 1) continue;

            var grad = ctx.createLinearGradient(0, barY, 0, barY + barH);
            grad.addColorStop(0,   "rgba(" + topR + "," + topG + "," + topB + "," + (MASTER_ALPHA * 0.85).toFixed(3) + ")");
            grad.addColorStop(0.5, "rgba(" + midR + "," + midG + "," + midB + "," + (MASTER_ALPHA * 0.55).toFixed(3) + ")");
            grad.addColorStop(1,   "rgba(0,140,120," + (MASTER_ALPHA * 0.25).toFixed(3) + ")");
            ctx.fillStyle = grad;
            ctx.fillRect(barX + GAP / 2, barY, fillW, barH);

            if (peakH > 2) {
                ctx.fillStyle = "rgba(" + topR + "," + topG + "," + topB + "," + (MASTER_ALPHA * 0.9).toFixed(3) + ")";
                ctx.fillRect(barX + GAP / 2, peakY - 2, fillW, 2);
            }
        }

        ctx.restore();
    };

    BezierEditor.prototype.toggleSpectrumMode = function() {
        this.spectrumMode = (this.spectrumMode === "bars") ? "radial" : "bars";
        if (!this._spectrumRadialPeaks) {
            this._spectrumRadialPeaks = new Float32Array(128);
        }
        this._scheduleRender();
        return this.spectrumMode;
    };

    BezierEditor.prototype._drawSpectrumRadial = function(ctx, boxLeft, boxTop, boxW, boxH) {
        var BAR_COUNT  = 128;
        var data       = this.spectrumData;
        var useBins    = Math.floor(data.length / 2);
        var binsPerBar = Math.max(1, Math.floor(useBins / BAR_COUNT));

        if (!this._spectrumRadialPeaks || this._spectrumRadialPeaks.length !== BAR_COUNT) {
            this._spectrumRadialPeaks = new Float32Array(BAR_COUNT);
        }

        var cx = boxLeft + boxW * 0.5;
        var cy = boxTop  + boxH * 0.5;

        var minDim   = Math.min(boxW, boxH);
        var BASE_R   = minDim * 0.18;
        var MAX_SPIKE = minDim * 0.30;

        var DECAY        = 0.016;
        var MASTER_ALPHA = 0.62;

        var beatE = this._beatEnergy;

        var topR = Math.round(0   + beatE * 255);
        var topG = Math.round(212 + beatE * (255 - 212));
        var topB = Math.round(170 + beatE * (255 - 170));

        var norms = new Float32Array(BAR_COUNT);
        for (var b = 0; b < BAR_COUNT; b++) {
            var binStart = b * binsPerBar;
            var sum = 0;
            for (var k = 0; k < binsPerBar; k++) sum += data[binStart + k];
            var avg = sum / binsPerBar;
            var norm = avg / 255;
            norm = Math.log(1 + norm * 1.5) / Math.log(2.5);
            if (norm > 1) norm = 1;
            norms[b] = norm;

            if (norm >= this._spectrumRadialPeaks[b]) {
                this._spectrumRadialPeaks[b] = norm;
            } else {
                this._spectrumRadialPeaks[b] = Math.max(0, this._spectrumRadialPeaks[b] - DECAY);
            }
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(boxLeft, boxTop, boxW, boxH);
        ctx.clip();

        var TWO_PI   = Math.PI * 2;
        var angleStep = TWO_PI / BAR_COUNT;
        var HALF_ARC  = angleStep * 0.72;

        var beatPulse = BASE_R * (1 + beatE * 0.18);

        ctx.beginPath();
        ctx.arc(cx, cy, beatPulse, 0, TWO_PI);
        var ringAlpha = 0.10 + beatE * 0.18;
        ctx.strokeStyle = "rgba(" + topR + "," + topG + "," + topB + "," + ringAlpha.toFixed(3) + ")";
        ctx.lineWidth = 1 + beatE * 1.5;
        ctx.stroke();

        if (beatE > 0.12) {
            ctx.beginPath();
            ctx.arc(cx, cy, beatPulse * 1.06, 0, TWO_PI);
            ctx.strokeStyle = "rgba(" + topR + "," + topG + "," + topB + "," + (beatE * 0.10).toFixed(3) + ")";
            ctx.lineWidth = 3 + beatE * 4;
            ctx.stroke();
        }

        for (var b = 0; b < BAR_COUNT; b++) {
            var angle   = b * angleStep - Math.PI * 0.5;
            var norm    = norms[b];
            var peak    = this._spectrumRadialPeaks[b];

            var innerR  = BASE_R;
            var outerR  = BASE_R + norm * MAX_SPIKE;
            var peakR   = BASE_R + peak * MAX_SPIKE;

            var cosA = Math.cos(angle);
            var sinA = Math.sin(angle);

            var x0 = cx + cosA * innerR;
            var y0 = cy + sinA * innerR;
            var x1 = cx + cosA * outerR;
            var y1 = cy + sinA * outerR;

            if (outerR - innerR < 0.5) continue;

            var freqFrac = b / BAR_COUNT;
            var hue = 168 - freqFrac * 80;
            var sat = 70 + beatE * 30;
            var lit = 52 + norm * 28 + beatE * 18;
            var barAlpha = (MASTER_ALPHA * (0.55 + norm * 0.45)).toFixed(3);

            var grad = ctx.createLinearGradient(x0, y0, x1, y1);
            grad.addColorStop(0,   "hsla(" + hue + "," + sat + "%," + (lit - 12) + "%," + (MASTER_ALPHA * 0.3).toFixed(3) + ")");
            grad.addColorStop(0.5, "hsla(" + hue + "," + sat + "%," + lit + "%," + barAlpha + ")");
            grad.addColorStop(1,   "rgba(" + topR + "," + topG + "," + topB + "," + (MASTER_ALPHA * 0.92).toFixed(3) + ")");

            ctx.beginPath();
            ctx.arc(cx, cy, innerR, angle - HALF_ARC, angle + HALF_ARC);
            ctx.arc(cx, cy, outerR, angle + HALF_ARC, angle - HALF_ARC, true);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            if (peakR > innerR + 1.5) {
                var peakAlpha = (0.55 + beatE * 0.35).toFixed(3);
                ctx.beginPath();
                ctx.arc(cx, cy, peakR, angle - HALF_ARC * 0.7, angle + HALF_ARC * 0.7);
                ctx.strokeStyle = "rgba(" + topR + "," + topG + "," + topB + "," + peakAlpha + ")";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        var glowR = BASE_R + 2;
        var glowGrad = ctx.createRadialGradient(cx, cy, glowR * 0.6, cx, cy, glowR * 1.4);
        glowGrad.addColorStop(0, "rgba(" + topR + "," + topG + "," + topB + "," + (0.06 + beatE * 0.10).toFixed(3) + ")");
        glowGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(cx, cy, glowR * 1.4, 0, TWO_PI);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        ctx.restore();
    };

    return {
        BezierEditor: BezierEditor,
        RESET_VALUES: RESET_VALUES
    };
})();