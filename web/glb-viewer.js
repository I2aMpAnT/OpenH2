// SpartanLoungeViewer - 3D Game Replay System
// Native Halo 2 .map rendering with Three.js/WebGL
// Falls back to GLB loading if .map file unavailable

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { H2MapParser } from './h2-map-parser.js';
import { H2Renderer } from './h2-renderer.js';

// Active H2 renderer instance (for cleanup on map switch)
let h2RendererInstance = null;

// ===== Configuration =====
const CONFIG = {
    mapsPath: '/maps3D/',
    telemetryPath: '/stats/theater/',
    playerMarkerSize: 0.25,
    playerMarkerHeight: 0.45,
    defaultCameraHeight: 50,
    followCameraDistance: 8,
    followCameraHeight: 4,
    defaultSpeed: 1,
    skipSeconds: 5,

    // Movement settings
    moveSpeed: 30,
    sprintMultiplier: 2.5,
    lookSensitivity: 0.002,

    // Gamepad settings
    gamepadDeadzone: 0.15,
    gamepadLookSensitivity: 0.05,
    gamepadMoveSpeed: 40,

    teamColors: {
        '_game_team_blue': 0x0066ff,
        '_game_team_red': 0xff3333,
        'blue': 0x0066ff,
        'red': 0xff3333,
        'none': 0x00ff88,
        'default': 0xffaa00
    },
    ffaColors: [
        0x00ff88, 0xff6600, 0xaa00ff, 0xffff00,
        0x00ffff, 0xff00aa, 0x88ff00, 0xff8800
    ]
};

// Map name to GLB filename mapping (player-facing name → internal GLB filename)
// Weapon name to icon filename mapping
const WEAPON_ICONS = {
    'assault bomb': 'AssaultBomb',
    'battle rifle': 'BattleRifle',
    'beam rifle': 'BeamRifle',
    'brute plasma rifle': 'BrutePlasmaRifle',
    'brute shot': 'BruteShot',
    'carbine': 'Carbine',
    'covenant carbine': 'Carbine',
    'energy sword': 'EnergySword',
    'sword': 'EnergySword',
    'flag': 'Flag',
    'frag grenade': 'FragGrenadeHUD',
    'fuel rod': 'FuelRod',
    'fuel rod gun': 'FuelRod',
    'fuel rod cannon': 'FuelRod',
    'magnum': 'Magnum',
    'pistol': 'Magnum',
    'melee': 'MeleeKill',
    'needler': 'Needler',
    'oddball': 'OddBall',
    'ball': 'OddBall',
    'plasma grenade': 'PlasmaGrenadeHUD',
    'plasma pistol': 'PlasmaPistol',
    'plasma rifle': 'PlasmaRifle',
    'rocket launcher': 'RocketLauncher',
    'rockets': 'RocketLauncher',
    'sentinel beam': 'SentinelBeam',
    'shotgun': 'Shotgun',
    'smg': 'SmG',
    'sniper rifle': 'SniperRifle',
    'sniper': 'SniperRifle'
};

function getWeaponIconUrl(weaponName) {
    if (!weaponName || weaponName === 'Unknown') return null;
    const normalized = weaponName.toLowerCase().trim();
    const iconName = WEAPON_ICONS[normalized];
    if (iconName) {
        return `/overlay/Weapons/${iconName}.png`;
    }
    // Try to find a partial match
    for (const [key, value] of Object.entries(WEAPON_ICONS)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return `/overlay/Weapons/${value}.png`;
        }
    }
    return null;
}

const MAP_NAME_TO_GLB = {
    'midship': 'midship',
    'lockout': 'lockout',
    'warlock': 'warlock',
    'sanctuary': 'deltatap',
    'beaver creek': 'beavercreek',
    'ascension': 'ascension',
    'coagulation': 'coagulation',
    'zanzibar': 'zanzibar',
    'burial mounds': 'burial_mounds',
    'colossus': 'colossus',
    'headlong': 'headlong',
    'waterworks': 'waterworks',
    'foundation': 'foundation',
    'backwash': 'backwash',
    'containment': 'containment',
    'elongation': 'elongation',
    'gemini': 'gemini',
    'turf': 'turf',
    'desolation': 'derelict',
    'relic': 'dune',
    'terminal': 'highplains',
    'ivory tower': 'cyclotron',
    'triplicate': 'triplicate'
};

function mapNameToGlbFilename(mapName) {
    const normalized = mapName.toLowerCase().trim();
    return MAP_NAME_TO_GLB[normalized] || normalized.replace(/\s+/g, '_');
}

// ===== State =====
let scene, camera, renderer, controls;
let mapModel = null;
let spartanModel = null;  // Loaded MasterChief.glb template
let playerMarkers = {};
let telemetryData = [];
let players = [];
let currentTimeMs = 0;
let startTimeMs = 0;
let totalDurationMs = 0;
let isPlaying = false;
let playbackSpeed = 1;
let lastFrameTime = 0;
let animationFrameId = null;
let followPlayer = null;
let viewMode = 'free';

// Input state
const keys = {};
let mouseDown = false;
let pointerLocked = false;

// Gamepad state
let gamepadIndex = null;
let gamepadConnected = false;

// URL parameters
let mapName = '';
let telemetryFile = '';
let gameInfo = {};

// Live theater mode
let isLiveMode = false;
let liveTheaterToken = '';
let liveServerId = '';          // server_id resolved from theater token
let liveServerIdPromise = null; // promise that resolves when server_id is known
let liveWs = null;
let liveServerData = {};
let liveMapLoaded = '';
let livePlayerPositions = {};  // playerName -> latest position data
let liveMapResolve = null;     // resolve function for waitForMapName

// Timeline dragging
let isDraggingTimeline = false;
let wasPlayingBeforeDrag = false;

// FPS tracking
let fpsFrames = 0;
let fpsLastTime = performance.now();
let fpsDisplay = 0;

// Camera positions (Overlord feature)
let savedCameraPositions = {};
let isOverlord = false;

// ===== Initialization =====
async function init() {
    try {
        // Fetch camera positions and user role in parallel with URL parsing
        const [_, camPos, authInfo] = await Promise.all([
            parseUrlParams(),
            fetch('/api/theater/camera-positions').then(r => r.ok ? r.json() : {}).catch(() => ({})),
            fetch('/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        savedCameraPositions = camPos;
        if (authInfo && authInfo.role === 'overlord') {
            isOverlord = true;
        }
        setupScene();
        setupEventListeners();
        setupGamepad();
        setupOverlordControls();
        await loadMapAndTelemetry();
        animate();
    } catch (error) {
        console.error('Initialization error:', error);
        const loadingOverlay = document.getElementById('loading-overlay');
        const errorOverlay = document.getElementById('error-overlay');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (errorOverlay) {
            errorOverlay.style.display = 'flex';
            document.getElementById('error-text').textContent = error.message;
        }
    }
}

async function parseUrlParams() {
    // Check for /theater/{identifier} URL - can be game number or filename prefix
    const pathMatch = window.location.pathname.match(/\/theater\/([^\/]+)/);

    if (pathMatch) {
        const identifier = pathMatch[1];

        try {
            const response = await fetch('/gameindex.json');
            const gameIndex = await response.json();

            // Check if identifier is a game number (all digits)
            if (/^\d+$/.test(identifier)) {
                const game = gameIndex[identifier];
                if (game) {
                    mapName = game.map || 'Unknown';
                    telemetryFile = game.theater || '';
                    gameInfo = {
                        map: mapName,
                        gameType: game.gametype || '',
                        date: game.timestamp || '',
                        variant: game.gametype || ''
                    };
                } else {
                    console.error(`Game #${identifier} not found`);
                    mapName = 'Unknown';
                    telemetryFile = '';
                    gameInfo = {};
                }
            } else {
                // Identifier is a filename prefix (e.g., 20251202_203858)
                // Search gameindex for matching theater file
                const searchFilename = `${identifier}_theater.csv`;
                let foundGame = null;

                for (const [gameNum, game] of Object.entries(gameIndex)) {
                    if (game.theater === searchFilename) {
                        foundGame = game;
                        break;
                    }
                }

                if (foundGame) {
                    mapName = foundGame.map || 'Unknown';
                    telemetryFile = foundGame.theater || '';
                    gameInfo = {
                        map: mapName,
                        gameType: foundGame.gametype || '',
                        date: foundGame.timestamp || '',
                        variant: foundGame.gametype || ''
                    };
                } else {
                    // No match in gameindex - theater file not available
                    console.error(`No theater file found for ${identifier}`);
                    throw new Error('Sorry, it seems this file was lost');
                }
            }
        } catch (e) {
            // Rethrow user-facing errors, only catch network/parse errors
            if (e.message === 'Sorry, it seems this file was lost') {
                throw e;
            }
            console.error('Failed to load gameindex.json:', e);
            mapName = 'Unknown';
            telemetryFile = '';
            gameInfo = {};
        }
    } else {
        // Fallback to query params
        const params = new URLSearchParams(window.location.search);
        const liveToken = params.get('live');

        if (liveToken) {
            // Live theater mode — resolve token to server_id asynchronously.
            // connectLiveTheater() is called from the loading sequence and
            // will await this promise to get the server_id before connecting
            // directly to ws_server.py for 10Hz data.
            isLiveMode = true;
            liveTheaterToken = liveToken;
            mapName = 'Loading...';
            liveServerIdPromise = fetch('/api/theater/token/resolve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({token: liveToken})
            })
            .then(r => r.json())
            .then(d => {
                if (d.ok && d.server_id) {
                    liveServerId = String(d.server_id);
                    console.log('[theater] Resolved server_id:', liveServerId);
                } else {
                    console.error('[theater] Token resolve failed:', d);
                }
            })
            .catch(e => console.error('[theater] Token resolve error:', e));
        } else {
            mapName = params.get('map') || 'Midship';
            telemetryFile = params.get('telemetry') || '';
            gameInfo = {
                map: mapName,
                gameType: params.get('gametype') || '',
                date: params.get('date') || '',
                variant: params.get('variant') || ''
            };
        }
    }

    document.getElementById('mapName').textContent = mapName;
    document.getElementById('gameType').textContent = gameInfo.variant || gameInfo.gameType;
    document.getElementById('gameDate').textContent = gameInfo.date;
}

function setupScene() {
    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('glb-canvas');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    scene.fog = new THREE.Fog(0x0a0a12, 50, 200);

    camera = new THREE.PerspectiveCamera(78, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, CONFIG.defaultCameraHeight, 0);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // OrbitControls for orbit mode
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 5;
    controls.maxDistance = 200;
    controls.enabled = false; // Start with WASD mode

    setupLighting();

    const gridHelper = new THREE.GridHelper(100, 100, 0x00c8ff, 0x1a1a2e);
    gridHelper.name = 'gridHelper';
    scene.add(gridHelper);

    window.addEventListener('resize', onWindowResize);
}

// Create skybox based on map type
function createSkybox(mapName) {
    // Maps that should have space-only theme (no Halo ring)
    const spaceMaps = ['midship', 'elongation'];
    const isSpaceMap = spaceMaps.some(m => mapName.toLowerCase().includes(m));

    // Create skybox using canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');

    if (isSpaceMap) {
        // Pure space theme - dark with lots of stars
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#000005');
        gradient.addColorStop(0.5, '#0a0a15');
        gradient.addColorStop(1, '#000005');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Add many stars for space maps
        for (let i = 0; i < 3000; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const radius = Math.random() * 1.5 + 0.5;
            const brightness = Math.random() * 155 + 100;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness + 30}, ${Math.random() * 0.5 + 0.5})`;
            ctx.fill();
        }

        // Add some nebula-like glow
        const nebula = ctx.createRadialGradient(canvas.width * 0.3, canvas.height * 0.4, 0, canvas.width * 0.3, canvas.height * 0.4, 400);
        nebula.addColorStop(0, 'rgba(80, 50, 120, 0.15)');
        nebula.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = nebula;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        // Halo ring theme - blue/purple sky with ring
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#1a1a3a');
        gradient.addColorStop(0.3, '#2a2a5a');
        gradient.addColorStop(0.5, '#1a2a4a');
        gradient.addColorStop(0.7, '#152535');
        gradient.addColorStop(1, '#0a1520');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Add stars
        for (let i = 0; i < 1500; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const radius = Math.random() * 1.2 + 0.3;
            const brightness = Math.random() * 100 + 155;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness + 20}, ${Math.random() * 0.4 + 0.3})`;
            ctx.fill();
        }

        // Draw Halo ring arc across the sky
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height * 0.3);

        // Ring shadow/glow
        ctx.strokeStyle = 'rgba(80, 150, 200, 0.3)';
        ctx.lineWidth = 80;
        ctx.beginPath();
        ctx.ellipse(0, 0, canvas.width * 0.8, canvas.height * 0.15, 0, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();

        // Main ring
        const ringGradient = ctx.createLinearGradient(-canvas.width * 0.8, 0, canvas.width * 0.8, 0);
        ringGradient.addColorStop(0, 'rgba(100, 150, 180, 0.1)');
        ringGradient.addColorStop(0.3, 'rgba(140, 180, 200, 0.6)');
        ringGradient.addColorStop(0.5, 'rgba(180, 210, 230, 0.8)');
        ringGradient.addColorStop(0.7, 'rgba(140, 180, 200, 0.6)');
        ringGradient.addColorStop(1, 'rgba(100, 150, 180, 0.1)');

        ctx.strokeStyle = ringGradient;
        ctx.lineWidth = 25;
        ctx.beginPath();
        ctx.ellipse(0, 0, canvas.width * 0.8, canvas.height * 0.15, 0, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();

        // Ring highlight
        ctx.strokeStyle = 'rgba(200, 230, 255, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, -8, canvas.width * 0.8, canvas.height * 0.15, 0, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();

        ctx.restore();
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;

    // Create large sphere for skybox
    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        fog: false
    });
    const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
    skyMesh.name = 'skybox';
    scene.add(skyMesh);

    // Update scene background to match sky
    scene.background = new THREE.Color(isSpaceMap ? 0x000005 : 0x1a1a3a);
    scene.fog = new THREE.Fog(isSpaceMap ? 0x000005 : 0x1a1a3a, 100, 400);
}

// Store lights for per-map adjustments
let sceneLights = {
    ambient: null,
    hemi: null,
    dir: null,
    fill1: null,
    fill2: null,
    fill3: null
};

