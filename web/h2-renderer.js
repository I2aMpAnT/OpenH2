// SpartanLoungeViewer - Three.js/WebGL renderer for Halo 2 maps
// Custom shaders matching Vulkan Generic.vk.frag/vert pipeline (commit c5ca16c)
// Blinn-Phong lighting: ambient 0.25, specular pow(32)*0.3, gamma 1/2.2
// Performance: geometry merged by material, instanced geometry via InstancedMesh

import * as THREE from 'three';

// ===== Custom vertex shader - mirrors Generic.vk.vert =====
const SPARTAN_VERTEX = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ===== Custom fragment shader - mirrors Generic.vk.frag (no-texture path) =====
const SPARTAN_FRAGMENT = `
uniform vec3 diffuseColor;
uniform vec3 specularColor;
uniform vec3 sunDirection;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDiff = cameraPosition - vWorldPos;
    vec3 viewDir = normalize(viewDiff);
    vec3 lightDir = normalize(sunDirection);

    // Ambient: diffuseColor * 0.25 (Generic.vk.frag line 162)
    vec3 ambient = diffuseColor * 0.25;

    // Diffuse: Lambertian (Generic.vk.frag globalLighting())
    float cosTheta = clamp(dot(-lightDir, normal), 0.0, 1.0);
    vec3 diffuse = diffuseColor * cosTheta;

    // Specular: Blinn-Phong (Generic.vk.frag globalLighting())
    vec3 halfDir = normalize(-lightDir + viewDir);
    float specAngle = max(dot(normal, halfDir), 0.0);
    float specMod = pow(specAngle, 32.0);
    vec3 specular = specularColor * specMod * 0.3;

    vec3 finalColor = ambient + diffuse + specular;

    // Gamma correction (Generic.vk.frag line 222)
    finalColor = pow(finalColor, vec3(1.0 / 2.2));

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

export class H2Renderer {
    constructor(scene) {
        this.scene = scene;
        this.mapGroup = new THREE.Group();
        this.mapGroup.name = 'h2-map';
        this.scene.add(this.mapGroup);

        // Halo 2: Z-up → Three.js: Y-up
        this.mapGroup.rotation.x = -Math.PI / 2;

        this.materials = new Map();
        this.meshCount = 0;
        this.triCount = 0;
        this.drawCalls = 0;

        // Sun direction uniform - shared across all materials
        this.sunDirection = new THREE.Vector3(0.5, -0.8, 0.3).normalize();

        console.log('[SpartanLoungeRender] Renderer initialized, coordinate transform: Z-up → Y-up');
    }

    buildFromParsedData(parsedMap) {
        const { bspData } = parsedMap;

        for (const bsp of bspData) {
            console.log(`[SpartanLoungeRender] Building BSP: ${bsp.name}`);

            // ===== Phase 1: Collect all meshes grouped by material key =====
            const buckets = new Map(); // materialKey → { meshes: [], material: THREE.Material }

            // Cluster meshes (BSP terrain)
            for (const mesh of bsp.clusterMeshes) {
                if (!mesh.vertices.positions || mesh.indices.length === 0) continue;
                const key = mesh.shaderId || mesh.matId;
                if (!buckets.has(key)) {
                    buckets.set(key, { meshes: [], material: this.getMaterial(mesh.shaderId, mesh.matId) });
                }
                buckets.get(key).meshes.push(mesh);
            }

            // ===== Phase 2: Merge each bucket into one draw call =====
            let clusterTriCount = 0;
            for (const [key, bucket] of buckets) {
                const merged = this.mergeGeometries(bucket.meshes);
                if (!merged) continue;

                const threeMesh = new THREE.Mesh(merged, bucket.material);
                threeMesh.name = `cluster_mat_${key}`;
                threeMesh.frustumCulled = true;
                this.mapGroup.add(threeMesh);
                this.drawCalls++;
                clusterTriCount += merged.index.count / 3;
            }

            console.log(`[SpartanLoungeRender] Cluster terrain: ${bsp.clusterMeshes.length} source meshes → ${buckets.size} batched draw calls, ${clusterTriCount} triangles`);

            // ===== Phase 3: Instanced geometry via InstancedMesh =====
            let instanceTriCount = 0;
            let instanceDrawCalls = 0;

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

            for (const [defIdx, instances] of instancesByDef) {
                const def = bsp.instanceMeshes[defIdx];

                // Group definition meshes by material
                const defBuckets = new Map();
                for (const mesh of def.meshes) {
                    if (!mesh.vertices.positions || mesh.indices.length === 0) continue;
                    const key = mesh.shaderId || mesh.matId;
                    if (!defBuckets.has(key)) {
                        defBuckets.set(key, { meshes: [], material: this.getMaterial(mesh.shaderId, mesh.matId) });
                    }
                    defBuckets.get(key).meshes.push(mesh);
                }

                for (const [key, bucket] of defBuckets) {
                    const geom = this.mergeGeometries(bucket.meshes);
                    if (!geom) continue;

                    const instancedMesh = new THREE.InstancedMesh(geom, bucket.material, instances.length);
                    instancedMesh.name = `ig_def${defIdx}_mat${key}`;
                    instancedMesh.frustumCulled = true;

                    const mat4 = new THREE.Matrix4();
                    const rotMat = new THREE.Matrix4();
                    const pos = new THREE.Vector3();
                    const scale = new THREE.Vector3();

                    for (let i = 0; i < instances.length; i++) {
                        const inst = instances[i];
                        const rm = inst.rotationMatrix;

                        rotMat.set(
                            rm[0], rm[1], rm[2], 0,
                            rm[3], rm[4], rm[5], 0,
                            rm[6], rm[7], rm[8], 0,
                            0, 0, 0, 1
                        );

                        pos.set(inst.position.x, inst.position.y, inst.position.z);
                        scale.setScalar(inst.scale);

                        mat4.identity();
                        mat4.makeTranslation(pos.x, pos.y, pos.z);
                        mat4.multiply(rotMat);
                        mat4.scale(scale);

                        instancedMesh.setMatrixAt(i, mat4);
                        instanceTriCount += geom.index.count / 3;
                    }

                    instancedMesh.instanceMatrix.needsUpdate = true;
                    this.mapGroup.add(instancedMesh);
                    this.drawCalls++;
                    instanceDrawCalls++;
                }
            }

            console.log(`[SpartanLoungeRender] Instanced geometry: ${bsp.instancedGeometryInstances.length} instances, ${instancesByDef.size} defs → ${instanceDrawCalls} draw calls, ${instanceTriCount} triangles`);
        }

        this.triCount = 0;
        this.mapGroup.traverse(child => {
            if (child.geometry && child.geometry.index) {
                this.triCount += child.geometry.index.count / 3;
                this.meshCount++;
            }
        });

        console.log(`[SpartanLoungeRender] === BUILD COMPLETE ===`);
        console.log(`[SpartanLoungeRender]   Draw calls: ${this.drawCalls} (was ${bspData.reduce((s, b) => s + b.clusterMeshes.length + b.instancedGeometryInstances.length, 0)} unbatched)`);
        console.log(`[SpartanLoungeRender]   Total triangles: ${this.triCount.toLocaleString()}`);
        console.log(`[SpartanLoungeRender]   Unique materials: ${this.materials.size}`);

        return this.mapGroup;
    }

    // Merge multiple meshes into a single BufferGeometry
    // Each mesh has shared vertex arrays from its cluster but different index ranges
    mergeGeometries(meshes) {
        if (meshes.length === 0) return null;

        // Calculate totals
        let totalVerts = 0;
        let totalIndices = 0;
        for (const mesh of meshes) {
            totalVerts += mesh.vertexCount;
            totalIndices += mesh.indices.length;
        }

        const hasNormals = meshes[0].vertices.normals != null;
        const hasUVs = meshes[0].vertices.texCoords != null;
        const hasLightmapUVs = meshes[0].vertices.lightmapUVs != null;

        const positions = new Float32Array(totalVerts * 3);
        const normals = hasNormals ? new Float32Array(totalVerts * 3) : null;
        const uvs = hasUVs ? new Float32Array(totalVerts * 2) : null;
        const lightmapUVs = hasLightmapUVs ? new Float32Array(totalVerts * 2) : null;

        const use32bit = totalVerts > 65535;
        const indices = use32bit ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

        let vertOffset = 0;
        let idxOffset = 0;

        for (const mesh of meshes) {
            const vc = mesh.vertexCount;

            // Copy vertex data
            positions.set(mesh.vertices.positions, vertOffset * 3);
            if (normals && mesh.vertices.normals) normals.set(mesh.vertices.normals, vertOffset * 3);
            if (uvs && mesh.vertices.texCoords) uvs.set(mesh.vertices.texCoords, vertOffset * 2);
            if (lightmapUVs && mesh.vertices.lightmapUVs) lightmapUVs.set(mesh.vertices.lightmapUVs, vertOffset * 2);

            // Copy indices with vertex offset
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
        if (lightmapUVs) geometry.setAttribute('uv2', new THREE.BufferAttribute(lightmapUVs, 2));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        if (!normals) geometry.computeVertexNormals();

        return geometry;
    }

    // Material system - custom ShaderMaterial matching Generic.vk.frag
    // Generates distinct diffuse colors per shader ID (placeholder until textures)
    getMaterial(shaderId, matId) {
        const key = shaderId || matId;
        if (this.materials.has(key)) {
            return this.materials.get(key);
        }

        const hue = ((key * 137) % 360) / 360;
        const color = new THREE.Color();
        color.setHSL(hue, 0.3, 0.5);

        const specColor = new THREE.Color(1.0, 1.0, 1.0);

        const mat = new THREE.ShaderMaterial({
            vertexShader: SPARTAN_VERTEX,
            fragmentShader: SPARTAN_FRAGMENT,
            uniforms: {
                diffuseColor: { value: color },
                specularColor: { value: specColor },
                sunDirection: { value: this.sunDirection }
            },
            side: THREE.DoubleSide
        });

        this.materials.set(key, mat);
        return mat;
    }

    setSunDirection(x, y, z) {
        this.sunDirection.set(x, y, z).normalize();
    }

    setupLighting() {
        // Custom shader pipeline - no Three.js lights needed
    }

    getMapBounds() {
        const box = new THREE.Box3().setFromObject(this.mapGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        return { center, size, box };
    }

    dispose() {
        this.mapGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        this.scene.remove(this.mapGroup);
        this.materials.clear();
    }
}
