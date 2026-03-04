// SpartanLoungeViewer - GLB Map Exporter
// Parses Halo 2 .map files and exports geometry as .glb
// Uses MeshStandardMaterial for universal GLB compatibility
// Exports: BSP clusters + instanced geometry (all static world geometry)
// Excludes: weapon/player/objective spawns (scenario tag items, not BSP geometry)

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { H2MapParser } from '../h2-map-parser.js';
import { mapNameToFilename } from '../h2-map-viewer.js';

// ===== IndexedDB cache (shared with main viewer) =====
const MAP_CACHE_DB = 'SpartanLoungeMapCache';
const MAP_CACHE_STORE = 'maps';

function openMapCacheDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(MAP_CACHE_DB, 1);
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
        console.warn('[GLBExport] Failed to cache:', e.message);
    }
}

// ===== UI Wiring =====
const mapSelect = document.getElementById('mapSelect');
const exportBtn = document.getElementById('exportBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const statusLog = document.getElementById('statusLog');

mapSelect.addEventListener('change', () => {
    exportBtn.disabled = !mapSelect.value;
});

exportBtn.addEventListener('click', () => {
    if (!mapSelect.value) return;
    exportMap(mapSelect.value);
});

function setProgress(pct, text) {
    progressBar.style.width = `${pct}%`;
    if (text) progressText.textContent = text;
}

function log(msg) {
    const line = document.createElement('div');
    line.textContent = msg;
    statusLog.appendChild(line);
    statusLog.scrollTop = statusLog.scrollHeight;
    console.log(`[GLBExport] ${msg}`);
}

// ===== Main Export Pipeline =====
async function exportMap(mapName) {
    exportBtn.disabled = true;
    progressContainer.style.display = 'block';
    statusLog.style.display = 'block';
    statusLog.innerHTML = '';

    try {
        // 1. Load the .map file
        setProgress(5, 'Loading map file...');
        const mapBuffer = await loadMapFile(mapName);
        log(`Map loaded: ${(mapBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

        // 2. Parse BSP geometry
        setProgress(30, 'Parsing BSP geometry...');
        const parser = new H2MapParser(mapBuffer);
        const parsedMap = await parser.parse();
        log(`Parsed: ${parsedMap.bspData.length} BSP(s)`);

        for (const bsp of parsedMap.bspData) {
            log(`  BSP "${bsp.name}": ${bsp.clusters.length} clusters, ${bsp.instancedGeometryDefs.length} IG defs, ${bsp.instancedGeometryInstances.length} IG instances`);
            log(`  Cluster meshes: ${bsp.clusterMeshes.length}, Shaders: ${bsp.shaders.length}`);
        }

        // 3. Build Three.js scene
        setProgress(50, 'Building 3D scene...');
        const scene = buildScene(parsedMap);

        // 4. Export to GLB
        setProgress(75, 'Exporting GLB...');
        const glbData = await exportToGLB(scene);
        log(`GLB size: ${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB`);

        // 5. Download
        setProgress(95, 'Downloading...');
        downloadBlob(glbData, `${mapNameToFilename(mapName)}.glb`);

        setProgress(100, 'Export complete!');
        log('Done! Check your downloads folder.');

        // Cleanup
        disposeScene(scene);
    } catch (e) {
        log(`ERROR: ${e.message}`);
        console.error(e);
        progressText.textContent = 'Export failed!';
        progressBar.style.background = '#ff4444';
    }

    exportBtn.disabled = false;
}

// ===== Load .map file (with IndexedDB cache) =====
async function loadMapFile(mapName) {
    const filename = mapNameToFilename(mapName);
    const url = `/maps3D/Cartographer/${filename}.map`;

    // Check cache
    const cached = await getCachedMap(filename);
    if (cached) {
        log(`Cache hit: ${filename}`);
        return cached;
    }

    // Fetch
    log(`Downloading ${filename}.map...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

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
        if (totalBytes > 0) {
            setProgress(5 + Math.floor((receivedBytes / totalBytes) * 25), `Downloading... ${Math.floor(receivedBytes / 1024 / 1024)}MB`);
        }
    }

    const buffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
    }

    // Cache
    cacheMap(filename, buffer.buffer.slice(0));
    return buffer.buffer;
}

// ===== Build Three.js Scene from parsed BSP =====
function buildScene(parsedMap) {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = 'halo2-map';
    // Z-up (Halo 2) → Y-up (glTF standard)
    root.rotation.x = -Math.PI / 2;
    scene.add(root);

    const materials = new Map();
    let totalTris = 0;
    let totalDrawCalls = 0;

    for (const bsp of parsedMap.bspData) {
        const bspGroup = new THREE.Group();
        bspGroup.name = bsp.name || 'bsp';
        root.add(bspGroup);

        // --- Cluster geometry (world terrain) ---
        const clusterGroup = new THREE.Group();
        clusterGroup.name = 'clusters';
        bspGroup.add(clusterGroup);

        // Bucket by material
        const clusterBuckets = new Map();
        for (const mesh of bsp.clusterMeshes) {
            if (!mesh.vertices.positions || mesh.indices.length === 0) continue;
            const key = mesh.shaderId || mesh.matId;
            if (!clusterBuckets.has(key)) {
                clusterBuckets.set(key, []);
            }
            clusterBuckets.get(key).push(mesh);
        }

        for (const [key, meshes] of clusterBuckets) {
            const geom = mergeGeometries(meshes);
            if (!geom) continue;
            const mat = getOrCreateMaterial(materials, key);
            const threeMesh = new THREE.Mesh(geom, mat);
            threeMesh.name = `cluster_${key}`;
            clusterGroup.add(threeMesh);
            totalTris += geom.index.count / 3;
            totalDrawCalls++;
        }

        log(`  Clusters: ${clusterBuckets.size} material groups`);

        // --- Instanced geometry (pillars, decorations, etc.) ---
        const igGroup = new THREE.Group();
        igGroup.name = 'instanced_geometry';
        bspGroup.add(igGroup);

        // Group instances by definition index
        const instancesByDef = new Map();
        for (const instance of bsp.instancedGeometryInstances) {
            if (instance.index >= bsp.instanceMeshes.length) continue;
            const def = bsp.instanceMeshes[instance.index];
            if (!def || !def.meshes || def.meshes.length === 0) continue;
            if (!instancesByDef.has(instance.index)) {
                instancesByDef.set(instance.index, []);
            }
            instancesByDef.get(instance.index).push(instance);
        }

        let igTris = 0;
        for (const [defIdx, instances] of instancesByDef) {
            const def = bsp.instanceMeshes[defIdx];

            // Merge all meshes for this definition by material
            const defBuckets = new Map();
            for (const mesh of def.meshes) {
                if (!mesh.vertices.positions || mesh.indices.length === 0) continue;
                const key = mesh.shaderId || mesh.matId;
                if (!defBuckets.has(key)) {
                    defBuckets.set(key, []);
                }
                defBuckets.get(key).push(mesh);
            }

            for (const [key, meshes] of defBuckets) {
                const baseGeom = mergeGeometries(meshes);
                if (!baseGeom) continue;
                const mat = getOrCreateMaterial(materials, key);

                // Bake each instance transform into actual vertex positions
                // This produces universally compatible geometry (no instancing required)
                for (let i = 0; i < instances.length; i++) {
                    const inst = instances[i];
                    const transform = buildInstanceTransform(inst);
                    const bakedGeom = baseGeom.clone();
                    bakedGeom.applyMatrix4(transform);

                    const threeMesh = new THREE.Mesh(bakedGeom, mat);
                    threeMesh.name = `ig_${defIdx}_${i}`;
                    igGroup.add(threeMesh);
                    igTris += bakedGeom.index.count / 3;
                    totalDrawCalls++;
                }
            }
        }

        totalTris += igTris;
        log(`  IG: ${instancesByDef.size} defs, ${bsp.instancedGeometryInstances.length} instances, ${igTris} tris`);
    }

    log(`Scene built: ${totalDrawCalls} meshes, ${totalTris.toLocaleString()} triangles, ${materials.size} materials`);
    return scene;
}

// ===== Build instance transform matrix =====
function buildInstanceTransform(inst) {
    const rm = inst.rotationMatrix;
    const mat4 = new THREE.Matrix4();
    const rotMat = new THREE.Matrix4();
    const pos = new THREE.Vector3(inst.position.x, inst.position.y, inst.position.z);
    const scale = new THREE.Vector3(inst.scale, inst.scale, inst.scale);

    // System.Numerics stores row-major; the 3x3 rotation matrix
    // from the .map file is in row-major order.
    // Three.js Matrix4.set() takes arguments in row-major logical order
    // but stores column-major internally.
    // For the GLB export, use the raw matrix layout — the baked vertex
    // positions are then correct regardless of convention.
    rotMat.set(
        rm[0], rm[1], rm[2], 0,
        rm[3], rm[4], rm[5], 0,
        rm[6], rm[7], rm[8], 0,
        0, 0, 0, 1
    );

    // Compose: Translation * Rotation * Scale
    mat4.identity();
    mat4.makeTranslation(pos.x, pos.y, pos.z);
    mat4.multiply(rotMat);
    mat4.scale(scale);

    return mat4;
}

// ===== Merge multiple parsed meshes into one BufferGeometry =====
function mergeGeometries(meshes) {
    if (meshes.length === 0) return null;

    let totalVerts = 0;
    let totalIndices = 0;
    for (const mesh of meshes) {
        totalVerts += mesh.vertexCount;
        totalIndices += mesh.indices.length;
    }
    if (totalVerts === 0 || totalIndices === 0) return null;

    const hasNormals = meshes[0].vertices.normals != null;
    const hasUVs = meshes[0].vertices.texCoords != null;

    const positions = new Float32Array(totalVerts * 3);
    const normals = hasNormals ? new Float32Array(totalVerts * 3) : null;
    const uvs = hasUVs ? new Float32Array(totalVerts * 2) : null;

    const use32bit = totalVerts > 65535;
    const indices = use32bit ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

    let vertOffset = 0;
    let idxOffset = 0;

    for (const mesh of meshes) {
        const vc = mesh.vertexCount;
        positions.set(mesh.vertices.positions, vertOffset * 3);
        if (normals && mesh.vertices.normals) normals.set(mesh.vertices.normals, vertOffset * 3);
        if (uvs && mesh.vertices.texCoords) uvs.set(mesh.vertices.texCoords, vertOffset * 2);

        for (let i = 0; i < mesh.indices.length; i++) {
            indices[idxOffset + i] = mesh.indices[i] + vertOffset;
        }

        vertOffset += vc;
        idxOffset += mesh.indices.length;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    if (!normals) geometry.computeVertexNormals();

    return geometry;
}

// ===== Material creation (d81c2c4-style: hash-based colors, PBR for GLB compat) =====
function getOrCreateMaterial(cache, key) {
    if (cache.has(key)) return cache.get(key);

    // Deterministic color from material/shader ID
    const hue = ((key * 137) % 360) / 360;
    const color = new THREE.Color();
    color.setHSL(hue, 0.35, 0.55);

    const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.0,
        roughness: 0.7,
        side: THREE.DoubleSide,
        name: `mat_${key}`
    });

    cache.set(key, mat);
    return mat;
}

// ===== Export scene to GLB binary =====
async function exportToGLB(scene) {
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
        exporter.parse(scene, (result) => {
            resolve(result);
        }, (error) => {
            reject(error);
        }, {
            binary: true,
            includeCustomExtensions: false
        });
    });
}

// ===== Download blob as file =====
function downloadBlob(data, filename) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ===== Cleanup =====
function disposeScene(scene) {
    scene.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}
