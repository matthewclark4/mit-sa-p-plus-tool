// MIT Wall — a set of "+ Walls" 3D banner templates (Block / Image / Header) plus a bottom nav for
// switching between named pages that each use one of those templates. Only one page's scene is ever
// alive at a time (see mountPage) — clicking a nav button tears down the current WebGL scene and builds
// a fresh one for the page you switched to, rather than keeping 15 renderers around at once.
// No p5.js dependency: the original project this was duplicated from only used p5 for setup()/draw()
// lifecycle convenience, which isn't needed here — see the small vanilla replacement at the bottom.

const ASSET_DIR = './assets/';
const SVG_DIR = ASSET_DIR + 'svgs/';
const WORDMARK_SVG = ASSET_DIR + 'Newsletter-2.svg'; // the one asset that predates the per-page art below

function css(el, styles) {
    Object.assign(el.style, styles);
}
function hexToRgb(hex) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
function wallsRnd(a, b) { return a + Math.random() * (b - a); }

// Rasterises an SVG onto a canvas filled with bgColorHex first (so the SVG's own negative space reads
// as a solid backing colour, not raw transparency) and recolours its non-transparent pixels to
// logoColorHex — pixel-level, not a string find/replace on the SVG's own markup, since there's no
// guarantee a source SVG carries an explicit fill attribute to find in the first place. Rasterised at
// WORDMARK_RASTER_SIZE regardless of the SVG's own intrinsic size — an SVG <img> redraws its vector
// content live at whatever size drawImage asks for, so this is what actually controls how crisp the
// art reads once it's stretched across a wall face onscreen.
const WORDMARK_RASTER_SIZE = 2400;
function rasterizeSvgTexture(imagePath, bgColorHex, logoColorHex, onReady) {
    let img = new Image();
    img.onload = () => {
        let nw = img.naturalWidth || 300, nh = img.naturalHeight || 150;
        let ar = nw / nh;
        let w = ar >= 1 ? WORDMARK_RASTER_SIZE : Math.round(WORDMARK_RASTER_SIZE * ar);
        let h = ar >= 1 ? Math.round(WORDMARK_RASTER_SIZE / ar) : WORDMARK_RASTER_SIZE;
        let oc = document.createElement('canvas');
        oc.width = w; oc.height = h;
        let octx = oc.getContext('2d');
        octx.fillStyle = bgColorHex;
        octx.fillRect(0, 0, w, h);
        let tc = document.createElement('canvas');
        tc.width = w; tc.height = h;
        let tctx = tc.getContext('2d');
        tctx.drawImage(img, 0, 0, w, h);
        let px = tctx.getImageData(0, 0, w, h);
        let fg = hexToRgb(logoColorHex);
        for (let i = 0; i < px.data.length; i += 4) {
            if (px.data[i + 3] > 0) { px.data[i] = fg.r; px.data[i + 1] = fg.g; px.data[i + 2] = fg.b; }
        }
        tctx.putImageData(px, 0, 0);
        octx.drawImage(tc, 0, 0);
        onReady(new THREE.CanvasTexture(oc));
    };
    img.src = imagePath;
}

// Loads a plain raster photo (jpg/png) as a texture, no recolouring — same-origin local assets, so no
// crossOrigin/CORS handling needed the way a fetched placeholder would.
function loadImageTexture(imagePath, onReady) {
    let img = new Image();
    img.onload = () => onReady(new THREE.Texture(img));
    img.onerror = () => onReady(null);
    img.src = imagePath;
}

// Sharpest a texture can look: no mip chain to pick a blurrier level from — just a single
// full-resolution level sampled with plain bilinear filtering. Mipmapping mainly buys quality when a
// texture is minified (viewed smaller than its native size / at a grazing angle); these wall faces are
// viewed close to straight-on and the whole point here is crisp art, so there's nothing to gain from a
// mip chain and one real risk from it (three.js silently drops mipmapping/forces ClampToEdge on any
// non-power-of-two texture under WebGL1 anyway, which a rasterised SVG usually is). anisotropy is set
// for the (fairly steep) angle these faces sit at regardless.
function applySharpFiltering(tex, renderer) {
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    try { tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); } catch (e) { /* no-op if unsupported */ }
    tex.needsUpdate = true;
}