function setupLighting() {
    // Strong ambient for interior visibility - key for seeing inside structures
    sceneLights.ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(sceneLights.ambient);

    // Hemisphere light - softer sky/ground blend
    sceneLights.hemi = new THREE.HemisphereLight(0xaaccff, 0x444422, 0.4);
    scene.add(sceneLights.hemi);

    // Main directional light (sun) - reduced to not overpower
    sceneLights.dir = new THREE.DirectionalLight(0xffffff, 0.6);
    sceneLights.dir.position.set(50, 100, 50);
    sceneLights.dir.castShadow = true;
    sceneLights.dir.shadow.mapSize.width = 2048;
    sceneLights.dir.shadow.mapSize.height = 2048;
    sceneLights.dir.shadow.camera.near = 0.5;
    sceneLights.dir.shadow.camera.far = 500;
    sceneLights.dir.shadow.camera.left = -100;
    sceneLights.dir.shadow.camera.right = 100;
    sceneLights.dir.shadow.camera.top = 100;
    sceneLights.dir.shadow.camera.bottom = -100;
    scene.add(sceneLights.dir);

    // Fill lights from multiple angles to illuminate interiors
    sceneLights.fill1 = new THREE.DirectionalLight(0xffffee, 0.4);
    sceneLights.fill1.position.set(-50, 20, -50);
    scene.add(sceneLights.fill1);

    sceneLights.fill2 = new THREE.DirectionalLight(0xeeeeff, 0.4);
    sceneLights.fill2.position.set(50, 20, -50);
    scene.add(sceneLights.fill2);

    sceneLights.fill3 = new THREE.DirectionalLight(0xffeedd, 0.3);
    sceneLights.fill3.position.set(0, -30, 0);  // Light from below for under-ramps/platforms
    scene.add(sceneLights.fill3);
}

// Adjust lighting intensity and color for specific maps
function adjustLightingForMap(mapNameLower) {
    // Default intensities
    let multiplier = 1.0;

    // Reset to default colors first
    if (sceneLights.ambient) sceneLights.ambient.color.setHex(0xffffff);
    if (sceneLights.hemi) {
        sceneLights.hemi.color.setHex(0xaaccff);
        sceneLights.hemi.groundColor.setHex(0x444422);
    }
    if (sceneLights.dir) sceneLights.dir.color.setHex(0xffffff);
    if (sceneLights.fill1) sceneLights.fill1.color.setHex(0xffffee);
    if (sceneLights.fill2) sceneLights.fill2.color.setHex(0xeeeeff);
    if (sceneLights.fill3) sceneLights.fill3.color.setHex(0xffeedd);

    // Warlock - reduce brightness and add dark green glow
    if (mapNameLower === 'warlock') {
        multiplier = 0.5;
        // Dark green tint for Warlock's mystical atmosphere
        const darkGreen = 0x2d5a3d;
        const greenTint = 0x4a7a5a;
        if (sceneLights.ambient) sceneLights.ambient.color.setHex(greenTint);
        if (sceneLights.hemi) {
            sceneLights.hemi.color.setHex(0x3a6a4a);
            sceneLights.hemi.groundColor.setHex(0x1a3a2a);
        }
        if (sceneLights.dir) sceneLights.dir.color.setHex(greenTint);
        if (sceneLights.fill1) sceneLights.fill1.color.setHex(darkGreen);
        if (sceneLights.fill2) sceneLights.fill2.color.setHex(darkGreen);
        if (sceneLights.fill3) sceneLights.fill3.color.setHex(0x1a4a2a);
    }

    // Apply multiplier to all lights
    if (sceneLights.ambient) sceneLights.ambient.intensity = 0.8 * multiplier;
    if (sceneLights.hemi) sceneLights.hemi.intensity = 0.4 * multiplier;
    if (sceneLights.dir) sceneLights.dir.intensity = 0.6 * multiplier;
    if (sceneLights.fill1) sceneLights.fill1.intensity = 0.4 * multiplier;
    if (sceneLights.fill2) sceneLights.fill2.intensity = 0.4 * multiplier;
    if (sceneLights.fill3) sceneLights.fill3.intensity = 0.3 * multiplier;
}

function setupEventListeners() {
    // Playback buttons
    document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
    document.getElementById('skipBackBtn').addEventListener('click', () => skip(-CONFIG.skipSeconds));
    document.getElementById('skipForwardBtn').addEventListener('click', () => skip(CONFIG.skipSeconds));
    document.getElementById('playbackSpeed').addEventListener('change', (e) => {
        playbackSpeed = parseFloat(e.target.value);
        updateSpeedDisplay();
    });

    // Timeline - enhanced media player style
    const timeline = document.getElementById('timeline');
    const timelineContainer = document.querySelector('.timeline-wrapper');

    timeline.addEventListener('mousedown', onTimelineMouseDown);
    timeline.addEventListener('input', onTimelineInput);
    timeline.addEventListener('change', onTimelineChange);

    // Click anywhere on timeline track to seek
    timelineContainer.addEventListener('click', onTimelineClick);

    // View controls - cycling button + dedicated POV
    document.getElementById('viewModeBtn')?.addEventListener('click', () => cycleViewMode());
    document.getElementById('povBtn')?.addEventListener('click', () => setViewMode('pov'));
    document.getElementById('followPlayerSelect')?.addEventListener('change', (e) => {
        if (e.target.value) {
            followPlayer = e.target.value;
            setViewMode('follow');
        }
    });

    // Trails toggle button
    document.getElementById('trailsToggleBtn')?.addEventListener('click', () => toggleTrails());

    // Death markers toggle button
    document.getElementById('deathMarkersBtn')?.addEventListener('click', () => toggleDeathMarkers());

    // Heatmap toggle button
    document.getElementById('heatmapBtn')?.addEventListener('click', () => toggleHeatmap());

    // Controls panel toggle and collapse
    document.getElementById('inputToggleBtn')?.addEventListener('click', toggleInputType);
    document.getElementById('controlsCollapseBtn')?.addEventListener('click', toggleControlsPanel);

    // Keyboard controls
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Mouse controls for free look
    const canvas = document.getElementById('glb-canvas');
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Pointer lock
    document.addEventListener('pointerlockchange', onPointerLockChange);
}

// ===== Controls Panel =====
let showingKeyboard = true;

function toggleInputType() {
    showingKeyboard = !showingKeyboard;
    const keyboardControls = document.getElementById('keyboardControls');
    const controllerControls = document.getElementById('controllerControls');
    const inputTypeText = document.getElementById('inputTypeText');

    if (showingKeyboard) {
        keyboardControls.style.display = 'block';
        controllerControls.style.display = 'none';
        inputTypeText.textContent = 'Keyboard';
    } else {
        keyboardControls.style.display = 'none';
        controllerControls.style.display = 'block';
        inputTypeText.textContent = 'Controller';
    }
}

function toggleControlsPanel() {
    const controlsHint = document.getElementById('controls-hint');
    controlsHint.classList.toggle('collapsed');
}

// ===== Gamepad Support =====
function setupGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
        console.log('Gamepad connected:', e.gamepad.id);
        gamepadIndex = e.gamepad.index;
        gamepadConnected = true;
        showGamepadNotification('Controller connected');
    });

    window.addEventListener('gamepaddisconnected', (e) => {
        console.log('Gamepad disconnected');
        if (e.gamepad.index === gamepadIndex) {
            gamepadIndex = null;
            gamepadConnected = false;
        }
    });
}

function pollGamepad() {
    if (!gamepadConnected || gamepadIndex === null) return null;

    const gamepads = navigator.getGamepads();
    return gamepads[gamepadIndex];
}

function applyDeadzone(value) {
    if (Math.abs(value) < CONFIG.gamepadDeadzone) return 0;
    const sign = value > 0 ? 1 : -1;
    return sign * (Math.abs(value) - CONFIG.gamepadDeadzone) / (1 - CONFIG.gamepadDeadzone);
}

function handleGamepadInput(deltaTime) {
    const gamepad = pollGamepad();
    if (!gamepad) return;

    // Standard gamepad mapping:
    // Left stick: axes[0] (X), axes[1] (Y) - Movement
    // Right stick: axes[2] (X), axes[3] (Y) - Look
    // Buttons: A(0), B(1), X(2), Y(3), LB(4), RB(5), LT(6), RT(7),
    //          Back(8), Start(9), LS(10), RS(11), DPad Up(12), Down(13), Left(14), Right(15)

    const leftX = applyDeadzone(gamepad.axes[0] || 0);
    const leftY = applyDeadzone(gamepad.axes[1] || 0);
    const rightX = applyDeadzone(gamepad.axes[2] || 0);
    const rightY = applyDeadzone(gamepad.axes[3] || 0);

    // Movement (left stick) - only in free mode
    if (viewMode === 'free' && (leftX !== 0 || leftY !== 0)) {
        const speed = CONFIG.gamepadMoveSpeed * deltaTime;
        const direction = new THREE.Vector3();

        // Get camera's actual forward direction (where it's looking)
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);

        // Right vector perpendicular to forward
        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        if (right.lengthSq() < 0.001) {
            right.set(1, 0, 0);
        }

        // Left stick: X = strafe, Y = forward/back (inverted)
        direction.addScaledVector(right, leftX);
        direction.addScaledVector(forward, -leftY);

        camera.position.addScaledVector(direction, speed);
    }

    // Look (right stick) - only in free mode
    if (viewMode === 'free' && (rightX !== 0 || rightY !== 0)) {
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.setFromQuaternion(camera.quaternion);

        euler.y -= rightX * CONFIG.gamepadLookSensitivity;
        euler.x -= rightY * CONFIG.gamepadLookSensitivity;
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

        camera.quaternion.setFromEuler(euler);
    }

    // Player cycling (bumpers LB/RB)
    if (gamepad.buttons[4]?.pressed && !gamepad.buttons[4]._lastState) { // LB - previous player
        cyclePreviousPlayer();
    }
    if (gamepad.buttons[5]?.pressed && !gamepad.buttons[5]._lastState) { // RB - next player
        cycleNextPlayer();
    }
    gamepad.buttons[4]._lastState = gamepad.buttons[4]?.pressed;
    gamepad.buttons[5]._lastState = gamepad.buttons[5]?.pressed;

    // Play/Pause (A button) - only on press, not hold
    if (gamepad.buttons[0]?.pressed && !gamepad.buttons[0]._lastState) {
        togglePlayPause();
    }
    gamepad.buttons[0]._lastState = gamepad.buttons[0]?.pressed;

    // DPad controls
    if (gamepad.buttons[12]?.pressed && !gamepad.buttons[12]._lastState) {
        changeSpeed(1); // DPad Up - increase speed
    }
    if (gamepad.buttons[13]?.pressed && !gamepad.buttons[13]._lastState) {
        toggleKillfeed(); // DPad Down - killfeed
    }
    if (gamepad.buttons[14]?.pressed) { // DPad Left - skip back
        skip(-CONFIG.skipSeconds * deltaTime * 2);
    }
    if (gamepad.buttons[15]?.pressed) { // DPad Right - skip forward
        skip(CONFIG.skipSeconds * deltaTime * 2);
    }
    gamepad.buttons[12]._lastState = gamepad.buttons[12]?.pressed;
    gamepad.buttons[13]._lastState = gamepad.buttons[13]?.pressed;

    // View mode (Y button cycles views)
    if (gamepad.buttons[3]?.pressed && !gamepad.buttons[3]._lastState) {
        cycleViewMode();
    }
    gamepad.buttons[3]._lastState = gamepad.buttons[3]?.pressed;

    // Triggers for fine timeline scrubbing
    const lt = gamepad.buttons[6]?.value || 0;
    const rt = gamepad.buttons[7]?.value || 0;
    if (lt > 0.1 || rt > 0.1) {
        const scrubAmount = (rt - lt) * 100 * deltaTime;
        currentTimeMs = Math.max(startTimeMs, Math.min(startTimeMs + totalDurationMs, currentTimeMs + scrubAmount));
        updateTimeDisplay();
        updatePlayerPositions();
    }
}

function changeSpeed(direction) {
    const speeds = [0.25, 0.5, 1, 2, 4, 8];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const newIndex = Math.max(0, Math.min(speeds.length - 1, currentIndex + direction));
    playbackSpeed = speeds[newIndex];
    document.getElementById('playbackSpeed').value = playbackSpeed;
    updateSpeedDisplay();
}

function cycleViewMode() {
    const modes = ['free', 'top', 'orbit', 'follow', 'pov'];
    const currentIndex = modes.indexOf(viewMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setViewMode(modes[nextIndex]);
}

function showGamepadNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'gamepad-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function updateSpeedDisplay() {
    const btn = document.getElementById('playbackSpeed');
    if (btn) btn.value = playbackSpeed;
}

// ===== Keyboard Controls =====
function onKeyDown(e) {
    keys[e.code] = true;

    // Don't handle shortcuts if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.code) {
        case 'Space':
            if (isLiveMode) break;
            e.preventDefault();
            togglePlayPause();
            break;
        case 'ArrowLeft':
            if (isLiveMode) break;
            e.preventDefault();
            skip(-CONFIG.skipSeconds);
            break;
        case 'ArrowRight':
            if (isLiveMode) break;
            e.preventDefault();
            skip(CONFIG.skipSeconds);
            break;
        case 'ArrowUp':
            if (isLiveMode) break;
            e.preventDefault();
            changeSpeed(1);
            break;
        case 'ArrowDown':
            if (isLiveMode) break;
            e.preventDefault();
            changeSpeed(-1);
            break;
        case 'Digit1':
            setViewMode('top');
            break;
        case 'Digit2':
            setViewMode('free');
            break;
        case 'Digit3':
            setViewMode('orbit');
            break;
        case 'Digit4':
            setViewMode('follow');
            break;
        case 'KeyF':
            toggleFullscreen();
            break;
        case 'KeyM':
            // Toggle mute (future audio support)
            break;
        case 'Home':
            if (isLiveMode) break;
            currentTimeMs = startTimeMs;
            updateTimeDisplay();
            updatePlayerPositions();
            break;
        case 'End':
            if (isLiveMode) break;
            currentTimeMs = startTimeMs + totalDurationMs;
            updateTimeDisplay();
            updatePlayerPositions();
            break;
        case 'Escape':
            if (pointerLocked) {
                document.exitPointerLock();
            }
            break;
        case 'Tab':
            e.preventDefault();
            toggleScoreboard();
            break;
        case 'KeyK':
            toggleKillfeed();
            break;
        case 'KeyP':
            togglePlayerNames();
            break;
        case 'KeyL':
            if (isLiveMode) break;
            toggleTrails();
            break;
        case 'KeyX':
            if (isLiveMode) break;
            toggleDeathMarkers();
            break;
        case 'KeyH':
            if (isLiveMode) break;
            toggleHeatmap();
            break;
        case 'KeyY':
            cycleViewMode();
            break;
        case 'KeyV':
            setViewMode('pov');
            break;
        case 'KeyT':
            setViewMode('top');
            break;
        case 'BracketLeft':
            cyclePreviousPlayer();
            break;
        case 'BracketRight':
            cycleNextPlayer();
            break;
    }
}

