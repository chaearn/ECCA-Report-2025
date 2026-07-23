function _1(md){return(
md`# ECCAsystem

Prototyping of ECCAsystem Map (In Development)`
)}

async function _2(FileAttachment,d3)
{
  // The "dry" brush relies on feTurbulence/feDisplacementMap filters, which
  // are expensive to rasterize — fine on desktop, but a real cost on phones
  // and small/touch screens. Fall back to "original" (a plain gradient
  // stroke, no filter) there instead.
  const MOBILE_BREAKPOINT = 768;
  function isSmallScreen() {
    return window.innerWidth < MOBILE_BREAKPOINT || window.matchMedia("(pointer: coarse)").matches;
  }
  let brushStyle = isSmallScreen() ? "original" : "dry"; // "original" | "marker" | "dry"
  window.addEventListener("resize", () => {
    const next = isSmallScreen() ? "original" : "dry";
    if (next !== brushStyle) {
      brushStyle = next;
      requestCrossLinksUpdate();
    }
  });

  // Live-adjustable via the settings panel (bottom right) — bandwidth and
  // thresholds control the contour blobs, the max-chars settings control
  // where cross-link/node labels wrap, labelEndOffsetPct controls how far
  // in from each end a cross-link's label sits. Persisted to localStorage
  // so tuning survives a reload — maxContentWPct/HPct specifically *require* a
  // reload to take effect (they drive the whole layout construction, not
  // just a render pass), so those two are saved but not applied live.
  // Distinct from the live map's "eccasystem-settings": both are served from
  // the same origin, so sharing the key would make tuning option 2 silently
  // overwrite the live map's saved geometry (and vice versa).
  const SETTINGS_STORAGE_KEY = "eccasystem-settings-o2";
  function loadStoredSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }
  const storedSettings = loadStoredSettings();
  const settings = Object.assign({
    // Tighter on a phone. 110 is tuned for the desktop map, where the wash is a
    // soft backdrop behind a spread-out cluster; on a phone it smears into four
    // overlapping discs far larger than the nodes they come from (~624 units
    // across vs ~377 for the panels), which is both muddy to look at and what
    // was dragging the chooser's zoom-to-fit down. 40 keeps it hugging its own
    // quadrant. Desktop is untouched.
    bandwidth: isSmallScreen() ? 40 : 110,
    thresholds: 4,
    crossLabelMaxChars: 18,
    nodeLabelMaxChars: 18,
    labelEndOffsetPct: 28,
    crossLabelFontSize: 12,
    nodeLabelFontSize: 8,
    // % of the actual viewport, not static px — scales proportionally on
    // any screen instead of feeling arbitrary on a much bigger or smaller
    // one. Renamed from maxContentW/H (which were px) so any old stored
    // value from before this change is just ignored, not misread as a %.
    maxContentWPct: 90,
    maxContentHPct: 90,
    // Gap in px between the fitted map and the viewport edge on load. Bigger =
    // the whole map sits smaller with more air around it.
    overviewFitPad: 10,
    // Base info-card width in px (before the mobile cardScale below). Drives
    // the foreignObject width, card positioning/clamping and leader-line
    // geometry — all computed once up front — so like the two maxContent
    // settings it can't be applied live and needs a reload.
    cardWidth: 165,
    // Info-card text sizes, in rem (tied to the root font-size set in
    // index.html, same as the card padding — so text and padding scale
    // together on mobile instead of the text shrinking with the card width).
    // Changing them re-wraps the labels and changes card height, which is
    // measured once at build, so they're reload-required too.
    cardPartnerRem: 0.625,
    cardLabelRem: 0.75,
    cardStageRem: 0.625,
    // Areas of work render under the divider. Same size the live map's sub-zone
    // cards used for them.
    cardAreaIconRem: 1.4,
    // Info-card inner padding in rem (top / bottom / horizontal — see
    // cardHTML). Changes the content-box size and card height (measured once
    // at build), so reload-required like the other card-geometry settings.
    cardPadTop: 0.75,
    cardPadBottom: 0.5,
    cardPadH: 0.625,
    // Sub-zone artwork tuning is stored per theme as dynamic keys
    // (sz<L>ax<i> / sz<L>ay<i> for attach points, sz<L>nax / sz<L>nay for the
    // Node Area) — added on demand when tuned; defaults come from SUBZONE_ART.
  }, storedSettings);
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }
  const showLocalLabels = true;
  const showCrossLabels = true;
  const bulletSvgs = await Promise.all([
    FileAttachment("bullet-1.svg").url(),
    FileAttachment("bullet-2.svg").url(),
    FileAttachment("bullet-3.svg").url(),
    FileAttachment("bullet-4.svg").url()
  ]);

  // Canvas fills the actual viewport (100svw x 100svh) rather than a fixed
  // square, so the 4 panels divide that real space evenly instead of
  // getting letterboxed on tall/narrow mobile screens. But on a very wide
  // or tall screen, letting the panel cluster itself keep growing to fill
  // the whole viewport spreads the 4 quadrants out to the corners with a
  // huge dead zone in the middle. So the cluster's own size is capped
  // instead of stretching indefinitely, and centered within the (still
  // full-bleed) canvas — see the initial zoom transform near the bottom.
  const viewportW = Math.max(320, window.innerWidth || 1260);
  const viewportH = Math.max(320, window.innerHeight || 1260);
  // The map's own size, which is NOT the screen size on a phone. Deriving the
  // layout from a 375px viewport gave each quadrant a 139px sliver: the arcs
  // came out tiny, the nodes had no room to spread, and zooming into one blew
  // its labels and cards up to fill the screen. So a phone builds the SAME
  // geometry a desktop does and the reader pans/zooms around it instead —
  // everything keeps its designed proportions and only the window onto it is
  // small. viewportW/H below stay the real screen, since the zoom transforms
  // and the SVG viewBox still have to be in screen space.
  const MOBILE_LAYOUT_W = 1280, MOBILE_LAYOUT_H = 900;
  const layoutBaseW = isSmallScreen() ? MOBILE_LAYOUT_W : viewportW;
  const layoutBaseH = isSmallScreen() ? MOBILE_LAYOUT_H : viewportH;
  const contentW = layoutBaseW * (settings.maxContentWPct / 100);
  const contentH = layoutBaseH * (settings.maxContentHPct / 100);
  const panelGapX = 60;
  const panelGapY = 60;

  const panelW = (contentW - panelGapX) / 2;
  const panelH = (contentH - panelGapY) / 2;

  const layout = {
    width: contentW,
    height: contentH,
    cols: 2,
    panelW,
    panelH,
    gapX: panelGapX,
    gapY: panelGapY,
    marginLeft: 0,
    marginTop: 0,
    // The node-spread distances/radii below were tuned for a ~600px-square
    // panel. On a narrower panel (small screens, or once a gap is carved
    // out of the space) that spread no longer fits, so nodes spill past
    // the panel edge and the gap disappears. Scale it down to match the
    // smaller dimension — capped at 1 so panels bigger than the original
    // reference don't force nodes to spread out further to compensate,
    // they just keep some breathing room instead.
    panelScale: Math.min(1, Math.max(0.35, Math.min(panelW, panelH) / 600))
  };

  // Scaled by screen size (not panelScale — an earlier attempt tied it to
  // panel size instead and crushed the text column down to ~1 word per
  // line on a small panel, which looked broken). w is genuinely used for
  // layout (foreignObject width + the card's own min-width); h is only a
  // generous *estimate* for the off-canvas clamp math below — actual
  // per-card foreignObject height is measured from real rendered content
  // (see measureCardHeights in makePanel), since labels vary a lot in
  // wrapped line count and a fixed height either clips long ones or
  // wastes space on short ones.
  const cardScale = isSmallScreen() ? 0.65 : 1;
  // Width comes from the settings panel (settings.cardWidth, default 172);
  // offsetX keeps the original -208/172 ratio to it so a wider/narrower card
  // still anchors sensibly relative to its node. h/offsetY are height-side
  // and stay tied to the reference dimensions.
  const cardW = settings.cardWidth * cardScale;
  const card = {
    w: cardW,
    h: 160 * cardScale,
    // How far the card floats up-and-left of its node — this is what sets the
    // leader-line length. Bumped out (from -208/172·w and -80) so the line is
    // longer and reads as a deliberate diagonal rather than the card sitting
    // right on top of the node.
    offsetX: -(250 / 172) * cardW,
    offsetY: -130 * cardScale
  };

  const data = await fetch(new URL("./data.json", import.meta.url)).then(r => r.json());

  const charts = await Promise.all(data.charts.map(async chart => ({
    ...chart,
    image: await FileAttachment(chart.image).url()
  })));

  const chartById = new Map(charts.map(d => [d.id, d]));

  const crossLinks = data.crossLinks;

  // A "hub" is a label-only node other charts' nodes can link to — it
  // doesn't belong to any of the 4 quadrant panels, so it needs its own
  // fixed position and its own lookup/color handling in the cross-link code.
  const hubs = data.hubs || [];
  const hubColor = "#22392C";
  const hubPosition = {x: layout.width / 2, y: layout.height / 2};

  function endpointKey(endpoint) {
    return endpoint.hub ? `hub::${endpoint.hub}` : `${endpoint.chart}::${endpoint.node}`;
  }
  function endpointColor(endpoint) {
    return endpoint.hub ? hubColor : chartById.get(endpoint.chart).color;
  }

  const sharedIds = new Set(
    [...d3.rollup(
      charts.flatMap(c => c.nodes.map(n => n.id)),
      v => v.length,
      d => d
    )]
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
  );

  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, viewportW, viewportH])
    .style("display", "block")
    .style("width", "100svw")
    .style("height", "100svh")
    .style("background", "#F2F1ED")
    .style("font-family", "system-ui, sans-serif");

  const defs = svg.append("defs");

  defs.append("filter")
    .attr("id", "markerStroke")
    .attr("x", "-20%")
    .attr("y", "-20%")
    .attr("width", "140%")
    .attr("height", "140%")
    .html(`
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.075" numOctaves="1" seed="7" result="noise"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    `);

  defs.append("filter")
    .attr("id", "dryBrushStroke")
    .attr("x", "-24%")
    .attr("y", "-24%")
    .attr("width", "148%")
    .attr("height", "148%")
    .html(`
      <feTurbulence type="fractalNoise" baseFrequency="0.036 0.83" numOctaves="2.5" seed="20" result="noise"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    `);

  defs.append("filter")
    .attr("id", "dryBrushStroke2")
    .attr("x", "-20%")
    .attr("y", "-24%")
    .attr("width", "128%")
    .attr("height", "140%")
    .html(`
      <feTurbulence type="fractalNoise" baseFrequency="0.036 0.83" numOctaves="1" seed="7" result="noise"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    `);

  const zoomLayer = svg.append("g");
  const linkOverlay = zoomLayer.append("g")
    .attr("fill", "none")
    .attr("pointer-events", "none");
  const hubLayer = zoomLayer.append("g").attr("pointer-events", "none");
  // Cross-link labels get their own layer, appended dead last (after every
  // panel is built, see below) so they always render above absolutely
  // everything — lines, contours, nodes, cards — not just other lines.
  let crossLabelLayer;

  const panels = [];
  // Reassigned when the settings panel is built; declared up here so the badge
  // drag handler (which fires long after) can call it without a TDZ hazard.
  let syncBadgePosSliders = () => {};
  // True while the phone overview is in chooser mode (see setChooserMode).
  // Declared here rather than next to that function because
  // computeOverviewTransform reads it, and its first call happens earlier in
  // this module body than soloedIndex/setChooserMode are declared.
  let chooserActive = false;
  // Global (zoomLayer-space) bumper zone for every title badge, so a node from
  // any quadrant is kept off ALL badges — not just its own panel's. Each panel
  // pushes its entry and keeps it current (badges are draggable) in render().
  const badgeRegistry = [];

  // Each panel's simulation independently asked updateCrossLinks() to redraw
  // on its own tick schedule. Since all 4 panels tick in lockstep, that
  // meant the cross-link redraw (the expensive one — turbulence filters,
  // gradients, cached bboxes) fired up to 4x per frame instead of once.
  // Coalesce all requests into a single per-frame update instead.
  let crossLinksDirty = false;
  function requestCrossLinksUpdate() {
    crossLinksDirty = true;
  }

  // Cross-links (both the stroke and its label) are hidden by default and
  // only reveal when you hover the *node* they touch (a node can have
  // several cross-links at once, hence a Set rather than a single key).
  // A click on a link pins it open so it stays visible without holding.
  const pinnedCrossLinks = new Set();
  const hoveredCrossLinkKeys = new Set();
  function isCrossLabelVisible(key) {
    return pinnedCrossLinks.has(key) || hoveredCrossLinkKeys.has(key);
  }

  // Which node most recently caused a given link to become visible — used
  // to decide which end's label to show. Stores the node's own on-canvas
  // position so the label can pick whichever end of the curve is actually
  // closer to it (handles group-expanded links too, see below, where the
  // hovered node isn't literally one of that specific link's endpoints).
  const linkTriggerPosition = new Map();

  function setCrossLinkVisible(g, visible) {
    const keys = new Set();
    g.each(d => keys.add(d.key));

    crossLabelLayer.selectAll("g.cross-label-group")
      .filter(d => keys.has(d.key))
      .interrupt()
      .transition()
      .duration(120)
      .style("opacity", visible ? 1 : 0);
    g.select(".main")
      .interrupt()
      .transition()
      .duration(120)
      .style("opacity", visible ? 1 : 0);
    g.select(".secondary")
      .interrupt()
      .transition()
      .duration(120)
      .style("opacity", visible ? 1 : 0);
  }

  // Links directly touching this node, plus — for links tagged with a
  // "group" (e.g. a closed triangle like Referral Network) — every other
  // link sharing that same group, even if it doesn't touch this node
  // directly. Hub fan-outs and plain one-to-one links have no group, so
  // they're untouched by this and only ever show their own direct link.
  function crossLinksTouchingNode(nodeId) {
    const direct = linkOverlay
      .selectAll("g.cross-link")
      .filter(d => d.sourceNode === nodeId || d.targetNode === nodeId);

    const groups = new Set();
    direct.each(d => { if (d.group) groups.add(d.group); });
    if (groups.size === 0) return direct;

    return linkOverlay
      .selectAll("g.cross-link")
      .filter(d => (d.sourceNode === nodeId || d.targetNode === nodeId) || (d.group && groups.has(d.group)));
  }

  function setNodeCrossLinksVisible(nodeId, nodePos, visible) {
    const links = crossLinksTouchingNode(nodeId);
    if (visible) {
      links.each(d => {
        hoveredCrossLinkKeys.add(d.key);
        linkTriggerPosition.set(d.key, nodePos);
      });
      setCrossLinkVisible(links, true);
      // Once the simulation has settled, nothing else re-runs
      // updateCrossLinks() — without this, linkTriggerPosition changes
      // above would never actually move the label to the new end.
      requestCrossLinksUpdate();
    } else {
      // Un-mark hover for all touching links, but only actually fade out
      // the ones that aren't pinned open by a click.
      const toHide = links.filter(d => {
        hoveredCrossLinkKeys.delete(d.key);
        return !pinnedCrossLinks.has(d.key);
      });
      setCrossLinkVisible(toHide, false);
    }
  }

  // The turbulence/displacement filters on cross-links are the expensive
  // part — the browser re-rasterizes them every time the filtered path's
  // geometry changes. That's fine once things are still (a one-time cost),
  // but brutal while nodes are actively settling in or being dragged, since
  // it forces a full filter recompute every frame. So: render cross-links
  // as plain (unfiltered) strokes while anything is moving, and only
  // switch the filter on ~220ms after motion stops.
  let crossLinksSettled = false;
  let settleTimer = null;
  function markCrossLinksActive() {
    crossLinksSettled = false;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      crossLinksSettled = true;
      crossLinksDirty = true;
    }, 220);
  }

  d3.timer(() => {
    if (crossLinksDirty) {
      crossLinksDirty = false;
      updateCrossLinks();
    }
  });

  function panelPosition(index) {
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    return {
      x: layout.marginLeft + col * (layout.panelW + layout.gapX),
      y: layout.marginTop + row * (layout.panelH + layout.gapY)
    };
  }

  const labelBBoxCache = new Map();

  function cachedTextBBox(textNode, key) {
    const cached = labelBBoxCache.get(key);
    if (cached) return cached;
    // getBBox() on an element that isn't attached to the document yet
    // (true for the very first call — the whole SVG is still detached
    // while this cell builds it) returns an all-zero rect. Don't cache
    // that, or the swipe backgrounds stay collapsed forever; only lock
    // in a value once we get a real measurement.
    const b = textNode.getBBox();
    const box = {width: b.width, height: b.height};
    if (b.width > 0 || b.height > 0) labelBBoxCache.set(key, box);
    return box;
  }

  // SVG <text> has no CSS max-width/word-wrap — this is the tspan-based
  // equivalent of "max-width: 18ch", word-wrapping at ~maxChars per line.
  // align "center" (default) centers the block on the text element's own
  // (x,y); align "bottom" keeps the last line at (x,y) and stacks the rest
  // upward — for a label meant to sit just above a fixed point.
  function wrapTextTspans(textSelection, text, maxChars = 18, lineHeight = 22, align = "center") {
    const words = (text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach(word => {
      const candidate = current ? `${current} ${word}` : word;
      if (current && candidate.length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);

    textSelection.selectAll("tspan").remove();
    const startDy = align === "bottom"
      ? -(lines.length - 1) * lineHeight
      : -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      textSelection.append("tspan")
        .attr("x", 0)
        .attr("dy", i === 0 ? startDy : lineHeight)
        .text(line);
    });
  }

  function markerSwipePath(x, y, w, h) {
    return `
      M ${x - w / 2} ${y - h / 2 + h * 0.16}
      C ${x - w * 0.34} ${y - h * 0.68}, ${x - w * 0.12} ${y - h * 0.44}, ${x} ${y - h * 0.53}
      C ${x + w * 0.20} ${y - h * 0.58}, ${x + w * 0.35} ${y - h * 0.48}, ${x + w / 2} ${y - h / 2 + h * 0.10}
      L ${x + w / 2 - w * 0.035} ${y + h / 2}
      C ${x + w * 0.18} ${y + h * 0.42}, ${x - w * 0.12} ${y + h * 0.57}, ${x - w / 2 + w * 0.04} ${y + h / 2 - h * 0.03}
      Z
    `;
  }

  function easePosition(state, target, factor = 0.18) {
    state.x += (target.titleX - state.x) * factor;
    state.y += (target.titleY - state.y) * factor;
  }

  function crossCurveWithControl(x1, y1, x2, y2, distVal = 0.18) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;

    const curve = dist * distVal;
    const nx = -dy / dist;
    const ny = dx / dist;
    const cx = mx + nx * curve;
    const cy = my + ny * curve;

    return {x1, y1, x2, y2, cx, cy, nx, ny};
  }

  function offsetQuadCurve(curve, offset) {
    return `M ${curve.x1 + curve.nx * offset} ${curve.y1 + curve.ny * offset}
            Q ${curve.cx + curve.nx * offset} ${curve.cy + curve.ny * offset}
              ${curve.x2 + curve.nx * offset} ${curve.y2 + curve.ny * offset}`;
  }

  function quadPoint(x1, y1, cx, cy, x2, y2, t = 0.5) {
    const mt = 1 - t;
    return {
      x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
      y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2
    };
  }

  function ensureGradient(id, x1, y1, x2, y2, c1, c2) {
    const mid = d3.interpolateRgb(c2, c1)(0.5);

    const grad = defs.selectAll(`linearGradient#${id}`)
      .data([null])
      .join("linearGradient")
      .attr("id", id)
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", x1)
      .attr("y1", y1)
      .attr("x2", x2)
      .attr("y2", y2);

    grad.selectAll("stop")
      .data([
        {offset: "0%", color: c2},
        {offset: "38%", color: c2},
        {offset: "47%", color: mid},
        {offset: "53%", color: mid},
        {offset: "62%", color: c1},
        {offset: "100%", color: c1}
      ])
      .join("stop")
      .attr("offset", d => d.offset)
      .attr("stop-color", d => d.color);

    return `url(#${id})`;
  }

  function hasCard(d) {
    return !!(d.partner || d.stage || d.label);
  }

  // Country flag shown top-right on master-map cards (data.json `country`).
  const COUNTRY_ICON = {
    "Thailand": "./characters/CountrySVG/Thailand.svg",
    "Singapore": "./characters/CountrySVG/Singapore.svg",
    "Indonesia": "./characters/CountrySVG/Indonesia.svg",
    "Denmark": "./characters/CountrySVG/Denmark.svg"
  };
  // Areas of work shown as icons on sub-zone cards, in place of the stage pill
  // (data.json `areaofwork-1..n`). "Frointline" matches the spelling used in
  // both data.json and the asset filename; the correct spelling is accepted too
  // so fixing the data later doesn't silently drop the icon.
  const AREA_ICON = {
    "Frointline & Communities": "./characters/AreaofWork/FrointlineCommunities.svg",
    "Frontline & Communities": "./characters/AreaofWork/FrointlineCommunities.svg",
    "Science & Evidence": "./characters/AreaofWork/ScienceEvidence.svg",
    "Markets & Finance": "./characters/AreaofWork/MarketsFinance.svg",
    "Network & Policy": "./characters/AreaofWork/NetworkPolicy.svg"
  };
  // areaofwork-1, areaofwork-2, ... in order, skipping blanks/unknowns.
  function areasOf(d) {
    return Object.keys(d)
      .filter(k => /^areaofwork-\d+$/.test(k))
      .sort((a, b) => (+a.split("-")[1]) - (+b.split("-")[1]))
      .map(k => d[k])
      .filter(v => v && AREA_ICON[v]);
  }

  // One card design: flag + partner, title, stage pill, then the areas of work
  // under the rule. The live map split these across "master"/"zone" variants
  // because it had two node sets; Task 2 collapsed those to one.
  function cardHTML(d, chart) {
    // Everything here is rem (except max-width — card.w is already a
    // JS-computed responsive value, see isSmallScreen() above). The card is
    // width:fit-content so it hugs its text (capped at card.w), with the real
    // width measured back into the foreignObject in measureCardHeights. Text
    // sizes, padding, gaps and radius are all tied to the root font-size set
    // in index.html (16px desktop, 10px mobile), so on a small screen the
    // whole card — text and spacing together — steps down by the same factor
    // and keeps its proportions. Text sizes come from the settings panel.
    const t = {
      partner: settings.cardPartnerRem,
      label:   settings.cardLabelRem,
      stage:   settings.cardStageRem
    };
    // A node with a `url` in data.json turns its card into a link to that
    // project page (opens in a new tab, with a "View project" affordance).
    // Nodes without a url render an inert card — so links can be added later,
    // one node at a time, as the project pages go live. The card's clickability
    // is gated by pointer-events, toggled on only for the focused card in
    // setEmphasis so hidden cards never intercept clicks.
    const clickable = !!d.url;
    const href = clickable ? String(d.url).replace(/"/g, "&quot;") : "";
    const tag = clickable ? "a" : "div";
    const linkAttrs = clickable ? `href="${href}" target="_blank" rel="noopener noreferrer"` : "";
    // Country flag straddles the card's top-right corner (master map only).
    // The overhang is negative margins on a normal flex item, NOT position:
    // absolute. Positioned content inside a <foreignObject> escapes the
    // foreignObject's rendering context in WebKit — it then ignores both the
    // SVG pan/zoom transform and the foreignObject's opacity, so every card
    // renders at full opacity stacked at the origin. Keep this in flow.
    // country may be a single name or a comma-separated list (e.g. a project
    // spanning "Thailand, Singapore, Indonesia") — render one flag per known
    // country, overhanging the card's top-right corner as a row.
    const countries = String(d.country || "").split(",").map(c => c.trim()).filter(c => COUNTRY_ICON[c]);
    const flag = countries.length ? `<span style="
        flex:none; display:inline-flex; gap:0.15rem;
        margin-top:${-(settings.cardPadTop + 0.4)}rem;
        margin-right:${-(settings.cardPadH - 0.2)}rem;
      ">${countries.map(c => `<img src="${COUNTRY_ICON[c]}" alt="${esc(c)}" style="
        width:1.5rem; height:auto; border-radius:0.125rem;
        box-shadow:0 1px 3px rgba(0,0,0,0.22);
      ">`).join("")}</span>` : "";
    // Option 2 shows a single card design: flag, partner, title, stage AND the
    // areas of work together (the live map split these across a "master" and a
    // "zone" variant because it had two node sets; Task 2 collapsed those to
    // one, so there is one card left to design).
    const areas = areasOf(d);
    return `
      <${tag} class="poppins" ${linkAttrs} style="
        width:fit-content;
        min-height:auto;
        box-sizing:border-box;
        background:rgba(247,246,239,0.96);
        border-radius:0.75rem;
        padding:${settings.cardPadTop}rem ${settings.cardPadH}rem ${settings.cardPadBottom}rem;
        color:#111;
        text-decoration:none;
        ${clickable ? "cursor:pointer;" : ""}
        display:flex;
        flex-direction:column;
        gap:0.25rem;
        box-shadow:0 1px 0 rgba(0,0,0,0.02);
      ">
        <div style="display:flex; align-items:flex-start; gap:0.5rem;">
          <div class="poppins" style="
            flex:1 1 auto;
            min-width:0;
            font-size:${t.partner}rem;
            font-weight:500;
            line-height:1;
            color:${chart.color};
            white-space:pre-line;
          ">${d.partner || ""}</div>
          ${flag}
        </div>

        <div class="poppins" style="
          font-size:${t.label}rem;
          font-weight:700;
          line-height:1.15;
          color:#111;
          white-space:pre-line;
          min-width:${card.w}px;
          max-width:25ch;
        ">${d.label || d.id}</div>

        ${
          d.stage
            ? `<div class="poppins" style="
                align-self:flex-start;
                background:${chart.color}22;
                color:${chart.color};
                border-radius:0.1875rem;
                padding:0.25rem 0.5rem;
                font-size:${t.stage}rem;
                font-weight:600;
                line-height:1;
              ">${d.stage}</div>`
            : ``
        }

        ${
          (areas.length || clickable)
            ? `<div style="
                 width:100%;
                 display:flex;
                 align-items:center;
                 gap:0.25rem;
                 border-top:1px solid ${chart.color};
                 padding-top:0.5rem;
               ">
                ${areas.map(a => `<img src="${AREA_ICON[a]}" alt="${esc(a)}" title="${esc(a)}"
                    style="width:${settings.cardAreaIconRem}rem;height:${settings.cardAreaIconRem}rem;display:block;flex:none;">`).join("")}
                ${clickable
                  ? `<div class="poppins" style="
                      margin-left:auto;
                      font-size:${t.stage}rem;
                      font-weight:600;
                      line-height:1;
                      color:${chart.color};
                      white-space:nowrap;
                    ">View project <svg style="padding-left: 0.5ch;" width="5" height="5" viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0.675 0.63V0H4.86V4.203H4.239V1.053L0.414 4.869L0 4.455L3.825 0.63H0.675Z" fill="currentColor"/></svg></div>`
                  : ``}
              </div>`
            : ``
        }

      </${tag}>
    `;
  }

  // Sub-zones per theme (names + descriptions from the ECCA copy). Rendered as
  // placeholder organic blobs, clustered in each panel, sitting at low opacity
  // and lighting up when the theme is soloed. Real blob shapes + which node
  // belongs to which zone come later.
  const SUBZONES = {
    "Healthy Oceans": [
      {name: "Protection & Restoration", desc: "Protecting and restoring marine ecosystems — coral reefs, mangroves, biodiversity and marine protected areas."},
      {name: "Livelihoods & Sustainable Use", desc: "Supporting responsible fishing, regenerative tourism and community livelihoods that depend on healthy oceans."},
      {name: "Pollution & Plastics", desc: "Tackling ocean pollution, plastic leakage, ghost gear and building circular economy solutions."},
      {name: "Adaptation & Resilience", desc: "Helping coastal and marine ecosystems adapt to climate change — building long-term resilience of habitats, species and communities."},
      {name: "Governance & Policy", desc: "Marine governance, policy advocacy and national ocean frameworks — shifting how oceans are managed at the systems level."}
    ],
    "Regenerative Landscapes": [
      {name: "Community Forestry & Stewardship", desc: "Communities leading forest management, stewardship and governance — protecting and sustainably using the landscapes they depend on."},
      {name: "Land Rights & Tenure", desc: "Legal frameworks and governance structures that determine who has recognized rights to land — and under what conditions stewardship is viable."},
      {name: "Landscape Restoration", desc: "Active restoration of forests and degraded land — including nature-based solutions that rebuild ecosystem health."},
      {name: "Regenerative Agriculture", desc: "Farming practices that restore soil health, support biodiversity and create sustainable food systems for farming communities."},
      {name: "Just Transition", desc: "Supporting communities to transition to clean energy and sustainable livelihoods — ensuring the shift away from extractive practices is equitable."}
    ],
    "Inclusive Communities": [
      {name: "Health & Wellbeing", desc: "Physical and mental health access, social emotional learning and trauma-informed support for people facing the highest barriers."},
      {name: "Protection & Safety", desc: "Strengthening protection systems, advocating for rights and building the safeguards that keep vulnerable people — migrants, children, those at risk — safe long-term."},
      {name: "Livelihoods & Economic Mobility", desc: "Skills training, employment pathways and social support that open doors to economic and social mobility for people who face the highest barriers."},
      {name: "Youth & Agency", desc: "Building youth leadership, agency and peer support — giving young people the tools and confidence to shape their own futures."}
    ],
    "Cultural Narratives": [
      {name: "Arts for Change", desc: "Using arts deliberately as a tool to drive measurable change in social and environmental outcomes — arts as intervention, not just expression."},
      {name: "Narratives & Storytelling", desc: "Arts and media that shift how issues are framed, felt and understood — changing the stories that shape what people believe is possible."},
      {name: "Creative Ecosystems", desc: "Investing in the next generation of artists and practitioners — building the talent, infrastructure and institutional capacity that sustains cultural work long-term."},
      {name: "Movement Building", desc: "Using cultural moments and platforms to mobilise people around a shared cause — building the collective energy needed for systems change."}
    ]
  };

  // Which node connects to which sub-zone(s), per theme. A node draws a
  // connector to each of its zones in the detail map. Filled in per theme as
  // the mapping is provided (others fall back to no connectors for now).
  const CONNECTIONS = {
    "Regenerative Landscapes": {
      "Mangroves, Forests, Climate and Livelihoods Program": ["Community Forestry & Stewardship", "Land Rights & Tenure"],
      "Grow CF": ["Community Forestry & Stewardship", "Land Rights & Tenure", "Landscape Restoration"],
      "FLF349 - Forest Restoration through Agroecology": ["Landscape Restoration", "Regenerative Agriculture"],
      "Pai Regenerative Network": ["Landscape Restoration", "Regenerative Agriculture"],
      "Sangsuree Power": ["Just Transition"]
    },
    "Healthy Oceans": {
      "30x30 SEA Ocean Fund": ["Protection & Restoration", "Livelihoods & Sustainable Use"],
      "Sea Guardians": ["Protection & Restoration", "Livelihoods & Sustainable Use", "Adaptation & Resilience", "Governance & Policy"],
      "Coral Conservation & Marine Science": ["Protection & Restoration"],
      "Mapping Connectivity of Coral Reefs": ["Protection & Restoration"],
      "Net Free Seas": ["Livelihoods & Sustainable Use", "Pollution & Plastics", "Governance & Policy"],
      "Ocean Fund I-B": ["Pollution & Plastics"],
      "Circular Economy Technology": ["Pollution & Plastics"],
      "Seaweed-based biomaterial": ["Pollution & Plastics"],
      "Precious Plastic": ["Pollution & Plastics"],
      "Ocean plastic recovery & finance": ["Pollution & Plastics"],
      "30x30 Thailand Coalition": ["Governance & Policy"]
    },
    "Inclusive Communities": {
      "Community-led Emergency Preparedness": ["Health & Wellbeing", "Protection & Safety"],
      "Gang i Gaden": ["Health & Wellbeing", "Protection & Safety"],
      "Border Health": ["Health & Wellbeing", "Protection & Safety"],
      "Navigating Emotions": ["Health & Wellbeing", "Protection & Safety", "Youth & Agency"],
      "Refugee and Migrant Employment": ["Protection & Safety", "Livelihoods & Economic Mobility"],
      "Grassroots Protection Network": ["Livelihoods & Economic Mobility", "Youth & Agency"],
      "Digital Skills & Youth Agency": ["Livelihoods & Economic Mobility", "Youth & Agency"],
      "Undifferent": ["Livelihoods & Economic Mobility"]
    },
    "Cultural Narratives": {
      "Arts-based Youth Development": ["Arts for Change"],
      "Community Theatre for Social Change": ["Arts for Change"],
      "Bangkok 1899": ["Arts for Change", "Creative Ecosystems", "Movement Building"],
      "Healing Arts Singapore": ["Arts for Change", "Creative Ecosystems", "Movement Building"],
      "Arts and Mental Health": ["Arts for Change", "Narratives & Storytelling"],
      "Nature x People": ["Narratives & Storytelling"],
      "Scholarships; ECCA-DMJX Photojournalism Award": ["Narratives & Storytelling", "Creative Ecosystems"],
      "Ghost 2568": ["Narratives & Storytelling", "Creative Ecosystems"],
      "Inspiring Asia Micro Film Festival Thailand": ["Narratives & Storytelling", "Creative Ecosystems"],
      "Bangkok Climate Action Week": ["Movement Building"]
    }
  };

  // Designed sub-zone artwork per theme. The artwork carries no text: each
  // zone's headline + body are separate PNGs composed at runtime (renderDetail).
  //   cx/cy  blob centre, r  hit radius (both normalized to the image WIDTH)
  //   top    blob's top edge, ay  blob's bottom edge (normalized to HEIGHT)
  //   ax     connector attach x. head/body carry each PNG's native size.
  // cx/cy/r/top/ay were measured off each artwork (colour mask + erosion), not
  // eyeballed. Label PNGs render at a single shared scale (see LABEL_REF_W in
  // renderDetail); BODY_SCALE then applies the "body reads smaller" step.
  //   o2  per-theme fit knobs for the option-2 in-quadrant layout (see
  //       renderDetail's o2ToGlobal): scale multiplies the auto-fit size that
  //       exactly fills the quadrant (1 = default, aspect ratios run from
  //       1.33 to 2.09 so themes will want different values here once judged
  //       by eye); ox/oy nudge the arc's rotation centre, as a fraction of
  //       the quadrant's own width/height (0,0 = quadrant centre). Optional —
  //       themes without an `o2` block just get the untouched auto-fit.
  const SUBZONE_ART = {
    "Healthy Oceans": {
      letter: "A", src: "./characters/EntryA/subzone-a.png", aspect: 2.090,
      // A is the widest/flattest arc (2.09) — expect it to read flatter than
      // B/C/D even at an identical auto-fit; tune scale/ox/oy here once
      // judged by eye (defaults = untouched auto-fit).
      // Tuned by the designer in the live Arc-tuning panel and copied back
      // here as the default; the sliders still override at runtime.
      o2: { scale: 1.41, ox: 0.12, oy: 0.375, rot: 9.9, flipX: false, flipY: true, badgeSize: 1, badgeX: 0.229, badgeY: 0.184 },
      nodeArea: { x: 0.52, y: 1.345 },
      zones: {
        "Protection & Restoration": {
          cx: 0.146, cy: 0.701, r: 0.090, top: 0.505, bot: 0.896, ax: 0.146, ay: 0.896, labelDy: -0.02,
          head: { src: "./characters/EntryA/Protection-RestorationEntryA.png", w: 343, h: 126 },
          body: { src: "./characters/EntryA/Protection-Restoration-TextEntryA.png", w: 452, h: 262 }
        },
        "Livelihoods & Sustainable Use": {
          cx: 0.303, cy: 0.455, r: 0.107, top: 0.267, bot: 0.642, ax: 0.335, ay: 0.605, labelDy: -0.03,
          head: { src: "./characters/EntryA/Livelihoods-SustainableUseEntryA.png", w: 431, h: 122 },
          body: { src: "./characters/EntryA/Livelihoods-SustainableUse-TextEntryA.png", w: 558, h: 206 }
        },
        "Pollution & Plastics": {
          cx: 0.508, cy: 0.321, r: 0.114, top: 0.167, bot: 0.475, ax: 0.508, ay: 0.475, labelDy: 0.025,
          head: { src: "./characters/EntryA/Pollution-PlasticsEntryA.png", w: 303, h: 123 },
          body: { src: "./characters/EntryA/Pollution-Plastics-TextEntryA.png", w: 469, h: 206 }
        },
        "Adaptation & Resilience": {
          cx: 0.730, cy: 0.382, r: 0.112, top: 0.178, bot: 0.585, ax: 0.73, ay: 0.585, labelDy: -0.015,
          head: { src: "./characters/EntryA/Adaptation-ResilienceEntryA.png", w: 342, h: 123 },
          body: { src: "./characters/EntryA/Adaptation-Resilience-TextEntryA.png", w: 521, h: 309 }
        },
        "Governance & Policy": {
          cx: 0.858, cy: 0.713, r: 0.103, top: 0.551, bot: 0.875, ax: 0.858, ay: 0.875, labelDy: 0.035,
          head: { src: "./characters/EntryA/Governance-PolicyEntryA.png", w: 348, h: 122 },
          body: { src: "./characters/EntryA/Governance-Policy-TextEntryA.png", w: 523, h: 262 }
        }
      }
    },
    "Regenerative Landscapes": {
      letter: "B", src: "./characters/EntryB/subzone-b.png", aspect: 1.326,
      // Tuned by the designer in the live Arc-tuning panel and copied back
      // here as the default; the sliders still override at runtime.
      o2: { scale: 1.555, ox: 0.065, oy: -0.305, rot: 0.6, flipX: true, flipY: false, badgeSize: 1.245, badgeX: 0.186, badgeY: 0.825 },
      nodeArea: { x: 0.265, y: 0.765 },
      zones: {
        "Community Forestry & Stewardship": {
          cx: 0.181, cy: 0.297, r: 0.120, top: 0.144, bot: 0.449, ax: 0.181, ay: 0.449, labelDy: 0.04,
          head: { src: "./characters/EntryB/Community%20ForestryStewardship.png", w: 469, h: 123 },
          body: { src: "./characters/EntryB/Community%20ForestryStewardship-Text.png", w: 526, h: 262 }
        },
        "Land Rights & Tenure": {
          cx: 0.424, cy: 0.227, r: 0.130, top: 0.112, bot: 0.342, ax: 0.424, ay: 0.342, labelDy: 0.015,
          head: { src: "./characters/EntryB/LandRightsTenure.png", w: 303, h: 124 },
          body: { src: "./characters/EntryB/LandRightsTenure-Text.png", w: 689, h: 206 }
        },
        "Landscape Restoration": {
          cx: 0.673, cy: 0.306, r: 0.134, top: 0.192, bot: 0.420, ax: 0.61, ay: 0.42,
          head: { src: "./characters/EntryB/LandscapeRestoration.png", w: 326, h: 125 },
          body: { src: "./characters/EntryB/LandscapeRestoration-Text.png", w: 604, h: 206 }
        },
        "Regenerative Agriculture": {
          cx: 0.742, cy: 0.805, r: 0.116, top: 0.689, bot: 0.922, ax: 0.63, ay: 0.845,
          head: { src: "./characters/EntryB/RegenerativeAgriculture.png", w: 342, h: 123 },
          body: { src: "./characters/EntryB/RegenerativeAgriculture-Text.png", w: 480, h: 262 }
        },
        "Just Transition": {
          cx: 0.768, cy: 0.556, r: 0.104, top: 0.424, bot: 0.688, ax: 0.66, ay: 0.615,
          head: { src: "./characters/EntryB/JustTransition.png", w: 274, h: 120 },
          // exported without the -Text suffix, but this is the body copy
          body: { src: "./characters/EntryB/JustTransition-1.png", w: 468, h: 318 }
        }
      }
    },
    "Inclusive Communities": {
      letter: "C", src: "./characters/EntryC/subzone-c.png", aspect: 1.434,
      // Tuned by the designer in the live Arc-tuning panel and copied back
      // here as the default; the sliders still override at runtime.
      o2: { scale: 1.365, ox: -0.055, oy: 0.285, rot: 0, flipX: true, flipY: true, badgeSize: 1, badgeX: 0.775, badgeY: 0.154 },
      nodeArea: { x: 0.635, y: 0.94 },
      zones: {
        "Health & Wellbeing": {
          cx: 0.176, cy: 0.730, r: 0.122, top: 0.557, bot: 0.902, ax: 0.176, ay: 0.902, labelDy: -0.035,
          head: { src: "./characters/EntryC/HealthWellbeing.png", w: 374, h: 127 },
          body: { src: "./characters/EntryC/HealthWellbeing-Text.png", w: 473, h: 318 }
        },
        "Protection & Safety": {
          cx: 0.332, cy: 0.452, r: 0.131, top: 0.306, bot: 0.597, ax: 0.332, ay: 0.597, labelDy: -0.015,
          head: { src: "./characters/EntryC/ProtectionSafety.png", w: 264, h: 112 },
          body: { src: "./characters/EntryC/ProtectionSafety-Text.png", w: 547, h: 318 }
        },
        "Livelihoods & Economic Mobility": {
          cx: 0.519, cy: 0.293, r: 0.134, top: 0.160, bot: 0.426, ax: 0.519, ay: 0.426, labelDy: -0.005,
          head: { src: "./characters/EntryC/LivelihoodsEconomicMobility.png", w: 535, h: 127 },
          body: { src: "./characters/EntryC/LivelihoodsEconomicMobility-Text.png", w: 609, h: 262 }
        },
        "Youth & Agency": {
          cx: 0.802, cy: 0.297, r: 0.146, top: 0.156, bot: 0.438, ax: 0.802, ay: 0.438, labelDy: -0.035,
          head: { src: "./characters/EntryC/YouthAgency.png", w: 287, h: 126 },
          body: { src: "./characters/EntryC/YouthAgency-Text.png", w: 614, h: 206 }
        }
      }
    },
    "Cultural Narratives": {
      letter: "D", src: "./characters/EntryD/subzone-d.png", aspect: 1.765,
      // Tuned by the designer in the live Arc-tuning panel and copied back
      // here as the default; the sliders still override at runtime.
      o2: { scale: 1.195, ox: -0.13, oy: -0.49, rot: -0.6, flipX: false, flipY: false, badgeSize: 1, badgeX: 0.749, badgeY: 0.59 },
      nodeArea: { x: 0.435, y: 1.155 },
      zones: {
        "Arts for Change": {
          cx: 0.168, cy: 0.516, r: 0.129, top: 0.345, bot: 0.687, ax: 0.168, ay: 0.687, labelDy: 0.015,
          head: { src: "./characters/EntryD/ArtsforChange.png", w: 246, h: 117 },
          body: { src: "./characters/EntryD/ArtsforChange-Text.png", w: 580, h: 262 }
        },
        "Narratives & Storytelling": {
          cx: 0.412, cy: 0.368, r: 0.143, top: 0.188, bot: 0.547, ax: 0.412, ay: 0.547, labelDy: 0.03,
          head: { src: "./characters/EntryD/NarrativesStorytelling.png", w: 370, h: 127 },
          body: { src: "./characters/EntryD/NarrativesStorytelling-Text.png", w: 656, h: 206 }
        },
        "Creative Ecosystems": {
          cx: 0.672, cy: 0.464, r: 0.131, top: 0.295, bot: 0.633, ax: 0.66, ay: 0.633, labelDy: 0.015,
          head: { src: "./characters/EntryD/CreativeEcosystems.png", w: 331, h: 123 },
          body: { src: "./characters/EntryD/CreativeEcosystems-Text.png", w: 626, h: 262 }
        },
        "Movement Building": {
          cx: 0.835, cy: 0.740, r: 0.115, top: 0.597, bot: 0.884, ax: 0.835, ay: 0.884, labelDy: -0.015,
          head: { src: "./characters/EntryD/MovementBuilding.png", w: 278, h: 121 },
          body: { src: "./characters/EntryD/MovementBuilding-Text.png", w: 533, h: 262 }
        }
      }
    }
  };

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Smooth closed organic blob path around (cx,cy) with radius r; `seed` gives
  // each blob a stable, slightly different wobble.
  function blobPath(cx, cy, r, seed) {
    const n = 8;
    let s = seed % 233280;
    const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.82 + rand() * 0.34);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
    }
    return d + "Z";
  }

  function makePanel(chart, index) {
    const {x, y} = panelPosition(index);

    const panel = zoomLayer.append("g")
      .attr("transform", `translate(${x},${y})`);

    // Anchor the title badge to this panel's own outer corner (the corner
    // farthest from the canvas center, where the 4 quadrants meet) instead
    // of tracking a node's live position.
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    const cornerMargin = 24;

    // "Mouth of the C" — the master node cluster's home point (Task 2: it used
    // to be the panel's dead centre, back when a separate "detail" node set
    // lived in the sub-zone arc's own Node Area). The arc always rotates to
    // open toward the canvas centre (see theta in renderDetail), so leaning
    // the cluster toward this panel's INNER corner (the one nearest the
    // centre, where all 4 quadrants meet) reads as the nodes spilling out of
    // the arc's open mouth instead of just sitting in the panel's middle.
    // CLUSTER_BIAS blends panel-centre (0) toward that corner (1) — not the
    // full distance, or the cluster would crowd the gap between quadrants.
    // Mutable (not const) because the legacy "Node Area" tune slider (see
    // detailControls.setNodeArea below) can retarget it live.
    const CLUSTER_BIAS = 0.42;
    const innerCornerX = col === 0 ? layout.panelW : 0;
    const innerCornerY = row === 0 ? layout.panelH : 0;
    const clusterCenter = {
      x: layout.panelW / 2 + (innerCornerX - layout.panelW / 2) * CLUSTER_BIAS,
      y: layout.panelH / 2 + (innerCornerY - layout.panelH / 2) * CLUSTER_BIAS + 8
    };

    const nodes = chart.nodes.map(d => ({...d}));
    const links = chart.links.map(d => ({...d}));

    function hashString(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return Math.abs(h);
    }
    
    nodes.forEach(d => {
      d.icon = bulletSvgs[hashString(`${chart.id}-${d.id}`) % bulletSvgs.length];
    });
    
    // Cap the badge to a reasonable fraction of its own panel — on a
    // narrow panel a full-size badge would overflow into the neighboring
    // one regardless of any gap between them.
    const badgeScale = Math.min(
      1,
      (layout.panelW * 0.5) / (chart.badgeW ?? 112),
      (layout.panelH * 0.35) / (chart.badgeH ?? 78)
    );
    const badgeW = (chart.badgeW ?? 112) * badgeScale;
    const badgeH = (chart.badgeH ?? 78) * badgeScale;

    const badgeArtL = (SUBZONE_ART[chart.id] || {}).letter;
    const cornerTarget = {
      x: col === 0 ? cornerMargin + badgeW / 2 : layout.panelW - cornerMargin - badgeW / 2,
      y: row === 0 ? cornerMargin + badgeH / 2 : layout.panelH - cornerMargin - badgeH / 2
    };
    // Saved badge position, as a fraction of the panel so it survives a resize.
    // Dragging the badge writes these, so "drag it where you want it" IS the
    // tuning gesture — the sliders in the settings panel edit the same values.
    // Falls back to the computed corner when the designer has not placed it.
    // Precedence, same as every other option-2 knob: dragged/slider value in
    // settings > the designer's baked SUBZONE_ART.o2 default > computed corner.
    const badgeCfg = (SUBZONE_ART[chart.id] || {}).o2 || {};
    const savedBadgePos = () => {
      if (!badgeArtL) return null;
      const fx = settings[`badgePosX${badgeArtL}`] ?? badgeCfg.badgeX;
      const fy = settings[`badgePosY${badgeArtL}`] ?? badgeCfg.badgeY;
      if (fx == null || fy == null) return null;
      return { x: fx * layout.panelW, y: fy * layout.panelH };
    };
    // Stays at its saved spot (or its fixed corner) on load; once dragged, this
    // overrides the corner target and the badge stays wherever it's dropped.
    let badgeOverride = savedBadgePos();
    const titleState = badgeOverride
      ? { x: badgeOverride.x, y: badgeOverride.y }
      : { x: cornerTarget.x, y: cornerTarget.y };
    // This panel's badge bumper zone in global (zoomLayer) coords, shared so
    // every panel's simulation can repel its nodes from it. Kept current in
    // render() since the badge can be dragged.
    const badgeZone = { gx: x + titleState.x, gy: y + titleState.y, halfW: badgeW / 2, halfH: badgeH / 2 };
    badgeRegistry.push(badgeZone);

    let soloBadgeScale = 1;      // grows to 1.5 while this theme is soloed
    let zoneAnchorsRef = null;   // this theme's sub-zone blobs (for the badge line)
    let badgeConnector = null;   // bent line: badge -> closest sub-zone blob edge
    // Per-theme badge size, tuned by eye. Needed because badgeW/badgeH (data.json)
    // do not match the badge SVGs' own aspect ratios, so each art file gets
    // letterboxed by a different amount inside its box — the four badges end up
    // the same height but at noticeably different internal scales, which reads
    // as mismatched text sizes. The text is knocked out of a compound path in
    // those SVGs, so there is nothing measurable to normalise against here.
    // Same reasoning as MOBILE_NODE_SCALE: the badge is sized for a desktop
    // viewport, and reads as oversized through a phone-sized window onto the
    // same geometry. Kept as a separate multiplier so the designer's tuned
    // badgeSize still means the same thing on both.
    const MOBILE_BADGE_SCALE = isSmallScreen() ? 0.6 : 1;
    // How much the badge grows while it is the chooser's tap target.
    const CHOOSER_BADGE_SCALE = 4;
    let badgeUserScale = ((badgeArtL ? settings[`badgeSize${badgeArtL}`] : undefined)
      ?? badgeCfg.badgeSize ?? 1) * MOBILE_BADGE_SCALE;

    // Badge renders here, before `inner` — so nodes/lines paint on top of
    // it wherever they overlap. Still draggable from any part of the badge
    // that isn't currently covered by a node.
    const titleLayer = panel.append("g").attr("pointer-events", "none");
    const titleBadge = titleLayer.append("g")
      .style("pointer-events", "auto")
      .style("cursor", "pointer");

    titleBadge.append("image")
      .attr("href", chart.image)
      .attr("xlink:href", chart.image)
      .attr("width", badgeW)
      .attr("height", badgeH)
      .attr("preserveAspectRatio", "xMidYMid meet");

    titleBadge.call(
      d3.drag()
        .on("start", event => {
          event.sourceEvent.stopPropagation();
          titleBadge.style("cursor", "grabbing");
          // Reheat the sim so the badge bumper actively pushes settled nodes
          // out of the badge's way while it's being dragged (otherwise the
          // frozen simulation ignores the moving badge).
          simulation.alphaTarget(0.3).restart();
        })
        .on("drag", event => {
          badgeOverride = {
            x: Math.max(badgeW / 2, Math.min(layout.panelW - badgeW / 2, event.x)),
            y: Math.max(badgeH / 2, Math.min(layout.panelH - badgeH / 2, event.y))
          };
          render();
        })
        .on("end", () => {
          titleBadge.style("cursor", "pointer");
          simulation.alphaTarget(0); // let it settle again
          // Persist where it was dropped, as a panel fraction — so dragging is
          // the placement gesture and the value survives reload + shows up in
          // the settings panel's Badge X/Y sliders and the copy button.
          if (badgeArtL && badgeOverride) {
            settings[`badgePosX${badgeArtL}`] = badgeOverride.x / layout.panelW;
            settings[`badgePosY${badgeArtL}`] = badgeOverride.y / layout.panelH;
            saveSettings();
            syncBadgePosSliders();
          }
        })
    );

    // Click the badge to zoom/solo this theme's quadrant (drag still
    // repositions it — d3-drag suppresses the click after a real drag).
    // Clicking the already-soloed theme's badge returns to the overview.
    titleBadge.on("click", (event) => {
      event.stopPropagation();
      if (soloedIndex === index) exitSolo();
      else soloPanel(index);
    });

    const title = titleLayer.append("text")
      .attr("font-size", 15)
      .attr("font-weight", 700)
      .attr("fill", "transparent")
      .attr("text-anchor", "middle")
      .text(chart.id);

    const inner = panel.append("g");
    // The density wash lives in its own root BELOW the sub-zone artwork, not
    // inside `inner` with the nodes. In the live map `inner` sat on top of the
    // (off-screen) detail maps and nothing overlapped; in option 2 the arc is
    // inside this same quadrant, so a contour drawn in `inner` washes over the
    // artwork. Carries the panel's own translate since it is no longer a child
    // of `panel`, and setFocus dims it alongside `inner`.
    const densityLayer = densityRoot.append("g")
      .attr("transform", `translate(${x},${y})`)
      .style("mix-blend-mode", "multiply")
      .style("pointer-events", "none");

    // Sub-zone "detail map" for this theme: the designed arc artwork, rotated
    // to face the canvas centre and scaled to fit INSIDE this panel's own
    // quadrant (previously parked diagonally outside it and only revealed on
    // zoom — see git history). Lives in the shared detailLayer (global
    // coords) so it composes under this panel's own badge/node graph.
    let detailCenter = null;
    let detailExtent = 0;
    let detailControls = null; // live tuning of attach points + node area (art)
    // Zone-connector path selection/fn + arc keep-out zones — set by
    // renderDetail (below) and read every tick by the OUTER render()/master
    // simulation (Task 2: connectors now track master nodes, and the arc's
    // own live-tune sliders (Task 2.5) re-run renderDetail, so both need a
    // stable place outside that function to publish into).
    let zoneLinkSel = null;
    let zoneConnPath = null;
    let arcAvoidZones = [];
    // Sub-zone headline labels + the node->sub-zone connection map, published
    // for setEmphasis so it can dim the sub-zones a focused node isn't tied to.
    let zoneLabelSel = null;
    let zoneConns = null;
    const detailGroup = detailLayer.append("g")
      .attr("class", "detail-map")
      .style("opacity", 1);
    // A named function (not the old IIFE) so Task 2.5's live arc sliders can
    // re-invoke it — every art-derived point (zone blobs, pin dots, labels,
    // the node keep-out zones) is recomputed from `settings` on each call, so
    // dragging a slider just calls this again instead of needing bespoke
    // per-slider update code.
    function renderDetail() {
      detailGroup.selectAll("*").remove(); // full rebuild, see above
      const zones = SUBZONES[chart.id] || [];
      const realNodes = nodes.filter(hasCard);
      if (!zones.length) return;
      const outX = col === 0 ? -1 : 1;
      const outY = row === 0 ? -1 : 1;
      const base = Math.min(layout.panelW, layout.panelH);
      // Quadrant centre — the arc's home is now IN the panel, not diagonally
      // outside it.
      const gcx = x + layout.panelW / 2;
      const gcy = y + layout.panelH / 2;
      const ringR = base * 0.34;
      const blobR = base * 0.16;
      const conns = CONNECTIONS[chart.id] || {};

      const art = SUBZONE_ART[chart.id];

      // Zone anchors: from the artwork coords when we have art, else a drawn
      // arc. Each has a display centre (x,y), an edge attach point (ax,ay) for
      // connectors, and a hit radius r.
      let imgBox = null;
      let zoneAnchors;
      const artL = art ? art.letter : null;
      // Every art-derived point below (zone centres/edges, attach points, the
      // node cluster's home, the dev-panel sliders) goes through this one
      // affine, so a coordinate defined as a fraction of the artwork's own
      // (unrotated) width/height (fx,fy in [0,1]) always lands correctly once
      // the artwork is rotated to face the centre. Only the <image> itself
      // sits inside an actual rotate() transform (below) — labels, pins,
      // nodes and connectors stay upright and are just positioned via this.
      let o2ToGlobal = (fx, fy) => ({ x: gcx, y: gcy });
      let o2RotateVec = (dx, dy) => ({ x: dx, y: dy });
      // theta/imgCenterX/imgCenterY are also read later (the artwork's own
      // rotate() transform, the detail-map zoom framing) — hoisted here
      // rather than left `const` inside the `if (art)` block below.
      // computedTheta similarly needs to survive past this block — it's
      // read again down in detailControls (a SEPARATE `if (art)` block,
      // Task 2.5's slider default), which is out of scope for a `const`
      // declared only inside this one.
      // flipX/flipY are hoisted for the same reason — the artwork's transform
      // (a separate `if (art)` block below) has to mirror by exactly the same
      // amount the coordinate helpers do.
      let theta = 0, imgCenterX = gcx, imgCenterY = gcy, computedTheta = 0;
      let flipX = false, flipY = false;
      if (art) {
        // subzone-*.png is a "C" arc, mouth open toward +y (straight down) at
        // 0°. Each quadrant rotates it so the mouth faces the canvas centre
        // instead: top row ±45°, bottom row ±135°; sign follows the column
        // (left = negative), magnitude follows the row. SVG's rotate(θ) maps
        // the "down" unit vector (0,1) to (-sinθ, cosθ) — plug in these
        // angles and that always points back toward (gcx,gcy)'s opposite
        // quadrant, i.e. the canvas centre. Task 2.5: the "Arc rotation"
        // slider (settings.o2rot<L>) overrides this computed angle when the
        // designer has tuned it — falls back to the computed value (NOT 0)
        // so an untouched theme still opens toward the centre.
        // Precedence for every arc knob: live slider > SUBZONE_ART.o2 default
        // (the designer's tuned values, baked in) > computed fallback.
        const o2cfg = art.o2 || {};
        computedTheta = outX * (outY < 0 ? 45 : 135);
        theta = settings[`o2rot${artL}`] ?? o2cfg.rot ?? computedTheta;
        const rad = theta * Math.PI / 180;
        const cosT = Math.cos(rad), sinT = Math.sin(rad);

        // Per-theme fit knobs — aspect ratios range from 1.33 (B) to 2.09 (A),
        // so one shared scale/offset would leave some arcs cramped and others
        // swimming in the quadrant. o2.scale multiplies the auto-fit size
        // (1 = exactly fills FIT_PAD of the quadrant); o2.ox/oy nudge the
        // arc's rotation centre, as a fraction of the quadrant's own w/h.
        // Task 2.5's live sliders (settings.o2scale<L>/o2ox<L>/o2oy<L>) win
        // over the SUBZONE_ART defaults when the designer has tuned them.
        // The trailing multiplier is the same phone adjustment the badge and
        // node icons get: same geometry, smaller window onto it, so the
        // artwork reads bigger than it should next to the labels.
        const themeScale = (settings[`o2scale${artL}`] ?? o2cfg.scale ?? 1)
          * (isSmallScreen() ? 0.8 : 1);
        flipX = settings[`o2fx${artL}`] ?? o2cfg.flipX ?? false;
        flipY = settings[`o2fy${artL}`] ?? o2cfg.flipY ?? false;
        imgCenterX = gcx + (settings[`o2ox${artL}`] ?? o2cfg.ox ?? 0) * layout.panelW;
        imgCenterY = gcy + (settings[`o2oy${artL}`] ?? o2cfg.oy ?? 0) * layout.panelH;

        // Fit the rotated bbox inside the quadrant on BOTH axes — a flat
        // (16:9-ish) quadrant is much shorter than it is wide, so height is
        // usually the binding constraint. Solved directly (not assumed
        // square): at exactly ±45°/±135° |sinθ|=|cosθ| so the rotated bbox
        // does come out square, but this derivation holds for any θ.
        const FIT_PAD = 0.8; // headroom so the arc doesn't touch the quadrant edge
        const absCos = Math.abs(cosT), absSin = Math.abs(sinT);
        const hFromW = (layout.panelW * FIT_PAD) / (art.aspect * absCos + absSin);
        const hFromH = (layout.panelH * FIT_PAD) / (art.aspect * absSin + absCos);
        const imgH = Math.min(hFromW, hFromH) * themeScale;
        const imgW = imgH * art.aspect;
        const imgX = imgCenterX - imgW / 2, imgY = imgCenterY - imgH / 2;
        imgBox = { x: imgX, y: imgY, w: imgW, h: imgH };

        // Mirroring happens in the artwork's own space, BEFORE the rotation —
        // so "flip X" always reads as flipping the arc left-to-right as drawn,
        // regardless of how far it has been rotated. Folded into the same
        // affine as everything else: get this wrong and the picture mirrors
        // while the pins/labels/hit circles stay put.
        const sx = flipX ? -1 : 1, sy = flipY ? -1 : 1;
        o2ToGlobal = (fx, fy) => {
          const px = imgX + fx * imgW, py = imgY + fy * imgH;
          const dx = (px - imgCenterX) * sx, dy = (py - imgCenterY) * sy;
          return { x: imgCenterX + dx * cosT - dy * sinT, y: imgCenterY + dx * sinT + dy * cosT };
        };
        o2RotateVec = (dx0, dy0) => {
          const dx = dx0 * sx, dy = dy0 * sy;
          return { x: dx * cosT - dy * sinT, y: dx * sinT + dy * cosT };
        };

        // Bent line linking this theme's badge to the closest sub-zone blob
        // edge. Same dotted look + cubic bend as the in-zone connectors; badge
        // end + endpoint recomputed in render(). Lives in detailGroup (global
        // coords, like the artwork).
        badgeConnector = detailGroup.append("path")
          .attr("class", "badge-connector").attr("fill", "none")
          .attr("stroke", chart.color).attr("stroke-opacity", 1)
          .attr("stroke-width", base * 0.008).attr("stroke-linecap", "round")
          .attr("stroke-dasharray", `0.1 ${base * 0.014}`);
        zoneAnchors = zones.map((z, i) => {
          const g = art.zones[z.name] || { cx: 0.5, cy: 0.3, r: 0.12, ax: 0.5, ay: 0.42 };
          // Attach points are UI-tunable per theme (settings sz<L>ax/ay<i>).
          const axf = settings[`sz${artL}ax${i}`];
          const ayf = settings[`sz${artL}ay${i}`];
          const center = o2ToGlobal(g.cx, g.cy);
          const topPt = o2ToGlobal(g.cx, g.top ?? g.cy);
          const botPt = o2ToGlobal(g.cx, g.bot ?? g.ay ?? g.cy);
          const attachPt = o2ToGlobal(axf ?? g.ax, ayf ?? g.ay);
          return { name: z.name, index: i, cfg: g,
            x: center.x, y: center.y,
            // Blob's measured top/bottom edges — deliberately NOT the attach
            // point (ax/ay), which is tuned independently, so labels stay put
            // when connectors are re-pinned. Rotated the same way as every
            // other art-derived point (see o2ToGlobal above).
            //
            // min/max, not top/bot as authored: a vertical flip (or a rotation
            // past 90 degrees) swaps which of the two ends up higher on screen.
            // The labels are always drawn upright, so they need the visually
            // top edge — leaving these unsorted makes (botY - topY) negative,
            // which collapses the blob height to 1px and drops the headline to
            // the bottom of the blob on exactly the flipped themes.
            topY: Math.min(topPt.y, botPt.y), botY: Math.max(topPt.y, botPt.y),
            ax: attachPt.x, ay: attachPt.y, r: g.r * imgW };
        });
        zoneAnchorsRef = zoneAnchors;
        // Keep-out zones for the master node cluster (Task 2): each sub-
        // zone's blob circle, converted to this panel's LOCAL coordinates
        // since that's the space master nodes/the simulation live in — read
        // fresh every tick by the "arcAvoid" force below, and recomputed
        // here whenever an arc slider (Task 2.5) re-runs renderDetail.
        arcAvoidZones = zoneAnchors.map(za => ({ x: za.x - x, y: za.y - y, r: za.r }));
      } else {
        arcAvoidZones = [];
        zoneAnchors = zones.map((z, i) => {
          const t = zones.length === 1 ? 0.5 : i / (zones.length - 1);
          const a = Math.PI * (1 - t);
          const zx = gcx + Math.cos(a) * ringR, zy = gcy - Math.sin(a) * ringR;
          return { name: z.name, x: zx, y: zy, ax: zx, ay: zy, r: blobR };
        });
      }
      const zoneByName = {};
      zoneAnchors.forEach(za => { zoneByName[za.name] = za; });

      // Where the free nodes cluster: the "Node Area" of the artwork (through
      // o2ToGlobal, so it rotates with it) when we have art, else a band
      // below the drawn arc.
      const naxDef = art?.nodeArea?.x ?? 0.35, nayDef = art?.nodeArea?.y ?? 0.9;
      const nodeAreaPt = art ? o2ToGlobal(settings[`sz${artL}nax`] ?? naxDef, settings[`sz${artL}nay`] ?? nayDef) : null;
      const nodeAreaX = art ? nodeAreaPt.x : gcx;
      const nodeAreaY = art ? nodeAreaPt.y : gcy + blobR * 2.6;

      // Task 2: zone connectors now read the SAME nodes the master
      // simulation draws (realNodes, filtered from `nodes` above) instead of
      // a separate free-floating copy — that copy (dNodes) was rendering a
      // second icon+label for every project, which is what doubled the node
      // count and duplicated 13 project names on screen. `connPath` below
      // adds this panel's own (x,y) offset to convert a source node's
      // panel-local position to the global coords the zone anchors use.
      const links = [];
      realNodes.forEach(dn => (conns[dn.id] || []).forEach(zn => {
        if (zoneByName[zn]) links.push({ source: dn, target: zoneByName[zn] });
      }));

      // Layers, back to front: connectors, artwork, hits, nodes. (No contour
      // glow here anymore — the master panel's own densityLayer already does
      // that job for this same node set, so a second blurred contour behind
      // the now-visible arc was pure redundant cost.)
      const connectorG = detailGroup.append("g").attr("class", "zone-links").style("pointer-events", "none");

      if (art) {
        // Designed sub-zone artwork (one combined image), rotated so its
        // mouth faces the canvas centre — see theta above. This <g> is the
        // ONLY thing in the detail map that actually rotates; every other
        // element (labels, pins, nodes, connectors) is placed via o2ToGlobal
        // instead, so it renders upright.
        // Transform list applies right-to-left to a point, so this mirrors
        // about the artwork's centre FIRST and rotates second — matching the
        // order baked into o2ToGlobal/o2RotateVec above.
        detailGroup.append("g")
          .attr("class", "subzone-art-rotate")
          .attr("transform",
            `rotate(${theta} ${imgCenterX} ${imgCenterY})` +
            ` translate(${imgCenterX} ${imgCenterY})` +
            ` scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})` +
            ` translate(${-imgCenterX} ${-imgCenterY})`)
          .append("image")
          .attr("href", art.src).attr("xlink:href", art.src)
          .attr("x", imgBox.x).attr("y", imgBox.y).attr("width", imgBox.w).attr("height", imgBox.h)
          .attr("preserveAspectRatio", "xMidYMid meet").style("pointer-events", "none");
      } else {
        // Drawn placeholder blobs.
        zones.forEach((z, i) => {
          const za = zoneByName[z.name];
          const g = detailGroup.append("g").attr("transform", `translate(${za.x},${za.y})`).style("pointer-events", "none");
          g.append("path")
            .attr("d", blobPath(0, 0, blobR, (i + 1) * 97 + chart.id.length * 13))
            .attr("fill", chart.color).attr("fill-opacity", 0.55)
            .attr("stroke", chart.color).attr("stroke-opacity", 0.5);
          g.append("foreignObject").attr("x", -blobR).attr("y", -blobR)
            .attr("width", blobR * 2).attr("height", blobR * 2).style("overflow", "visible")
            .append("xhtml:div").attr("class", "subzone-label")
            .html(`<div class="sz-name">${esc(z.name)}</div><div class="sz-desc">${esc(z.desc)}</div>`);
        });
      }

      // Curved "bent" connector, dotted — pins to the zone's edge attach
      // point. `l.source` is a master node, positioned in THIS PANEL'S LOCAL
      // coordinates (like every node the simulation drives); `l.target` (a
      // zone anchor) is already GLOBAL (built through o2ToGlobal above) — so
      // the source needs the panel's own (x,y) offset added before the two
      // can share a curve.
      function connPath(l) {
        const s = l.source, t = l.target;
        const sx = x + s.x, sy = y + s.y;
        const my = (sy + t.ay) / 2;
        return `M${sx},${sy}C${sx},${my} ${t.ax},${my} ${t.ax},${t.ay}`;
      }
      const linkSel = connectorG.selectAll("path").data(links).join("path")
        .attr("fill", "none").attr("stroke", chart.color).attr("stroke-opacity", 0.5)
        .attr("stroke-width", base * 0.005).attr("stroke-linecap", "round")
        .attr("stroke-dasharray", `0.1 ${base * 0.012}`)
        .attr("d", connPath); // initial position — the master sim's OWN tick
                               // (see render() below) keeps this current from
                               // here on, there's no separate detail-map sim
                               // to do a first tick for us anymore.
      // Published for render()'s tick handler and detailFitTransform/etc. to
      // read — see the `let zoneLinkSel`/`zoneConnPath` declared above.
      zoneLinkSel = linkSel;
      zoneConnPath = connPath;
      zoneConns = conns;

      // Per-zone label nudge, applied ONLY to the hover layout: at rest the
      // headline must stay centred in its blob, so the offset eases in on hover
      // and back out on leave. Setters are kept for the settings panel; offsets
      // are fractions of the artwork, so they hold at any zoom.
      const labelSetters = [];

      // Per-zone labels + invisible hit targets over the artwork.
      // Where the artwork carries no baked-in text, each zone supplies its
      // headline/body as separate PNGs (see SUBZONE_ART). At rest only the
      // headline shows, centred in its blob; hovering the blob slides the
      // headline up and fades the body in beneath it, so the pair lands in the
      // same arrangement the old text-baked artwork had. PNGs are scaled by the
      // artwork's own ratio so they keep their designed size.
      if (art) {
        // Every label PNG, in all four themes, is exported at one fixed scale
        // (verified: an identical 56px text line pitch in each), so they must
        // all render at the same on-screen size — regardless of how many pixels
        // wide a given artwork happens to be. LABEL_REF_W is the artwork width
        // those exports correspond to, so dividing the rendered artwork width
        // by it yields one label unit shared by every theme.
        // This replaces a per-theme labelScale derived from text *widths*, which
        // line-wrapping differences made unreliable: it rendered B/C/D's copy
        // 11-17% larger than A's. Sizing off the export scale (not each
        // artwork's pixel width) also stops artwork re-exports from drifting it.
        const LABEL_REF_W = 2439;
        const labelUnit = imgBox.w / LABEL_REF_W;
        const LABEL_GAP = 22;   // native px between headline and body
        const BODY_SCALE = 0.7; // body copy reads smaller than the headline
        // On hover the headline's TOP sits this far below the blob's top edge
        // (as a fraction of blob height), so it reads as sitting on the blob
        // rather than floating off its edge. Body follows underneath.
        const LABEL_TOP_INSET = 0.07;
        const HEAD_HOVER_SCALE = 0.85; // headline shrinks slightly on hover
        zoneAnchors.forEach(za => {
          const cfg = za.cfg || {};
          let onEnter = () => {}, onLeave = () => {};
          if (cfg.head) {
            // The nudge lives on the label group, but is only applied while
            // hovered — rest keeps translate(0,0) so the headline stays centred.
            const labelG = detailGroup.append("g")
              .attr("class", "subzone-label-art")
              .datum(za)
              .style("pointer-events", "none")
              .attr("transform", "translate(0,0)");
            const nudge = { x: 0, y: 0, hovered: false };
            const setNudge = (dxf, dyf) => {
              // The label itself doesn't rotate, but "left/right, up/down" in
              // the settings sliders is defined relative to the ARTWORK, so
              // the nudge vector goes through the same rotation as every
              // other art-derived coordinate (o2RotateVec — a vector, not a
              // point, so no translation term).
              const v = o2RotateVec(dxf * imgBox.w, dyf * imgBox.h);
              nudge.x = v.x; nudge.y = v.y;
              // Live-apply while tuning, but only if this zone is showing.
              if (nudge.hovered) labelG.interrupt().attr("transform", `translate(${nudge.x},${nudge.y})`);
            };
            setNudge(settings[`sz${artL}ldx${za.index}`] ?? cfg.labelDx ?? 0,
                     settings[`sz${artL}ldy${za.index}`] ?? cfg.labelDy ?? 0);
            labelSetters[za.index] = setNudge;
            // Rest: headline at full size, centred in the blob.
            const hw = cfg.head.w * labelUnit, hh = cfg.head.h * labelUnit;
            const restY = za.y - hh / 2;
            // Hover: headline shrinks and tucks just under the blob's top edge,
            // with the body sitting balanced on the blob's face below it.
            const hw2 = hw * HEAD_HOVER_SCALE, hh2 = hh * HEAD_HOVER_SCALE;
            const blobH = Math.max(1, za.botY - za.topY);
            const hoverY = za.topY + LABEL_TOP_INSET * blobH;
            let bodyImg = null;
            if (cfg.body) {
              const bw = cfg.body.w * labelUnit * BODY_SCALE, bh = cfg.body.h * labelUnit * BODY_SCALE;
              const gap = LABEL_GAP * labelUnit;
              bodyImg = labelG.append("image")
                .attr("href", cfg.body.src).attr("xlink:href", cfg.body.src)
                .attr("x", za.x - bw / 2).attr("y", hoverY + hh2 + gap)
                .attr("width", bw).attr("height", bh)
                .attr("preserveAspectRatio", "xMidYMid meet")
                .style("opacity", 0);
            }
            const headImg = labelG.append("image")
              .attr("href", cfg.head.src).attr("xlink:href", cfg.head.src)
              .attr("x", za.x - hw / 2).attr("y", restY)
              .attr("width", hw).attr("height", hh)
              .attr("preserveAspectRatio", "xMidYMid meet");
            onEnter = () => {
              nudge.hovered = true;
              labelG.interrupt().transition().duration(180)
                .attr("transform", `translate(${nudge.x},${nudge.y})`);
              headImg.interrupt().transition().duration(180)
                .attr("x", za.x - hw2 / 2).attr("y", hoverY)
                .attr("width", hw2).attr("height", hh2);
              if (bodyImg) bodyImg.interrupt().transition().duration(180).style("opacity", 1);
            };
            onLeave = () => {
              nudge.hovered = false;
              labelG.interrupt().transition().duration(180)
                .attr("transform", "translate(0,0)");
              headImg.interrupt().transition().duration(180)
                .attr("x", za.x - hw / 2).attr("y", restY)
                .attr("width", hw).attr("height", hh);
              if (bodyImg) bodyImg.interrupt().transition().duration(180).style("opacity", 0);
            };
          }
          // Hovering a sub-zone dims every OTHER sub-zone label (this one stays
          // bright), the same focus cue a node gets. Selects from the root svg,
          // NOT the closure's detailGroup: renderDetail can re-run (retuneArc)
          // and leave this closure holding a stale, detached detailGroup whose
          // selectAll finds nothing — the svg root never goes stale. Sub-zone
          // names are unique across all four themes, so matching by name also
          // dims other themes' labels, matching a focused node's reach.
          // Opacity is a plain inline set that .subzone-label-art's CSS
          // transition animates (a d3 named transition proved unreliable here).
          const dimOthers = () => {
            svg.selectAll("g.subzone-label-art")
              .style("opacity", z => (z && z.name === za.name) ? 1 : DIM_ZONE_LABEL);
          };
          const undimAll = () => {
            svg.selectAll("g.subzone-label-art").style("opacity", 1);
          };
          detailGroup.append("circle")
            .attr("cx", za.x).attr("cy", za.y).attr("r", za.r)
            .attr("fill", "transparent").style("pointer-events", "auto").style("cursor", "pointer")
            .on("mouseenter", () => { linkSel.attr("stroke-opacity", l => l.target === za ? 0.95 : 0.1); dimOthers(); onEnter(); })
            .on("mouseleave", () => { linkSel.attr("stroke-opacity", 0.5); undimAll(); onLeave(); });
        });
      }

      // Published now the label groups exist (created in the loop above).
      // Selecting rather than array-collecting so a retuneArc re-render, which
      // rebuilds these groups, is picked up by the next setEmphasis read.
      zoneLabelSel = detailGroup.selectAll("g.subzone-label-art");

      // Tiny dot marking each sub-zone's pin (attach) point, where its
      // connectors terminate. Moves live when the attach point is tuned.
      const pinDots = detailGroup.selectAll("circle.zone-pin").data(zoneAnchors).join("circle")
        .attr("class", "zone-pin")
        .attr("cx", d => d.ax).attr("cy", d => d.ay).attr("r", base * 0.009)
        .attr("fill", chart.color).style("pointer-events", "none");

      // Task 2: the "detail" project nodes (their own icon/label/card, own
      // drag, own force sim — dNodes/nodeSel above) are gone. The master
      // node set (rendered once, in the panel's own nodeLayer/labelLayer/
      // infoCards below) is now the only node UI on screen; this sub-zone
      // map only draws the zone connectors reaching for it (linkSel above)
      // and the pin dots they terminate at.

      // Zoom frames the whole composition (artwork + the Node Area cluster).
      // The artwork's own footprint is measured post-rotation (the 4 corners
      // through o2ToGlobal), not the raw unrotated imgBox — otherwise a
      // rotated arc's actual on-screen extent would be under-measured.
      if (art) {
        const naR = base * 0.65;
        const corners = [o2ToGlobal(0, 0), o2ToGlobal(1, 0), o2ToGlobal(0, 1), o2ToGlobal(1, 1)];
        const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
        const left = Math.min(Math.min(...xs), nodeAreaX - naR);
        const right = Math.max(Math.max(...xs), nodeAreaX + naR);
        const top = Math.min(Math.min(...ys), nodeAreaY - naR);
        const bottom = Math.max(Math.max(...ys), nodeAreaY + naR);
        detailCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
        detailExtent = 0.5 * Math.max(right - left, bottom - top) + base * 0.05;
      } else {
        detailCenter = { x: gcx, y: gcy };
        detailExtent = ringR + base * 0.42;
      }

      // Live tuning hooks used by the settings panel — routed through the
      // same o2ToGlobal/o2RotateVec affine as everything else above, so the
      // sliders stay correct on a rotated arc instead of drifting off it.
      if (art) {
        detailControls = {
          letter: artL,
          art,
          zoneNames: zones.map(z => z.name),
          // The angle theta would have if the "Arc rotation" slider (Task
          // 2.5) has never been touched — the slider's own default value, so
          // an untuned theme still shows the correct (not 0°) rotation.
          defaultRot: computedTheta,
          setAttach(i, xf, yf) {
            const za = zoneAnchors[i];
            if (!za) return;
            const p = o2ToGlobal(xf, yf);
            za.ax = p.x; za.ay = p.y;
            linkSel.attr("d", connPath);
            pinDots.attr("cx", d => d.ax).attr("cy", d => d.ay);
          },
          // Nudge a zone's label (headline + body together) in its HOVER state
          // only — rest stays centred. Independent of setAttach, which moves
          // the connector pin dot.
          setLabelOffset(i, dxf, dyf) {
            const set = labelSetters[i];
            if (set) set(dxf, dyf);
          },
          // Task 2: this used to retarget a separate "detail" node
          // simulation that no longer exists (dNodes/sim, removed above) —
          // now it moves the MASTER node cluster's home point instead (see
          // clusterCenter/centerForce/xForce/yForce declared further down,
          // below `simulation`). Those are `const` bindings further down in
          // this same function, but this closure is only ever CALLED later,
          // via the settings-panel slider, by which point they're assigned.
          setNodeArea(xf, yf) {
            const p = o2ToGlobal(xf, yf);
            clusterCenter.x = p.x - x;
            clusterCenter.y = p.y - y;
            centerForce.x(clusterCenter.x).y(clusterCenter.y);
            xForce.x(clusterCenter.x);
            yForce.y(clusterCenter.y);
            simulation.alpha(0.5).restart();
          }
        };
      }
    }
    renderDetail();

    const localLinkLayer = inner.append("g")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.45);
    const localLabelLayer = inner.append("g");
    const nodeLayer = inner.append("g");
    const labelLayer = inner.append("g");

    // Bias the containment strength per axis to match the panel's own
    // aspect ratio, so the cluster settles into an oval that mirrors the
    // panel's own shape (landscape panel -> wide oval, portrait -> tall
    // oval) rather than a uniform circular scatter. A stronger pull on an
    // axis means *less* spread there (nodes held tighter to center), so
    // the axis with more room gets the weaker pull. Clamped so an extreme
    // aspect ratio doesn't collapse nodes onto a line.
    const panelAspect = layout.panelW / layout.panelH;
    const baseAxisStrength = 0.03;
    const forceXStrength = baseAxisStrength * Math.min(1.6, Math.max(0.6, 1 / panelAspect));
    const forceYStrength = baseAxisStrength * Math.min(1.6, Math.max(0.6, panelAspect));

    // Client feedback: nodes must not overlap ANY title badge, including a
    // neighbouring quadrant's. Hard constraint — any node whose icon would land
    // inside a rectangular "bumper" around a badge is pushed to that bumper's
    // nearest edge (inward velocity killed), guaranteeing a clear margin. Works
    // in global coords against every badge in badgeRegistry.
    const badgeBumperPad = 30 * layout.panelScale; // margin beyond the icon
    const badgeBumper = (() => {
      let ns;
      function force() {
        for (const d of ns) {
          if (d.fx != null || d.fy != null) continue; // leave a dragged node alone
          const half = (hasCard(d) ? 42 : sharedIds.has(d.id) ? 28 : 22) / 2 + badgeBumperPad;
          const ngx = x + d.x, ngy = y + d.y; // node centre in global coords
          for (const bz of badgeRegistry) {
            const hw = bz.halfW + half, hh = bz.halfH + half;
            const dx = ngx - bz.gx, dy = ngy - bz.gy;
            if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
              const px = hw - Math.abs(dx), py = hh - Math.abs(dy);
              // Move d out along its shortest exit (global delta == local delta,
              // panels are translate-only).
              if (px < py) { d.x += (dx >= 0 ? px : -px); d.vx = 0; }
              else { d.y += (dy >= 0 ? py : -py); d.vy = 0; }
            }
          }
        }
      }
      force.initialize = (n) => { ns = n; };
      return force;
    })();

    // Task 2: keeps master nodes from parking on top of the sub-zone arc's
    // painted band. Reads `arcAvoidZones` (each sub-zone blob's circle, in
    // this panel's local coords) fresh every tick via closure — renderDetail
    // recomputes that array on every arc-tune slider change (Task 2.5), so
    // this force stays correct live, without needing its own re-wiring.
    const arcAvoidPad = 16 * layout.panelScale;
    const arcAvoidForce = (() => {
      let ns;
      function force() {
        for (const d of ns) {
          if (d.fx != null || d.fy != null) continue; // leave a dragged node alone
          for (const za of arcAvoidZones) {
            const dx = d.x - za.x, dy = d.y - za.y;
            const minDist = za.r + arcAvoidPad;
            const dist = Math.hypot(dx, dy) || 0.001;
            if (dist < minDist) {
              const push = minDist - dist;
              d.x += (dx / dist) * push;
              d.y += (dy / dist) * push;
              d.vx = (d.vx || 0) * 0.5;
              d.vy = (d.vy || 0) * 0.5;
            }
          }
        }
      }
      force.initialize = (n) => { ns = n; };
      return force;
    })();

    // Named consts (not inline) so detailControls.setNodeArea — a closure
    // defined earlier, in renderDetail — can retarget them live when the
    // legacy "Node Area" slider moves the cluster's home point.
    const centerForce = d3.forceCenter(clusterCenter.x, clusterCenter.y);
    const xForce = d3.forceX(clusterCenter.x).strength(forceXStrength);
    const yForce = d3.forceY(clusterCenter.y).strength(forceYStrength);
    // Task 2: node icons/cards used to have the whole ~600px-square quadrant
    // to spread into; the sub-zone arc (now living IN the quadrant, see
    // renderDetail) eats a chunk of that, so the old 112px collide radius
    // for carded nodes pushed them straight out past the panel edge. Tuned
    // down to leave room for both — needs a final visual pass once the
    // arc's own scale/position sliders (Task 2.5) are dialed in per theme,
    // since the two interact (a smaller arc frees up more room here).
    const CARD_COLLIDE_R = 70;
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(235 * layout.panelScale).strength(0.2))
      .force("charge", d3.forceManyBody().strength(-105 * layout.panelScale))
      .force("center", centerForce)
      .force("collide", d3.forceCollide().radius(d => {
        const base = hasCard(d) ? CARD_COLLIDE_R : (sharedIds.has(d.id) ? 10 : 22);
        return base * layout.panelScale;
      }))
      .force("x", xForce)
      .force("y", yForce)
      // Pushes carded/id nodes off each sub-zone blob's footprint so they
      // don't sit on top of the arc's painted band (see arcAvoidZones,
      // renderDetail above).
      .force("arcAvoid", arcAvoidForce)
      // Registered last so its position clamp is the final word each tick,
      // not overwritten by the centering forces before the frame renders.
      .force("badgeBumper", badgeBumper);

    // Option 2 draws no badge -> node spokes. The live map fans a dashed line
    // from the badge to every node in its quadrant; here the badge sits on its
    // own arc and the nodes cluster inside it, so 34 spokes only crowded the
    // artwork. Bound to an empty array rather than deleted so the tick handler
    // below (and the label machinery, which is data-driven and currently has
    // no labelled local links) keeps working untouched.
    const localLinks = localLinkLayer.selectAll("line")
      .data([])
      .join("line");

    const localLabelGroups = localLabelLayer.selectAll("g.local-link-label")
      .data(links)
      .join("g")
      .attr("class", "local-link-label")
      .attr("display", d => (showLocalLabels && d.label?.trim()) ? null : "none");

    localLabelGroups.append("path").attr("class", "label-swipe");

    localLabelGroups.append("text")
      .attr("font-size", 10)
      .attr("font-weight", 600)
      .attr("fill", "#334155")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .text(d => d.label || "");

    // Mobile chooser: the phone overview shows only badges + node icons, so a
    // quadrant reads as something to tap rather than something to decipher.
    let chooserMode = false;
    // Icons are sized for a desktop viewport. A phone views the same geometry
    // through a much smaller window, so they come out oversized relative to the
    // labels beside them — trim them. Applied inside nodeSize because render()
    // positions each icon from the same function (x = d.x - nodeSize/2), so
    // scaling only width/height would leave every icon off-centre by half the
    // difference.
    const MOBILE_NODE_SCALE = isSmallScreen() ? 0.6 : 1;
    const nodeSize = d => (hasCard(d) ? 42 : sharedIds.has(d.id) ? 28 : 22)
      * MOBILE_NODE_SCALE;

    const node = nodeLayer
      .selectAll("image.node-icon")
      .data(nodes)
      .join("image")
      .attr("class", "node-icon")
      .attr("href", d => d.icon)
      .attr("xlink:href", d => d.icon)
      .attr("width", d => nodeSize(d))
      .attr("height", d => nodeSize(d))
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("display", d => hasCard(d) ? null : "none")
      .style("cursor", "pointer");

    // Wrapped in its own group (like the cross-link/local-link labels)
    // rather than positioned by attrs directly on <text> — a <tspan> with
    // an explicit x (needed for each wrapped line to start at the same
    // horizontal spot) is positioned in absolute coordinates, ignoring
    // the parent <text>'s own x/y, so per-node positioning has to happen
    // via a translate on a wrapping <g> instead.
    const labelGroupsNode = labelLayer.selectAll("g.node-id")
      .data(nodes)
      .join(enter => {
        const g = enter.append("g")
          .attr("class", "node-id")
          .attr("display", d => hasCard(d) ? null : "none")
          .style("pointer-events", "none");

        const text = g.append("text")
          .attr("class", "poppins")
          .attr("font-size", settings.nodeLabelFontSize)
          .attr("font-weight", 500)
          .attr("fill", "#334155")
          .attr("text-anchor", "middle")
          .style("paint-order", "stroke")
          .style("stroke", "#F2F1ED")
          .style("stroke-width", "3px")
          .style("stroke-linejoin", "round");

        return g;
      });

    // Label text is static per node, so wrap once up front instead of
    // re-wrapping (removing/recreating tspans) on every render frame —
    // refreshNodeLabels() below re-runs this only when the max-width
    // setting actually changes.
    function refreshNodeLabels() {
      labelGroupsNode.select("text")
        .attr("font-size", settings.nodeLabelFontSize)
        .each(function(d) {
          wrapTextTspans(d3.select(this), d.id, settings.nodeLabelMaxChars, settings.nodeLabelFontSize * 1.1, "bottom");
        });
    }
    refreshNodeLabels();
    const labels = labelGroupsNode;

    // Shared by the tick's positioning and the hover/pin emphasis below: the
    // label group is translated to its node, then scaled by a per-node
    // emphasis factor (1 normally, larger when the node is a neighbour of the
    // focused node). Kept in one place so a running simulation's tick and an
    // emphasis transition write the same transform string instead of fighting.
    const NEIGHBOR_LABEL_SCALE = 1.5;
    // Faded stroke-opacity for the node->sub-zone connectors that don't belong
    // to the focused node (their normal opacity is 0.5).
    const DIM_ZONE_LINK = 0.08;
    // Faded opacity for sub-zone headline labels a focused node isn't tied to.
    const DIM_ZONE_LABEL = 0.15;
    function labelTransform(d) {
      return `translate(${d.x},${d.y - nodeSize(d) / 2 - 5}) scale(${d.__labelScale ?? 1})`;
    }

    const cardNodes = nodes.filter(hasCard);

    const cardLeaders = labelLayer.selectAll("path.card-leader")
      .data(cardNodes)
      .join("path")
      .attr("class", "card-leader")
      .attr("fill", "none")
      .attr("stroke", chart.color)
      .attr("stroke-opacity", 0)
      .attr("stroke-width", 1.1)
      .attr("stroke-linecap", "round")
      .attr("pointer-events", "none");

    const infoCards = labelLayer.selectAll("foreignObject.node-card")
      .data(cardNodes)
      .join("foreignObject")
      .attr("class", "node-card")
      .attr("width", card.w)
      .attr("height", card.h)
      .style("overflow", "visible")
      .style("pointer-events", "none")
    .style("opacity", 0)
      // Part of the hover-intent bridge (see scheduleClear): while a linked
      // card is focused it's pointer-events:auto, so hovering it cancels the
      // pending hide and keeps it up long enough to click; leaving re-arms it.
      // These only fire for the focused card since the rest stay
      // pointer-events:none.
      .on("mouseenter", () => cancelClear())
      .on("mouseleave", () => scheduleClear());

    infoCards.append("xhtml:div").html(d => cardHTML(d, chart));

    // Clamp to the overall visible canvas (in this panel's local
    // coordinates, hence the +/- x,y — the panel's own global offset)
    // rather than letting the fixed offset push the card off-screen on a
    // small panel. Accepts an optional actual-height override so a card
    // that's been individually measured (see measureCardHeights below)
    // clamps against its own real size instead of the generic estimate.
    // These two themes place the card to the RIGHT of the node instead of the
    // left (their arcs/labels sit to the node's left, so a left card collides).
    const CARD_RIGHT = chart.id === "Regenerative Landscapes" || chart.id === "Healthy Oceans";
    function clampedCardPos(d, hOverride) {
      const h = hOverride ?? card.h;
      // Cards are auto-width (fit-content, capped at card.w) and get their
      // real width measured into d.__cardW below; fall back to card.w before
      // that first measurement.
      const w = d.__cardW ?? card.w;
      // Right-side placement mirrors the card across the node: the same node-to-
      // card gap, on the other side. card.offsetX is negative (left), so
      // -offsetX - w lands the card's left edge symmetrically to the right.
      const offX = CARD_RIGHT ? (-card.offsetX - w) : card.offsetX;
      return {
        x: Math.max(-x, Math.min(d.x + offX, layout.width - x - w)),
        y: Math.max(-y, Math.min(d.y + card.offsetY, layout.height - y - h))
      };
    }

    // Leader line as a gentle curve (matching the organic cross-links) from
    // the card's centre to the node. Anchoring at the centre (rather than the
    // nearest corner) gives a single stable attach point, so the line doesn't
    // hop between corners as the node moves; the card paints on top, so the
    // segment overlapping the card is hidden and the line reads as emerging
    // from behind it.
    const LEADER_CURVE = 0.16; // arc height as a fraction of the line's length
    function leaderPath(d) {
      const w = d.__cardW ?? card.w;
      const h = d.__cardH ?? card.h;
      const pos = clampedCardPos(d, h);
      const ax = pos.x + w / 2;
      const ay = pos.y + h / 2;
      const nx = d.x, ny = d.y;
      const dx = nx - ax, dy = ny - ay;
      const len = Math.hypot(dx, dy) || 1;
      const cx = (nx + ax) / 2 + (-dy / len) * len * LEADER_CURVE;
      const cy = (ny + ay) / 2 + (dx / len) * len * LEADER_CURVE;
      return `M${ax},${ay} Q${cx},${cy} ${nx},${ny}`;
    }

    // iOS Safari's foreignObject clips content to its declared height
    // regardless of `overflow: visible` (a known WebKit quirk) — a card
    // with a long label wraps to more lines than the fixed height budgets
    // for, and the bottom (often the stage pill) gets silently cut off.
    // Rather than trust overflow to save an undersized box, measure each
    // card's actual rendered content and size the foreignObject to match
    // exactly — and re-clamp its position against that real height too,
    // since a taller-than-estimated card could otherwise still hang off
    // the canvas edge even though it's no longer internally clipped.
    //
    // This needs to run more than once: it runs while the SVG may still
    // be detached from the document (offsetHeight reads 0 there, same
    // issue as the bbox/hub measurements elsewhere in this file), *and*
    // the Poppins font used inside the card loads from an external
    // Typekit stylesheet — if that hasn't finished loading yet, the
    // browser measures with a fallback font, locks in the wrong height,
    // and the real font swaps in afterward without ever re-measuring.
    // document.fonts.ready plus a couple of delayed fallbacks covers
    // both a slow font fetch and any other late reflow.
    function measureCardHeights() {
      infoCards.each(function(d) {
        const wrapperEl = this.firstElementChild;      // fills the foreignObject
        const cardEl = wrapperEl && wrapperEl.firstElementChild; // the fit-content card
        // offsetWidth/offsetHeight are the exact, cheap path — but they resolve
        // against offsetParent, and WebKit leaves offsetParent null inside a
        // <foreignObject>, so they report 0 there. Unguarded, that skips the
        // measurement below and strands every card at its default size in
        // Safari. getBoundingClientRect() has no offsetParent dependency and
        // works everywhere; it just reports *screen* pixels, so the map's zoom
        // has to be divided back out to get user units.
        const userUnits = (el) => {
          const ctm = this.getScreenCTM();
          const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
          if (!(scale > 0)) return { w: 0, h: 0 };
          const r = el.getBoundingClientRect();
          return { w: r.width / scale, h: r.height / scale };
        };
        let measuredH = wrapperEl ? wrapperEl.offsetHeight : 0;
        let measuredW = cardEl ? cardEl.offsetWidth : 0;
        if (!measuredH && wrapperEl) measuredH = userUnits(wrapperEl).h;
        if (!measuredW && cardEl) measuredW = userUnits(cardEl).w;
        if (measuredH > 0) {
          const h = measuredH + 4;
          const w = measuredW > 0 ? measuredW : card.w;
          d.__cardW = w;
          d.__cardH = h; // real height, used to anchor the leader line
          const g = d3.select(this);
          g.attr("height", h).attr("width", w);
          const pos = clampedCardPos(d, h);
          g.attr("x", pos.x).attr("y", pos.y);
        }
      });
      // The card may have been repositioned above (real-height clamp), so
      // re-draw the leaders to stay attached — the tick has usually stopped
      // by the time this runs.
      cardLeaders.attr("d", leaderPath);
    }
    measureCardHeights();
    requestAnimationFrame(measureCardHeights);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measureCardHeights);
    }
    setTimeout(measureCardHeights, 400);
    setTimeout(measureCardHeights, 1800);

    const density = d3.contourDensity()
      .x(d => d.x)
      .y(d => d.y)
      .size([layout.panelW, layout.panelH]);

    const path = d3.geoPath();

    function renderDensity() {
      density.bandwidth(settings.bandwidth).thresholds(settings.thresholds);
      densityLayer.selectAll("path")
        .data(density(nodes))
        .join("path")
        .attr("d", path)
        .attr("fill", chart.color)
        .attr("fill-opacity", 0.07)
        .attr("stroke", "none");
    }

    function render() {
      // Badge position first — local links fan out from here, so this has
      // to be current before anything else references titleState. Ease
      // toward the fixed corner on load, but once the user has dragged it,
      // track the cursor exactly — easing a drag makes it feel laggy.
      if (badgeOverride) {
        titleState.x = badgeOverride.x;
        titleState.y = badgeOverride.y;
      } else {
        easePosition(titleState, {titleX: cornerTarget.x, titleY: cornerTarget.y}, 0.18);
      }

      const badgeX = titleState.x - badgeW / 2;
      const badgeY = titleState.y - badgeH / 2;

      // Keep this badge's global bumper zone current (it may have been dragged,
      // and its size follows the per-theme badge scale so nodes keep clear of
      // the badge at whatever size it is actually drawn).
      badgeZone.gx = x + titleState.x;
      badgeZone.gy = y + titleState.y;
      badgeZone.halfW = (badgeW / 2) * badgeUserScale;
      badgeZone.halfH = (badgeH / 2) * badgeUserScale;

      // Scale about the badge centre so it grows in place when soloed.
      //
      // In the phone chooser the badge IS the interface — there is nothing else
      // to read at that zoom — so it moves to the middle of its quadrant and
      // grows, then returns to its tuned corner spot at its normal size the
      // moment a theme is opened. Only the drawing moves: badgeZone (the node
      // keep-out) deliberately stays on the real position, so the node layout
      // does not reflow between the chooser and the view you tap into.
      const bx = chooserMode ? layout.panelW / 2 : titleState.x;
      const by = chooserMode ? layout.panelH / 2 : titleState.y;
      const bScale = soloBadgeScale * badgeUserScale
        * (chooserMode ? CHOOSER_BADGE_SCALE : 1);
      titleBadge.attr("transform",
        `translate(${bx},${by}) scale(${bScale}) translate(${-badgeW / 2},${-badgeH / 2})`);

      // Bent connector from the badge (global coords) to the closest edge of
      // the nearest sub-zone blob. Cubic with vertical tangents, matching the
      // in-zone connectors (see connPath in renderDetail).
      if (badgeConnector && zoneAnchorsRef && zoneAnchorsRef.length) {
        const bx = x + titleState.x, by = y + titleState.y;
        let best = zoneAnchorsRef[0], bestD = Infinity;
        for (const za of zoneAnchorsRef) {
          const d = Math.hypot(za.x - bx, za.y - by) - za.r; // distance to blob edge
          if (d < bestD) { bestD = d; best = za; }
        }
        const dx = bx - best.x, dy = by - best.y, len = Math.hypot(dx, dy) || 1;
        const ex = best.x + (dx / len) * best.r; // point on the blob edge, facing the badge
        const ey = best.y + (dy / len) * best.r;
        const my = (by + ey) / 2;
        badgeConnector.attr("d", `M${bx},${by}C${bx},${my} ${ex},${my} ${ex},${ey}`);
      }

      title
        .attr("x", badgeX + badgeW / 2)
        .attr("y", badgeY + badgeH / 2 + 6);

      // Fan out from the badge instead of an invisible center node — every
      // local link's source is the badge's current on-screen position.
      localLinks
        .attr("x1", titleState.x)
        .attr("y1", titleState.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      localLabelGroups
        .attr("transform", d => {
          const mx = (titleState.x + d.target.x) / 2;
          const my = (titleState.y + d.target.y) / 2;
          const dx = d.target.x - titleState.x;
          const dy = d.target.y - titleState.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          return `translate(${mx + nx * 10},${my + ny * 10})`;
        });

      localLabelGroups.each(function(d) {
        if (!d.label?.trim()) return;
        const g = d3.select(this);
        const t = g.select("text").node();
        if (!t) return;
        const b = cachedTextBBox(t, `local:${d.label}`);
        const w = b.width + 16;
        const h = b.height + 7;

        g.select(".label-swipe")
          .attr("d", markerSwipePath(0, 0, w, h))
          .attr("fill", "#f6e27a")
          .attr("fill-opacity", 0.92);
      });

      node
        .attr("x", d => d.x - nodeSize(d) / 2)
        .attr("y", d => d.y - nodeSize(d) / 2);

      labels
        .attr("transform", d => labelTransform(d));

      infoCards
        .attr("x", d => clampedCardPos(d, d.__cardH).x)
        .attr("y", d => clampedCardPos(d, d.__cardH).y);

      cardLeaders.attr("d", leaderPath);

      // Task 2: zone connectors now source from these SAME master nodes (see
      // renderDetail's `links`/connPath above), so they ride this same tick
      // instead of a separate detail-map simulation that no longer exists.
      if (zoneLinkSel) zoneLinkSel.attr("d", zoneConnPath);
    }

    function dragBehavior(simulation) {
      function dragstarted(event, d) {
        event.sourceEvent.stopPropagation();
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      function dragged(event, d) {
        d.fx = Math.max(12, Math.min(layout.panelW - 12, event.x));
        d.fy = Math.max(20, Math.min(layout.panelH - 12, event.y));
        render();
        renderDensity();
        requestCrossLinksUpdate();
        markCrossLinksActive();
        focusVisual(chart.id, d.id, {x: x + d.x, y: y + d.y});
      }
      function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        // Drag has no hover to end on, so mirror mouseleave: fall back to the
        // pinned node if one is pinned, otherwise clear.
        if (pinned) {
          focusVisual(pinned.chartId, pinned.nodeId, pinned.getPos());
        } else {
          clearVisual(d.id);
        }
      }
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    node
      .call(dragBehavior(simulation))
      .on("mouseenter", (event, d) => {
        // Hover is a transient preview — it shows a node's neighbourhood but
        // doesn't change what's pinned. Cancel any pending hide so moving
        // between nodes (or from the card back to a node) doesn't clear.
        cancelClear();
        // Moving straight from one node to another cancels the pending clear
        // above, so the node we are leaving never gets cleaned up and its
        // cross-link labels linger. Fade them now before showing the new node —
        // but not the pinned node's, whose neighbourhood should persist.
        // setNodeCrossLinksVisible already leaves click-pinned links alone.
        const prevHoverId = hoverFocus && hoverFocus.nodeId;
        if (prevHoverId != null && prevHoverId !== d.id
            && !(pinned && pinned.nodeId === prevHoverId)) {
          setNodeCrossLinksVisible(prevHoverId, null, false);
        }
        hoverFocus = {chartId: chart.id, nodeId: d.id, getPos: () => ({x: x + d.x, y: y + d.y})};
        focusVisual(chart.id, d.id, {x: x + d.x, y: y + d.y});
      })
      .on("mouseleave", () => {
        // Don't hide immediately — give the pointer time to reach the card
        // (see scheduleClear / the card handlers).
        scheduleClear();
      })
      .on("click", (event, d) => {
        // Tap/click pins a node's neighbourhood so it persists without a
        // hover (the only way to explore on touch), and lets you walk the
        // graph by tapping a connected node to re-focus on it. Tapping the
        // pinned node again — or empty canvas (see the svg click handler) —
        // clears it. d3-drag suppresses this click after a real drag, so
        // dragging a node to reposition it won't toggle the pin.
        event.stopPropagation();
        const key = `${chart.id}::${d.id}`;
        if (pinned && pinned.key === key) {
          const prev = pinned.nodeId;
          pinned = null;
          clearVisual(prev);
        } else {
          pinned = {
            key,
            chartId: chart.id,
            nodeId: d.id,
            getPos: () => ({x: x + d.x, y: y + d.y})
          };
          // Reset every other node's card + connections first, so clicking a
          // new node cannot leave a stale card or line from a previous focus
          // (or from hovering across nodes on the way there).
          resetNodeVisuals();
          focusVisual(chart.id, d.id, {x: x + d.x, y: y + d.y});
        }
      });

    let frame = 0;
    simulation.on("tick", () => {
      render();
      frame += 1;
      if (frame % 3 === 0) {
        renderDensity();
        requestCrossLinksUpdate();
        markCrossLinksActive();
      }
    });

    render();
    renderDensity();

    // Per-panel half of the focus interaction (driven by the global
    // focusVisual/clearVisual). Neighbours — nodes sharing a cross-link with
    // the focused node — get their id label scaled up and darkened; the
    // focused node shows its info card and hides its own now-redundant label;
    // every other node dims. Cards for neighbours no longer pop.
    function setEmphasis(focusKey, nbrKeys) {
      const keyOf = d => `${chart.id}::${d.id}`;
      node.interrupt().transition().duration(160)
        .attr("opacity", d => nbrKeys.has(keyOf(d)) ? 1 : 0.35);

      labels.each(function(d) {
        const k = keyOf(d);
        const isFocus = k === focusKey;
        const isNbr = nbrKeys.has(k);
        d.__labelScale = (isNbr && !isFocus) ? NEIGHBOR_LABEL_SCALE : 1;
        const g = d3.select(this).interrupt();
        g.transition().duration(160)
          .attr("transform", labelTransform(d))
          .style("opacity", isFocus ? 0 : (isNbr ? 1 : 0.3));
        g.select("text").interrupt().transition().duration(160)
          .attr("fill", (isNbr && !isFocus) ? "#0f172a" : "#334155")
          .attr("font-weight", (isNbr && !isFocus) ? 700 : 500);
      });

      // Dotted node -> sub-zone connectors: keep the focused node's own bright,
      // fade everyone else's (in every panel, since the focused node may live
      // in another one). zoneLinkSel is read live via closure, so it tracks the
      // current selection after a retuneArc re-render.
      if (zoneLinkSel) {
        zoneLinkSel.interrupt().transition().duration(160)
          .attr("stroke-opacity", l => keyOf(l.source) === focusKey ? 0.5 : DIM_ZONE_LINK);
      }

      // Dim the sub-zone headline labels the focused node isn't connected to.
      // A node only links to sub-zones in its own theme, so a focus in another
      // panel dims every label here. Named transition ("dimlabel") so it never
      // interrupts the head/body reveal that runs on labelG's default timeline.
      if (zoneLabelSel) {
        const prefix = chart.id + "::";
        const focusNodeHere = focusKey.startsWith(prefix) ? focusKey.slice(prefix.length) : null;
        const related = new Set((focusNodeHere && zoneConns && zoneConns[focusNodeHere]) || []);
        // Inline opacity (CSS animates it, see .subzone-label-art) — matches the
        // sub-zone hover path so the two can't fight over the same property.
        zoneLabelSel.style("opacity", za => related.has(za.name) ? 1 : DIM_ZONE_LABEL);
      }

      infoCards.interrupt().transition().duration(180)
        .style("opacity", d => keyOf(d) === focusKey ? 1 : 0);
      // Only the focused card, and only if it links somewhere, accepts clicks —
      // otherwise invisible cards would intercept clicks over their footprint.
      infoCards.style("pointer-events", d => (keyOf(d) === focusKey && d.url) ? "auto" : "none");
      cardLeaders.interrupt().transition().duration(180)
        .attr("stroke-opacity", d => keyOf(d) === focusKey ? 0.5 : 0);
    }

    function clearEmphasis() {
      node.interrupt().transition().duration(160).attr("opacity", 1);
      labels.each(function(d) {
        d.__labelScale = 1;
        const g = d3.select(this).interrupt();
        g.transition().duration(160)
          .attr("transform", labelTransform(d))
          .style("opacity", 1);
        g.select("text").interrupt().transition().duration(160)
          .attr("fill", "#334155")
          .attr("font-weight", 500);
      });
      infoCards.interrupt().transition().duration(160).style("opacity", 0);
      infoCards.style("pointer-events", "none");
      cardLeaders.interrupt().transition().duration(160).attr("stroke-opacity", 0);
      if (zoneLinkSel) {
        zoneLinkSel.interrupt().transition().duration(160).attr("stroke-opacity", 0.5);
      }
      if (zoneLabelSel) {
        zoneLabelSel.style("opacity", 1);
      }
    }

    return {
      chart,
      index,
      root: panel,
      detailGroup,
      nodeLayer,  // for detailFitTransform's small-screen bbox, see below
      titleLayer, // same — the badge has to be inside the frame it pans to
      // Getters (not plain values) — Task 2.5's arc-tune sliders call
      // retuneArc() below, which re-runs renderDetail() and reassigns the
      // OUTER detailCenter/detailExtent/detailControls variables; a plain
      // value here would have frozen at whatever they were when makePanel
      // first returned, going stale the first time a slider moves.
      get detailCenter() { return detailCenter; },
      get detailExtent() { return detailExtent; },
      get detailControls() { return detailControls; },
      nodes,
      node,
      labels,
      infoCards,
      cardLeaders,
      localLabelGroups,
      renderDensity,
      refreshNodeLabels,
      setEmphasis,
      clearEmphasis,
      // Re-run the sub-zone artwork build (Task 2.5's live arc sliders) and
      // refresh the panel once so anything not driven by the tick loop
      // (e.g. the badge-to-blob connector) reflects the new geometry too.
      retuneArc() { renderDetail(); render(); },
      badgeLetter: badgeArtL,
      // Chooser mode hides this panel's node labels and shrinks its icons; the
      // badge stays untouched (it is the tap target). Re-applies width/height
      // because those are set once at join, then re-renders so the positions
      // follow the new size.
      setChooserMode(on) {
        chooserMode = on;
        node.attr("width", d => nodeSize(d)).attr("height", d => nodeSize(d));
        labelGroupsNode.attr("display", d => (hasCard(d) && !on) ? null : "none");
        render();
      },
      // v is the designer's tuned badgeSize; re-apply the phone multiplier so
      // dragging the slider does not silently drop it.
      setBadgeScale2(v) { badgeUserScale = v * MOBILE_BADGE_SCALE; render(); },
      // Slider-driven twin of the drag gesture — same badgeOverride, clamped
      // the same way so the badge can never be parked outside its panel.
      setBadgePos(fx, fy) {
        badgeOverride = {
          x: Math.max(badgeW / 2, Math.min(layout.panelW - badgeW / 2, fx * layout.panelW)),
          y: Math.max(badgeH / 2, Math.min(layout.panelH - badgeH / 2, fy * layout.panelH))
        };
        render();
      },
      // Where the badge actually sits now, as panel fractions — used to seed the
      // sliders (and the copy button) whether it was placed by drag or slider.
      badgePosFractions() {
        return { x: titleState.x / layout.panelW, y: titleState.y / layout.panelH };
      },
      setBadgeScale(s) { soloBadgeScale = s; render(); },
      // Focus dimming when a badge is clicked:
      //  'off'     -> overview, everything at full opacity
      //  'focused' -> this soloed theme: everything of ITS OWN stays bright
      //  'dim'     -> a non-focused theme: content, badge and detail all dim
      //
      // The live map dims `inner` (this panel's nodes + labels) on 'focused'
      // too, because there the sub-zone detail map lives OUTSIDE the overview:
      // zooming to it meant the master cluster was leftover background. Option 2
      // moved the artwork into the quadrant, so the nodes sit inside the arc you
      // just zoomed into — dimming them hides the very thing being focused.
      setFocus(state) {
        const DIM = 0.12;
        inner.interrupt().transition().duration(500)
          .style("opacity", state === "dim" ? DIM : 1);
        // Moved out of `inner` (it lives under the artwork now), so it needs
        // dimming explicitly or a non-focused theme keeps a bright wash.
        densityLayer.interrupt().transition().duration(500)
          .style("opacity", state === "dim" ? DIM : 1);
        titleLayer.interrupt().transition().duration(500)
          .style("opacity", state === "dim" ? DIM : 1);
        detailGroup.interrupt().transition().duration(600)
          .style("opacity", state === "dim" ? DIM : 1);
      },
      x0: x,
      y0: y
    };
  }

  function relatedCrossNodeKeys(chartId, nodeId) {
    const keys = new Set([`${chartId}::${nodeId}`]);
  
    crossLinks.forEach(l => {
      const a = `${l.source.chart}::${l.source.node}`;
      const b = `${l.target.chart}::${l.target.node}`;
  
      if (a === `${chartId}::${nodeId}`) keys.add(b);
      if (b === `${chartId}::${nodeId}`) keys.add(a);
    });
  
    return keys;
  }

  // Hover previews a node's neighbourhood; a click pins it (see the node
  // handlers in makePanel). Both drive the same visual through every panel's
  // setEmphasis: the focused node's card shows, its cross-link-connected
  // nodes' labels scale up, everything else dims, and the relationship curves
  // touching it reveal. The neighbourhood is exactly the cross-link set —
  // in-panel links are a hidden hub-and-spoke, so they carry no adjacency.
  let pinned = null; // { key, chartId, nodeId, getPos } | null

  // Hover-intent bridge: the card sits offset from its node with a gap between
  // them, so leaving the node to reach the card would normally hide it before
  // the pointer arrives. Instead of clearing immediately on node-mouseleave we
  // schedule the clear after a short grace period; moving onto the card (which
  // is pointer-events:auto while focused) cancels it, so hover → glide to card
  // → click "View project" is one gesture. Moving to another node also cancels
  // (its mouseenter re-focuses). Falls back to the pinned node, or clears.
  const HOVER_GRACE_MS = 220;
  let hideTimer = null;
  let hoverFocus = null; // { chartId, nodeId, getPos } currently previewed via hover

  function cancelClear() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleClear() {
    cancelClear();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      const prevId = hoverFocus ? hoverFocus.nodeId : null;
      if (pinned) {
        if (prevId != null && prevId !== pinned.nodeId) setNodeCrossLinksVisible(prevId, null, false);
        focusVisual(pinned.chartId, pinned.nodeId, pinned.getPos());
      } else {
        clearVisual(prevId);
      }
      hoverFocus = null;
    }, HOVER_GRACE_MS);
  }

  function focusVisual(chartId, nodeId, canvasPos) {
    const focusKey = `${chartId}::${nodeId}`;
    const nbrKeys = relatedCrossNodeKeys(chartId, nodeId); // includes focusKey
    panels.forEach(panel => panel.setEmphasis(focusKey, nbrKeys));

    // Swap the top-left bubble + legend character to this node's entry point,
    // so focusing a node reads as being "in" its theme. setChrome no-ops if the
    // chrome is already that theme, so this is cheap on every hover/drag tick.
    setChrome(chartId);

    setNodeCrossLinksVisible(nodeId, canvasPos, true);
    linkOverlay.selectAll("g.cross-link").each(function(d) {
      const active = d.sourceNode === nodeId || d.targetNode === nodeId;
      d3.select(this).attr("opacity", active ? 1 : 0.14);
    });
  }

  function clearVisual(prevNodeId) {
    panels.forEach(panel => panel.clearEmphasis());
    if (prevNodeId != null) setNodeCrossLinksVisible(prevNodeId, null, false);
    linkOverlay.selectAll("g.cross-link").attr("opacity", 1);
    // Restore whatever chrome was showing before the node focus overrode it.
    setChrome(baseChrome);
  }

  // Hard reset of every transient node visual, used when a NEW node is clicked
  // so nothing from a previous focus lingers. clearVisual only unwinds one
  // known previous node; hovering across several nodes first can leave each of
  // their cross-links marked visible in hoveredCrossLinkKeys (a mouseleave
  // schedules the clear, the next mouseenter cancels it, so it never runs).
  // This clears all of them at once — including link-pins (pinnedCrossLinks,
  // from clicking a link directly) — plus any pending hide timer, then fades
  // every cross-link. Cards are handled by the focusVisual() that follows.
  function resetNodeVisuals() {
    cancelClear();
    hoverFocus = null;
    hoveredCrossLinkKeys.clear();
    pinnedCrossLinks.clear();
    setCrossLinkVisible(linkOverlay.selectAll("g.cross-link"), false);
  }

  function updateCrossLinks() {
    const lookup = new Map();

    panels.forEach(panel => {
      panel.nodes.forEach(d => {
        lookup.set(`${panel.chart.id}::${d.id}`, {
          x: panel.x0 + d.x,
          y: panel.y0 + d.y
        });
      });
    });

    hubs.forEach(h => {
      lookup.set(`hub::${h.id}`, hubPosition);
    });

    const connectors = crossLinks.map((d, i) => {
      const source = lookup.get(endpointKey(d.source));
      const target = lookup.get(endpointKey(d.target));
      if (!source || !target) return null;

      let sx = source.x;
      let sy = source.y;
      let tx = target.x;
      let ty = target.y;

      if (tx < sx) {
        [sx, tx] = [tx, sx];
        [sy, ty] = [ty, sy];
      }

      const curveDist = d.curveDist ?? 0.18;
      const baseCurve = crossCurveWithControl(sx, sy, tx, ty, curveDist);
      const mainPath = offsetQuadCurve(baseCurve, -2.28);
      const secondPath = offsetQuadCurve(baseCurve, 2.28);
      const swapped = tx !== target.x; // did we flip x1/x2 above?

      // Two candidate label spots, near each end of the curve — swap
      // accounted for, so "start" always maps back to the true source.
      const endOffsetT = Math.min(0.49, Math.max(0.01, settings.labelEndOffsetPct / 100));
      const nearStart = quadPoint(baseCurve.x1, baseCurve.y1, baseCurve.cx, baseCurve.cy, baseCurve.x2, baseCurve.y2, endOffsetT);
      const nearEnd = quadPoint(baseCurve.x1, baseCurve.y1, baseCurve.cx, baseCurve.cy, baseCurve.x2, baseCurve.y2, 1 - endOffsetT);
      const sourceEnd = swapped ? nearEnd : nearStart;
      const targetEnd = swapped ? nearStart : nearEnd;

      return {
        key: `${endpointKey(d.source)}->${endpointKey(d.target)}`,
        gradientId: `cross-grad-${i}`,
        sourceNode: d.source.node ?? d.source.hub,
        targetNode: d.target.node ?? d.target.hub,
        group: d.group,
        source,
        target,
        label: d.label || "",
        curveDist: d.curveDist,
        sourceColor: endpointColor(d.source),
        targetColor: endpointColor(d.target),
        mainPath,
        secondPath,
        sourceEnd,
        targetEnd
      };
    }).filter(Boolean);

    const groups = linkOverlay
      .selectAll("g.cross-link")
      .data(connectors, d => d.key)
      .join(enter => {
        const g = enter.append("g")
          .attr("class", "cross-link")
          .attr("fill", "none")
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round");

        // Wide, invisible stroke purely for hover/tap hit-testing — the
        // visible strokes are too thin (and too fiddly on touch) to hover
        // reliably otherwise.
        g.append("path")
          .attr("class", "hit")
          .attr("stroke", "transparent")
          .attr("stroke-width", 26)
          .style("pointer-events", "stroke")
          .style("cursor", "pointer");

        g.append("path").attr("class", "main").style("opacity", 0);
        g.append("path").attr("class", "secondary").style("opacity", 0);

        // Reveal is node-hover-driven only (see node.on("mouseenter")) —
        // clicking or tapping the line itself must never be what reveals
        // it from cold. On mobile there's no hover phase, so a tap fires
        // "click" directly — if the click handler pinned unconditionally,
        // tapping any invisible line would reveal it, which is exactly
        // the bug this guards against. A click only ever pins a link
        // that's already visible via a node hover; it keeps showing near
        // whichever end most recently triggered it (linkTriggerPosition
        // already has that).
        g.on("click", function(event, d) {
          event.stopPropagation();
          if (pinnedCrossLinks.has(d.key)) {
            pinnedCrossLinks.delete(d.key);
            if (!hoveredCrossLinkKeys.has(d.key)) setCrossLinkVisible(d3.select(this), false);
          } else if (hoveredCrossLinkKeys.has(d.key)) {
            pinnedCrossLinks.add(d.key);
            setCrossLinkVisible(d3.select(this), true);
          }
        });

        return g;
      });

    groups.each(function(d) {
      const g = d3.select(this);

      g.select(".hit").attr("d", d.mainPath);

      const grad = ensureGradient(
        d.gradientId,
        d.source.x, d.source.y,
        d.target.x, d.target.y,
        d.sourceColor, d.targetColor
      );

      if (brushStyle === "original") {
        g.select(".main")
          .attr("d", d.mainPath)
          .attr("stroke", grad)
          .attr("stroke-width", 3.2)
          // .attr("stroke-dasharray", "5,6")
          .attr("filter", null);

        g.select(".secondary")
          .attr("d", null)
          .attr("stroke", "none")
          .attr("filter", null);
      }

      if (brushStyle === "marker") {
        g.select(".main")
          .attr("d", d.mainPath)
          .attr("stroke", grad)
          .attr("stroke-width", 5.2)
          .attr("stroke-dasharray", null)
          .attr("filter", "url(#markerStroke)");

        g.select(".secondary")
          .attr("d", d.secondPath)
          .attr("stroke", grad)
          .attr("stroke-width", 2.1)
          .attr("stroke-dasharray", null)
          .attr("filter", "url(#markerStroke)");
      }

      if (brushStyle === "dry") {
        // Same widths/colors whether settled or not, so there's no visible
        // "pop" — only the noisy filtered edge switches on once still.
        g.select(".main")
          .attr("d", d.mainPath)
          .attr("stroke", grad)
          .attr("stroke-width", 5.8)
          .attr("stroke-opacity", 0.98)
          .attr("stroke-dasharray", null)
          .attr("filter", crossLinksSettled ? "url(#dryBrushStroke)" : null);

        g.select(".secondary")
          .attr("d", d.secondPath)
          .attr("stroke", grad)
          .attr("stroke-width", 3.2)
          .attr("stroke-opacity", 0.92)
          .attr("stroke-dasharray", null)
          .attr("filter", crossLinksSettled ? "url(#dryBrushStroke2)" : null);
      }

      // Keep opacity in sync with hover/pin state across re-renders (e.g.
      // while dragging a node whose link is pinned open).
      const linkVisible = isCrossLabelVisible(d.key) ? 1 : 0;
      g.select(".main").style("opacity", linkVisible);
      g.select(".secondary").style("opacity", linkVisible);
    });

    // Labels live in their own layer, appended after linkOverlay, so they
    // always render above every cross-link line regardless of which links
    // happen to be visible at once.
    const labelGroups = crossLabelLayer
      .selectAll("g.cross-label-group")
      .data(connectors, d => d.key)
      .join(enter => {
        const lg = enter.append("g")
          .attr("class", "cross-label-group")
          .attr("display", showCrossLabels ? null : "none")
          .style("opacity", 0)
          .style("pointer-events", "none");

        lg.append("path").attr("class", "label-swipe");

        lg.append("text")
          .attr("class", "cross-label")
          .attr("font-size", settings.crossLabelFontSize)
          .attr("font-weight", 700)
          .attr("fill", "#334155")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle");

        return lg;
      });

    labelGroups.each(function(d) {
      const lg = d3.select(this);

      // Show the label near whichever end is closest to the node that
      // most recently triggered this link's visibility. For a directly
      // touched link that's obviously its own end; for a link pulled in
      // via group-expansion (e.g. the third side of a triangle) the
      // trigger node isn't literally an endpoint, so pick geometrically.
      const trigger = linkTriggerPosition.get(d.key);
      let pos = d.sourceEnd;
      if (trigger) {
        const dSource = (trigger.x - d.sourceEnd.x) ** 2 + (trigger.y - d.sourceEnd.y) ** 2;
        const dTarget = (trigger.x - d.targetEnd.x) ** 2 + (trigger.y - d.targetEnd.y) ** 2;
        pos = dTarget < dSource ? d.targetEnd : d.sourceEnd;
      }

      lg.attr("display", (showCrossLabels && d.label?.trim()) ? null : "none")
        .attr("transform", `translate(${pos.x},${pos.y})`)
        .style("opacity", isCrossLabelVisible(d.key) ? 1 : 0);

      const textSel = lg.select(".cross-label");

      if (showCrossLabels && d.label?.trim()) {
        wrapTextTspans(textSel, d.label, settings.crossLabelMaxChars, settings.crossLabelFontSize * 1.1);

        const textNode = textSel.node();
        const bbox = cachedTextBBox(textNode, `cross:${d.label}`);
        const w = bbox.width + 18;
        const h = bbox.height + 0;

        lg.select(".label-swipe")
          .attr("d", markerSwipePath(0, 0, w, h))
          .attr("fill", "#D6EDD3")
          .attr("fill-opacity", 0.92);
      }
    });

    syncHubVisibility(connectors);
  }

  function renderHubs() {
    // Same visual language as a cross-link label — the .cross-label class
    // picks up the Contee script font from the stylesheet in cell _4, and
    // the swipe path is the same hand-drawn highlight shape used elsewhere.
    const hubGroups = hubLayer
      .selectAll("g.hub-node")
      .data(hubs, d => d.id)
      .join(enter => {
        const g = enter.append("g").attr("class", "hub-node").style("opacity", 0);
        g.append("path").attr("class", "label-swipe");
        g.append("text")
          .attr("class", "cross-label")
          .attr("font-size", settings.crossLabelFontSize)
          .attr("font-weight", 700)
          .attr("fill", "#D6EDD3")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle");
        return g;
      });

    hubGroups
      .attr("transform", `translate(${hubPosition.x},${hubPosition.y})`);

    hubGroups.each(function(d) {
      const g = d3.select(this);
      g.select(".cross-label").text(d.id);

      const textNode = g.select(".cross-label").node();
      const bbox = cachedTextBBox(textNode, `hub:${d.id}`);
      const w = bbox.width + 18;
      const h = bbox.height + 0;

      g.select(".label-swipe")
        .attr("d", markerSwipePath(0, 0, w, h))
        .attr("fill", hubColor)
        .attr("fill-opacity", 0.92);
    });
  }

  // Hub label only shows while one of its own connections is active (i.e.
  // a node it's linked to is hovered, or that link is pinned). This runs
  // on every settle/drag frame via updateCrossLinks(), so a plain style
  // set (not a fresh transition each time) avoids restarting mid-fade.
  function syncHubVisibility(connectors) {
    hubLayer.selectAll("g.hub-node").each(function(hub) {
      const visible = connectors.some(c =>
        (c.sourceNode === hub.id || c.targetNode === hub.id) && isCrossLabelVisible(c.key)
      );
      d3.select(this).style("opacity", visible ? 1 : 0);
    });
  }

  const zoom = d3.zoom()
    .scaleExtent([0.6, 3])
    .on("zoom", event => zoomLayer.attr("transform", event.transform));

  svg.style("cursor", "grab").call(zoom);
  svg.on("mousedown", () => svg.style("cursor", "grabbing"));
  svg.on("mouseup", () => svg.style("cursor", "grab"));
  svg.on("mouseleave", () => svg.style("cursor", "grab"));

  // Clicking empty canvas clears any pinned node. Guarded against pans: a
  // drag-to-pan ends in a click event too, so only a click with no
  // intervening zoom move counts. Node and cross-link clicks stopPropagation,
  // so they never reach here.
  // Only a *user* pan counts as a move — the initial centering (and any other
  // programmatic zoom.transform) fires zoom events with a null sourceEvent,
  // and must not leave zoomMoved stuck true or the first canvas click would
  // always be swallowed.
  let zoomMoved = false;
  zoom.on("start.pinclear", () => { zoomMoved = false; })
      .on("zoom.pinclear", (event) => { if (event.sourceEvent) zoomMoved = true; });
  svg.on("click.pinclear", (event) => {
    if (zoomMoved) { zoomMoved = false; return; }
    // A click that reaches the bare canvas (target is the svg itself — nodes,
    // badges, blob hit-targets all stopPropagation) returns to the master
    // overview when we're currently focused on a theme.
    if (event.target === svg.node() && currentChrome !== "master") {
      exitSolo();
    }
    if (pinned) {
      const prev = pinned.nodeId;
      pinned = null;
      clearVisual(prev);
    }
  });

  // Paint order from here down: density wash, then the sub-zone artwork, then
  // the panels (nodes/labels/cards). In the live map the detail maps sat
  // outside the quadrants so nothing overlapped and the order did not matter;
  // option 2 stacks all three in the same space, so the contour has to be its
  // own root BELOW the artwork rather than a child of each panel.
  const densityRoot = zoomLayer.append("g").attr("class", "density-root");
  const detailLayer = zoomLayer.append("g").attr("class", "detail-maps");
  // Cross-link labels sit ABOVE the artwork but BELOW the panels, so a focused
  // node's info card (in its panel) paints on top of them instead of being
  // covered by a "Partner with"/"Invested for" label. Created before the panel
  // loop for that stacking; still assigned to the outer `let crossLabelLayer`
  // so updateCrossLinks etc. reach it.
  crossLabelLayer = zoomLayer.append("g").attr("pointer-events", "none");

  charts.forEach((chart, index) => {
    panels.push(makePanel(chart, index));
  });

  // Bandwidth/thresholds changes need each panel's density re-rendered;
  // node-label max-width needs a re-wrap (it's normally wrapped once, not
  // every frame); cross-link max-width/end-offset flow through the next
  // updateCrossLinks() pass automatically since that already re-wraps
  // every cycle. Clearing the bbox cache covers both max-width settings —
  // a stale cached size from the old wrap width would otherwise stick.
  function refreshAllSettings() {
    labelBBoxCache.clear();
    panels.forEach(p => {
      p.renderDensity();
      p.refreshNodeLabels();
    });
    // Cross-link/hub label font-size is only set once at element creation,
    // not every render pass — update existing elements directly here.
    crossLabelLayer.selectAll(".cross-label").attr("font-size", settings.crossLabelFontSize);
    hubLayer.selectAll(".cross-label").attr("font-size", settings.crossLabelFontSize);
    requestCrossLinksUpdate();
    saveSettings();
  }

  renderHubs();
  updateCrossLinks();
  // Both calls above run while the SVG is still detached from the document
  // (Observable only attaches the returned node after this cell resolves),
  // so any getBBox() measurement they took is bogus. updateCrossLinks()
  // gets a second, correct pass for free via the crossLinksDirty timer
  // once dragging/settling happens — renderHubs() has no such follow-up,
  // so give it one explicitly once the node is actually on the page.
  requestAnimationFrame(renderHubs);

  // Center the (possibly capped, see settings.maxContentWPct/HPct above)
  // content cluster within the full-bleed canvas, with a small 0.92 scale-down for
  // breathing room from the edges either way.
  //
  // That 0.92 assumes the drawn cluster roughly fills contentW/contentH, which
  // holds on a landscape desktop. On a phone it does not: the content box
  // inherits the viewport's portrait aspect, so each panel is a ~139px-wide
  // sliver while the node spread (floored by layout.panelScale) stays ~2.4x
  // wider than its slot. The quadrants overlap and run off both edges, and
  // scaleExtent's 0.6 floor means you cannot even pinch out far enough to see
  // the whole map. So on small screens fit to what is actually drawn, rather
  // than to a content box the drawing does not respect.
  const OVERVIEW_FIT_PAD = 10;
  // Breathing room around a soloed quadrant. Generous because the fit is
  // measured from bboxes that do not know about the fixed chrome sitting on
  // top (the header bubble, the "Overview" pill, the legend character) — at a
  // tight pad the badge ends up flush against the edge or a few px behind it.
  const DETAIL_FIT_PAD = 28;
  // The scale the desktop map sits at. Phones reuse it when panning to a
  // soloed quadrant, so the artwork, labels and cards there are exactly the
  // size they were designed at rather than being fitted to a small screen.
  const DESKTOP_SCALE = 0.92;
  // getBBox() over `sel`, with anything matching `hideSel` dropped from the
  // measurement. display:none is what removes an element from getBBox —
  // opacity:0 does not, so invisible-but-laid-out things still count. Returns
  // null when there is no layout to measure yet.
  function measuredBBox(sel, hideSel) {
    const stashed = [];
    sel.selectAll(hideSel).each(function () {
      stashed.push([this, this.style.display]);
      this.style.display = "none";
    });
    let bb = null;
    try { bb = sel.node().getBBox(); } catch (e) { bb = null; }
    stashed.forEach(([el, prev]) => { el.style.display = prev; });
    return bb && bb.width > 0 && bb.height > 0 ? bb : null;
  }
  // Smallest rect containing both a and b (either may be null — the whole
  // point being callers don't have to null-check before combining). Used by
  // detailFitTransform below, since Task 2 moved the master node icons out
  // of detailGroup (they're the only node set now, not a "detail" copy), so
  // that fit needs two separate bboxes unioned instead of one.
  function unionBBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  function overviewBBox() {
    // The sub-zone artwork now lives IN each quadrant and is visible at rest
    // (no longer parked outside the overview), so it must count toward this
    // fit or the mobile auto-fit crops the arcs at the viewport edge. Still
    // drop the info cards (master's own, parked up-left of their nodes) and
    // the sub-zone hover cards/labels — all invisible at rest (opacity:0,
    // not display:none) but still laid out, so they'd otherwise inflate the
    // measurement.
    // The density wash spreads a long way past the nodes it is drawn from
    // (624x613 units vs ~377 for the panels themselves), so in chooser mode —
    // where it is the only thing left besides badges and icons — it would drag
    // the fit down to ~0.57 and leave the badges too small to tap. It is
    // background texture and already bleeds off-screen on desktop, so drop it
    // from the measurement there and let it crop.
    const hide = ".node-card, .detail-node-card, .node-label-fo"
      + (chooserActive ? ", .density-root" : "");
    return measuredBBox(zoomLayer, hide);
  }

  function computeOverviewTransform() {
    // Option 2 fits on EVERY screen, not just small ones. The live map could
    // assume 0.92 framed things well because its quadrants were bare node
    // clusters; here each one carries a rotated arc whose extent depends on
    // per-theme scale/offset/rotation the designer tunes, so the only framing
    // that reliably shows all four is one measured from what is actually drawn.
    const bb = overviewBBox();
    const pad = settings.overviewFitPad ?? OVERVIEW_FIT_PAD;
    // 0.92 keeps the full map slightly clear of the edges. The chooser has no
    // arcs and no labels, so its extent is much smaller — capping it at 0.92
    // would leave it as a small clump in the middle of the phone screen with
    // badges too small to tap. Let that one scale up to fill instead.
    const maxK = chooserActive ? 3 : DESKTOP_SCALE;
    const k = bb
      ? Math.min(
          maxK,
          (viewportW - pad * 2) / bb.width,
          (viewportH - pad * 2) / bb.height
        )
      : DESKTOP_SCALE;
    // Pinching out to (a little past) the fitted view has to stay reachable;
    // with no fit (desktop) this re-asserts the original 0.6 floor.
    zoom.scaleExtent([Math.min(0.6, k * 0.85), 3]);
    return bb
      ? d3.zoomIdentity
          .translate(
            (viewportW - bb.width * k) / 2 - bb.x * k,
            (viewportH - bb.height * k) / 2 - bb.y * k
          )
          .scale(k)
      : d3.zoomIdentity
          .translate(
            (viewportW - contentW * k) / 2,
            (viewportH - contentH * k) / 2
          )
          .scale(k);
  }

  // getBBox() needs layout, and nothing here is in the document yet: the svg is
  // built detached (d3.create) and only appended at the very end of this cell,
  // whose return value the runtime attaches later still. So this first pass
  // always measures 0 and takes the unfitted branch — correct for desktop, and
  // the starting point we re-fit from on a phone once layout exists.
  let overviewTransform = computeOverviewTransform();
  svg.call(zoom.transform, overviewTransform);

  // Re-fit once attached, and again once the force sims have settled (they run
  // on async timers, so the first frame's positions are not final). Skip it if
  // the reader has already taken the zoom over themselves — their gesture wins.
  let userHasZoomed = false;
  zoom.on("zoom.userfit", (event) => { if (event.sourceEvent) userHasZoomed = true; });
  // No isSmallScreen() gate here either: the first computeOverviewTransform()
  // above always measures a detached (zero-size) SVG and falls back to 0.92, so
  // this deferred pass is what actually applies the fit — on every screen.
  function refitOverview() {
    if (userHasZoomed || soloedIndex !== null) return;
    overviewTransform = computeOverviewTransform();
    svg.call(zoom.transform, overviewTransform);
  }
  requestAnimationFrame(refitOverview);
  setTimeout(refitOverview, 1600);
  // Re-fit on resize too — the arcs are sized from the quadrant, so a window
  // resize changes the extent this framing was measured from.
  d3.select(window).on("resize.o2fit", () => { userHasZoomed = false; refitOverview(); });

  // --- Title-badge zoom/solo -------------------------------------------------
  // Clicking a theme's title badge zooms that quadrant to fill the screen and
  // fades the others, so it reads as its own map; a floating "Overview" button
  // (or Esc, or the soloed badge again) returns. Reuses the existing zoom —
  // the richer per-theme detail maps (in Figma) are a later phase.
  let soloedIndex = null;
  let currentChrome = null; // which theme (or "master") the header/legend show
  // The "resting" chrome to fall back to when a transient node focus clears —
  // set by everything that establishes a lasting view (init, solo/exit, pan),
  // but NOT by a node hover/click, which only overrides the chrome temporarily.
  let baseChrome = "master";
  let showTune = () => {}; // assigned when the settings panel is built

  // The detail maps used to sit outside the master view, kept out of sight
  // purely by being parked off-screen. They now live inside their own quadrant
  // and are visible from the rest state — on desktop.
  //
  // On a phone a quadrant is only ~139px wide, which is not enough for an arc,
  // its sub-zone labels, 8-11 nodes and their labels all at once; showing them
  // together just produced overlapping text. So the phone overview becomes a
  // CHOOSER: four badges over shrunken, unlabelled node icons and nothing else.
  // Tapping a badge zooms that quadrant and restores the full desktop-style
  // view for it; leaving goes back to the chooser. Desktop never enters this
  // mode, so it is unaffected.
  function setChooserMode(on) {
    chooserActive = on;
    detailLayer.style("display", on ? "none" : null);
    linkOverlay.style("display", on ? "none" : null);
    crossLabelLayer.style("display", on ? "none" : null);
    hubLayer.style("display", on ? "none" : null);
    panels.forEach(p => p.setChooserMode && p.setChooserMode(on));
  }
  // Whether the phone should be in chooser mode right now: only when nothing
  // is soloed. Called on load, and on every solo/exit.
  function syncChooserMode() {
    setChooserMode(isSmallScreen() && soloedIndex === null);
  }
  // Apply on load. The deferred refits scheduled above (rAF + timeout) run
  // after this module body finishes, so they measure the chooser's own extent
  // rather than the full arcs it has just hidden.
  syncChooserMode();

  // Fit transform that pans + zooms to a theme's detail map (which lives
  // in its own quadrant, see makePanel).
  function detailFitTransform(index) {
    const p = panels[index];
    if (!p || !p.detailCenter) return overviewTransform;
    // detailExtent covers the sub-zone artwork only, and the formula below
    // deliberately overflows it (pad < 1) to fill the narrow side of the
    // screen. On a landscape desktop that still leaves the surrounding nodes
    // and their labels in frame; on a ~390px phone it shoves them off both
    // edges. So on small screens fit the whole drawn detail map instead.
    if (isSmallScreen() && p.detailGroup) {
      // Do NOT fit the quadrant to the phone screen. The map is now built at
      // desktop geometry (see MOBILE_LAYOUT_W), so squeezing a whole quadrant
      // into 375px would shrink everything below its designed size — and
      // fitting it the other way round is what previously blew the labels and
      // cards up. Instead hold the desktop scale and just pan to the quadrant,
      // leaving the reader to explore the rest of the map by dragging.
      // getBBox() reports an element's OWN user space and ignores ancestor
      // transforms. detailGroup hangs off detailLayer, which has none, so its
      // box is already global — but nodeLayer sits inside the panel's
      // translate(x,y), so its box is panel-local and has to be shifted before
      // the two can be unioned. Skipping this offset the centring by the
      // panel's own position: 0 for the top-left quadrant (which looked fine)
      // but 606px for the right column, which is why Cultural Narratives and
      // Inclusive Communities landed off-screen.
      const toGlobal = (b) => b
        ? { x: b.x + p.x0, y: b.y + p.y0, width: b.width, height: b.height }
        : null;
      const artBB = measuredBBox(p.detailGroup, ".detail-node-card, .node-label-fo");
      const nodesBB = toGlobal(p.nodeLayer ? measuredBBox(p.nodeLayer, ".__unused__") : null);
      // The badge lives in titleLayer, also panel-local. Include it or the pan
      // can centre on the artwork with the badge left outside the frame — which
      // is exactly what happened to Healthy Oceans.
      const badgeBB = toGlobal(p.titleLayer ? measuredBBox(p.titleLayer, ".__unused__") : null);
      const bb = unionBBox(unionBBox(artBB, nodesBB), badgeBB);
      if (bb) {
        // Never zoom IN past the desktop scale (that is what made everything
        // look oversized), but do zoom OUT when the quadrant plus its badge
        // does not fit the phone — better a slightly smaller view than one with
        // the badge or half the arc cropped off.
        const k = Math.min(
          DESKTOP_SCALE,
          (viewportW - DETAIL_FIT_PAD * 2) / bb.width,
          (viewportH - DETAIL_FIT_PAD * 2) / bb.height
        );
        return d3.zoomIdentity
          .translate(
            viewportW / 2 - k * (bb.x + bb.width / 2),
            viewportH / 2 - k * (bb.y + bb.height / 2)
          )
          .scale(k);
      }
    }
    const pad = 0.9; // <1 lets the sub-zone fill (slightly overflow) the screen
    const k = Math.max(0.6, Math.min(3,
      Math.min(viewportW, viewportH) / (2 * p.detailExtent * pad)));
    return d3.zoomIdentity
      .translate(viewportW / 2 - k * p.detailCenter.x, viewportH / 2 - k * p.detailCenter.y)
      .scale(k);
  }

  // Clicking a badge is now just a shortcut: zoom to that theme's detail map.
  // The chrome + tune panel follow via updateChromeForView / setChrome below,
  // and the detail maps stay at full opacity the whole time.
  function soloPanel(index) {
    soloedIndex = index;
    // Restore the full view BEFORE measuring the fit — detailFitTransform sizes
    // itself from the artwork's bbox, which reads as empty while it is hidden.
    syncChooserMode();
    svg.transition().duration(750).call(zoom.transform, detailFitTransform(index));
    panels.forEach((p, i) => {
      p.setBadgeScale(i === index ? 1.5 : 1);
      // Phones do not dim the other three. There the map is bigger than the
      // screen and tapping a badge only pans to that quadrant, so the reader is
      // expected to keep dragging around the whole map — dimming everything
      // they are about to pan into would work against that. On desktop the
      // whole map is already in view, so dimming still reads as focus.
      p.setFocus(isSmallScreen() ? "off" : (i === index ? "focused" : "dim"));
    });
    setBaseChrome(charts[index].id);
    showTune(panels[index]);
    // On a phone the how-to blob is onboarding for the chooser. Once a theme has
    // been opened the reader has clearly worked out the interaction, and the
    // bubble is just fixed chrome covering a map they now have to pan around —
    // so drop it for good. Nothing re-reveals it: setChrome only re-opens the
    // legend, and only on desktop.
    if (isSmallScreen()) exploreBubble.classed("collapsed", true);
  }

  function exitSolo() {
    soloedIndex = null;
    panels.forEach(p => { p.setBadgeScale(1); p.setFocus("off"); });
    setBaseChrome("master");
    showTune(null);
    // Back to the chooser on a phone, then re-fit: the overview transform was
    // measured with the arcs showing, which is the wrong extent for a chooser
    // that has none.
    syncChooserMode();
    userHasZoomed = false;
    overviewTransform = computeOverviewTransform();
    svg.transition().duration(750).call(zoom.transform, overviewTransform);
  }

  d3.select(window).on("keydown.solo", (event) => {
    if (event.key === "Escape") exitSolo();
  });

  // --- Map UI chrome: header context blob + legend ---------------------------
  // Overlaid HTML (like the settings panel). setChrome swaps between the
  // master-map copy and a focused theme's copy, driven by soloPanel/exitSolo.
  // The theme header carries the "← Overview" back link. Legend collapses on
  // click of its header. Illustrations (the character, Areas-of-Work icons)
  // are placeholders for now — real branded art drops in later. Copy for
  // themes other than Regenerative Landscapes is a TODO from the Figma file.
  const ENTRY_POINTS = {
    "Healthy Oceans": "A",
    "Regenerative Landscapes": "B",
    "Inclusive Communities": "C",
    "Cultural Narratives": "D"
  };
  const THEME_TAGLINES = {
    "Healthy Oceans": "The pressures here are visible. Overfishing. Habitat loss. Plastic leaking into the sea faster than it can be recovered.",
    "Regenerative Landscapes": "Land is not just a backdrop to climate and biodiversity goals. It is the operating system underlying them.",
    "Inclusive Communities": "Economic inclusion is often treated as a separate social issue — important, but secondary to the bigger systemic challenges.",
    "Cultural Narratives": "Culture shapes what we take for granted."
  };

  const chromeStyle = d3.create("style").text(`
    .ecca-chrome { font-family: poppins, system-ui, sans-serif; box-sizing: border-box; }

    /* Placeholder sub-zone blob labels (in-SVG foreignObjects). */
    .subzone-label { font-family: poppins, system-ui, sans-serif; color: #2c3a22; text-align: center; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 0 12%; box-sizing: border-box; }
    /* Sub-zone headline groups dim via a plain inline opacity set (node focus and
       sub-zone hover both write it directly); this animates that change. Using
       CSS rather than a d3 transition because a named d3 transition proved
       unreliable when fired from the sub-zone hit-circle handler. */
    .subzone-label-art { transition: opacity 0.16s ease; }
    .subzone-label .sz-name { font-weight: 700; font-size: 11px; line-height: 1.12; margin-bottom: 3px; }
    .subzone-label .sz-desc { font-size: 7.5px; line-height: 1.25; opacity: .9; }
    /* .detail-node-label removed with Task 2 — the duplicate "detail" node
       set (own icon/label/card) is gone; the master nodes are the only ones
       on screen now, styled by their own existing rules. */

    /* Header speech bubble (top-left) — now a pre-rendered art bubble
       (TheECCAsystem-bubble / entry-bubble-A..D). The "← Overview" back link
       sits as a pill ABOVE the entry bubble in theme view. */
    .ecca-header {
      position: fixed; left: 20px; top: 20px; z-index: 9;
      display: flex; flex-direction: column; align-items: flex-start;
      pointer-events: none;
    }
    .ecca-header-img { display: block; width: 225px; max-width: 32vw; height: auto;
      filter: drop-shadow(0 4px 16px rgba(0,0,0,0.12)); }
    .ecca-header .ecca-back {
      cursor: pointer; font-size: 13px; font-weight: 600;
      background: #003932; color: #F2F1ED; padding: 7px 15px 7px 12px;
      border-radius: 20px; margin-bottom: 10px; display: inline-flex; align-items: center;
      box-shadow: 0 3px 12px rgba(0,0,0,0.16); transition: transform .15s ease, background .2s ease;
    }
    .ecca-header .ecca-back:hover { background: #005F57; transform: translateX(-2px); }

    /* Bottom-left link out to the full annual report page. */
    .ecca-report {
      position: fixed; left: 20px; bottom: 20px; z-index: 9;
      display: inline-flex; align-items: center; gap: 8px;
      background: #F2F1ED; color: #003932; text-decoration: none;
      font-weight: 600; font-size: 13px; padding: 10px 16px;
      border-radius: 12px; box-shadow: 0 3px 12px rgba(0,0,0,0.12);
      transition: background .2s ease, transform .2s ease;
    }
    .ecca-report:hover { background: #fff; transform: translateY(-1px); }

    /* Bottom-right stack: How-to-Explore art bubble over the legend + character.
       pointer-events:none because this (and .ecca-header) is a transparent box
       pinned over the map — it otherwise swallows clicks meant for the title
       badges underneath. That is what made the Healthy Oceans badge unclickable
       on a phone, where this container spans the whole lower-right. Only the
       genuinely interactive bits opt back in, just below. */
    .ecca-br { position: fixed; right: 20px; bottom: 20px; z-index: 9; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; }
    .ecca-legend, .ecca-char-wrap, .ecca-header .ecca-back { pointer-events: auto; }
    .ecca-explore { margin-right: 34px; }
    .ecca-explore.collapsed { display: none; }
    .ecca-explore-img { display: block; width: 230px; max-width: 40vw; height: auto;
      filter: drop-shadow(0 4px 16px rgba(0,0,0,0.10)); }

    .ecca-legend-row { display: flex; flex-direction: row; align-items: flex-end; gap: 0; }
    .ecca-char-wrap { position: relative; display: inline-flex; align-self: flex-end; margin-left: -18px; }
    .ecca-character {
      height: 170px; width: auto; cursor: pointer; user-select: none;
      filter: drop-shadow(0 3px 6px rgba(0,0,0,0.12));
      transition: transform .2s ease;
    }
    .ecca-character:hover { transform: translateY(-2px); }
    /* Hover popover pointing at the character. */
    .ecca-char-tip {
      position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%) translateY(-4px);
      background: #003932; color: #F2F1ED; font-size: 12px; font-weight: 600;
      padding: 6px 12px; border-radius: 14px; white-space: nowrap;
      box-shadow: 0 3px 12px rgba(0,0,0,0.18);
      opacity: 0; pointer-events: none; transition: opacity .18s ease; z-index: 10;
    }
    .ecca-char-tip::after {
      content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
      border: 6px solid transparent; border-top-color: #003932;
    }
    .ecca-char-wrap:hover .ecca-char-tip,
    .ecca-char-wrap.tip-hint .ecca-char-tip { opacity: 1; }
    /* Legend is now a pre-rendered image, swapped by view (master/theme) and
       viewport (desktop/mobile). Grows on hover — anchored bottom-right so it
       expands away from the screen edge and the character beside it. */
    .ecca-legend {
      align-self: flex-end; position: relative;
      transform-origin: bottom right; transition: transform .22s ease;
    }
    .ecca-legend:hover { transform: scale(1.15); z-index: 1; }
    .ecca-legend.collapsed { display: none; }
    .ecca-legend-img { display: block; height: auto;
      filter: drop-shadow(0 6px 24px rgba(0,0,0,0.18)); }
    .ecca-legend-desktop { width: 225px; max-width: 22.5vw; }
    .ecca-legend-mobile { display: none; }

    /* Mobile: the report link moves up to the top-right (kept clear of the
       header blob at top-left), the character shrinks, and the legend sits to
       its left rather than stacked above it — the How-to-Explore bubble still
       rides on top of the pair. All of it to stop the chrome blanketing the
       lower half of the (now fitted) map. */
    @media (max-width: 768px) {
      /* The character walks along the bottom edge of the viewport, so the whole
         stack sits flush to it; the legend beside him floats just clear.
         The stack spans the full width so the legend can sit hard left while
         the character (and the how-to bubble above him) stay hard right. */
      .ecca-br { bottom: 0; left: 14px; right: 14px; }
      /* margin-left:auto on the character rather than justify-content:
         space-between — the legend starts collapsed (display:none) here, and
         space-between parks a lone remaining item at the START, which threw the
         man to the left edge. auto margin pins him right either way. */
      .ecca-legend-row { flex-direction: row; align-items: flex-end; gap: 0;
        width: 100%; }
      .ecca-char-wrap { margin-left: auto; }
      .ecca-character { height: 96px; display: block; }
      .ecca-legend-desktop { display: none; }
      /* Wider than its own box on purpose (and uncapped) so the legend art
         fills the row now that gap:0 has closed the space beside the character. */
      .ecca-legend-mobile { display: block; width: 105%; max-width: none; }
      .ecca-legend { margin-bottom: 16px; }
      /* Kill the hover grow on a phone. It is a mouse affordance, and a tap
         leaves :hover stuck on — so the legend sat permanently scaled. With
         transform-origin at bottom right it grows LEFTWARD, and the panel
         already starts near the left edge, so the extra 15% ran straight off
         the screen. */
      .ecca-legend:hover { transform: none; }
      /* Both speech bubbles at 0.84x of their old phone size (0.7 then nudged
         back up by 1.2): they are fixed chrome sitting over a map you now pan
         around, so the less of it they cover the better — but at a flat 0.7 the
         copy inside got hard to read. 46vw -> 38.6vw, 40vw -> 33.6vw. */
      .ecca-header-img { width: 190px; max-width: 38.6vw; }
      /* Smaller, and lifted clear of the toggle tip below it. The tip is
         absolutely positioned (out of flow), so the column reserves no room for
         it — this margin is what stops the bubble landing on top of it. */
      .ecca-explore-img { width: 218px; max-width: 33.6vw; }
      /* flush right, above the toggle tip (which is out of flow, so this margin
         is what stops the bubble landing on top of it). */
      .ecca-explore { margin-bottom: 30px; margin-right: 0; align-self: flex-end; }
      /* The tip is centred on the character, who sits hard against the right
         edge — which ran it off-screen. Anchor it to his right edge instead and
         shift the arrow to keep it pointing at him. */
      .ecca-char-tip { left: auto; right: 0; transform: translateY(-4px); }
      .ecca-char-tip::after { left: auto; right: 34px; transform: none; }
      /* top matches .ecca-header's 20px so this pill's top edge lines up with
         the "← Overview" pill opposite it. */
      .ecca-report {
        top: 20px; right: 14px; left: auto; bottom: auto;
        font-size: 10px; gap: 5px; padding: 6px 10px; border-radius: 10px;
      }
    }
  `);

  const headerBlob = d3.create("div").attr("class", "ecca-header ecca-chrome");
  const headerInner = headerBlob.append("div").attr("class", "ecca-header-inner");

  // Bottom-left link to the full annual-report page.
  // Relative ("../") so it works wherever this is hosted: the map lives at
  // <site>/interactive-map/ and the report is one level up at <site>/ —
  // works on Netlify now and under eccafamily.foundation/report-2025/ later,
  // without hardcoding a domain.
  const REPORT_URL = "../";
  const reportLink = d3.create("a").attr("class", "ecca-report ecca-chrome")
    .attr("href", REPORT_URL).attr("target", "_blank").attr("rel", "noopener noreferrer")
    .html(`📄 Read ECCA Annual Report 2025 →`);

  // Per-view character illustration (the SVGs you exported). Doubles as the
  // legend toggle — clicking the character hides/shows the legend panel.
  // Phones get their own set (characters/legend-mb) — the desktop art is drawn
  // to sit beside a wide legend panel and reads badly at phone size.
  const CHARACTERS_DESKTOP = {
    master: "./characters/master.svg",
    "Healthy Oceans": "./characters/entrypoint-a.svg",
    "Regenerative Landscapes": "./characters/entrypoint-b.svg",
    "Inclusive Communities": "./characters/entrypoint-c.svg",
    "Cultural Narratives": "./characters/entrypoint-d.svg"
  };
  const CHARACTERS_MOBILE = {
    master: "./characters/legend-mb/master-man-mb.svg",
    "Healthy Oceans": "./characters/legend-mb/ocean-man-mb.svg",
    "Regenerative Landscapes": "./characters/legend-mb/regen-woman-mb.svg",
    "Inclusive Communities": "./characters/legend-mb/commu-woman-mb.svg",
    "Cultural Narratives": "./characters/legend-mb/cult-man-mb.svg"
  };
  const CHARACTERS = isSmallScreen() ? CHARACTERS_MOBILE : CHARACTERS_DESKTOP;

  // ECCA brand palette (from the project swatch sheet).
  const PAL = {
    eccaGreen: "#005F57", darkGreen: "#003932", lightGreen: "#D6EDD3",
    plum: "#530E2A", midPlum: "#C37F98", lightPlum: "#D492AB",
    khaki: "#6F7042", midKhaki: "#9E9C64", lightKhaki: "#C2C7A1",
    pink: "#FF99B3", midPink: "#FFC0C2", lightPink: "#FFD0D1",
    yellow: "#FFC71B", midYellow: "#FFDE4A", lightYellow: "#FFE572",
    peach: "#FF9E74", midPeach: "#FFBA8B", lightPeach: "#FFC69F",
    cream: "#F2F1ED", blue: "#3F8FFF", midBlue: "#589BFF", lightBlue: "#9BC1FC"
  };

  const bottomRight = d3.create("div").attr("class", "ecca-br ecca-chrome");
  const exploreBubble = bottomRight.append("div").attr("class", "ecca-explore");
  exploreBubble.append("img").attr("class", "ecca-explore-img")
    .attr("src", "./characters/how-to-explore.svg").attr("alt", "How to explore The ECCAsystem");
  const legendRow = bottomRight.append("div").attr("class", "ecca-legend-row");
  const legendPanel = legendRow.append("div").attr("class", "ecca-legend ecca-chrome");
  // Two legend images: one for desktop, one for the wide mobile layout. Their
  // src is swapped per-view (master vs entry point) in setChrome; CSS media
  // query decides which is visible.
  const legendDesktop = legendPanel.append("img").attr("class", "ecca-legend-img ecca-legend-desktop").attr("alt", "Legend");
  const legendMobile = legendPanel.append("img").attr("class", "ecca-legend-img ecca-legend-mobile").attr("alt", "Legend");
  // Character doubles as the legend toggle; a small popover hints at that.
  // The hint shows on load (tip-hint) and dismisses once the user first clicks.
  const charWrap = legendRow.append("div").attr("class", "ecca-char-wrap tip-hint");
  charWrap.append("div").attr("class", "ecca-char-tip").text("Click to toggle legend");
  const characterImg = charWrap.append("img").attr("class", "ecca-character").attr("alt", "")
    .attr("title", "Click to toggle legend");
  characterImg.on("click", () => {
    charWrap.classed("tip-hint", false); // hint dismissed after first use
    const collapsed = !legendPanel.classed("collapsed");
    legendPanel.classed("collapsed", collapsed);
    // The how-to blob is onboarding, not part of the legend: it shows on load
    // and the first toggle dismisses it for good, rather than flipping back and
    // forth with the legend.
    exploreBubble.classed("collapsed", true);
  });

  // Pre-rendered legend art, swapped by view + viewport in setChrome.
  const LEGEND_ART = {
    masterDesktop: "./characters/Desktop-Legend-Master.png",
    themeDesktop:  "./characters/Desktop-Legend-EntryPoint.png",
    masterMobile:  "./characters/legend-mobile-master.png",
    themeMobile:   "./characters/Mobile-Legend-EntryPoint.png"
  };

  // setChrome that also records the mode as the resting chrome (see baseChrome).
  // Used for lasting view changes; focusVisual uses plain setChrome so its swap
  // is undone when the focus clears back to baseChrome.
  function setBaseChrome(mode) { baseChrome = mode; setChrome(mode); }

  function setChrome(mode) {
    if (mode === currentChrome) return; // already showing this view's chrome
    currentChrome = mode;
    if (mode === "master") {
      // Master header is the standalone "The ECCAsystem" art bubble.
      headerInner.html(`<img class="ecca-header-img" src="./characters/TheECCAsystem-bubble.svg" alt="The ECCAsystem">`);
      characterImg.attr("src", CHARACTERS.master);
      legendDesktop.attr("src", LEGEND_ART.masterDesktop);
      legendMobile.attr("src", LEGEND_ART.masterMobile);
    } else {
      const letter = (ENTRY_POINTS[mode] || "").toLowerCase();
      // Theme header: a "← Overview" pill above the entry-point art bubble.
      headerInner.html(`
        <div class="ecca-back">← Overview</div>
        <img class="ecca-header-img" src="./characters/entry-bubble-${letter}.svg" alt="Entry Point ${letter.toUpperCase()} — ${mode}">
      `);
      headerInner.select(".ecca-back").on("click", exitSolo);
      characterImg.attr("src", CHARACTERS[mode] || CHARACTERS.master);
      legendDesktop.attr("src", LEGEND_ART.themeDesktop);
      legendMobile.attr("src", LEGEND_ART.themeMobile);
      // Zooming into an entry point reveals the legend even if it was toggled
      // off in the overview — but not on a phone, where it starts collapsed on
      // purpose and re-opening it would just re-cover the detail map. The
      // how-to blob is never re-revealed here: once dismissed, it stays gone.
      if (!isSmallScreen()) {
        legendPanel.classed("collapsed", false);
      }
    }
  }
  setBaseChrome("master");

  // On a phone the legend blankets a large share of a small screen, so start it
  // collapsed and let the map breathe; the character's "Click to toggle legend"
  // hint shows on load, which is what makes that discoverable. The how-to blob
  // stays visible on load (it is the onboarding copy) until the first toggle
  // dismisses it. Desktop still starts with both open, as before.
  if (isSmallScreen()) {
    legendPanel.classed("collapsed", true);
  }

  // Follow the pan: whichever theme's detail map the viewport is centered over
  // takes over the header bubble + legend (and the dev tune panel). Panning
  // back over the master in the middle restores the master chrome. Only reacts
  // to user-driven pans/zooms (programmatic transforms have a null sourceEvent).
  // Which panel index the viewport is centred over (>=0), or -1 for none —
  // used both by the pan-driven chrome and to revert the chrome after a node
  // focus clears (so it falls back to whatever the current pan implies).
  function panelIndexForView(transform) {
    const [cx, cy] = transform.invert([viewportW / 2, viewportH / 2]);
    let best = -1, bestDist = Infinity;
    panels.forEach((p, i) => {
      if (!p.detailCenter) return;
      const d = Math.hypot(p.detailCenter.x - cx, p.detailCenter.y - cy);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return (best >= 0 && bestDist < panels[best].detailExtent * 1.2) ? best : -1;
  }
  function updateChromeForView(transform) {
    const best = panelIndexForView(transform);
    const target = best >= 0 ? charts[best].id : "master";
    if (target !== currentChrome) {
      setBaseChrome(target);
      showTune(best >= 0 ? panels[best] : null);
    }
  }
  zoom.on("zoom.chrome", (event) => {
    if (event.sourceEvent) updateChromeForView(event.transform);
  });

  // Small dev-facing settings panel — bottom right, collapsed by default —
  // for tweaking the contour/label tuning knobs live without editing code.
  const settingsPanel = d3.create("div")
    .style("position", "fixed")
    .style("right", "12px")
    .style("top", "12px")
    .style("z-index", "11")
    .style("display", "none")   // dev panel: hidden by default, toggle with "d"
    .style("font-family", "system-ui, sans-serif")
    .style("font-size", "12px")
    .style("color", "#1b1e23");

  // Show/hide the dev settings panel with the "d" key (kept out of the way for
  // the client build; still available for tuning).
  d3.select(window).on("keydown.devpanel", (event) => {
    if ((event.key === "d" || event.key === "D") && !/^(input|textarea)$/i.test(event.target.tagName)) {
      settingsPanel.style("display", settingsPanel.style("display") === "none" ? "block" : "none");
    }
  });

  const settingsToggle = settingsPanel.append("button")
    .text("⚙ Settings")
    .style("padding", "7px 12px")
    .style("border-radius", "8px")
    .style("border", "1px solid #d8d5cd")
    .style("background", "#fff")
    .style("box-shadow", "0 2px 8px rgba(0,0,0,0.12)")
    .style("cursor", "pointer");

  const settingsBody = settingsPanel.append("div")
    .style("display", "none")
    .style("margin-top", "8px")
    .style("padding", "14px")
    .style("width", "220px")
    // Cap to the viewport and scroll: the panel outgrew the screen, which left
    // the sub-zone sliders at the bottom with no way to reach them.
    .style("max-height", "calc(100vh - 90px)")
    .style("overflow-y", "auto")
    .style("background", "#fff")
    .style("border-radius", "10px")
    .style("box-shadow", "0 4px 20px rgba(0,0,0,0.15)");

  settingsToggle.on("click", () => {
    const hidden = settingsBody.style("display") === "none";
    settingsBody.style("display", hidden ? "block" : "none");
  });

  // Clipboard write, with a textarea+execCommand fallback for origins where
  // navigator.clipboard is unavailable/blocked (e.g. plain http, not https —
  // this is served locally for tuning). `onDone` fires once text has
  // actually landed on the clipboard, so the caller can show its own
  // "copied" feedback rather than assuming success.
  function copyTextToClipboard(text, onDone) {
    function legacyCopy() {
      const ta = document.createElement("textarea");
      ta.value = text;
      // Off-screen but still selectable — display:none blocks execCommand.
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); onDone(); } catch (e) { /* nothing more to try */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onDone, legacyCopy);
    } else {
      legacyCopy();
    }
  }

  // --- Arc tuning (Task 2.5) --------------------------------------------
  // One group per theme, always visible (not gated behind soloing a panel,
  // unlike the legacy per-zone tuning below) — the designer tunes all 4
  // arcs' size/position/rotation from here. Placed at the very TOP of the
  // panel per spec (a past round buried new sliders low enough to be
  // unreachable before the scroll/max-height fix further down existed).
  const arcTuneContainer = settingsBody.append("div").style("margin-bottom", "14px");
  arcTuneContainer.append("div")
    .style("font-weight", "700").style("margin-bottom", "8px")
    .text("Arc tuning — all 4 themes (live)");

  // Framing of the whole map on load. Live: re-fits as you drag (unless you
  // have already panned/zoomed yourself, which always wins).
  addLiveSlider(arcTuneContainer, "Zoom pad (px)", "overviewFitPad", 10, () => {
    userHasZoomed = false;
    refitOverview();
  }, 200, 0);

  const arcCopyBtn = arcTuneContainer.append("button")
    .text("📋 คัดลอกค่า arc")
    .style("width", "100%").style("margin-bottom", "6px")
    .style("padding", "7px").style("border-radius", "6px")
    .style("border", "1px solid #d8d5cd").style("background", "#F2F1ED")
    .style("font-size", "11px").style("font-weight", "600").style("cursor", "pointer");

  // Saved slider values always beat the values baked into SUBZONE_ART, so once
  // a knob has been dragged there is no way to see a newly-baked default again
  // without clearing storage by hand. This does that: wipe this map's settings
  // key and reload, so everything falls back to the values in the source.
  arcTuneContainer.append("button")
    .text("↺ ล้างค่าที่ปรับไว้ (กลับเป็น default ในโค้ด)")
    .style("width", "100%").style("margin-bottom", "10px")
    .style("padding", "7px").style("border-radius", "6px")
    .style("border", "1px solid #d8d5cd").style("background", "#fff")
    .style("font-size", "11px").style("font-weight", "600").style("cursor", "pointer")
    .on("click", () => {
      try { localStorage.removeItem(SETTINGS_STORAGE_KEY); } catch (e) {}
      location.reload();
    });

  const badgePosSliders = [];
  syncBadgePosSliders = () => badgePosSliders.forEach(fn => fn());

  panels.forEach(panel => {
    const dc = panel.detailControls;
    if (!dc) return; // theme has no designed artwork to tune (shouldn't happen currently)
    const L = dc.letter;
    const o2cfg = dc.art.o2 || {};
    const group = arcTuneContainer.append("div")
      .style("margin-bottom", "10px")
      .style("padding", "8px 8px 2px")
      .style("border", "1px solid #eee")
      .style("border-radius", "6px");
    group.append("div")
      .style("font-weight", "600").style("margin-bottom", "4px").style("font-size", "11px")
      .text(`${panel.chart.id} (${L})`);
    // All 4 sliders for a theme just re-run that theme's renderDetail with
    // whatever settings[...] value the slider itself already wrote —
    // recomputing every art-derived point (zone blobs, pin dots, labels,
    // node keep-out zones) from scratch, so nothing here needs its own
    // per-attribute update code.
    const applyArc = () => panel.retuneArc();
    addLiveSlider(group, "Arc size", `o2scale${L}`, o2cfg.scale ?? 1, applyArc, 2.5, 0.3);
    addLiveSlider(group, "Arc X", `o2ox${L}`, o2cfg.ox ?? 0, applyArc, 0.6, -0.6);
    addLiveSlider(group, "Arc Y", `o2oy${L}`, o2cfg.oy ?? 0, applyArc, 0.6, -0.6);
    // Default = the angle renderDetail would compute from this theme's
    // quadrant (col/row) on its own — NOT 0 — so an untouched slider still
    // shows (and the arc still renders at) the correct starting rotation.
    addLiveSlider(group, "Arc rotation", `o2rot${L}`, o2cfg.rot ?? dc.defaultRot, applyArc, 180, -180);
    // Badge size is separate from the arc — it only rescales the title badge in
    // place (and its node keep-out zone), so it does not re-run renderDetail.
    addLiveSlider(group, "Badge size", `badgeSize${L}`, o2cfg.badgeSize ?? 1,
      () => panel.setBadgeScale2(settings[`badgeSize${L}`] ?? o2cfg.badgeSize ?? 1), 2, 0.4);
    // Badge position, as a fraction of the panel. Seeded from wherever the badge
    // currently is (dragged or defaulted) so the slider never jumps on open.
    const bp0 = panel.badgePosFractions();
    const applyBadgePos = () => panel.setBadgePos(
      settings[`badgePosX${L}`] ?? bp0.x,
      settings[`badgePosY${L}`] ?? bp0.y
    );
    const bxSlider = addLiveSlider(group, "Badge X", `badgePosX${L}`, bp0.x, applyBadgePos, 1, 0);
    const bySlider = addLiveSlider(group, "Badge Y", `badgePosY${L}`, bp0.y, applyBadgePos, 1, 0);
    badgePosSliders.push(() => {
      const p = panel.badgePosFractions();
      bxSlider.sync(p.x);
      bySlider.sync(p.y);
    });

    // Mirror toggles. Flipping happens in the artwork's own space before the
    // rotation, so "flip ⇄" always reads as left-to-right on the arc as drawn,
    // however far it has been rotated.
    const flipRow = group.append("div")
      .style("display", "flex").style("gap", "6px").style("margin", "6px 0 8px");
    [["flip ⇄", `o2fx${L}`, o2cfg.flipX], ["flip ⇅", `o2fy${L}`, o2cfg.flipY]].forEach(([label, key, def]) => {
      const on = () => settings[key] ?? def ?? false;
      const btn = flipRow.append("button")
        .style("flex", "1").style("padding", "5px").style("border-radius", "6px")
        .style("border", "1px solid #d8d5cd").style("font-size", "11px").style("cursor", "pointer")
        .text(label);
      const paint = () => btn
        .style("background", on() ? "#003932" : "#F2F1ED")
        .style("color", on() ? "#F2F1ED" : "#111")
        .style("font-weight", on() ? "700" : "500");
      paint();
      btn.on("click", () => { settings[key] = !on(); saveSettings(); paint(); applyArc(); });
    });
  });

  arcCopyBtn.on("click", () => {
    const out = {};
    panels.forEach(panel => {
      const dc = panel.detailControls;
      if (!dc) return;
      const L = dc.letter, o2cfg = dc.art.o2 || {};
      out[panel.chart.id] = {
        scale: +(settings[`o2scale${L}`] ?? o2cfg.scale ?? 1).toFixed(3),
        ox: +(settings[`o2ox${L}`] ?? o2cfg.ox ?? 0).toFixed(3),
        oy: +(settings[`o2oy${L}`] ?? o2cfg.oy ?? 0).toFixed(3),
        rot: +(settings[`o2rot${L}`] ?? o2cfg.rot ?? dc.defaultRot ?? 0).toFixed(1),
        flipX: !!(settings[`o2fx${L}`] ?? o2cfg.flipX ?? false),
        flipY: !!(settings[`o2fy${L}`] ?? o2cfg.flipY ?? false),
        badgeSize: +(settings[`badgeSize${L}`] ?? 1).toFixed(3),
        badgeX: +panel.badgePosFractions().x.toFixed(3),
        badgeY: +panel.badgePosFractions().y.toFixed(3)
      };
    });
    const originalLabel = arcCopyBtn.text();
    copyTextToClipboard(JSON.stringify(out, null, 2), () => {
      arcCopyBtn.text("Copied!");
      setTimeout(() => arcCopyBtn.text(originalLabel), 1400);
    });
  });

  // Live sub-zone tuning goes next — it's the panel's per-zone working area,
  // rebuilt for whichever theme is soloed. Everything below it is legacy
  // tuning whose values are already baked in, so it's tucked behind a
  // collapsed section.
  const tuneContainer = settingsBody.append("div");
  const tuneEmpty = settingsBody.append("div")
    .style("color", "#6b7280").style("margin-bottom", "10px")
    .text("Click a theme badge to tune its sub-zones.");

  const advancedToggle = settingsBody.append("button")
    .text("▸ Advanced (layout, cards, contour)")
    .style("width", "100%").style("margin", "4px 0 10px")
    .style("padding", "6px").style("border-radius", "6px")
    .style("border", "1px solid #e6e3db").style("background", "#F7F6EF")
    .style("font-size", "11px").style("color", "#6b7280").style("cursor", "pointer");
  const advancedBody = settingsBody.append("div").style("display", "none");
  advancedToggle.on("click", () => {
    const hidden = advancedBody.style("display") === "none";
    advancedBody.style("display", hidden ? "block" : "none");
    advancedToggle.text((hidden ? "▾" : "▸") + " Advanced (layout, cards, contour)");
  });

  function addSettingSlider(label, key, min, max, step) {
    const row = advancedBody.append("div").style("margin-bottom", "12px");
    const header = row.append("div")
      .style("display", "flex")
      .style("justify-content", "space-between")
      .style("margin-bottom", "4px");
    header.append("span").text(label);
    const valueLabel = header.append("span").style("color", "#6b7280").text(settings[key]);

    row.append("input")
      .attr("type", "range")
      .attr("min", min)
      .attr("max", max)
      .attr("step", step)
      .property("value", settings[key])
      .style("width", "100%")
      .on("input", function() {
        settings[key] = +this.value;
        valueLabel.text(this.value);
        refreshAllSettings();
      });
  }

  addSettingSlider("Contour bandwidth", "bandwidth", 20, 200, 5);
  addSettingSlider("Contour thresholds", "thresholds", 1, 8, 1);
  addSettingSlider("Cross-link label max-width (ch)", "crossLabelMaxChars", 8, 40, 1);
  addSettingSlider("Node label max-width (ch)", "nodeLabelMaxChars", 8, 40, 1);
  addSettingSlider("Label end offset (%)", "labelEndOffsetPct", 5, 45, 1);
  addSettingSlider("Cross-link label font size", "crossLabelFontSize", 8, 32, 1);
  addSettingSlider("Node label font size", "nodeLabelFontSize", 5, 16, 1);

  // Max content width/height drive the whole layout construction (panel
  // sizes, force simulation targets, badge corners, hub position — all
  // computed once up front), not just a render pass, so unlike the sliders
  // above these can't be applied live. Saved immediately; a reload picks
  // them up (loadStoredSettings() above already merges saved values in).
  advancedBody.append("div")
    .style("margin", "4px 0 12px")
    .style("border-top", "1px solid #eee");

  function addDeferredSettingSlider(label, key, min, max, step) {
    const row = advancedBody.append("div").style("margin-bottom", "12px");
    const header = row.append("div")
      .style("display", "flex")
      .style("justify-content", "space-between")
      .style("margin-bottom", "4px");
    header.append("span").text(label);
    const valueLabel = header.append("span").style("color", "#6b7280").text(settings[key]);

    row.append("input")
      .attr("type", "range")
      .attr("min", min)
      .attr("max", max)
      .attr("step", step)
      .property("value", settings[key])
      .style("width", "100%")
      .on("input", function() {
        settings[key] = +this.value;
        valueLabel.text(this.value);
        saveSettings();
        reloadHint.style("display", "block");
      });
  }

  addDeferredSettingSlider("Card width (px)", "cardWidth", 120, 280, 4);
  addDeferredSettingSlider("Card title font (rem)", "cardLabelRem", 0.375, 1.5, 0.0625);
  addDeferredSettingSlider("Card partner font (rem)", "cardPartnerRem", 0.375, 1.5, 0.0625);
  addDeferredSettingSlider("Card stage font (rem)", "cardStageRem", 0.375, 1.5, 0.0625);
  addDeferredSettingSlider("Card padding top (rem)", "cardPadTop", 0, 1.5, 0.125);
  addDeferredSettingSlider("Card padding bottom (rem)", "cardPadBottom", 0, 1.5, 0.125);
  addDeferredSettingSlider("Card padding H (rem)", "cardPadH", 0, 1.5, 0.125);
  addDeferredSettingSlider("Max panel-cluster width (% of screen)", "maxContentWPct", 20, 100, 1);
  addDeferredSettingSlider("Max panel-cluster height (% of screen)", "maxContentHPct", 20, 100, 1);

  // Live sub-zone tuning — rebuilt for whichever theme is soloed (see the
  // solo hooks below). Applies immediately (no reload) via detailControls.
  function addLiveSlider(container, label, key, defVal, apply, max = 1, min = 0) {
    const val = settings[key] ?? defVal;
    const row = container.append("div").style("margin-bottom", "10px");
    const header = row.append("div").style("display", "flex")
      .style("justify-content", "space-between").style("margin-bottom", "4px");
    header.append("span").text(label);
    const valueLabel = header.append("span").style("color", "#6b7280").text(val);
    const input = row.append("input").attr("type", "range").attr("min", min).attr("max", max).attr("step", 0.005)
      .property("value", val).style("width", "100%")
      .on("input", function () {
        settings[key] = +this.value;
        valueLabel.text(this.value);
        apply();
        saveSettings();
      });
    // Returned so a control that can also be driven from the canvas (badge X/Y,
    // which the drag gesture writes) can push the new value back into the UI.
    // Existing callers ignore this.
    return {
      sync(v) { input.property("value", v); valueLabel.text(+(+v).toFixed(3)); }
    };
  }
  // Rebuild the tuning sliders for the currently-soloed theme.
  showTune = (panel) => {
    tuneContainer.selectAll("*").remove();
    const dc = panel && panel.detailControls;
    tuneEmpty.style("display", dc ? "none" : "block");
    if (!dc) return;
    const L = dc.letter, art = dc.art, defZones = art.zones;
    tuneContainer.append("div").style("font-weight", "700").style("margin-bottom", "6px")
      .text(`Sub-zones — ${panel.chart.id} (live)`);
    dc.zoneNames.forEach((zn, i) => {
      const g = defZones[zn] || { ax: 0.5, ay: 0.5 };
      tuneContainer.append("div")
        .style("font-weight", "600").style("margin", "10px 0 4px")
        .style("padding-top", "6px").style("border-top", "1px solid #f0efe9")
        .text(zn);
      // Label = the headline + body text. Attach = the connector's pin dot.
      const applyLabel = () => dc.setLabelOffset(i, settings[`sz${L}ldx${i}`] ?? g.labelDx ?? 0,
                                                    settings[`sz${L}ldy${i}`] ?? g.labelDy ?? 0);
      addLiveSlider(tuneContainer, "text ← →", `sz${L}ldx${i}`, g.labelDx ?? 0, applyLabel, 0.2, -0.2);
      addLiveSlider(tuneContainer, "text ↑ ↓", `sz${L}ldy${i}`, g.labelDy ?? 0, applyLabel, 0.2, -0.2);
      const applyAttach = () => dc.setAttach(i, settings[`sz${L}ax${i}`] ?? g.ax, settings[`sz${L}ay${i}`] ?? g.ay);
      addLiveSlider(tuneContainer, "dot X", `sz${L}ax${i}`, g.ax, applyAttach);
      addLiveSlider(tuneContainer, "dot Y", `sz${L}ay${i}`, g.ay, applyAttach);
    });
    const applyNodeArea = () => dc.setNodeArea(settings[`sz${L}nax`] ?? art.nodeArea.x, settings[`sz${L}nay`] ?? art.nodeArea.y);
    // Node Area can push past the artwork bounds (fraction of the image
    // width/height), so allow up to 2× — useful for dropping the cluster below.
    addLiveSlider(tuneContainer, "Node Area X", `sz${L}nax`, art.nodeArea.x, applyNodeArea, 2);
    addLiveSlider(tuneContainer, "Node Area Y", `sz${L}nay`, art.nodeArea.y, applyNodeArea, 2);
  };

  const reloadHint = advancedBody.append("button")
    .text("Reload to apply size change")
    .style("display", "none")
    .style("width", "100%")
    .style("padding", "8px")
    .style("border-radius", "6px")
    .style("border", "1px solid #d8d5cd")
    .style("background", "#F2F1ED")
    .style("cursor", "pointer")
    .on("click", () => location.reload());

  const wrapper = d3.create("div").style("position", "relative");
  wrapper.node().appendChild(svg.node());
  wrapper.node().appendChild(chromeStyle.node());
  wrapper.node().appendChild(headerBlob.node());
  wrapper.node().appendChild(reportLink.node());
  wrapper.node().appendChild(bottomRight.node());
  wrapper.node().appendChild(settingsPanel.node());

  return wrapper.node();
}


function _3(html){return(
html`<link rel="stylesheet" href="https://use.typekit.net/syg3laf.css">`
)}

function _4(html){return(
html`<style>

  .poppins {
    font-family: "poppins", sans-serif;
    font-weight: 300;
    font-style: normal;
  }

.cross-label {
font-family: "Contee", sans-serif;
    font-weight: 300;
    font-style: normal;
}
</style>`
)}

function _addFonts(FontFace){return(
(
  fonts // [{ fontFamily, url, style, weight, stretch }]
) => {
  const fontNames = fonts.map((f) => {
    const fontFace = new FontFace(f.fontFamily, `url(${f.url})`, {
      style: f.style ?? "normal",
      weight: f.weight ?? "normal",
      stretch: f.stretch ?? "normal"
    });
    fontFace.load();
    document.fonts.add(fontFace);
    return f;
  });
  return fontNames;
}
)}

async function _6(addFonts,FileAttachment){return(
addFonts([
  {
    fontFamily: "Contee",
    url: await FileAttachment("Contee Script Plus.ttf").url(),
    style: "normal",
    weight: "300",
    stretch: "expanded"
  }
])
)}

function _7(htl){return(
htl.html`<p style="font-family:'Contee';"> ✨ <span style="font-weight:bold;font-stretch:expanded;">Custom</span> Font via FileAttachement and FontFace API. 👻</p> `
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  function toString() { return this.url; }
  const fileAttachments = new Map([
    ["culturalnarrative@1.png", {url: new URL("./files/7191241aa5c27144c921c85b7423715d8bdf1447965d62d20588d2d3549f43de47f02c9568c0f6ae12bc092c1336f886d9a6f4ebb4d17fde455110f83b44bd6e.png", import.meta.url), mimeType: "image/png", toString}],
    ["healthyocean@1.png", {url: new URL("./files/669813c32961b8dbe05210c732c0afb325e4912d5a91739a6cb315b3e9be053fd1c41313260eafd3c912439827b984aac5350da4f0338948cbff90279944c513.png", import.meta.url), mimeType: "image/png", toString}],
    ["inclusivecommu@1.png", {url: new URL("./files/31b81a3dccddc4fa8502d7832655315ae923db3905eea06e716febc50d8903292422e2013bab43cdf47ec16e914b0ad800eacf56ded5dee1297d933bb6583551.png", import.meta.url), mimeType: "image/png", toString}],
    ["regenland@1.png", {url: new URL("./files/a4dad551a2adddb442a460136730dee1d78031e8592b08f7073a4920b87c848cf9d12dfc0db7efdd8efd13fd4abe73d3520fe7187293b6cdc0a6baff8b0fd368.png", import.meta.url), mimeType: "image/png", toString}],
    ["Contee Script Plus.ttf", {url: new URL("./files/f4a0bc9bc707cb1e11d0eb97ab62a66a14f2f2aa320e356c66186ebeba1b6ee6448b341c3de9dceed953aec3c4e0db819ad8c5b8f532fff71811f5ca51b2f7d6.ttf", import.meta.url), mimeType: "font/ttf", toString}],
    ["bullet-4.svg", {url: new URL("./files/eac0c2831435ae2837b28ad11bc75ca79f07e3a6279e73b3f5b96471030ad325bf462b3c147a095bcb2e5908c6a35ef3e8cd66e83129466d88a5e6cf135db98d.svg", import.meta.url), mimeType: "image/svg+xml", toString}],
    ["bullet-1.svg", {url: new URL("./files/686dbab0cb97e7a055a2a16a2a66e009780de57f1386ab7d9ee6abdd75aee055a55a9a30d728d358c82ebbcfa128d6a74762373904e070ca553b4742070765be.svg", import.meta.url), mimeType: "image/svg+xml", toString}],
    ["bullet-3.svg", {url: new URL("./files/c844eb6f66527f62cc17b06b002b384289b1ca8666cf58e3654beb7901789db14bd2110e93f45066cc4b87f317cec73b03e4f5ecfa618b77bc7d887a61f46ed2.svg", import.meta.url), mimeType: "image/svg+xml", toString}],
    ["bullet-2.svg", {url: new URL("./files/3433e3263c31b11c3a5e1e66f95e132da60332c24c695415390f6f0e7e4145f03d434d63d34be0a66dcc2079bbbfe2d0fa5174a1ec72afcce8cabbfa68c34fb3.svg", import.meta.url), mimeType: "image/svg+xml", toString}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer()).define(["FileAttachment","d3"], _2);
  main.variable(observer()).define(["html"], _3);
  main.variable(observer()).define(["html"], _4);
  main.variable(observer("addFonts")).define("addFonts", ["FontFace"], _addFonts);
  main.variable(observer()).define(["addFonts","FileAttachment"], _6);
  main.variable(observer()).define(["htl"], _7);
  return main;
}
