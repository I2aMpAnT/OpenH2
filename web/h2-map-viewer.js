// SpartanLoungeViewer - Main entry point
// Loads Halo 2 .map files and renders them with Three.js/WebGL
// Replaces GLB viewer for native map rendering

import * as THREE from 'three';
import { H2MapParser } from './h2-map-parser.js';
import { H2Renderer } from './h2-renderer.js';

// Map internal names to .map filenames at /maps3D/Cartographer/
const MAP_NAME_TO_FILE = {
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

export function mapNameToFilename(mapName) {
    const normalized = mapName.toLowerCase().trim();
    return MAP_NAME_TO_FILE[normalized] || normalized.replace(/\s+/g, '_');
}

/**
 * Load and render a Halo 2 .map file
 * @param {THREE.Scene} scene - Three.js scene
 * @param {string} mapName - Map name (e.g. "warlock")
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<H2Renderer>} The renderer instance
 */
export async function loadH2Map(scene, mapName, onProgress) {
    const filename = mapNameToFilename(mapName);
    const url = `/maps3D/Cartographer/${filename}.map`;

    console.log(`[SpartanLounge] Loading map: ${url}`);
    onProgress?.(5);

    // Fetch the .map file as ArrayBuffer
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load map: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength) : 0;

    // Stream download with progress
    let receivedBytes = 0;
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        if (totalBytes > 0) {
            const pct = Math.floor((receivedBytes / totalBytes) * 60) + 5; // 5-65%
            onProgress?.(pct);
        }
    }

    // Combine chunks into single ArrayBuffer
    const mapBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
        mapBuffer.set(chunk, offset);
        offset += chunk.length;
    }

    console.log(`[SpartanLounge] Downloaded ${(receivedBytes / 1024 / 1024).toFixed(1)} MB`);
    onProgress?.(70);

    // Parse the map file
    const parser = new H2MapParser(mapBuffer.buffer);
    const parsedMap = parser.parse();
    onProgress?.(85);

    // Build Three.js scene
    const renderer = new H2Renderer(scene);
    renderer.setupLighting();
    renderer.buildFromParsedData(parsedMap);
    onProgress?.(95);

    // Position based on map bounds
    const bounds = renderer.getMapBounds();
    console.log(`[SpartanLounge] Map center: ${bounds.center.x.toFixed(1)}, ${bounds.center.y.toFixed(1)}, ${bounds.center.z.toFixed(1)}`);
    console.log(`[SpartanLounge] Map size: ${bounds.size.x.toFixed(1)} x ${bounds.size.y.toFixed(1)} x ${bounds.size.z.toFixed(1)}`);

    onProgress?.(100);
    return renderer;
}

/**
 * Get list of available maps (for map selector dropdown)
 */
export function getAvailableMaps() {
    return Object.keys(MAP_NAME_TO_FILE).map(name => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        file: MAP_NAME_TO_FILE[name]
    }));
}