// ── shared "+ Walls" idle motion ─────────────────────────────────────────────────────────────
// A page background, not a hero moment — every unit gets a slow, continuous, per-unit drift (orbit)
// and self-spin, both far too slow to distract: a full drift cycle or a full rotation each take several
// minutes, so from one glance to the next it barely reads as motion, just "alive".
const WALL_ORBIT_RADIUS = 18;
const WALL_ORBIT_SPEED_MIN = 0.012;
const WALL_ORBIT_SPEED_MAX = 0.03;
const WALL_SPIN_SPEED_MIN = 0.01;
const WALL_SPIN_SPEED_MAX = 0.025;
// Every unit's own base tilt — a plain fixed Euler tilt (not a billboard-toward-camera basis) so both
// perpendicular sheets are caught at a flattering diagonal to start from (the slow idle spin then
// rotates a unit away from this over time, but always relative to this same base — see baseQuat below).
const WALL_UNIT_ROT_X = -0.22;
const WALL_UNIT_ROT_Y = 0.55;

// Per-type layout: how big a page is and how big/many/dense its wall units are. Colour and artwork are
// per-PAGE (see PAGES below), not per-type, since every page in a type needs its own. tiltRange/rotRange
// bound each unit's own random deviation from the shared base tilt (see WALL_UNIT_ROT_X/Y) — Header's
// are pulled way in from Block/Image's: at Header's much larger zoom, the same randomness that reads as
// pleasant variety at Block's scale was swinging some units close enough to edge-on that their faces
// foreshortened hard, reading as inconsistently-sized (and visibly warped) letters next to their
// neighbours. Tighter ranges keep every unit closer to the same angle, hence the same apparent size.
const WALL_TYPES = {
    block: {
        sectionWidth: '65vw', sectionHeight: 'auto', sectionAspect: '1 / 1',
        unitSize: 190, unitCount: 5, spreadX: 230, spreadY: 100, spreadZ: [-50, 100],
        tiltXRange: 0.10, tiltYRange: 0.18, rotRange: 0.35,
    },
    header: {
        sectionWidth: '100%', sectionHeight: 'clamp(180px, 23vw, 320px)',
        unitSize: 95, unitCount: 4, spreadX: 300, spreadY: 45, spreadZ: [-40, 70],
        tiltXRange: 0.03, tiltYRange: 0.05, rotRange: 0.08,
    },
    // A bit more zoomed in (bigger units) and fewer of them than Block — enough of the photo shows on
    // each face to read as an actual image rather than a tiny repeated tile.
    image: {
        sectionWidth: '65vw', sectionHeight: 'clamp(360px, 46vw, 640px)',
        unitSize: 260, unitCount: 3, spreadX: 170, spreadY: 70, spreadZ: [-40, 90],
        tiltXRange: 0.10, tiltYRange: 0.18, rotRange: 0.35,
    },
};

