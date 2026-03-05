// SpartanLoungeViewer - Three.js/WebGL renderer for Halo 2 maps
// Custom shaders matching Vulkan Generic.vk.frag/vert pipeline (commit c5ca16c)
// Blinn-Phong lighting with diffuse texture support
// Performance: geometry merged by material, instanced geometry via InstancedMesh

import * as THREE from 'three';

// ===== Vertex shader with UV passthrough =====
const SPARTAN_VERTEX = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUV;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(normalMatrix * normal);
    vUV = uv;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ===== Fragment shader with texture sampling =====
const SPARTAN_FRAGMENT = `
uniform vec3 diffuseColor;
uniform vec3 specularColor;
uniform vec3 sunDirection;
uniform sampler2D diffuseMap;
uniform float hasTexture;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUV;

void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 lightDir = normalize(sunDirection);

    // Sample texture or use solid color
    vec3 baseColor = hasTexture > 0.5
        ? texture2D(diffuseMap, vUV).rgb
        : diffuseColor;

    // Ambient
    vec3 ambient = baseColor * 0.25;

    // Diffuse: Lambertian
    float cosTheta = clamp(dot(-lightDir, normal), 0.0, 1.0);
    vec3 diffuse = baseColor * cosTheta;

    // Specular: Blinn-Phong
    vec3 halfDir = normalize(-lightDir + viewDir);
    float specMod = pow(max(dot(normal, halfDir), 0.0), 32.0);
    vec3 specular = specularColor * specMod * 0.3;

    vec3 finalColor = pow(ambient + diffuse + specular, vec3(1.0 / 2.2));
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
        this.textures = new Map(); // shaderId → THREE.Texture
        this.meshCount = 0;
        this.triCount = 0;
        this.drawCalls = 0;

        this.sunDirection = new THREE.Vector3(0.5, -0.8, 0.3).normalize();
        // Placeholder 1x1 white texture for untextured materials
        this.placeholderTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        this.placeholderTexture.needsUpdate = true;
    }

    buildFromParsedData(parsedMap) {
        const { bspData } = parsedMap;

        for (const bsp of bspData) {
            console.log(`[SpartanLoungeRender] Building BSP: ${bsp.name}`);

            // Upload textures to GPU
            let texturedCount = 0;
            if (bsp.textures) {
                for (const [shaderId, texData] of bsp.textures) {
                    const tex = new THREE.DataTexture(
                        texData.rgba,
                        texData.width,
                        texData.height,
                        THREE.RGBAFormat,
                        THREE.UnsignedByteType
                    );
                    tex.wrapS = THREE.RepeatWrapping;
                    tex.wrapT = THREE.RepeatWrapping;
                    tex.magFilter = THREE.LinearFilter;
                    tex.minFilter = THREE.LinearMipmapLinearFilter;
                    tex.generateMipmaps = true;
                    tex.needsUpdate = true;
                    this.textures.set(shaderId, tex);
                    texturedCount++;
                }
                console.log(`[SpartanLoungeRender] Uploaded ${texturedCount} textures to GPU`);
            }

            // ===== Phase 1: Collect all meshes grouped by material key =====
            const buckets = new Map();

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

                        // Transpose 3x3: C# uses row-vectors (v*M), Three.js uses column-vectors (M*v)
                        rotMat.set(
                            rm[0], rm[3], rm[6], 0,
                            rm[1], rm[4], rm[7], 0,
                            rm[2], rm[5], rm[8], 0,
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
        console.log(`[SpartanLoungeRender]   Draw calls: ${this.drawCalls}`);
        console.log(`[SpartanLoungeRender]   Total triangles: ${this.triCount.toLocaleString()}`);
        console.log(`[SpartanLoungeRender]   Unique materials: ${this.materials.size} (${this.textures.size} textured)`);

        return this.mapGroup;
    }

    mergeGeometries(meshes) {
        if (meshes.length === 0) return null;

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
            positions.set(mesh.vertices.positions, vertOffset * 3);
            if (normals && mesh.vertices.normals) normals.set(mesh.vertices.normals, vertOffset * 3);
            if (uvs && mesh.vertices.texCoords) uvs.set(mesh.vertices.texCoords, vertOffset * 2);
            if (lightmapUVs && mesh.vertices.lightmapUVs) lightmapUVs.set(mesh.vertices.lightmapUVs, vertOffset * 2);

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

    getMaterial(shaderId, matId) {
        const key = shaderId || matId;
        if (this.materials.has(key)) {
            return this.materials.get(key);
        }

        const texture = this.textures.get(key);
        const hasTexture = !!texture;

        // Fallback color for untextured materials
        const hue = ((key * 137) % 360) / 360;
        const color = new THREE.Color();
        color.setHSL(hue, 0.3, 0.5);

        const mat = new THREE.ShaderMaterial({
            vertexShader: SPARTAN_VERTEX,
            fragmentShader: SPARTAN_FRAGMENT,
            uniforms: {
                diffuseColor: { value: color },
                specularColor: { value: new THREE.Color(1, 1, 1) },
                sunDirection: { value: this.sunDirection },
                diffuseMap: { value: texture || this.placeholderTexture },
                hasTexture: { value: hasTexture ? 1.0 : 0.0 }
            },
            side: THREE.DoubleSide
        });

        this.materials.set(key, mat);
        return mat;
    }

    setSunDirection(x, y, z) {
        this.sunDirection.set(x, y, z).normalize();
    }

    setupLighting() {}

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
        for (const tex of this.textures.values()) tex.dispose();
        this.placeholderTexture.dispose();
        this.scene.remove(this.mapGroup);
        this.materials.clear();
        this.textures.clear();
    }
}
