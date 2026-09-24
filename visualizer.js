/* =========================================================
   Platinum Construction Group — "See your new roof" visualizer
   One real-looking house photo (img/visualizer/house.jpg) plus two masks
   (roof, siding). A colour is applied by keeping each pixel's light and
   texture (its brightness relative to the surface average) and swapping the
   hue underneath — so the shingle granules, the siding shadow lines and the
   lighting on every roof plane all survive the change.
   Changing a colour animates like the real job: shingles go on course by
   course from the eave up, siding panels run in row by row.
   ========================================================= */
(function () {
  "use strict";
  var root = document.getElementById("visualizer");
  if (!root) return;

  /* Owens Corning TruDefinition Duration colours: the full current US lineup
     (owenscorning.com/en-us/roofing/shingles/trudefinition-duration). avg / dark
     / light were sampled from Owens Corning's own swatch photos: dark = the
     darkest fifth of the granules, light = the lightest fifth. A roof is painted
     by running each pixel along that dark-to-light blend, so it keeps the
     multi-tone look of the real shingle. */
  var ROOFS = [
    { id: "brownwood", name: "Brownwood", avg: "#5a4138", dark: "#3a2a27", light: "#745446" },
    { id: "chateau", name: "Chateau Green", avg: "#3a4e44", dark: "#2a342f", light: "#446253" },
    { id: "colonial", name: "Colonial Slate", avg: "#67625e", dark: "#484443", light: "#7d7e77" },
    { id: "desertrose", name: "Desert Rose", avg: "#715849", dark: "#4f3e38", light: "#8c7057" },
    { id: "driftwood", name: "Driftwood", avg: "#6c675f", dark: "#544d48", light: "#7f7d72" },
    { id: "estate", name: "Estate Gray", avg: "#575e5e", dark: "#373c3d", light: "#717977" },
    { id: "plum", name: "Midnight Plum", avg: "#4b4b54", dark: "#282b31", light: "#646470" },
    { id: "onyx", name: "Onyx Black", avg: "#2e3133", dark: "#1c1e20", light: "#3f4346" },
    { id: "peppercorn", name: "Peppercorn", avg: "#555652", dark: "#343636", light: "#706d65" },
    { id: "sandcastle", name: "Sand Castle", avg: "#978773", dark: "#726555", light: "#ac9d8a" },
    { id: "sierra", name: "Sierra Gray", avg: "#949794", dark: "#616260", light: "#b3b5b2" },
    { id: "slatestone", name: "Slatestone Gray", avg: "#676b6b", dark: "#424443", light: "#888d8e" },
    { id: "teak", name: "Teak", avg: "#594942", dark: "#3d312c", light: "#6e5a4e" },
    { id: "terracotta", name: "Terra Cotta", avg: "#894f3f", dark: "#603930", light: "#a45f49" },
    { id: "williamsburg", name: "Williamsburg Gray", avg: "#4d4f52", dark: "#2d2f32", light: "#626669" }
  ];
  var SIDINGS = [
    { id: "original", name: "Light Gray",   hex: null },
    { id: "white",    name: "Bright White", hex: "#e4e3dd" },
    { id: "cream",    name: "Cream",        hex: "#ded3b9" },
    { id: "pewter",   name: "Pewter",       hex: "#9a9c99" },
    { id: "clay",     name: "Clay",         hex: "#b9a68a" },
    { id: "sage",     name: "Sage",         hex: "#98a18a" },
    { id: "blue",     name: "Coastal Blue", hex: "#8196aa" },
    { id: "navy",     name: "Harbor Navy",  hex: "#3f4d63" },
    { id: "charcoal", name: "Charcoal",     hex: "#4b4d50" },
    { id: "red",      name: "Barn Red",     hex: "#7c3b33" }
  ];

  var canvas = root.querySelector("#vzCanvas");
  var ctx = canvas.getContext("2d");
  var W, H, basePx;
  var state = { roof: "estate", siding: "original" };
  var shown = null;        /* canvas holding what is on screen now */
  var animating = null;

  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }

  function loadImg(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; });
  }
  function pixels(img) {
    var c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    var x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data;
  }

  /* per-surface: which pixels, how strongly (soft edge), and each pixel's
     brightness relative to that surface's average */
  function prepSurface(maskPx) {
    var idx = [], a = [], sum = 0, wsum = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (var i = 0, n = W * H; i < n; i++) {
      var m = maskPx[i * 4];
      if (m < 8) continue;
      var L = 0.3 * basePx[i * 4] + 0.59 * basePx[i * 4 + 1] + 0.11 * basePx[i * 4 + 2];
      idx.push(i); a.push(m / 255);
      if (m > 200) { sum += L; wsum++; }
      var x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    var avg = sum / Math.max(1, wsum), ratio = new Float32Array(idx.length);
    for (var k = 0; k < idx.length; k++) {
      var j = idx[k];
      var L2 = 0.3 * basePx[j * 4] + 0.59 * basePx[j * 4 + 1] + 0.11 * basePx[j * 4 + 2];
      ratio[k] = Math.min(2.4, Math.max(0.15, L2 / avg));
    }
    return { idx: Int32Array.from(idx), a: Float32Array.from(a), ratio: ratio, box: [x0, y0, x1, y1] };
  }

  function paint(data, surf, hex) {
    if (!hex) return;
    var c = hexRgb(hex);
    for (var k = 0; k < surf.idx.length; k++) {
      var i = surf.idx[k] * 4, al = surf.a[k], r = surf.ratio[k];
      data[i]     = data[i]     * (1 - al) + Math.min(255, c[0] * r) * al;
      data[i + 1] = data[i + 1] * (1 - al) + Math.min(255, c[1] * r) * al;
      data[i + 2] = data[i + 2] * (1 - al) + Math.min(255, c[2] * r) * al;
    }
  }

  /* roofs: each pixel's brightness (vs the roof average) picks its spot on the
     colour's dark-to-light granule blend; real shadows and glints run past both ends */
  function paintRoof(data, surf, c) {
    var d = hexRgb(c.dark), l = hexRgb(c.light);
    for (var k = 0; k < surf.idx.length; k++) {
      var i = surf.idx[k] * 4, al = surf.a[k], r = surf.ratio[k];
      var t = Math.min(1, Math.max(0, (r - 0.62) / 0.76));
      var s = r < 0.62 ? r / 0.62 : (r > 1.38 ? Math.min(1.35, r / 1.38) : 1);
      for (var ch = 0; ch < 3; ch++) {
        var v = (d[ch] + (l[ch] - d[ch]) * t) * s;
        data[i + ch] = data[i + ch] * (1 - al) + Math.min(255, v) * al;
      }
    }
  }

  var ROOF, SIDE;
  function render(roofId, sideId) {
    var out = new ImageData(new Uint8ClampedArray(basePx), W, H);
    if (roofId !== "photo") paintRoof(out.data, ROOF, find(ROOFS, roofId));
    paint(out.data, SIDE, find(SIDINGS, sideId).hex);
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    c.getContext("2d").putImageData(out, 0, 0);
    return c;
  }

  /* Lay the new surface on in courses: bottom course first, each one running
     left to right a beat behind the one below it. */
  function lay(next, box, course, done) {
    if (animating) cancelAnimationFrame(animating.raf);
    var from = shown, x0 = box[0] - 4, x1 = box[2] + 4, y0 = box[1] - 4, y1 = box[3] + 4;
    var rows = Math.ceil((y1 - y0) / course), rowTime = 230, lag = 55;
    var total = rowTime + lag * rows, t0 = performance.now();
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /* no animation for reduced-motion users, or in a background tab where the
       browser holds animation frames back (it would never finish) */
    if (reduce || document.hidden) { ctx.drawImage(next, 0, 0); shown = next; animating = null; done && done(); return; }
    /* belt and braces: if frames stall mid-way, land on the finished look anyway */
    var safety = setTimeout(function () {
      if (animating && animating.next === next) { cancelAnimationFrame(animating.raf); ctx.drawImage(next, 0, 0); shown = next; animating = null; done && done(); }
    }, total + 800);
    function frame(now) {
      var t = now - t0;
      ctx.drawImage(from, 0, 0);
      for (var r = 0; r < rows; r++) {
        var p = Math.min(1, Math.max(0, (t - r * lag) / rowTime));
        if (!p) continue;
        p = 1 - Math.pow(1 - p, 3);
        var yb = y1 - (r + 1) * course, w = (x1 - x0) * p;
        ctx.drawImage(next, x0, yb, w, course, x0, yb, w, course);
        if (p < 1) {           /* the leading edge of the course being laid */
          ctx.fillStyle = "rgba(0,0,0,.18)";
          ctx.fillRect(x0 + w - 3, yb, 3, course);
        }
      }
      if (t < total) animating = { raf: requestAnimationFrame(frame), next: next };
      else { clearTimeout(safety); ctx.drawImage(next, 0, 0); shown = next; animating = null; done && done(); }
    }
    animating = { raf: requestAnimationFrame(frame), next: next };
  }

  function label() {
    root.querySelector("#vzRoofName").textContent = find(ROOFS, state.roof).name;
    root.querySelector("#vzSideName").textContent = find(SIDINGS, state.siding).name;
    root.querySelectorAll(".vz-sw").forEach(function (b) {
      b.classList.toggle("on", state[b.dataset.kind] === b.dataset.id);
      b.setAttribute("aria-pressed", state[b.dataset.kind] === b.dataset.id ? "true" : "false");
    });
    var q = root.querySelector("#vzQuote");
    if (q) q.dataset.look = find(ROOFS, state.roof).name + " roof, " + find(SIDINGS, state.siding).name + " siding";
  }

  function choose(kind, id) {
    if (state[kind] === id || !basePx) return;
    state[kind] = id; label();
    var next = render(state.roof, state.siding);
    /* course height scales with the photo so the rows read the same at any size */
    var k = W / 2048;
    if (kind === "roof") lay(next, ROOF.box, Math.round(18 * k), null);
    else lay(next, SIDE.box, Math.round(14 * k), null);
  }

  function swatches(list, kind, holder) {
    list.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "vz-sw"; b.dataset.kind = kind; b.dataset.id = s.id;
      b.title = s.name;
      /* roof chips show a little of the granule blend instead of a flat square */
      var chip = s.dark
        ? "radial-gradient(circle at 30% 30%," + s.light + " 0 18%,transparent 19%),radial-gradient(circle at 72% 64%," + s.dark + " 0 20%,transparent 21%),linear-gradient(135deg," + s.dark + "," + s.avg + " 55%," + s.light + ")"
        : (s.hex || "#b9bcbe");
      b.innerHTML = '<i style="background:' + chip + '"></i><span>' + s.name + "</span>";
      b.addEventListener("click", function () { choose(kind, s.id); });
      holder.appendChild(b);
    });
  }

  swatches(ROOFS, "roof", root.querySelector("#vzRoofs"));
  swatches(SIDINGS, "siding", root.querySelector("#vzSidings"));

  /* hold to see the house as it is today */
  var hold = root.querySelector("#vzHold"), orig = null;
  function showOrig(on) {
    if (!basePx || animating) return;
    if (on) { if (!orig) orig = render("photo", "original"); ctx.drawImage(orig, 0, 0); }
    else ctx.drawImage(shown, 0, 0);
    hold.classList.toggle("on", on);
  }
  ["mousedown", "touchstart"].forEach(function (e) { hold.addEventListener(e, function (ev) { ev.preventDefault(); showOrig(true); }, { passive: false }); });
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(function (e) { hold.addEventListener(e, function () { showOrig(false); }); });

  root.querySelector("#vzReset").addEventListener("click", function () {
    if (!basePx) return;
    state.roof = "estate"; state.siding = "original"; label();
    lay(render("estate", "original"), [0, Math.min(ROOF.box[1], SIDE.box[1]), W, Math.max(ROOF.box[3], SIDE.box[3])], Math.round(18 * W / 2048), null);
  });

  /* full screen: the picture and the colours together, as big as the screen goes */
  var fullBtn = root.querySelector("#vzFull"), grid = root.querySelector(".vz-grid");
  if (fullBtn && grid) {
    if (!grid.requestFullscreen) fullBtn.style.display = "none";   /* iPhone Safari has no element full screen */
    fullBtn.addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else grid.requestFullscreen().catch(function () {});
    });
    document.addEventListener("fullscreenchange", function () {
      fullBtn.querySelector("span").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
    });
  }

  /* carry the look into the quote form so Evan sees what they picked */
  var quoteBtn = root.querySelector("#vzQuote");
  var modal = root.querySelector("#vzModal");
  var LOOK_PREFIX = "I'd like a quote. The look I picked: ";
  function lookText() { return LOOK_PREFIX + quoteBtn.dataset.look + "."; }
  /* write the look into a notes box, but never over something the visitor typed:
     only when it is empty or still holds an earlier look */
  function fillNotes(box) {
    if (box && (!box.value || box.value.indexOf(LOOK_PREFIX) === 0)) box.value = lookText();
  }
  function openModal() {
    fillNotes(root.querySelector("#vzModalNotes"));
    modal.hidden = false;
    var first = modal.querySelector('input[name="name"]');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeModal() { modal.hidden = true; }
  if (quoteBtn) quoteBtn.addEventListener("click", function (e) {
    if (document.fullscreenElement && modal) {
      /* full screen: the page underneath can't be scrolled to, so the form pops up here */
      e.preventDefault();
      openModal();
      return;
    }
    fillNotes(document.querySelector("#quote textarea"));
  });
  if (modal) {
    root.querySelector("#vzModalX").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeModal(); });
    /* leaving full screen with the pop-up open: close it, the main form is right there */
    document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement) closeModal(); });
  }

  /* load only when the section is near the screen — the photo is the heaviest thing on the page */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    Promise.all([
      loadImg("img/visualizer/house.jpg"),
      loadImg("img/visualizer/roof-mask-web.png"),
      loadImg("img/visualizer/siding-mask-web.png")
    ]).then(function (imgs) {
      W = imgs[0].naturalWidth; H = imgs[0].naturalHeight;
      canvas.width = W; canvas.height = H;
      basePx = pixels(imgs[0]);
      ROOF = prepSurface(pixels(imgs[1]));
      SIDE = prepSurface(pixels(imgs[2]));
      shown = render(state.roof, state.siding);
      ctx.drawImage(shown, 0, 0);
      root.classList.add("ready");
      label();
    }).catch(function () { root.classList.add("failed"); });
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); boot(); }
    }, { rootMargin: "600px" });
    io.observe(root);
  } else boot();
  /* backstop: fetch it a few seconds after the page settles anyway, so a quick
     jump from the hero button never lands on an empty frame */
  window.addEventListener("load", function () { setTimeout(boot, 2500); });
  document.querySelectorAll('a[href="#visualizer"]').forEach(function (a) { a.addEventListener("click", boot); });
})();