// Every page the bottom nav can switch to, in nav order. type picks a WALL_TYPES entry for layout; nav
// is the button label. sectionBg is the page's own DOM background (shows through any gap the
// randomly-placed units don't cover). For block/header pages: faceImage is the SVG rasterised onto each
// wall face, wallBg/wallInk its two recolour targets (see rasterizeSvgTexture). For image pages:
// photoImage is loaded as-is, no recolouring. pickers:true (MIT SA+P only, for now) adds the three live
// colour pickers instead of hard-coding sectionBg/wallBg/wallInk. zoom is a per-page multiplier on top
// of its WALL_TYPES unitSize (1.2 = "+20% bigger"); spreadMult likewise multiplies spreadX/spreadY;
// unitCount overrides the type's own count outright; sectionAspect (Block's own type default: every
// Block page is square) pairs with sectionHeight:'auto' so the explicit height doesn't fight it — all
// four applied in mountPage.
const PAGES = [
    { id: 'block-sap', type: 'block', nav: 'Block: MIT SA+P', pickers: true, zoom: 1.656, unitCount: 3,
      faceImage: SVG_DIR + 'school of architecture-walls.svg',
      sectionBg: '#9AB1FF', wallBg: '#000000', wallInk: '#9AB1FF' },
    { id: 'block-newsletter', type: 'block', nav: 'Block: Newsletter', zoom: 1.56, unitCount: 3,
      faceImage: WORDMARK_SVG,
      sectionBg: '#707F00', wallBg: '#E0FD65', wallInk: '#707F00' },
    { id: 'block-arc', type: 'block', nav: 'Block: ARC', zoom: 1.3225, unitCount: 3,
      faceImage: SVG_DIR + 'Block – Architecture.svg',
      sectionBg: '#EEB1FF', wallBg: '#000000', wallInk: '#EEB1FF' },
    { id: 'block-cre', type: 'block', nav: 'Block: CRE', zoom: 2.08, unitCount: 3,
      faceImage: SVG_DIR + 'Block – CRE.svg',
      sectionBg: '#FD6234', wallBg: '#ffffff', wallInk: '#FD6234' },
    { id: 'block-lcau', type: 'block', nav: 'Block: LCAU', zoom: 1.955, unitCount: 3,
      faceImage: SVG_DIR + 'Block – LCAU.svg',
      sectionBg: '#9AB1FF', wallBg: '#000000', wallInk: '#9AB1FF' },
    { id: 'block-mad', type: 'block', nav: 'Block: MAD', zoom: 2.08, unitCount: 3, spreadMult: 1.3,
      faceImage: SVG_DIR + 'MAD.svg',
      sectionBg: '#FFC486', wallBg: '#000000', wallInk: '#FFC486' },
    { id: 'block-medialab', type: 'block', nav: 'Block: Media Lab', zoom: 1.68, unitCount: 3,
      faceImage: SVG_DIR + 'Block – Media Lab.svg',
      sectionBg: '#6B0033', wallBg: '#ffffff', wallInk: '#6B0033' },
    { id: 'block-dusp', type: 'block', nav: 'Block: DUSP', zoom: 2.40, unitCount: 2,
      faceImage: SVG_DIR + 'DUSP.svg',
      sectionBg: '#707F00', wallBg: '#ffffff', wallInk: '#707F00' },

    { id: 'image-01', type: 'image', nav: 'Image: 01', photoImage: SVG_DIR + 'ARC.jpg' },
    { id: 'image-02', type: 'image', nav: 'Image: 02', photoImage: SVG_DIR + 'DUSP.png' },
    { id: 'image-03', type: 'image', nav: 'Image: 03', photoImage: SVG_DIR + 'CRE.jpg' },
    { id: 'image-04', type: 'image', nav: 'Image: 04', photoImage: SVG_DIR + 'Media Arts.jpg' },
    { id: 'image-05', type: 'image', nav: 'Image: 05', photoImage: SVG_DIR + 'ACT.jpg' },

    { id: 'header-research', type: 'header', nav: 'Header: Research', zoom: 2.50,
      faceImage: SVG_DIR + 'Heading – Research.svg',
      sectionBg: '#ffffff', wallBg: '#E0FD65', wallInk: '#ffffff' },
    { id: 'header-academics', type: 'header', nav: 'Header: Academics', zoom: 2.00,
      faceImage: SVG_DIR + 'Heading – Academics.svg',
      sectionBg: '#ffffff', wallBg: '#EEB1FF', wallInk: '#ffffff' },
    { id: 'header-about', type: 'header', nav: 'Header: About', zoom: 2.50,
      faceImage: SVG_DIR + 'Heading – About.svg',
      sectionBg: '#ffffff', wallBg: '#FFC486', wallInk: '#ffffff' },
];