// Toggle functions for keyboard shortcuts
function toggleScoreboard() {
    const scoreboard = document.getElementById('scoreboard');
    if (scoreboard) {
        // Check if currently visible (empty string or 'block' means visible)
        const isVisible = scoreboard.style.display !== 'none';
        scoreboard.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            populateScoreboard();
        }
    }
}

function populateScoreboard() {
    const playersSection = document.getElementById('players-section');
    if (!playersSection) return;

    // Get current player positions for weapon/stat info
    const playerPositions = {};
    for (let i = telemetryData.length - 1; i >= 0; i--) {
        const row = telemetryData[i];
        if (row.gameTimeMs <= currentTimeMs && !playerPositions[row.playerName]) {
            playerPositions[row.playerName] = row;
        }
    }

    // Detect FFA: check if any player has a team that's not red/blue
    const teamSet = new Set();
    players.forEach(p => {
        const t = (p.team || '').toLowerCase();
        if (t) teamSet.add(t);
    });
    const isFFA = teamSet.size > 2 || (teamSet.size === 1 && !teamSet.has('_game_team_red') && !teamSet.has('_game_team_blue') && !teamSet.has('red') && !teamSet.has('blue'));

    // Compute team scores from player kills
    let redTotal = 0, blueTotal = 0;
    const rows = [];

    // For FFA, sort players by kills descending
    const sortedPlayers = isFFA
        ? players.slice().sort((a, b) => {
            const ka = (playerPositions[a.name] || {}).kills || 0;
            const kb = (playerPositions[b.name] || {}).kills || 0;
            return kb - ka;
        })
        : players;

    const ffaHexColors = CONFIG.ffaColors.map(c => '#' + c.toString(16).padStart(6, '0'));

    sortedPlayers.forEach((player, idx) => {
        const pos = playerPositions[player.name] || {};
        const team = player.team || '';
        const isRed = team.includes('red') || team === '_game_team_red';
        const kills = pos.kills || 0;
        const deaths = pos.deaths || 0;
        const assists = pos.assists || 0;
        const isDead = pos.isDead || false;
        const emblemUrl = player.emblemUrl || '';
        const weaponName = pos.currentWeapon || '';
        const weaponIconUrl = getWeaponIconUrl(weaponName);

        if (!isFFA) {
            if (isRed) redTotal += kills; else blueTotal += kills;
        }

        // Emblem — dead=X, has URL=img, fallback=gray square (matches Scoreboard.html)
        let emblemHtml;
        if (isDead) {
            emblemHtml = '<div class="player-emblem"><span class="dead-x"><svg viewBox="0 0 22 22" width="22" height="22"><line x1="2" y1="2" x2="20" y2="20" stroke="#FF0000" stroke-width="3" stroke-linecap="round"/><line x1="20" y1="2" x2="2" y2="20" stroke="#FF0000" stroke-width="3" stroke-linecap="round"/></svg></span></div>';
        } else if (emblemUrl) {
            emblemHtml = `<div class="player-emblem"><img src="${emblemUrl}" style="width:22px;height:22px" onerror="this.outerHTML='<span style=\\'width:22px;height:22px;background:#444;border-radius:2px;display:inline-block\\'></span>'"></div>`;
        } else {
            emblemHtml = '<div class="player-emblem"><span style="width:22px;height:22px;background:#444;border-radius:2px;display:inline-block"></span></div>';
        }

        // Weapon icon
        const weaponHtml = weaponIconUrl
            ? `<div class="player-weapon"><img src="${weaponIconUrl}" alt="${weaponName}"></div>`
            : '<div class="player-weapon"></div>';

        // Stats with K/D/A labels (matches Scoreboard.html)
        const statsHtml = `<div class="player-stats">
            <span class="stat-label">K</span><span class="stat-value">${kills}</span>
            <span class="stat-label">D</span><span class="stat-value">${deaths}</span>
            <span class="stat-label">A</span><span class="stat-value">${assists}</span>
        </div>`;

        if (isFFA) {
            const bgColor = ffaHexColors[idx % ffaHexColors.length] + '66';
            rows.push(`<div class="player-row" style="background-color:${bgColor}">
                ${emblemHtml}${weaponHtml}
                <span class="player-name">${player.name}</span>
                ${statsHtml}
            </div>`);
        } else {
            const teamColor = isRed ? 'red' : 'blue';
            rows.push(`<div class="player-row ${teamColor}">
                ${emblemHtml}${weaponHtml}
                <span class="player-name">${player.name}</span>
                ${statsHtml}
            </div>`);
        }
    });

    playersSection.innerHTML = rows.join('');

    // Update team scores in headers
    const redNameEl = document.getElementById('red-team-name');
    const blueNameEl = document.getElementById('blue-team-name');
    const redScore = document.getElementById('red-team-score');
    const blueScore = document.getElementById('blue-team-score');
    const teamGap = document.querySelector('#scoreboard .team-gap');

    if (isFFA) {
        if (redNameEl) redNameEl.textContent = 'Free For All';
        if (redScore) redScore.textContent = '';
        const redHeader = document.querySelector('#scoreboard .team-header.red');
        const blueHeader = document.querySelector('#scoreboard .team-header.blue');
        if (redHeader) redHeader.style.background = 'linear-gradient(90deg, #1a1a2e, #16213e)';
        if (blueHeader) blueHeader.style.display = 'none';
        if (teamGap) teamGap.style.display = 'none';
    } else {
        if (redScore) redScore.textContent = redTotal;
        if (blueScore) blueScore.textContent = blueTotal;
        const redHeader = document.querySelector('#scoreboard .team-header.red');
        const blueHeader = document.querySelector('#scoreboard .team-header.blue');
        if (redHeader) redHeader.style.background = '';
        if (blueHeader) blueHeader.style.display = '';
        if (teamGap) teamGap.style.display = '';
    }
}

function toggleKillfeed() {
    const killfeed = document.getElementById('killfeed');
    if (killfeed) {
        killfeed.style.display = killfeed.style.display === 'none' ? 'block' : 'none';
    }
}

let showPlayerNames = true;
function togglePlayerNames() {
    showPlayerNames = !showPlayerNames;
    Object.values(playerMarkers).forEach(marker => {
        if (marker.label) {
            marker.label.visible = showPlayerNames;
        }
    });
}

let showTrails = false;
let playerTrails = {};  // Trail line objects for each player
let selectedTrailPlayers = new Set();  // Players with trails enabled

// Death markers
let showDeathMarkers = false;
let deathMarkers = [];  // Array of { sprite, position, playerName, team, timeMs }
let deathEvents = [];   // Raw death events for heatmap: { x, y, z, playerName, team, timeMs }

// Heatmap
let showHeatmap = false;
let heatmapMesh = null;
let heatmapCanvas = null;
let heatmapTexture = null;
let heatmapBounds = null;  // { minX, maxX, minZ, maxZ }

function toggleTrails() {
    showTrails = !showTrails;

    if (showTrails) {
        // If no specific players selected, enable all
        if (selectedTrailPlayers.size === 0) {
            players.forEach(p => selectedTrailPlayers.add(p.name));
            syncTrailDropdown();
        }
        // Show trails for selected players
        Object.entries(playerTrails).forEach(([playerName, trail]) => {
            if (trail.line) {
                trail.line.visible = selectedTrailPlayers.has(playerName);
            }
        });
        rebuildTrails();
    } else {
        // Hide all trail lines
        Object.values(playerTrails).forEach(trail => {
            if (trail.line) {
                trail.line.visible = false;
            }
        });
    }
    updateTrailsButton();
}

// Toggle trail for specific player (called from dropdown)
function setPlayerTrail(playerName, enabled) {
    if (enabled) {
        selectedTrailPlayers.add(playerName);
    } else {
        selectedTrailPlayers.delete(playerName);
    }

    // Update trail visibility
    const trail = playerTrails[playerName];
    if (trail && trail.line) {
        trail.line.visible = showTrails && selectedTrailPlayers.has(playerName);
    }

    // Rebuild trails if showing
    if (showTrails) {
        rebuildTrails();
    }
}

// Update trails button active state
function updateTrailsButton() {
    const btn = document.getElementById('trailsToggleBtn');
    if (btn) {
        btn.classList.toggle('active', showTrails);
    }
}

// Sync dropdown selection with selectedTrailPlayers set
function syncTrailDropdown() {
    const select = document.getElementById('trailPlayerSelect');
    if (!select) return;

    Array.from(select.options).forEach(option => {
        option.selected = selectedTrailPlayers.has(option.value);
    });
}

// Populate the trail player dropdown
function populateTrailDropdown() {
    const select = document.getElementById('trailPlayerSelect');
    if (!select) return;

    select.innerHTML = '';

    players.forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;

        // Add team color class
        const team = player.team || '';
        if (team.includes('red') || team === '_game_team_red') {
            option.className = 'red-player';
        } else if (team.includes('blue') || team === '_game_team_blue') {
            option.className = 'blue-player';
        }

        option.selected = selectedTrailPlayers.has(player.name);
        select.appendChild(option);
    });

    // Handle selection changes
    select.addEventListener('change', () => {
        const selected = Array.from(select.selectedOptions).map(opt => opt.value);

        // Update selectedTrailPlayers based on dropdown
        players.forEach(player => {
            const isSelected = selected.includes(player.name);
            setPlayerTrail(player.name, isSelected);
        });
    });
}

// Death marker functions
function toggleDeathMarkers() {
    showDeathMarkers = !showDeathMarkers;

    if (showDeathMarkers) {
        buildDeathMarkers();
    }

    // Update visibility of all death markers
    deathMarkers.forEach(marker => {
        marker.sprite.visible = showDeathMarkers && marker.timeMs <= currentTimeMs;
    });

    updateDeathMarkersButton();
}

function updateDeathMarkersButton() {
    const btn = document.getElementById('deathMarkersBtn');
    if (btn) {
        btn.classList.toggle('active', showDeathMarkers);
    }
}

function createDeathMarkerSprite(color = 0xff0000) {
    // Create canvas for red X
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Draw red X
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';

    // X shape
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(52, 52);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(52, 12);
    ctx.lineTo(12, 52);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 1.5, 1);  // Medium size

    return sprite;
}

function buildDeathMarkers() {
    // Clear existing death markers from scene
    deathMarkers.forEach(marker => {
        scene.remove(marker.sprite);
        marker.sprite.material.map.dispose();
        marker.sprite.material.dispose();
    });
    deathMarkers = [];
    deathEvents = [];

    // Track last death count for each player
    const lastDeaths = {};

    // Parse telemetry for death events
    for (const row of telemetryData) {
        const playerName = row.playerName;
        const currentDeaths = row.deaths || 0;
        const prevDeaths = lastDeaths[playerName] || 0;

        // Death occurred when death count increases
        if (currentDeaths > prevDeaths) {
            const player = players.find(p => p.name === playerName);
            const team = player?.team || 'none';

            // Halo X->Three X, Halo Z->Three Y, Halo Y->Three Z
            const deathPos = {
                x: row.x,
                y: row.z + 0.5,  // Slightly above ground
                z: row.y
            };

            // Store death event for heatmap
            deathEvents.push({
                x: deathPos.x,
                y: deathPos.y,
                z: deathPos.z,
                playerName,
                team,
                timeMs: row.gameTimeMs
            });

            // Create sprite
            const sprite = createDeathMarkerSprite();
            sprite.position.set(deathPos.x, deathPos.y, deathPos.z);
            sprite.visible = showDeathMarkers && row.gameTimeMs <= currentTimeMs;
            scene.add(sprite);

            deathMarkers.push({
                sprite,
                position: deathPos,
                playerName,
                team,
                timeMs: row.gameTimeMs
            });
        }

        lastDeaths[playerName] = currentDeaths;
    }

    console.log(`Created ${deathMarkers.length} death markers`);
}

function updateDeathMarkersVisibility() {
    if (!showDeathMarkers) return;

    deathMarkers.forEach(marker => {
        marker.sprite.visible = marker.timeMs <= currentTimeMs;
    });
}

// Heatmap functions
function toggleHeatmap() {
    showHeatmap = !showHeatmap;

    if (showHeatmap) {
        buildHeatmap();
    }

    if (heatmapMesh) {
        heatmapMesh.visible = showHeatmap;
    }

    updateHeatmapButton();

    if (showHeatmap) {
        updateHeatmap();
    }
}

function updateHeatmapButton() {
    const btn = document.getElementById('heatmapBtn');
    if (btn) {
        btn.classList.toggle('active', showHeatmap);
    }
}

function buildHeatmap() {
    // First, collect death events if not already done
    if (deathEvents.length === 0) {
        buildDeathMarkers();
    }

    if (deathEvents.length === 0) {
        console.log('No death events for heatmap');
        return;
    }

    // Calculate bounds from all death positions
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    deathEvents.forEach(event => {
        minX = Math.min(minX, event.x);
        maxX = Math.max(maxX, event.x);
        minZ = Math.min(minZ, event.z);
        maxZ = Math.max(maxZ, event.z);
    });

    // Add padding
    const padding = 10;
    minX -= padding;
    maxX += padding;
    minZ -= padding;
    maxZ += padding;

    heatmapBounds = { minX, maxX, minZ, maxZ };

    // Create canvas for heatmap
    const canvasSize = 512;
    heatmapCanvas = document.createElement('canvas');
    heatmapCanvas.width = canvasSize;
    heatmapCanvas.height = canvasSize;

    // Create texture and mesh
    heatmapTexture = new THREE.CanvasTexture(heatmapCanvas);
    heatmapTexture.colorSpace = THREE.SRGBColorSpace;

    const width = maxX - minX;
    const height = maxZ - minZ;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
        map: heatmapTexture,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    // Remove old heatmap if exists
    if (heatmapMesh) {
        scene.remove(heatmapMesh);
        heatmapMesh.geometry.dispose();
        heatmapMesh.material.dispose();
    }

    heatmapMesh = new THREE.Mesh(geometry, material);
    heatmapMesh.rotation.x = -Math.PI / 2;  // Lay flat
    heatmapMesh.position.set((minX + maxX) / 2, 0.5, (minZ + maxZ) / 2);
    heatmapMesh.visible = showHeatmap;
    scene.add(heatmapMesh);

    console.log(`Heatmap created with ${deathEvents.length} death events`);
}

function updateHeatmap() {
    if (!showHeatmap || !heatmapCanvas || !heatmapBounds) return;

    const ctx = heatmapCanvas.getContext('2d');
    const canvasSize = heatmapCanvas.width;

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Get death events up to current time
    const activeDeaths = deathEvents.filter(e => e.timeMs <= currentTimeMs);

    if (activeDeaths.length === 0) {
        if (heatmapTexture) heatmapTexture.needsUpdate = true;
        return;
    }

    const { minX, maxX, minZ, maxZ } = heatmapBounds;
    const width = maxX - minX;
    const height = maxZ - minZ;

    // Draw each death as a radial gradient
    const radius = 30;  // Radius in pixels

    activeDeaths.forEach(event => {
        // Convert world coords to canvas coords
        const canvasX = ((event.x - minX) / width) * canvasSize;
        const canvasY = ((event.z - minZ) / height) * canvasSize;

        // Create radial gradient (red/orange heat effect)
        const gradient = ctx.createRadialGradient(canvasX, canvasY, 0, canvasX, canvasY, radius);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0.4)');
        gradient.addColorStop(0.4, 'rgba(255, 100, 0, 0.25)');
        gradient.addColorStop(1, 'rgba(255, 200, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(canvasX - radius, canvasY - radius, radius * 2, radius * 2);
    });

    // Update texture
    if (heatmapTexture) {
        heatmapTexture.needsUpdate = true;
    }
}

function initializeTrails() {
    // Create trail line for each player
    players.forEach(player => {
        const color = player.team === 'none' || player.team === '' ? 0xffffff : player.color;
        const material = new THREE.LineBasicMaterial({
            color: color,
            linewidth: 2,
            transparent: true,
            opacity: 0.6
        });

        const geometry = new THREE.BufferGeometry();
        const line = new THREE.Line(geometry, material);
        line.frustumCulled = false;
        line.visible = showTrails;
        scene.add(line);

        playerTrails[player.name] = {
            line,
            geometry,
            material,
            positions: []
        };
    });
}

function rebuildTrails() {
    // Clear existing trail data
    Object.values(playerTrails).forEach(trail => {
        trail.positions = [];
    });

    // Build trails from telemetry data up to current time
    const lastPositions = {};

    for (const row of telemetryData) {
        if (row.gameTimeMs > currentTimeMs) break;

        const trail = playerTrails[row.playerName];
        if (!trail) continue;

        // Invert X was done at parse time, so use pos.x directly
        // Halo X->Three X, Halo Z->Three Y, Halo Y->Three Z
        const newPos = { x: row.x, y: row.z, z: row.y };

        const lastPos = lastPositions[row.playerName];

        // Only add point if position changed significantly (reduces clutter)
        if (!lastPos ||
            Math.abs(newPos.x - lastPos.x) > 0.1 ||
            Math.abs(newPos.y - lastPos.y) > 0.1 ||
            Math.abs(newPos.z - lastPos.z) > 0.1) {
            trail.positions.push(newPos.x, newPos.y, newPos.z);
            lastPositions[row.playerName] = newPos;
        }
    }

    // Update trail geometries
    Object.values(playerTrails).forEach(trail => {
        if (trail.positions.length >= 6) {  // Need at least 2 points (6 values)
            trail.geometry.setAttribute('position',
                new THREE.Float32BufferAttribute(trail.positions, 3));
            trail.geometry.attributes.position.needsUpdate = true;
        }
    });
}

function updateTrails() {
    if (!showTrails) return;

    // Update trail for each player with their current position
    for (const player of players) {
        const trail = playerTrails[player.name];
        const marker = playerMarkers[player.name];
        if (!trail || !marker || !marker.group.visible) continue;

        const pos = marker.group.position;
        const len = trail.positions.length;

        // Check if position changed
        if (len >= 3) {
            const lastX = trail.positions[len - 3];
            const lastY = trail.positions[len - 2];
            const lastZ = trail.positions[len - 1];

            if (Math.abs(pos.x - lastX) < 0.1 &&
                Math.abs(pos.y - lastY) < 0.1 &&
                Math.abs(pos.z - lastZ) < 0.1) {
                continue;  // No significant movement
            }
        }

        // Add new position
        trail.positions.push(pos.x, pos.y, pos.z);

        // Update geometry
        trail.geometry.setAttribute('position',
            new THREE.Float32BufferAttribute(trail.positions, 3));
        trail.geometry.attributes.position.needsUpdate = true;
    }
}

function cyclePreviousPlayer() {
    if (players.length === 0) return;
    const currentIndex = players.findIndex(p => p.name === followPlayer);
    const newIndex = currentIndex <= 0 ? players.length - 1 : currentIndex - 1;
    followPlayer = players[newIndex].name;
    if (viewMode !== 'follow') setViewMode('follow');
}

function cycleNextPlayer() {
    if (players.length === 0) return;
    const currentIndex = players.findIndex(p => p.name === followPlayer);
    const newIndex = (currentIndex + 1) % players.length;
    followPlayer = players[newIndex].name;
    if (viewMode !== 'follow') setViewMode('follow');
}

function onKeyUp(e) {
    keys[e.code] = false;
}

// ===== Mouse Controls =====
let rightMouseDown = false;

function onMouseDown(e) {
    if (e.button === 2) { // Right click only for free-look rotation
        rightMouseDown = true;
        mouseDown = true;
    } else if (e.button === 0) { // Left click for pointer lock request
        mouseDown = true;
    }
}

function onMouseUp(e) {
    if (e.button === 2) rightMouseDown = false;
    if (e.button === 0) mouseDown = false;
}

function onMouseMove(e) {
    if (viewMode !== 'free') return;

    // Only look when pointer is locked or right mouse is held
    if (!pointerLocked && !rightMouseDown) return;

    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;

    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(camera.quaternion);

    euler.y -= movementX * CONFIG.lookSensitivity;
    euler.x -= movementY * CONFIG.lookSensitivity;

    // Clamp vertical look
    euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

    camera.quaternion.setFromEuler(euler);
}

function onCanvasClick(e) {
    // Double-click to toggle pointer lock in free mode
    if (viewMode === 'free' && e.detail === 2) {
        const canvas = document.getElementById('glb-canvas');
        canvas.requestPointerLock();
    }
}

function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === document.getElementById('glb-canvas');
}

// ===== WASD Movement =====
function handleKeyboardMovement(deltaTime) {
    if (viewMode !== 'free') return;

    const speed = CONFIG.moveSpeed * deltaTime * (keys['ShiftLeft'] || keys['ShiftRight'] ? CONFIG.sprintMultiplier : 1);

    const direction = new THREE.Vector3();

    // Get camera's actual forward direction (where it's looking, including up/down)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    // Get right vector perpendicular to forward
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // If looking straight up/down, use camera's right vector
    if (right.lengthSq() < 0.001) {
        right.set(1, 0, 0);
    }

    // WASD movement - move in actual camera direction
    if (keys['KeyW']) direction.add(forward);
    if (keys['KeyS']) direction.sub(forward);
    if (keys['KeyA']) direction.sub(right);
    if (keys['KeyD']) direction.add(right);

    // Vertical movement (Q/E go up/down in world space)
    if (keys['KeyQ'] || keys['PageDown']) direction.y -= 1;
    if (keys['KeyE'] || keys['PageUp']) direction.y += 1;

    if (direction.lengthSq() > 0) {
        direction.normalize();
        camera.position.addScaledVector(direction, speed);
    }
}

// ===== Timeline Controls =====
function onTimelineMouseDown(e) {
    isDraggingTimeline = true;
    wasPlayingBeforeDrag = isPlaying;
    if (isPlaying) {
        togglePlayPause();
    }
}

function onTimelineInput(e) {
    const value = parseInt(e.target.value);
    currentTimeMs = startTimeMs + value;
    updateTimeDisplay();
    updatePlayerPositions();
    if (showTrails) rebuildTrails();
}

function onTimelineChange(e) {
    isDraggingTimeline = false;
    const value = parseInt(e.target.value);
    currentTimeMs = startTimeMs + value;
    updateTimeDisplay();
    updatePlayerPositions();
    if (showTrails) rebuildTrails();

    // Resume playing if it was playing before
    if (wasPlayingBeforeDrag && !isPlaying) {
        togglePlayPause();
    }
}

function onTimelineClick(e) {
    const timeline = document.getElementById('timeline');
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * totalDurationMs;

    currentTimeMs = startTimeMs + Math.max(0, Math.min(totalDurationMs, newTime));
    timeline.value = currentTimeMs - startTimeMs;
    updateTimeDisplay();
    updatePlayerPositions();
    if (showTrails) rebuildTrails();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// ===== Loading =====
async function loadMapAndTelemetry() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.querySelector('.loading-text');
    const loadingProgress = document.getElementById('loading-progress');
    const errorOverlay = document.getElementById('error-overlay');

    try {
        if (isLiveMode) {
            // Live theater: connect WebSocket, wait for map name, then load
            loadingText.textContent = 'Connecting to live game...';
            loadingProgress.textContent = '10%';
            await loadSpartanModel();
            loadingProgress.textContent = '30%';

            await connectLiveTheater();

            // Wait for the first WS message to know the map name
            loadingText.textContent = 'Waiting for game data...';
            await waitForMapName();

            loadingText.textContent = 'Loading 3D map...';
            const mapFilename = mapNameToGlbFilename(mapName);
            try {
                await loadH2Map(mapFilename, (progress) => {
                    loadingProgress.textContent = `${Math.round(50 + progress * 50)}%`;
                });
            } catch (mapError) {
                console.warn('.map load failed, trying GLB fallback:', mapError);
                const glbPath = `${CONFIG.mapsPath}${mapFilename}.glb`;
                try {
                    await loadGLB(glbPath, (progress) => {
                        loadingProgress.textContent = `${Math.round(50 + progress * 50)}%`;
                    });
                } catch (glbError) {
                    console.warn('GLB not found either:', glbError);
                    showFallbackMessage();
                }
            }

            adjustLightingForMap(mapName.toLowerCase());
            createSkybox(mapName);
            liveMapLoaded = mapName;

            // Hide replay-only controls in live mode
            const playbackControls = document.querySelector('.playback-controls');
            if (playbackControls) {
                const timeline = playbackControls.querySelector('.timeline-container');
                const controlBtns = playbackControls.querySelector('.control-buttons');
                if (timeline) timeline.style.display = 'none';
                if (controlBtns) controlBtns.style.display = 'none';
            }
            // Hide death markers, heatmap, and trails (replay-only features)
            const deathBtn = document.getElementById('deathMarkersBtn');
            const heatmapBtn = document.getElementById('heatmapBtn');
            const trailsCtrl = document.querySelector('.trails-control');
            if (deathBtn) deathBtn.style.display = 'none';
            if (heatmapBtn) heatmapBtn.style.display = 'none';
            if (trailsCtrl) trailsCtrl.style.display = 'none';

            loadingOverlay.style.display = 'none';
            // Apply saved camera position if available, otherwise default free view
            applySavedCameraPosition();
            setViewMode('free');
            return;
        }

        if (telemetryFile) {
            loadingText.textContent = 'Loading telemetry data...';
            loadingProgress.textContent = '0%';
            await loadTelemetry(telemetryFile);
            loadingProgress.textContent = '30%';
        } else {
            console.warn('No telemetry file specified');
        }

        // Load Spartan model for player markers
        loadingText.textContent = 'Loading Spartan model...';
        loadingProgress.textContent = '40%';
        await loadSpartanModel();

        loadingText.textContent = 'Loading 3D map...';
        const mapFilename = mapNameToGlbFilename(mapName);

        try {
            await loadH2Map(mapFilename, (progress) => {
                loadingProgress.textContent = `${Math.round(50 + progress * 50)}%`;
            });
        } catch (mapError) {
            console.warn('.map load failed, trying GLB fallback:', mapError);
            const glbPath = `${CONFIG.mapsPath}${mapFilename}.glb`;
            try {
                await loadGLB(glbPath, (progress) => {
                    loadingProgress.textContent = `${Math.round(50 + progress * 50)}%`;
                });
            } catch (glbError) {
                console.warn('GLB not found either:', glbError);
                showFallbackMessage();
            }
        }

        // Adjust lighting for specific maps
        adjustLightingForMap(mapName.toLowerCase());

        await createPlayerMarkers();
        initializeTrails();
        populateTrailDropdown();
        createSkybox(mapName);
        loadingOverlay.style.display = 'none';
        // Apply saved camera position, or fit to telemetry bounds
        if (!applySavedCameraPosition()) {
            positionCameraToFit();
        }

        // Populate scoreboard with initial data
        populateScoreboard();

        // Set initial view mode
        setViewMode('free');

    } catch (error) {
        console.error('Error loading:', error);
        loadingOverlay.style.display = 'none';
        errorOverlay.style.display = 'flex';
        document.getElementById('error-text').textContent = error.message;
    }
}

// ===== IndexedDB map cache =====
const MAP_CACHE_DB = 'SpartanLoungeMapCache';
const MAP_CACHE_STORE = 'maps';
const MAP_CACHE_VERSION = 1;

function openMapCacheDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(MAP_CACHE_DB, MAP_CACHE_VERSION);
        req.onupgradeneeded = () => req.result.createObjectStore(MAP_CACHE_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getCachedMap(filename) {
    try {
        const db = await openMapCacheDB();
        return new Promise((resolve) => {
            const tx = db.transaction(MAP_CACHE_STORE, 'readonly');
            const req = tx.objectStore(MAP_CACHE_STORE).get(filename);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

async function cacheMap(filename, arrayBuffer) {
    try {
        const db = await openMapCacheDB();
        const tx = db.transaction(MAP_CACHE_STORE, 'readwrite');
        tx.objectStore(MAP_CACHE_STORE).put(arrayBuffer, filename);
    } catch (e) {
        console.warn('[SpartanLounge] Failed to cache map in IndexedDB:', e.message);
    }
}

async function loadH2Map(mapFilename, onProgress) {
    const mapUrl = `/maps3D/Cartographer/${mapFilename}.map`;
    console.log(`[SpartanLounge] Loading .map: ${mapUrl}`);

    // Cleanup previous H2 renderer
    if (h2RendererInstance) {
        h2RendererInstance.dispose();
        h2RendererInstance = null;
    }

    let mapBuffer;

    // Check IndexedDB cache first
    const cached = await getCachedMap(mapFilename);
    if (cached) {
        console.log(`[SpartanLounge] Cache hit: ${mapFilename} (${(cached.byteLength / 1024 / 1024).toFixed(1)} MB)`);
        mapBuffer = new Uint8Array(cached);
        onProgress?.(0.7);
    } else {
        // Download from server
        const response = await fetch(mapUrl);
        if (!response.ok) throw new Error(`Map not found: ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength) : 0;
        let receivedBytes = 0;
        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedBytes += value.length;
            if (totalBytes > 0 && onProgress) {
                onProgress(receivedBytes / totalBytes * 0.7); // 0-70% for download
            }
        }

        mapBuffer = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
            mapBuffer.set(chunk, offset);
            offset += chunk.length;
        }
        console.log(`[SpartanLounge] Downloaded ${(receivedBytes / 1024 / 1024).toFixed(1)} MB`);

        // Store in IndexedDB for next time (fire and forget)
        cacheMap(mapFilename, mapBuffer.buffer.slice(0));
        console.log(`[SpartanLounge] Caching ${mapFilename} to IndexedDB`);
    }

    // Parse
    console.log('[SpartanLounge] Parsing .map file...');
    console.time('[SpartanLounge] Parse time');
    onProgress?.(0.75);
    const parser = new H2MapParser(mapBuffer.buffer);
    const parsedMap = await parser.parse();
    console.timeEnd('[SpartanLounge] Parse time');

    // Build scene
    console.log('[SpartanLounge] Building Three.js scene...');
    console.time('[SpartanLounge] Build time');
    onProgress?.(0.85);
    const h2r = new H2Renderer(scene);
    h2r.setupLighting();
    h2r.buildFromParsedData(parsedMap);
    h2RendererInstance = h2r;
    console.timeEnd('[SpartanLounge] Build time');

    // Set mapModel to the group so existing code (camera, etc.) works
    mapModel = h2r.mapGroup;

    const gridHelper = scene.getObjectByName('gridHelper');
    if (gridHelper) scene.remove(gridHelper);

    onProgress?.(1.0);
}

async function loadGLB(path, onProgress) {
    // Try .map file first via SpartanLoungeViewer
    const mapFilename = path.replace(/.*\//, '').replace(/\.glb$/, '');
    try {
        await loadH2Map(mapFilename, onProgress);
        console.log('[SpartanLounge] Loaded .map successfully');
        return;
    } catch (mapErr) {
        console.warn(`[SpartanLounge] .map not available (${mapErr.message}), falling back to GLB`);
    }

    // Fallback to GLB loading
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(dracoLoader);

        loader.load(
            path,
            (gltf) => {
                mapModel = gltf.scene;
                mapModel.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                const gridHelper = scene.getObjectByName('gridHelper');
                if (gridHelper) scene.remove(gridHelper);

                scene.add(mapModel);
                resolve(gltf);
            },
            (progress) => {
                if (progress.lengthComputable && onProgress) onProgress(progress.loaded / progress.total);
            },
            reject
        );
    });
}

async function loadSpartanModel() {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(dracoLoader);

        loader.load(
            `${CONFIG.mapsPath}MasterChief.glb`,
            (gltf) => {
                spartanModel = gltf.scene;
                console.log('Loaded Spartan model');
                resolve(gltf);
            },
            undefined,
            (error) => {
                console.warn('Failed to load Spartan model, will use fallback geometry:', error);
                resolve(null);
            }
        );
    });
}

async function loadTelemetry(filename) {
    const response = await fetch(`${CONFIG.telemetryPath}${filename}`);
    if (!response.ok) throw new Error(`Failed to load telemetry: ${response.statusText}`);
    parseTelemetryCSV(await response.text());
}

function parseTelemetryCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) throw new Error('Telemetry file is empty or invalid');

    const header = lines[0].replace(/^\uFEFF/, '').split(',');
    const columnIndex = {};
    header.forEach((col, i) => { columnIndex[col.trim()] = i; });

    // Helper to get column index with fallback names (preferred name first)
    const getCol = (...names) => {
        for (const name of names) {
            if (columnIndex[name] !== undefined) return columnIndex[name];
        }
        return undefined;
    };

    // Map columns with fallbacks for new/legacy formats
    const cols = {
        playerName: getCol('PlayerName'),
        team: getCol('Team'),
        gameTimeMs: getCol('GameTimeMs'),
        // Position: new format uses PosX/PosY/PosZ, legacy uses X/Y/Z
        x: getCol('PosX', 'X'),
        y: getCol('PosY', 'Y'),
        z: getCol('PosZ', 'Z'),
        // Facing: new format has Yaw/Pitch (radians) and YawDeg/PitchDeg (degrees)
        yaw: getCol('Yaw', 'FacingYaw'),
        pitch: getCol('Pitch', 'FacingPitch'),
        yawDeg: getCol('YawDeg'),
        pitchDeg: getCol('PitchDeg'),
        // Status
        isCrouching: getCol('IsCrouching'),
        isAirborne: getCol('IsAirborne'),
        isDead: getCol('IsDead'),
        health: getCol('Health'),
        shield: getCol('Shield'),
        // Weapons
        currentWeapon: getCol('CurrentWeapon'),
        // Emblem: new format uses EmblemFg/EmblemBg, legacy uses EmblemForeground/EmblemBackground
        emblemFg: getCol('EmblemFg', 'EmblemForeground'),
        emblemBg: getCol('EmblemBg', 'EmblemBackground'),
        // Colors: new format uses ColorPrimary, legacy uses PrimaryColor
        colorPrimary: getCol('ColorPrimary', 'PrimaryColor'),
        colorSecondary: getCol('ColorSecondary', 'SecondaryColor'),
        colorTertiary: getCol('ColorTertiary', 'TertiaryColor'),
        colorQuaternary: getCol('ColorQuaternary', 'QuaternaryColor'),
        // Combat stats
        kills: getCol('Kills'),
        deaths: getCol('Deaths'),
        assists: getCol('Assists'),
        // Objective stats
        score: getCol('Score'),
        redTeamScore: getCol('RedTeamScore'),
        blueTeamScore: getCol('BlueTeamScore'),
        // Events
        event: getCol('Event')
    };

    // Validate required columns exist (check both formats)
    if (cols.playerName === undefined) throw new Error('Missing required column: PlayerName');
    if (cols.gameTimeMs === undefined) throw new Error('Missing required column: GameTimeMs');
    if (cols.x === undefined) throw new Error('Missing required column: PosX or X');
    if (cols.y === undefined) throw new Error('Missing required column: PosY or Y');
    if (cols.z === undefined) throw new Error('Missing required column: PosZ or Z');

    telemetryData = [];
    const playerSet = new Set();
    let minTime = Infinity, maxTime = 0;

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < header.length) continue;

        // Get facing angles - prefer degrees if available, otherwise use radians
        let facingYaw = 0, facingPitch = 0;
        if (cols.yawDeg !== undefined) {
            // Convert degrees to radians
            facingYaw = (parseFloat(values[cols.yawDeg]) || 0) * Math.PI / 180;
            facingPitch = (parseFloat(values[cols.pitchDeg]) || 0) * Math.PI / 180;
        } else if (cols.yaw !== undefined) {
            facingYaw = parseFloat(values[cols.yaw]) || 0;
            facingPitch = parseFloat(values[cols.pitch]) || 0;
        }

        const row = {
            playerName: values[cols.playerName],
            team: cols.team !== undefined ? (values[cols.team] || 'none') : 'none',
            gameTimeMs: parseInt(values[cols.gameTimeMs]) || 0,
            x: -(parseFloat(values[cols.x]) || 0),  // Invert X axis for correct positioning
            y: parseFloat(values[cols.y]) || 0,
            z: parseFloat(values[cols.z]) || 0,
            facingYaw: facingYaw,
            facingPitch: facingPitch,
            isCrouching: cols.isCrouching !== undefined ? values[cols.isCrouching] === 'True' : false,
            isAirborne: cols.isAirborne !== undefined ? values[cols.isAirborne] === 'True' : false,
            isDead: cols.isDead !== undefined ? values[cols.isDead] === 'True' : false,
            health: cols.health !== undefined ? parseFloat(values[cols.health]) || 1 : 1,
            shield: cols.shield !== undefined ? parseFloat(values[cols.shield]) || 1 : 1,
            currentWeapon: cols.currentWeapon !== undefined ? (values[cols.currentWeapon] || 'Unknown') : 'Unknown',
            // Emblem data
            emblemForeground: cols.emblemFg !== undefined ? (parseInt(values[cols.emblemFg]) || 0) : 0,
            emblemBackground: cols.emblemBg !== undefined ? (parseInt(values[cols.emblemBg]) || 0) : 0,
            primaryColor: cols.colorPrimary !== undefined ? (parseInt(values[cols.colorPrimary]) || 0) : 0,
            secondaryColor: cols.colorSecondary !== undefined ? (parseInt(values[cols.colorSecondary]) || 0) : 0,
            tertiaryColor: cols.colorTertiary !== undefined ? (parseInt(values[cols.colorTertiary]) || 0) : 0,
            quaternaryColor: cols.colorQuaternary !== undefined ? (parseInt(values[cols.colorQuaternary]) || 0) : 0,
            // Combat stats
            kills: cols.kills !== undefined ? (parseInt(values[cols.kills]) || 0) : 0,
            deaths: cols.deaths !== undefined ? (parseInt(values[cols.deaths]) || 0) : 0,
            assists: cols.assists !== undefined ? (parseInt(values[cols.assists]) || 0) : 0,
            // Events
            event: cols.event !== undefined ? values[cols.event] : ''
        };

        telemetryData.push(row);
        playerSet.add(row.playerName);
        minTime = Math.min(minTime, row.gameTimeMs);
        maxTime = Math.max(maxTime, row.gameTimeMs);
    }

    telemetryData.sort((a, b) => a.gameTimeMs - b.gameTimeMs);

    // Extract map name from CSV if present (fixes Midship default bug)
    const mapCol = getCol('MapName');
    if (mapCol !== undefined && lines.length > 1) {
        const firstDataRow = parseCSVLine(lines[1]);
        const csvMapName = firstDataRow[mapCol]?.trim();
        if (csvMapName) {
            mapName = csvMapName;
            document.getElementById('mapName').textContent = mapName;
        }
    }

    players = [];
    const playerTeams = {};
    telemetryData.forEach(row => {
        if (!playerTeams[row.playerName]) playerTeams[row.playerName] = row.team;
    });

    // Extract player emblems from first occurrence
    const playerEmblemData = {};
    telemetryData.forEach(row => {
        if (!playerEmblemData[row.playerName]) {
            playerEmblemData[row.playerName] = {
                emblemForeground: row.emblemForeground,
                emblemBackground: row.emblemBackground,
                primaryColor: row.primaryColor,
                secondaryColor: row.secondaryColor,
                tertiaryColor: row.tertiaryColor,
                quaternaryColor: row.quaternaryColor
            };
        }
    });

    let ffaColorIndex = 0;
    playerSet.forEach((name) => {
        const team = playerTeams[name] || 'none';
        let color;
        if (team === 'none' || team === '') {
            color = CONFIG.ffaColors[ffaColorIndex++ % CONFIG.ffaColors.length];
        } else {
            color = CONFIG.teamColors[team] || CONFIG.teamColors.default;
        }
        const emblem = playerEmblemData[name] || {};
        // Generate emblem URL using SpartanLounge emblem generator
        const emblemUrl = `${location.origin}/emblems/P${emblem.primaryColor || 0}-S${emblem.secondaryColor || 0}-EP${emblem.tertiaryColor || 0}-ES${emblem.quaternaryColor || 0}-EF${emblem.emblemForeground || 0}-EB${emblem.emblemBackground || 0}-ET0.png`;
        players.push({ name, team, color, emblem, emblemUrl });
    });

    startTimeMs = minTime;
    totalDurationMs = maxTime - minTime;
    currentTimeMs = minTime;

    document.getElementById('totalTime').textContent = formatTime(totalDurationMs);
    document.getElementById('timeline').max = totalDurationMs;
    document.getElementById('timeline').value = 0;

    updatePlayerLegend();
    updateFollowSelect();

    console.log(`Loaded ${telemetryData.length} telemetry points for ${players.length} players`);
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function showFallbackMessage() {
    const container = document.getElementById('canvas-container');
    const message = document.createElement('div');
    message.className = 'no-glb-message';
    message.innerHTML = `
        <h2>No 3D Map Available</h2>
        <p>The GLB file for <strong>${mapName}</strong> hasn't been added yet.</p>
        <p>To add it, place the GLB file at:</p>
        <code>maps/${mapName}.glb</code>
        <p>Player positions will still be displayed on the grid.</p>
    `;
    container.appendChild(message);
}

// ===== Live Theater WebSocket =====

function waitForMapName() {
    return new Promise((resolve) => {
        if (mapName && mapName !== 'Loading...') {
            resolve();
            return;
        }
        liveMapResolve = resolve;
    });
}

async function connectLiveTheater() {
    // Wait for token resolve if still in-flight
    if (liveServerIdPromise) {
        await liveServerIdPromise;
        liveServerIdPromise = null;
    }
    if (!liveServerId) {
        console.error('[theater] No server_id — cannot connect');
        return;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Connect directly to ws_server.py via NGINX proxy for 10Hz data
    liveWs = new WebSocket(`${proto}//${location.host}/ws/halocaster`);

    liveWs.onopen = () => {
        console.log('[theater] Live WS connected, subscribing to server', liveServerId);
        // Subscribe to our specific server for filtered broadcasts
        liveWs.send(JSON.stringify({
            action: 'subscribe',
            server_id: liveServerId
        }));
    };

    liveWs.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);

        if (msg.type === 'init') {
            // ws_server.py sends all active servers on init — extract ours
            const servers = msg.servers || {};
            const srv = servers[liveServerId];
            if (srv) {
                liveServerData = srv;
                handleTheaterUpdate(srv);
            }
            return;
        }

        // Scoreboard update (10Hz from webhook — this is the primary data path)
        if (msg.type === 'scoreboard' && String(msg.server_id) === liveServerId) {
            if (!liveServerData) liveServerData = {};
            liveServerData.scoreboard = msg.data;
            handleTheaterUpdate(liveServerData);
            return;
        }

        // Killfeed update
        if (msg.type === 'killfeed' && String(msg.server_id) === liveServerId) {
            if (!liveServerData) liveServerData = {};
            if (!liveServerData.killfeed) liveServerData.killfeed = [];
            liveServerData.killfeed.push(msg.data);
            liveServerData.killfeed = liveServerData.killfeed.slice(-20);
            updateLiveKillfeed(liveServerData);
            return;
        }

        // Viewer count (from ws_server.py subscription tracking)
        if (msg.type === 'viewer_count') {
            const el = document.getElementById('viewer-count');
            if (el) el.textContent = msg.count;
            return;
        }

        // Game end — clear data
        if (msg.type === 'game_end' && String(msg.server_id) === liveServerId) {
            liveServerData = {};
            return;
        }
    };

    liveWs.onclose = (ev) => {
        console.log('[theater] Live WS closed:', ev.code, ev.reason);
        liveWs = null;
        // Reconnect on unexpected close
        setTimeout(connectLiveTheater, 3000);
    };

    liveWs.onerror = (ev) => {
        console.error('[theater] Live WS error:', ev);
    };

    // Keepalive ping every 30s
    if (!connectLiveTheater._pingInterval) {
        connectLiveTheater._pingInterval = setInterval(() => {
            if (liveWs && liveWs.readyState === WebSocket.OPEN) {
                liveWs.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }
}

/**
 * Handle a theater data update — extracts scoreboard info, updates map,
 * player positions, scoreboard UI, and killfeed.
 */
function handleTheaterUpdate(data) {
    const sb = data.scoreboard;

    if (sb) {
        // Update map name if changed (case-insensitive comparison)
        if (sb.map_name && sb.map_name.toLowerCase() !== mapName.toLowerCase()) {
            mapName = sb.map_name;
            document.getElementById('mapName').textContent = mapName;
            // Resolve initial map wait
            if (liveMapResolve) {
                liveMapResolve();
                liveMapResolve = null;
            }
            // Map changed — always reload the GLB
            loadNewMap(mapName);
        } else if (sb.map_name && !liveMapLoaded) {
            // First data — resolve map wait if still pending
            mapName = sb.map_name;
            document.getElementById('mapName').textContent = mapName;
            if (liveMapResolve) {
                liveMapResolve();
                liveMapResolve = null;
            }
        }

        // Update game info display
        document.getElementById('gameType').textContent =
            sb.variant_name || sb.game_type || '';

        // Update game timer
        const gameTimer = document.getElementById('game-timer');
        if (gameTimer && sb.duration) {
            gameTimer.textContent = sb.duration;
        }
    }

    // Update player positions and markers from live data
    updateLivePlayerData(data);

    // Update scoreboard UI
    updateLiveScoreboard(data);

    // Update killfeed
    updateLiveKillfeed(data);
}

async function loadNewMap(newMapName) {
    // Cleanup previous H2 renderer
    if (h2RendererInstance) {
        h2RendererInstance.dispose();
        h2RendererInstance = null;
    }
    // Remove existing map model
    if (mapModel) {
        scene.remove(mapModel);
        mapModel = null;
    }
    const mapFilename = mapNameToGlbFilename(newMapName);
    try {
        await loadH2Map(mapFilename, null);
    } catch (mapError) {
        console.warn('.map load failed, trying GLB:', mapError);
        try {
            await loadGLB(`${CONFIG.mapsPath}${mapFilename}.glb`);
        } catch (e) {
            console.warn('Map not found:', e);
        }
    }
    adjustLightingForMap(newMapName.toLowerCase());
    createSkybox(newMapName);
    liveMapLoaded = newMapName;
}

function updateLivePlayerData(data) {
    const sb = data.scoreboard;
    if (!sb) return;

    // Collect all players from both teams
    const allPlayers = [];
    if (sb.red_team && sb.red_team.players) {
        sb.red_team.players.forEach(p => allPlayers.push({ ...p, team: 'red' }));
    }
    if (sb.blue_team && sb.blue_team.players) {
        sb.blue_team.players.forEach(p => allPlayers.push({ ...p, team: 'blue' }));
    }

    // Check if we need to create/update player list
    const newPlayerNames = allPlayers.map(p => p.name).sort();
    const existingNames = players.map(p => p.name).sort();
    const playersChanged = JSON.stringify(newPlayerNames) !== JSON.stringify(existingNames);

    if (playersChanged) {
        // Detect FFA
        const isFFA = isLiveFFA(sb);

        // Rebuild player list
        let ffaIdx = 0;
        players = allPlayers.map(p => ({
            name: p.name,
            team: p.team,
            color: isFFA
                ? CONFIG.ffaColors[ffaIdx++ % CONFIG.ffaColors.length]
                : (p.team === 'red' ? CONFIG.teamColors.red : CONFIG.teamColors.blue),
            emblemUrl: p.emblem_url || ''
        }));

        // Recreate markers
        createPlayerMarkers();
        updatePlayerLegend();

        // Populate follow player dropdown
        const followSelect = document.getElementById('followPlayerSelect');
        if (followSelect) {
            followSelect.innerHTML = '<option value="">Select Player...</option>';
            players.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                followSelect.appendChild(opt);
            });
        }
    }

    // Update position data for each player
    allPlayers.forEach(p => {
        if (!p.position) return;
        const yawRad = (p.yaw_deg || 0) * Math.PI / 180;
        const pitchRad = (p.pitch_deg || 0) * Math.PI / 180;

        livePlayerPositions[p.name] = {
            x: -(p.position.x || 0),  // Invert X for Three.js
            y: p.position.y || 0,
            z: p.position.z || 0,
            facingYaw: yawRad,
            facingPitch: pitchRad,
            isCrouching: p.crouching || false,
            isAirborne: p.airborne || false,
            isDead: !(p.alive !== false),
            currentWeapon: p.current_weapon || 'Unknown',
            kills: p.kills || 0,
            deaths: p.deaths || 0,
            team: p.team
        };

        // Update 3D marker position
        const marker = playerMarkers[p.name];
        if (marker) {
            const pos = livePlayerPositions[p.name];
            const isDead = pos.isDead || false;

            // Only update position/rotation when alive — dead players stay at last known position
            if (!isDead) {
                // Halo coords: X->-X (already inverted), Y->Z, Z->Y in Three.js
                marker.group.position.set(pos.x, pos.z, pos.y);
                marker.group.rotation.y = pos.facingYaw - Math.PI / 2;
                if (marker.modelContainer) {
                    marker.modelContainer.rotation.x = -pos.facingPitch;
                    marker.modelContainer.scale.y = pos.isCrouching ? 0.7 : 1;
                }
            }
            // Dead: hide 3D model, show red X emblem. Alive: show model + emblem.
            if (marker.modelContainer) marker.modelContainer.visible = !isDead;
            marker.group.visible = true;
            if (marker.wasDead !== isDead) {
                marker.wasDead = isDead;
                const newCanvas = createWaypointCanvas(p.name, marker.player.color, marker.emblemImage, isDead);
                const newTexture = new THREE.CanvasTexture(newCanvas);
                newTexture.colorSpace = THREE.SRGBColorSpace;
                marker.label.material.map.dispose();
                marker.label.material.map = newTexture;
                marker.label.material.needsUpdate = true;
            }
        }
    });
}

function isLiveFFA(sb) {
    // FFA if team_count > 2 or is_ffa flag or 3+ unique team indices
    if (sb.team_count !== undefined && sb.team_count > 2) return true;
    if (sb.is_ffa) return true;
    // Check for 3+ unique teams among all players
    const allPlayers = [
        ...(sb.red_team && sb.red_team.players || []),
        ...(sb.blue_team && sb.blue_team.players || [])
    ];
    const teamSet = new Set();
    allPlayers.forEach(p => { if (p.team !== undefined && p.team !== null) teamSet.add(p.team); });
    if (teamSet.size > 2) return true;
    // Only red has players and blue is empty
    const rp = sb.red_team && sb.red_team.players ? sb.red_team.players.length : 0;
    const bp = sb.blue_team && sb.blue_team.players ? sb.blue_team.players.length : 0;
    return rp > 0 && bp === 0;
}

function updateLiveScoreboard(data) {
    const sb = data.scoreboard;
    if (!sb) return;

    const playersSection = document.getElementById('players-section');
    if (!playersSection) return;

    const gameType = sb.game_type || '';
    const isFFA = isLiveFFA(sb);

    // Update team header names and scores
    const redNameEl = document.getElementById('red-team-name');
    const blueNameEl = document.getElementById('blue-team-name');
    const redScoreEl = document.getElementById('red-team-score');
    const blueScoreEl = document.getElementById('blue-team-score');
    const teamGap = document.querySelector('#scoreboard .team-gap');

    if (isFFA) {
        // FFA: single "Free For All" header, hide blue
        if (redNameEl) redNameEl.textContent = 'Free For All';
        if (redScoreEl) redScoreEl.textContent = '';
        const redHeader = document.querySelector('#scoreboard .team-header.red');
        const blueHeader = document.querySelector('#scoreboard .team-header.blue');
        if (redHeader) redHeader.style.background = 'linear-gradient(90deg, #1a1a2e, #16213e)';
        if (blueHeader) blueHeader.style.display = 'none';
        if (teamGap) teamGap.style.display = 'none';
    } else {
        // Team game: show both headers
        if (redNameEl && sb.red_team) redNameEl.textContent = sb.red_team.team_name || 'Red Team';
        if (blueNameEl && sb.blue_team) blueNameEl.textContent = sb.blue_team.team_name || 'Blue Team';
        if (redScoreEl && sb.red_team) redScoreEl.textContent = sb.red_team.score || sb.red_team.team_score || 0;
        if (blueScoreEl && sb.blue_team) blueScoreEl.textContent = sb.blue_team.score || sb.blue_team.team_score || 0;
        const redHeader = document.querySelector('#scoreboard .team-header.red');
        const blueHeader = document.querySelector('#scoreboard .team-header.blue');
        if (redHeader) redHeader.style.background = '';
        if (blueHeader) blueHeader.style.display = '';
        if (teamGap) teamGap.style.display = '';
    }

    // Build player rows — matches overlay/Scoreboard.html format
    function renderPlayerRow(p, teamColor, ffaColor) {
        const isDead = p.alive === false || p.is_dead;
        const weaponIconUrl = getWeaponIconUrl(p.current_weapon);

        // Emblem — dead=X, has URL=img, fallback=gray square
        let emblemHtml;
        if (isDead) {
            emblemHtml = '<div class="player-emblem"><span class="dead-x"><svg viewBox="0 0 22 22" width="22" height="22"><line x1="2" y1="2" x2="20" y2="20" stroke="#FF0000" stroke-width="3" stroke-linecap="round"/><line x1="20" y1="2" x2="2" y2="20" stroke="#FF0000" stroke-width="3" stroke-linecap="round"/></svg></span></div>';
        } else if (p.emblem_url) {
            emblemHtml = `<div class="player-emblem"><img src="${p.emblem_url}" style="width:22px;height:22px" onerror="this.outerHTML='<span style=\\'width:22px;height:22px;background:#444;border-radius:2px;display:inline-block\\'></span>'"></div>`;
        } else {
            emblemHtml = '<div class="player-emblem"><span style="width:22px;height:22px;background:#444;border-radius:2px;display:inline-block"></span></div>';
        }

        // Weapon icon
        const weaponHtml = weaponIconUrl
            ? `<div class="player-weapon"><img src="${weaponIconUrl}" alt="${p.current_weapon || 'None'}"></div>`
            : '<div class="player-weapon"></div>';

        // Stats with K/D/A labels
        const statsHtml = `<div class="player-stats">
            <span class="stat-label">K</span><span class="stat-value">${p.kills || 0}</span>
            <span class="stat-label">D</span><span class="stat-value">${p.deaths || 0}</span>
            <span class="stat-label">A</span><span class="stat-value">${p.assists || 0}</span>
        </div>`;

        // FFA: individual colored row, Team: red/blue class
        const rowStyle = ffaColor ? ` style="background-color:${ffaColor}"` : '';
        const rowClass = ffaColor ? '' : teamColor;

        return `<div class="player-row ${rowClass}"${rowStyle}>
            ${emblemHtml}${weaponHtml}
            <span class="player-name">${p.name || 'Unknown'}</span>
            ${statsHtml}
        </div>`;
    }

    const rows = [];
    if (isFFA) {
        // Merge all players, sort by kills desc, assign FFA colors
        const allPlayers = [
            ...(sb.red_team && sb.red_team.players || []),
            ...(sb.blue_team && sb.blue_team.players || [])
        ];
        allPlayers.sort((a, b) => (b.kills || 0) - (a.kills || 0));
        const ffaHexColors = CONFIG.ffaColors.map(c => '#' + c.toString(16).padStart(6, '0'));
        allPlayers.forEach((p, i) => {
            const color = ffaHexColors[i % ffaHexColors.length];
            // Semi-transparent so it's not too bright
            const bgColor = color + '66';
            rows.push(renderPlayerRow(p, '', bgColor));
        });
    } else {
        if (sb.red_team && sb.red_team.players) {
            sb.red_team.players.forEach(p => rows.push(renderPlayerRow(p, 'red', null)));
        }
        if (sb.blue_team && sb.blue_team.players) {
            sb.blue_team.players.forEach(p => rows.push(renderPlayerRow(p, 'blue', null)));
        }
    }
    playersSection.innerHTML = rows.join('');
}

function updateLiveKillfeed(data) {
    const killfeed = data.killfeed;
    if (!killfeed || !Array.isArray(killfeed)) return;

    const container = document.getElementById('killfeed');
    if (!container) return;

    container.innerHTML = killfeed.map(k => {
        const killerClass = k.killer_team === 'Red' ? 'red-text' : 'blue-text';
        const victimClass = k.victim_team === 'Red' ? 'red-text' : 'blue-text';
        const weaponUrl = getWeaponIconUrl(k.weapon);
        const weaponHtml = weaponUrl
            ? `<img class="kill-weapon-icon" src="${weaponUrl}" alt="${k.weapon || ''}" title="${k.weapon || ''}">`
            : `<span class="weapon">${k.weapon || ''}</span>`;
        return `<div class="kill-entry">
            <span class="${killerClass}">${k.killer || ''}</span>
            ${weaponHtml}
            <span class="${victimClass}">${k.victim || ''}</span>
        </div>`;
    }).join('');
}

function updateLiveCameraFollow() {
    if (viewMode === 'follow' && followPlayer) {
        const marker = playerMarkers[followPlayer];
        if (marker && marker.group.visible) {
            const targetPos = marker.group.position.clone();
            targetPos.y += CONFIG.followCameraHeight;
            const offset = new THREE.Vector3(0, 0, CONFIG.followCameraDistance);
            offset.applyQuaternion(marker.group.quaternion);
            camera.position.lerp(targetPos.clone().add(offset), 0.1);
            controls.target.lerp(marker.group.position, 0.1);
        }
    }

    if (viewMode === 'pov' && followPlayer) {
        const marker = playerMarkers[followPlayer];
        const pos = livePlayerPositions[followPlayer];
        if (marker && pos) {
            const eyeHeight = pos.isCrouching ? 0.4 : 0.62;
            camera.position.set(pos.x, pos.z + eyeHeight, pos.y);
            const pitch = pos.facingPitch || 0;
            const yaw = pos.facingYaw || 0;
            // Skip POV rotation if both are zero (data not available yet)
            if (pitch !== 0 || yaw !== 0) {
                const euler = new THREE.Euler(-pitch, yaw - Math.PI / 2, 0, 'YXZ');
                camera.quaternion.setFromEuler(euler);
            }
            marker.group.visible = false;
        }
    } else if (followPlayer) {
        // Ensure marker is visible when not in POV
        const marker = playerMarkers[followPlayer];
        if (marker) marker.group.visible = true;
    }
}

// ===== Player Markers =====
async function createPlayerMarkers() {
    Object.values(playerMarkers).forEach(marker => scene.remove(marker.group));
    playerMarkers = {};

    // Load all emblems first
    const emblemImages = {};
    await Promise.all(players.map(async player => {
        if (player.emblemUrl) {
            emblemImages[player.name] = await loadEmblemImage(player.emblemUrl);
        }
    }));

    players.forEach(player => {
        const group = new THREE.Group();
        group.name = `player_${player.name}`;

        // Model container for the Spartan
        const modelContainer = new THREE.Group();
        let spartanClone = null;

        if (spartanModel) {
            // Clone the loaded MasterChief model (use SkeletonUtils for skinned meshes)
            try {
                spartanClone = SkeletonUtils.clone(spartanModel);

                // Apply team color and fix material visibility
                spartanClone.traverse((child) => {
                    if (child.isMesh) {
                        const fixMat = (mat) => {
                            const m = mat.clone();
                            m.color.setHex(player.color);
                            m.emissive = new THREE.Color(0x000000);
                            m.emissiveIntensity = 0;
                            m.transparent = false;
                            m.opacity = 1;
                            m.side = THREE.DoubleSide;
                            m.depthWrite = true;
                            m.depthTest = true;
                            return m;
                        };
                        if (Array.isArray(child.material)) {
                            child.material = child.material.map(fixMat);
                        } else {
                            child.material = fixMat(child.material);
                        }
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                // Auto-scale model to match player marker height
                const box = new THREE.Box3().setFromObject(spartanClone);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0) {
                    const scale = CONFIG.playerMarkerHeight / maxDim;
                    spartanClone.scale.set(scale, scale, scale);
                }
                // Center model at origin (player position point)
                box.setFromObject(spartanClone);
                const center = new THREE.Vector3();
                box.getCenter(center);
                spartanClone.position.sub(center);

                modelContainer.add(spartanClone);
                console.log('Added Spartan model for player:', player.name, 'scale:', spartanClone.scale.x.toFixed(4));
            } catch (cloneError) {
                console.warn('Failed to clone Spartan model, using fallback:', cloneError);
                spartanClone = null;
            }
        }

        if (!spartanClone) {
            // Fallback geometry if model failed to load
            const bodyGeometry = new THREE.CylinderGeometry(
                CONFIG.playerMarkerSize * 0.4,
                CONFIG.playerMarkerSize * 0.5,
                CONFIG.playerMarkerHeight * 0.7,
                16
            );
            const bodyMaterial = new THREE.MeshStandardMaterial({
                color: player.color,
                metalness: 0.5,
                roughness: 0.4
            });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.position.y = CONFIG.playerMarkerHeight * 0.35;
            body.castShadow = true;
            modelContainer.add(body);

            const headGeometry = new THREE.SphereGeometry(CONFIG.playerMarkerSize * 0.35, 16, 16);
            const headMaterial = new THREE.MeshStandardMaterial({
                color: player.color,
                metalness: 0.5,
                roughness: 0.4
            });
            const head = new THREE.Mesh(headGeometry, headMaterial);
            head.position.y = CONFIG.playerMarkerHeight * 0.8;
            head.castShadow = true;
            modelContainer.add(head);
        }

        group.add(modelContainer);

        // Use waypoint canvas with emblem if available
        const emblemImage = emblemImages[player.name];
        const waypointCanvas = createWaypointCanvas(player.name, player.color, emblemImage);
        const labelTexture = new THREE.CanvasTexture(waypointCanvas);
        labelTexture.colorSpace = THREE.SRGBColorSpace;
        const labelMaterial = new THREE.SpriteMaterial({
            map: labelTexture,
            transparent: true,
            depthTest: false,
            toneMapped: false  // Prevent tone mapping from washing out colors
        });
        const label = new THREE.Sprite(labelMaterial);
        label.scale.set(1.25, 1.5625, 1); // 50% smaller, Aspect ratio 128:160
        label.position.y = CONFIG.playerMarkerHeight + 1.5;
        group.add(label);

        scene.add(group);
        playerMarkers[player.name] = { group, modelContainer, spartanClone, label, player, emblemImage };
    });
}

function createLabelCanvas(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
    ctx.fill();

    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 2;
    ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
    ctx.stroke();

    ctx.font = 'bold 28px Overpass, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    return canvas;
}

// Create a Halo-style waypoint canvas with emblem and arrow
function createWaypointCanvas(text, color, emblemImage = null, isDead = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    const colorHex = `#${color.toString(16).padStart(6, '0')}`;
    const haloBlue = '#00aaff';

    // Draw waypoint arrow pointing down (halo blue)
    const arrowY = 130;
    const arrowSize = 20;
    ctx.fillStyle = haloBlue;
    ctx.beginPath();
    ctx.moveTo(64, arrowY + arrowSize);  // Bottom point
    ctx.lineTo(64 - arrowSize / 2, arrowY);  // Top left
    ctx.lineTo(64 + arrowSize / 2, arrowY);  // Top right
    ctx.closePath();
    ctx.fill();

    // Draw emblem box background (white, no border) - only for alive players
    const boxX = 14;
    const boxY = 10;
    const boxSize = 100;

    // Draw emblem or death X
    if (isDead) {
        // Draw bold red X for dead players (no background)
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(boxX + 15, boxY + 15);
        ctx.lineTo(boxX + boxSize - 15, boxY + boxSize - 15);
        ctx.moveTo(boxX + boxSize - 15, boxY + 15);
        ctx.lineTo(boxX + 15, boxY + boxSize - 15);
        ctx.stroke();
    } else if (emblemImage && emblemImage.complete) {
        // White background only for emblem
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(boxX, boxY, boxSize, boxSize);
        ctx.drawImage(emblemImage, boxX + 4, boxY + 4, boxSize - 8, boxSize - 8);
    } else {
        // Draw player initial as fallback
        ctx.font = 'bold 50px Orbitron, sans-serif';
        ctx.fillStyle = colorHex;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text.charAt(0).toUpperCase(), 64, 60);
    }

    return canvas;
}

// Load emblem image async
function loadEmblemImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

function updatePlayerPositions() {
    const playerPositions = {};

    // Build per-player before/after frames for interpolation
    const beforeFrames = {};
    const afterFrames = {};

    for (let i = 0; i < telemetryData.length; i++) {
        const row = telemetryData[i];
        const name = row.playerName;
        if (row.gameTimeMs <= currentTimeMs) {
            beforeFrames[name] = row;
        } else if (!afterFrames[name]) {
            afterFrames[name] = row;
        }
        // Stop once we have after-frames for all known players and are well past currentTime
        if (row.gameTimeMs > currentTimeMs + 500) break;
    }

    // Interpolate between before and after frames
    for (const name in beforeFrames) {
        const a = beforeFrames[name];
        const b = afterFrames[name];
        if (b && b.gameTimeMs > a.gameTimeMs) {
            // Don't interpolate toward 0,0,0 when the next frame is dead
            if (b.isDead && !a.isDead) {
                playerPositions[name] = a;
            } else if (a.isDead) {
                // Already dead — use before frame as-is (position stays stale)
                playerPositions[name] = a;
            } else {
                const t = (currentTimeMs - a.gameTimeMs) / (b.gameTimeMs - a.gameTimeMs);
                const clamped = Math.max(0, Math.min(1, t));
                playerPositions[name] = {
                    ...a,
                    x: a.x + (b.x - a.x) * clamped,
                    y: a.y + (b.y - a.y) * clamped,
                    z: a.z + (b.z - a.z) * clamped,
                    facingYaw: a.facingYaw + (b.facingYaw - a.facingYaw) * clamped,
                    facingPitch: a.facingPitch + (b.facingPitch - a.facingPitch) * clamped,
                };
            }
        } else {
            playerPositions[name] = a;
        }
    }

    const liveStatsBody = document.getElementById('live-stats-body');
    if (liveStatsBody) liveStatsBody.innerHTML = '';

    for (const player of players) {
        const marker = playerMarkers[player.name];
        if (!marker) continue;

        const pos = playerPositions[player.name];
        if (pos) {
            const isDead = pos.isDead || false;

            // Only update position/rotation when alive — dead players stay at last known position
            if (!isDead) {
                // Position: Halo X->Three X (inverted at parse), Halo Z->Three Y (height), Halo Y->Three Z
                marker.group.position.set(pos.x, pos.z, pos.y);

                // Apply yaw (horizontal rotation) — counterclockwise - 90° offset
                if (!isNaN(pos.facingYaw)) {
                    marker.group.rotation.y = pos.facingYaw - Math.PI / 2;
                }

                // Apply pitch to model container (inverted)
                if (marker.modelContainer && !isNaN(pos.facingPitch)) {
                    marker.modelContainer.rotation.x = -pos.facingPitch;
                }

                // Handle crouching by scaling the model
                if (marker.modelContainer) {
                    if (pos.isCrouching) {
                        marker.modelContainer.scale.y = 0.7;
                    } else {
                        marker.modelContainer.scale.y = 1;
                    }
                }
            }

            // Dead: hide 3D model, show red X emblem. Alive: show model + emblem.
            if (marker.modelContainer) marker.modelContainer.visible = !isDead;
            marker.group.visible = true;
            if (marker.wasDead !== isDead) {
                marker.wasDead = isDead;
                const newCanvas = createWaypointCanvas(player.name, player.color, marker.emblemImage, isDead);
                const newTexture = new THREE.CanvasTexture(newCanvas);
                newTexture.colorSpace = THREE.SRGBColorSpace;
                marker.label.material.map.dispose();
                marker.label.material.map = newTexture;
                marker.label.material.needsUpdate = true;
            }

            if (liveStatsBody) {
                const state = pos.isCrouching ? 'Crouching' : (pos.isAirborne ? 'Airborne' : 'Standing');
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span style="color: #${player.color.toString(16).padStart(6, '0')}">${player.name}</span></td>
                    <td>${pos.currentWeapon}</td>
                    <td>${state}</td>
                `;
                liveStatsBody.appendChild(row);
            }
        } else {
            marker.group.visible = false;
        }
    }

    // Follow camera
    if (viewMode === 'follow' && followPlayer) {
        const marker = playerMarkers[followPlayer];
        if (marker && marker.group.visible) {
            const targetPos = marker.group.position.clone();
            targetPos.y += CONFIG.followCameraHeight;

            const offset = new THREE.Vector3(0, 0, CONFIG.followCameraDistance);
            offset.applyQuaternion(marker.group.quaternion);

            camera.position.lerp(targetPos.clone().add(offset), 0.1);
            controls.target.lerp(marker.group.position, 0.1);
        }
    }

    // POV camera (recorded/telemetry mode)
    if (viewMode === 'pov' && followPlayer) {
        const marker = playerMarkers[followPlayer];
        const pos = playerPositions[followPlayer];
        if (marker && pos) {
            const eyeHeight = pos.isCrouching ? 0.4 : 0.62;
            // Position at player eye level (Halo X->Three X, Halo Z->Three Y, Halo Y->Three Z)
            camera.position.set(pos.x, pos.z + eyeHeight, pos.y);
            const euler = new THREE.Euler(-(pos.facingPitch || 0), (pos.facingYaw || 0) - Math.PI / 2, 0, 'YXZ');
            camera.quaternion.setFromEuler(euler);
            // Hide the followed player's own model in POV
            marker.group.visible = false;
        }
    } else if (viewMode !== 'pov' && followPlayer) {
        // Ensure marker is visible when not in POV
        const marker = playerMarkers[followPlayer];
        if (marker && playerPositions[followPlayer]) marker.group.visible = true;
    }

    // Update scoreboard with current weapons (throttled)
    if (!updatePlayerPositions.lastScoreboardUpdate ||
        currentTimeMs - updatePlayerPositions.lastScoreboardUpdate > 500) {
        updatePlayerPositions.lastScoreboardUpdate = currentTimeMs;
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard && scoreboard.style.display !== 'none') {
            populateScoreboard();
        }
    }
}

// ===== Playback =====
function togglePlayPause() {
    isPlaying = !isPlaying;

    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const playPauseBtn = document.getElementById('playPauseBtn');

    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        playPauseBtn.classList.add('playing');
        lastFrameTime = performance.now();
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playPauseBtn.classList.remove('playing');
    }
}

function skip(seconds) {
    const skipMs = seconds * 1000;
    currentTimeMs = Math.max(startTimeMs, Math.min(startTimeMs + totalDurationMs, currentTimeMs + skipMs));
    updateTimeDisplay();
    updatePlayerPositions();
}

function updateTimeDisplay() {
    const elapsed = currentTimeMs - startTimeMs;
    document.getElementById('currentTime').textContent = formatTime(elapsed);
    document.getElementById('timeline').value = elapsed;

    // Update progress bar visual
    const progress = (elapsed / totalDurationMs) * 100;
    document.getElementById('timeline').style.setProperty('--progress', `${progress}%`);

    // Update game timer display
    const gameTimer = document.getElementById('game-timer');
    if (gameTimer) {
        gameTimer.textContent = formatTime(elapsed);
    }
}

function formatTime(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// ===== View Modes =====
function setViewMode(mode) {
    const prevMode = viewMode;
    viewMode = mode;

    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${mode}ViewBtn`)?.classList.add('active');

    const followSelect = document.getElementById('followPlayerSelect');
    followSelect.style.display = (mode === 'follow' || mode === 'pov') ? 'block' : 'none';

    // Update view mode text
    const modeNames = { free: 'Free', top: 'Top', orbit: 'Orbit', follow: 'Follow', pov: 'POV' };
    const viewModeText = document.getElementById('viewModeText');
    if (viewModeText) viewModeText.textContent = modeNames[mode] || mode;

    // Restore FOV when leaving POV
    if (prevMode === 'pov' && mode !== 'pov') {
        camera.fov = 78;
        camera.updateProjectionMatrix();
        const reticle = document.getElementById('pov-reticle');
        if (reticle) reticle.style.display = 'none';
        // Re-show the followed player's model
        if (followPlayer) {
            const marker = playerMarkers[followPlayer];
            if (marker) marker.group.visible = true;
        }
    }

    // Update controls hint
    updateControlsHint();

    if (mode === 'top') {
        controls.enabled = false;
        camera.position.set(0, CONFIG.defaultCameraHeight, 0);
        camera.lookAt(0, 0, 0);
        camera.up.set(0, 0, -1);
    } else if (mode === 'free') {
        controls.enabled = false;
        camera.up.set(0, 1, 0);
    } else if (mode === 'orbit') {
        controls.enabled = true;
        camera.up.set(0, 1, 0);
        // Set orbit target to where camera is looking (avoid orbiting stale point)
        const lookTarget = new THREE.Vector3();
        camera.getWorldDirection(lookTarget);
        lookTarget.multiplyScalar(20).add(camera.position);
        controls.target.copy(lookTarget);
        controls.update();
    } else if (mode === 'follow') {
        controls.enabled = true;
        camera.up.set(0, 1, 0);
    } else if (mode === 'pov') {
        controls.enabled = false;
        camera.up.set(0, 1, 0);
        camera.fov = 78;
        camera.updateProjectionMatrix();
        const reticle = document.getElementById('pov-reticle');
        if (reticle) reticle.style.display = 'block';
        // Auto-select first player if none selected
        if (!followPlayer && players.length > 0) {
            followPlayer = players[0].name;
            if (followSelect) followSelect.value = followPlayer;
        }
    }
}

function positionCameraToFit() {
    if (telemetryData.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    telemetryData.forEach(row => {
        minX = Math.min(minX, row.x);
        maxX = Math.max(maxX, row.x);
        minY = Math.min(minY, row.y);
        maxY = Math.max(maxY, row.y);
        minZ = Math.min(minZ, row.z);
        maxZ = Math.max(maxZ, row.z);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const maxRange = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    // Position camera above and looking at center (Halo Y -> Three Z, Halo Z -> Three Y)
    camera.position.set(centerX, maxZ + maxRange * 0.8, centerY);
    controls.target.set(centerX, centerZ, centerY);
    controls.update();
}

// ===== Overlord Camera Controls =====
function setupOverlordControls() {
    if (!isOverlord) return;
    // Create save camera position button in the view controls area
    const viewControls = document.querySelector('.view-controls');
    if (!viewControls) return;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'view-btn';
    saveBtn.id = 'saveCameraBtn';
    saveBtn.title = 'Save default camera position for this map (Overlord)';
    saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg><span>Save Cam</span>';
    saveBtn.addEventListener('click', saveCameraPosition);
    viewControls.appendChild(saveBtn);
}

async function saveCameraPosition() {
    if (!isOverlord || !mapName) return;
    const position = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        qx: camera.quaternion.x,
        qy: camera.quaternion.y,
        qz: camera.quaternion.z,
        qw: camera.quaternion.w,
    };
    try {
        const resp = await fetch('/api/theater/camera-position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ map_name: mapName, position }),
        });
        if (resp.ok) {
            savedCameraPositions[mapName.toLowerCase()] = position;
            const btn = document.getElementById('saveCameraBtn');
            if (btn) {
                btn.querySelector('span').textContent = 'Saved!';
                setTimeout(() => { btn.querySelector('span').textContent = 'Save Cam'; }, 2000);
            }
        }
    } catch (e) {
        console.error('Failed to save camera position:', e);
    }
}

function applySavedCameraPosition() {
    if (!mapName) return;
    const pos = savedCameraPositions[mapName.toLowerCase()];
    if (!pos) return;
    camera.position.set(pos.x, pos.y, pos.z);
    camera.quaternion.set(pos.qx, pos.qy, pos.qz, pos.qw);
    return true;
}

// ===== UI Updates =====
function updatePlayerLegend() {
    const container = document.getElementById('player-list');
    if (!container) return;
    container.innerHTML = '';

    players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'player-item';
        item.onclick = () => {
            followPlayer = player.name;
            setViewMode('follow');
        };

        const color = document.createElement('div');
        color.className = 'player-color';
        color.style.backgroundColor = `#${player.color.toString(16).padStart(6, '0')}`;

        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = player.name;

        const team = document.createElement('span');
        team.className = 'player-team';
        if (player.team.includes('blue')) {
            team.classList.add('blue');
            team.textContent = 'Blue';
        } else if (player.team.includes('red')) {
            team.classList.add('red');
            team.textContent = 'Red';
        } else {
            team.classList.add('ffa');
            team.textContent = 'FFA';
        }

        item.appendChild(color);
        item.appendChild(name);
        item.appendChild(team);
        container.appendChild(item);
    });
}

function updateFollowSelect() {
    const select = document.getElementById('followPlayerSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select Player...</option>';

    players.forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        select.appendChild(option);
    });
}

function updateControlsHint() {
    const hint = document.getElementById('controls-hint');
    if (!hint) return;

    if (viewMode === 'free') {
        hint.innerHTML = `
            <div><kbd>WASD</kbd> Move</div>
            <div><kbd>Q</kbd><kbd>E</kbd> Up/Down</div>
            <div><kbd>Shift</kbd> Sprint</div>
            <div><kbd>Mouse</kbd> Look</div>
            <div><kbd>Space</kbd> Play/Pause</div>
        `;
    } else {
        hint.innerHTML = `
            <div><kbd>Space</kbd> Play/Pause</div>
            <div><kbd>←</kbd><kbd>→</kbd> Skip 5s</div>
            <div><kbd>↑</kbd><kbd>↓</kbd> Speed</div>
        `;
    }
}

window.toggleStatsPanel = function() {
    const panel = document.getElementById('stats-panel');
    if (panel) panel.classList.toggle('collapsed');
};

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// Browser fullscreen (fills browser window, hides header/controls)
let isBrowserFullscreen = false;

function toggleBrowserFullscreen() {
    isBrowserFullscreen = !isBrowserFullscreen;
    const container = document.querySelector('.viewer-container');
    const header = document.querySelector('.viewer-header');
    const controls = document.querySelector('.playback-controls');
    const expandIcon = document.getElementById('expandIcon');
    const compressIcon = document.getElementById('compressIcon');

    if (isBrowserFullscreen) {
        container.classList.add('browser-fullscreen');
        header.style.display = 'none';
        controls.classList.add('fullscreen-mode');
        expandIcon.style.display = 'none';
        compressIcon.style.display = 'block';
    } else {
        container.classList.remove('browser-fullscreen');
        header.style.display = 'flex';
        controls.classList.remove('fullscreen-mode');
        expandIcon.style.display = 'block';
        compressIcon.style.display = 'none';
    }

    // Trigger resize to update canvas
    onWindowResize();
}

// Add fullscreen button listener
document.getElementById('fullscreenBtn')?.addEventListener('click', toggleBrowserFullscreen);

// ===== Animation Loop =====
function animate() {
    animationFrameId = requestAnimationFrame(animate);

    const currentTime = performance.now();
    const deltaTime = (currentTime - lastFrameTime) / 1000; // Convert to seconds
    lastFrameTime = currentTime;

    // FPS tracking
    fpsFrames++;
    if (currentTime - fpsLastTime >= 1000) {
        fpsDisplay = fpsFrames;
        fpsFrames = 0;
        fpsLastTime = currentTime;
        const fpsCounter = document.getElementById('fps-counter');
        if (fpsCounter) fpsCounter.textContent = `${fpsDisplay} FPS`;
    }

    // Handle keyboard movement
    handleKeyboardMovement(deltaTime);

    // Handle gamepad input
    handleGamepadInput(deltaTime);

    // Update playback (recorded mode) or live camera (live mode)
    if (isLiveMode) {
        // Live mode: player positions are updated via WebSocket, just handle camera
        updateLiveCameraFollow();
    } else if (isPlaying) {
        currentTimeMs += deltaTime * 1000 * playbackSpeed;

        if (currentTimeMs >= startTimeMs + totalDurationMs) {
            currentTimeMs = startTimeMs; // Loop
            // Reset trails when looping
            if (showTrails) {
                Object.values(playerTrails).forEach(trail => {
                    trail.positions = [];
                });
            }
        }

        updateTimeDisplay();
        updatePlayerPositions();
        updateTrails();
        updateDeathMarkersVisibility();
        updateHeatmap();
    }

    // Update orbit controls
    if (controls.enabled) {
        controls.update();
    }

    renderer.render(scene, camera);
}

// ===== Retry Load =====
window.retryLoad = async function() {
    document.getElementById('error-overlay').style.display = 'none';
    document.getElementById('loading-overlay').style.display = 'flex';
    await loadMapAndTelemetry();
};

// ===== Map Selector (Hidden Feature) =====
const ALL_MAPS = [
    'Ascension', 'Backwash', 'Beaver Creek', 'Burial Mounds', 'Coagulation',
    'Colossus', 'Containment', 'Desolation', 'Elongation', 'Foundation',
    'Gemini', 'Headlong', 'Ivory Tower', 'Lockout', 'Midship',
    'Relic', 'Sanctuary', 'Terminal', 'Triplicate', 'Turf',
    'Warlock', 'Waterworks', 'Zanzibar'
];

// Populate the map selector dropdown
function populateMapSelector() {
    const list = document.getElementById('mapSelectorList');
    if (!list) return;

    list.innerHTML = '';
    ALL_MAPS.forEach(map => {
        const item = document.createElement('div');
        item.className = 'map-selector-item';
        if (map.toLowerCase() === mapName.toLowerCase()) {
            item.classList.add('current');
        }
        item.textContent = map;
        item.onclick = (e) => {
            e.stopPropagation();
            selectMap(map);
        };
        list.appendChild(item);
    });
}

// Toggle map selector dropdown visibility
window.toggleMapSelector = function() {
    const dropdown = document.getElementById('mapSelector');
    if (!dropdown) return;

    const isVisible = dropdown.style.display !== 'none';
    if (isVisible) {
        dropdown.style.display = 'none';
    } else {
        populateMapSelector();
        dropdown.style.display = 'block';
    }
};

// Select a map from the dropdown (free look mode - no telemetry)
async function selectMap(selectedMapName) {
    const dropdown = document.getElementById('mapSelector');
    if (dropdown) dropdown.style.display = 'none';

    // Stop current playback
    isPlaying = false;
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';

    // Clear existing telemetry and player markers
    telemetryData = [];
    players = [];
    Object.values(playerMarkers).forEach(marker => {
        if (marker.mesh) scene.remove(marker.mesh);
        if (marker.nameLabel) scene.remove(marker.nameLabel);
        if (marker.trail) scene.remove(marker.trail);
    });
    playerMarkers = {};

    // Update state
    mapName = selectedMapName;
    telemetryFile = ''; // Free look mode - no telemetry
    gameInfo = { map: selectedMapName, gameType: 'Free Look', date: '', variant: '' };

    // Update UI
    document.getElementById('mapName').textContent = selectedMapName;
    document.getElementById('gameType').textContent = 'Free Look';
    document.getElementById('gameDate').textContent = '';

    // Clear scoreboard
    const playersSection = document.getElementById('players-section');
    if (playersSection) playersSection.innerHTML = '';

    // Hide scoreboard, killfeed, game timer, and playback controls in free look mode
    const scoreboard = document.getElementById('scoreboard');
    const killfeed = document.getElementById('killfeed');
    const gameTimer = document.getElementById('game-timer');
    const playbackControls = document.querySelector('.playback-controls');
    const redScore = document.getElementById('red-team-score');
    const blueScore = document.getElementById('blue-team-score');

    if (scoreboard) scoreboard.style.display = 'none';
    if (killfeed) killfeed.style.display = 'none';
    if (gameTimer) gameTimer.style.display = 'none';
    if (playbackControls) playbackControls.style.display = 'none';
    if (redScore) redScore.textContent = '0';
    if (blueScore) blueScore.textContent = '0';

    // Clear trails
    Object.values(playerTrails).forEach(trail => {
        if (trail.line) scene.remove(trail.line);
    });
    playerTrails = {};
    selectedTrailPlayers.clear();

    // Remove existing map model
    if (mapModel) {
        scene.remove(mapModel);
        mapModel = null;
    }

    // Show loading overlay
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.querySelector('.loading-text');
    const loadingProgress = document.getElementById('loading-progress');
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = 'Loading 3D map...';
    loadingProgress.textContent = '0%';

    try {
        // Load the new map (.map first, GLB fallback)
        const mapFilename = mapNameToGlbFilename(selectedMapName);
        try {
            await loadH2Map(mapFilename, (progress) => {
                loadingProgress.textContent = `${Math.round(progress * 100)}%`;
            });
        } catch (mapError) {
            console.warn('.map load failed, trying GLB:', mapError);
            await loadGLB(`${CONFIG.mapsPath}${mapFilename}.glb`, (progress) => {
                loadingProgress.textContent = `${Math.round(progress * 100)}%`;
            });
        }

        // Adjust lighting for specific maps
        adjustLightingForMap(selectedMapName.toLowerCase());

        // Remove old skybox if exists
        const oldSkybox = scene.getObjectByName('skybox');
        if (oldSkybox) scene.remove(oldSkybox);

        createSkybox(selectedMapName);
        loadingOverlay.style.display = 'none';
        positionCameraToFit();

        // Switch to free view mode
        viewMode = 'free';
        document.getElementById('viewModeText').textContent = 'Free';
    } catch (error) {
        console.error('Failed to load map:', error);
        document.getElementById('error-overlay').style.display = 'flex';
        document.getElementById('error-text').textContent = `Failed to load ${selectedMapName}`;
        loadingOverlay.style.display = 'none';
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('mapSelector');
    const mapNameEl = document.getElementById('mapName');
    if (dropdown && !dropdown.contains(e.target) && e.target !== mapNameEl) {
        dropdown.style.display = 'none';
    }
});

// ===== Initialize =====
init();