// One self-contained "+ Walls" scene: its own canvas/renderer/units, living inside `container`. Returns
// { step, dispose, recolorSvg, captureJpg } — step() re-measures the container and renders one frame
// (called every RAF while this page is the active one); dispose() tears the WebGL context + textures
// down when navigating away, since only one page's scene is ever meant to be alive at once (see
// mountPage); recolorSvg(bg, ink) re-rasterises an 'svg'-type page's texture with new colours on the fly
// — either argument can be left null to leave that one alone — for the MIT SA+P colour pickers;
// captureJpg(minWidth) renders one high-res frame and returns it as a JPEG data URL, for the download
// button (works for every page type, since it just rasterises whatever's currently on screen).
function createWallScene(container, cfg) {
    let canvas = document.createElement('canvas');
    let renderer, scene, camera, unitGeo, edgeGeo, edgeMat;
    let units = [], tex = null, disposed = false;

    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
    } catch (e) {
        return { step() {}, dispose() {}, recolorSvg() {}, captureJpg() { return null; } };
    }
    container.appendChild(canvas);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
    unitGeo = new THREE.PlaneGeometry(1, 1);
    edgeGeo = new THREE.EdgesGeometry(unitGeo);
    edgeMat = new THREE.LineBasicMaterial({ color: '#111111' });
    edgeMat.visible = false;
    // Just a placeholder pose so the camera isn't sitting at the default origin for the one frame (if
    // any) before step() first runs and re-derives its real position/aspect from the container's own
    // live rect every frame from here on.
    camera.position.set(0, 0, 800);
    camera.lookAt(0, 0, 0);

    // Sizes a face plane to the shared texture's own aspect ratio.
    function sizeFace(unit, face) {
        let H = unit.userData.size;
        let aspect = (tex && tex.image && tex.image.width) ? tex.image.width / tex.image.height : 1;
        let w = H * aspect;
        face.scale.set(w, H, 1);
        face.position.set(0, 0, 0);
        face.position[face.userData.axis] = face.userData.sign * w / 2;
    }
    // Assigns the one shared texture to every face of one unit — before it's finished loading, faces
    // fall back to a plain tint (cfg.wallBg for a recoloured SVG, or a neutral grey for a photo).
    function assignTexture(unit) {
        unit.userData.faces.forEach(face => {
            if (tex) { face.material.map = tex; face.material.color.set(0xffffff); }
            else { face.material.map = null; face.material.color.set(cfg.wallBg || '#cccccc'); }
            face.material.opacity = 1;
            face.material.needsUpdate = true;
            sizeFace(unit, face);
        });
    }

    // One 3D "+" unit — 4 wings, front+back faces each (8 total). u.rot (its own z twist, on top of the
    // shared X/Y base tilt) gives each one individual variety. Its rest position/orientation never
    // change — step() layers the slow orbit + spin on top of them fresh every frame, so this rest pose
    // is always what the motion returns toward/around.
    function makeUnit(u) {
        let g = new THREE.Group();
        g.position.set(u.x, u.y, u.z);
        g.rotation.set(WALL_UNIT_ROT_X + u.tiltX, WALL_UNIT_ROT_Y + u.tiltY, u.rot);
        g.userData.baseQuat = g.quaternion.clone();
        g.userData.size = cfg.unitSize;
        g.userData.faces = [];
        let wingDefs = [
            { axis: 'x', sign: 1, ry: 0 },
            { axis: 'x', sign: -1, ry: 0 },
            { axis: 'z', sign: 1, ry: Math.PI / 2 },
            { axis: 'z', sign: -1, ry: Math.PI / 2 },
        ];
        wingDefs.forEach(wd => {
            [0, Math.PI].forEach(flip => {
                let mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.FrontSide });
                let m = new THREE.Mesh(unitGeo, mat);
                m.rotation.y = wd.ry + flip;
                m.userData = { axis: wd.axis, sign: wd.sign };
                m.add(new THREE.LineSegments(edgeGeo, edgeMat));
                m.scale.set(cfg.unitSize, cfg.unitSize, 1);
                m.position[wd.axis] = wd.sign * cfg.unitSize / 2;
                g.add(m);
                g.userData.faces.push(m);
            });
        });
        g.userData.rest = u;
        assignTexture(g);
        scene.add(g);
        units.push(g);
    }

    // Each unit's own settled (x, y, z, z-rotation) plus its own orbit + spin parameters. x/y are
    // stratified rather than drawn fully independently — count evenly-spaced slots across the full
    // spread, one unit per slot (with its own shuffled row, so slot order isn't the same left-to-right
    // as top-to-bottom, and a small jitter within the slot so it doesn't read as a rigid grid). Fully
    // independent random x/y could — and, with only 2-3 units, regularly did — clump every unit into
    // one side of the frame by pure chance; stratifying guarantees the units cover the canvas evenly on
    // every load instead of only on lucky ones.
    function makeUnitDefs(count) {
        let defs = [];
        let zLo = cfg.spreadZ[0], zHi = cfg.spreadZ[1];
        let rowOrder = [];
        for (let i = 0; i < count; i++) rowOrder.push(i);
        for (let i = count - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            let tmp = rowOrder[i]; rowOrder[i] = rowOrder[j]; rowOrder[j] = tmp;
        }
        for (let i = 0; i < count; i++) {
            let xSlot = ((i + 0.5) / count) * 2 - 1;
            let ySlot = ((rowOrder[i] + 0.5) / count) * 2 - 1;
            let xJitter = wallsRnd(-0.5, 0.5) * (cfg.spreadX / count);
            let yJitter = wallsRnd(-0.5, 0.5) * (cfg.spreadY / count);
            defs.push({
                x: xSlot * cfg.spreadX + xJitter,
                y: ySlot * cfg.spreadY + yJitter,
                z: wallsRnd(zLo, zHi),
                rot: wallsRnd(-cfg.rotRange, cfg.rotRange),
                tiltX: wallsRnd(-cfg.tiltXRange, cfg.tiltXRange),
                tiltY: wallsRnd(-cfg.tiltYRange, cfg.tiltYRange),
                orbitAx: wallsRnd(0.5, 1) * WALL_ORBIT_RADIUS,
                orbitAy: wallsRnd(0.5, 1) * WALL_ORBIT_RADIUS,
                orbitAz: wallsRnd(0.5, 1) * WALL_ORBIT_RADIUS,
                orbitWx: wallsRnd(WALL_ORBIT_SPEED_MIN, WALL_ORBIT_SPEED_MAX),
                orbitWy: wallsRnd(WALL_ORBIT_SPEED_MIN, WALL_ORBIT_SPEED_MAX),
                orbitWz: wallsRnd(WALL_ORBIT_SPEED_MIN, WALL_ORBIT_SPEED_MAX),
                orbitPx: wallsRnd(0, Math.PI * 2),
                orbitPy: wallsRnd(0, Math.PI * 2),
                orbitPz: wallsRnd(0, Math.PI * 2),
                spinAxis: new THREE.Vector3(wallsRnd(-1, 1), wallsRnd(-1, 1), wallsRnd(-1, 1)).normalize(),
                spinSpeed: wallsRnd(WALL_SPIN_SPEED_MIN, WALL_SPIN_SPEED_MAX) * (Math.random() < 0.5 ? -1 : 1),
            });
        }
        return defs;
    }

    makeUnitDefs(cfg.unitCount).forEach(u => makeUnit(u));

    function loadTexture() {
        if (cfg.texture === 'svg') {
            rasterizeSvgTexture(cfg.faceImage, cfg.wallBg, cfg.wallInk, t => {
                if (disposed) { t.dispose(); return; }
                if (tex) tex.dispose();
                tex = t; applySharpFiltering(tex, renderer); units.forEach(assignTexture);
            });
        } else if (cfg.texture === 'photo') {
            loadImageTexture(cfg.photoImage, t => {
                if (!t || disposed) { if (t) t.dispose(); return; }
                tex = t; applySharpFiltering(tex, renderer); units.forEach(assignTexture);
            });
        }
    }
    loadTexture();

    // Re-rasterises the 'svg' texture with new colours (leaving cfg.wallBg/wallInk as whichever the
    // caller didn't pass) and reassigns it to every unit once ready — used by the MIT SA+P colour
    // pickers to preview a change live, without rebuilding the whole scene.
    function recolorSvg(newBg, newInk) {
        if (cfg.texture !== 'svg') return;
        if (newBg) cfg.wallBg = newBg;
        if (newInk) cfg.wallInk = newInk;
        loadTexture();
    }

    const spinQ = new THREE.Quaternion(); // scratch, reused every frame instead of allocating per unit
    // Re-measures the container and renders one frame — cheap to just always run while this page is
    // active (a handful of flat planes), skipped entirely if the section is nowhere near the viewport.
    // The drift/spin are pure functions of absolute time, so units don't jump after being skipped.
    function step() {
        let rect = container.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;

        let nowS = performance.now() / 1000;

        // Rendered a little larger than the container and shifted to stay centred over it, so a unit
        // whose rest position sits near/past the container's own edge (see makeUnitDefs' own x/y
        // spread) can drift close to that edge without an abrupt cut mid-unit — the container's own
        // overflow: hidden (see style.css) still clips the result to a clean rectangle regardless. d
        // below is deliberately derived from this PADDED height, not the container's own raw one — a
        // perspective camera positioned at d = (height/2)/tan(fov/2) always maps 1 world unit to
        // exactly 1 pixel at z=0 regardless of what "height" actually is, so computing it from the
        // padded canvas keeps that same 1:1 scale while the padding simply widens the visible field.
        let pad = Math.round(Math.max(40, Math.min(rect.width, rect.height) * 0.15));
        let w = Math.max(1, rect.width) + pad * 2, h = Math.max(1, rect.height) + pad * 2;
        css(canvas, { left: -pad + 'px', top: -pad + 'px', width: w + 'px', height: h + 'px' });
        renderer.setSize(w, h);
        camera.aspect = w / h;
        let fov = 50;
        let d = (h / 2) / Math.tan((fov / 2) * Math.PI / 180);
        camera.far = d + 3000;
        camera.updateProjectionMatrix();
        camera.position.set(0, 0, d);
        camera.lookAt(0, 0, 0);

        units.forEach(mesh => {
            let u = mesh.userData.rest;
            mesh.position.set(
                u.x + u.orbitAx * Math.sin(nowS * u.orbitWx + u.orbitPx),
                u.y + u.orbitAy * Math.sin(nowS * u.orbitWy + u.orbitPy),
                u.z + u.orbitAz * Math.sin(nowS * u.orbitWz + u.orbitPz)
            );
            spinQ.setFromAxisAngle(u.spinAxis, nowS * u.spinSpeed);
            mesh.quaternion.copy(mesh.userData.baseQuat).multiply(spinQ);
        });

        renderer.render(scene, camera);
    }

    // Renders one frame at (at least) minWidth px wide — same composition/framing as what's on screen,
    // just supersampled to export resolution — and returns it as a JPEG data URL. Two things the naive
    // version of this got wrong, both fixed below:
    //  - d (camera distance) must NOT be recomputed from the new, larger h the way step() computes it
    //    from the live container height. That formula is deliberately self-cancelling (see step()'s own
    //    comment) so that a world unit always maps to exactly 1 pixel regardless of h/d — exactly the
    //    wrong property here, since it means scaling h up just adds empty space around the SAME
    //    absolute-pixel-sized content instead of making that content bigger too. d is computed once from
    //    the real on-screen (unscaled) height and held fixed, so scaling w/h up scales the content with
    //    them — a genuine higher-resolution render of the same view, not a zoomed-out one.
    //  - this renderer is alpha:true so the section's own CSS background shows through on screen; JPEG
    //    has no alpha channel, so without an explicit opaque clear colour that transparency flattens to
    //    solid black on export instead. Sets the clear colour to the page's own sectionBg for the
    //    capture and restores the transparent default step() relies on immediately after.
    // No pad here (unlike step()) — the pad exists purely so units can poke past the container's own
    // edge under the section's own overflow: hidden crop; capturing the container's raw, unpadded rect
    // instead already matches that cropped result exactly, with no separate crop step needed.
    function captureJpg(minWidth) {
        let rect = container.getBoundingClientRect();
        let baseW = Math.max(1, rect.width), baseH = Math.max(1, rect.height);
        let fov = 50;
        let d = (baseH / 2) / Math.tan((fov / 2) * Math.PI / 180);

        let scale = Math.max(1, minWidth / baseW);
        let w = Math.round(baseW * scale), h = Math.round(baseH * scale);

        let oldPixelRatio = renderer.getPixelRatio();
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        camera.aspect = baseW / baseH;
        camera.far = d + 3000;
        camera.position.set(0, 0, d);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        renderer.setClearColor(new THREE.Color(cfg.sectionBg || '#ffffff'), 1);
        renderer.render(scene, camera);

        let dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(oldPixelRatio);
        return dataUrl;
    }

    function dispose() {
        disposed = true;
        units.forEach(g => g.userData.faces.forEach(f => f.material.dispose()));
        if (tex) tex.dispose();
        unitGeo.dispose();
        edgeGeo.dispose();
        edgeMat.dispose();
        renderer.dispose();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    return { step, dispose, recolorSvg, captureJpg };
}

// ── colour pickers (MIT SA+P only, for now) ──────────────────────────────────────────────────
// Three live colour inputs — background (the page's own DOM background), walls (the SVG's recoloured
// backing sheet) and text (the SVG's recoloured ink) — wired straight to the section/scene they affect.
function buildPickers(section, scene, cfg) {
    let panel = document.createElement('div');
    panel.className = 'wall-pickers';
    function addRow(label, value, onInput) {
        let row = document.createElement('label');
        row.className = 'wall-pickers-row';
        let span = document.createElement('span');
        span.textContent = label;
        let input = document.createElement('input');
        input.type = 'color';
        input.value = value;
        input.addEventListener('input', () => onInput(input.value));
        row.appendChild(span);
        row.appendChild(input);
        panel.appendChild(row);
    }
    addRow('Background', cfg.sectionBg, v => { cfg.sectionBg = v; section.style.background = v; });
    addRow('Walls', cfg.wallBg, v => scene.recolorSvg(v, null));
    addRow('Text', cfg.wallInk, v => scene.recolorSvg(null, v));
    document.body.appendChild(panel);
    return panel;
}

// ── JPG export ────────────────────────────────────────────────────────────────────────────────
// Downloads a high-res JPEG of whatever the current page's scene looks like right now — works for every
// page type (the earlier attempt at a real vector-SVG export only ever worked for the 'svg'-texture
// pages, and even there fetch()-ing the source file back out turned out not to work reliably, so this
// replaces it outright rather than living alongside it). DOWNLOAD_JPG_MIN_WIDTH is a floor, not a fixed
// size — a page already wider than that on screen exports at its own (higher) resolution, never
// downscaled.
const DOWNLOAD_JPG_MIN_WIDTH = 3000;
function downloadFileBase(page) {
    return page.nav.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
}
function downloadCurrentJpg() {
    if (!activePage || !activeScene) return;
    let dataUrl = activeScene.captureJpg(DOWNLOAD_JPG_MIN_WIDTH);
    if (!dataUrl) return;
    let a = document.createElement('a');
    a.href = dataUrl;
    a.download = downloadFileBase(activePage) + '.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// ── page mounting + bottom nav ───────────────────────────────────────────────────────────────
let activePage = null, activeScene = null, activeSectionEl = null, activePickerEl = null;

function mountPage(page) {
    if (activeScene) activeScene.dispose();
    if (activeSectionEl && activeSectionEl.parentNode) activeSectionEl.parentNode.removeChild(activeSectionEl);
    if (activePickerEl && activePickerEl.parentNode) activePickerEl.parentNode.removeChild(activePickerEl);
    activePickerEl = null;

    let cfg = Object.assign({}, WALL_TYPES[page.type], page);
    cfg.texture = page.type === 'image' ? 'photo' : 'svg';
    if (page.zoom) cfg.unitSize = Math.round(cfg.unitSize * page.zoom);
    if (page.spreadMult) { cfg.spreadX = Math.round(cfg.spreadX * page.spreadMult); cfg.spreadY = Math.round(cfg.spreadY * page.spreadMult); }

    let section = document.createElement('div');
    section.className = 'wall-section';
    css(section, {
        width: cfg.sectionWidth, height: cfg.sectionHeight, background: cfg.sectionBg || 'transparent',
        aspectRatio: cfg.sectionAspect || 'auto',
    });

    let navEl = document.querySelector('.wall-nav');
    document.body.insertBefore(section, navEl);

    activePage = page;
    activeSectionEl = section;
    activeScene = createWallScene(section, cfg);
    if (page.pickers) activePickerEl = buildPickers(section, activeScene, cfg);
}

function buildNav() {
    let nav = document.createElement('nav');
    nav.className = 'wall-nav';
    [['block'], ['image'], ['header']].forEach(([type]) => {
        let row = document.createElement('div');
        row.className = 'wall-nav-row';
        PAGES.filter(p => p.type === type).forEach(page => {
            let btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = page.nav;
            btn.addEventListener('click', () => {
                if (activePage === page) return;
                mountPage(page);
                nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
            });
            row.appendChild(btn);
        });
        nav.appendChild(row);
    });

    // Next to the page buttons, not one of them — downloads a high-res JPEG of whichever page is
    // currently active (see downloadCurrentJpg). Works for every page type.
    let utilRow = document.createElement('div');
    utilRow.className = 'wall-nav-row';
    let downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = 'Download JPG';
    downloadBtn.addEventListener('click', downloadCurrentJpg);
    utilRow.appendChild(downloadBtn);
    nav.appendChild(utilRow);

    document.body.appendChild(nav);
    return nav;
}

// ── lifecycle (vanilla — see the top of this file for why there's no p5.js dependency here) ────────
function loop() {
    if (activeScene) activeScene.step();
    requestAnimationFrame(loop);
}
let nav = buildNav();
mountPage(PAGES[0]);
nav.querySelector('button').classList.add('active');
requestAnimationFrame(loop);
