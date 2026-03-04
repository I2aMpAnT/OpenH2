// SpartanLoungeViewer - Three.js/WebGL renderer for Halo 2 maps
// Custom shaders matching Vulkan Generic.vk.frag/vert pipeline (commit c5ca16c)
// Blinn-Phong lighting: ambient 0.25, specular pow(32)*0.3, gamma 1/2.2

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
// Matches the lighting model from commit c5ca16c exactly:
//   ambient = diffuseColor * 0.25
//   diffuse = diffuseColor * cosTheta
//   specular = specularColor * pow(halfAngle, 32) * 0.3
//   gamma = pow(finalColor, 1/2.2)
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

        // Halo 2 uses a different coordinate system - Z-up, we need Y-up for Three.js
        // Halo 2: X=right, Y=forward, Z=up
        // Three.js: X=right, Y=up, Z=backward
        this.mapGroup.rotation.x = -Math.PI / 2;

        this.materials = new Map(); // cache by shaderId
        this.meshCount = 0;
        this.triCount = 0;
        this.vertCount = 0;
        this.failedMeshes = 0;

        // Sun direction uniform - shared across all materials
        // Default matches typical Halo 2 outdoor lighting
        this.sunDirection = new THREE.Vector3(0.5, -0.8, 0.3).normalize();

        console.log('[SpartanLoungeRender] Renderer initialized, coordinate transform: Z-up → Y-up');
        console.log('[SpartanLoungeRender] Shader: Blinn-Phong (ambient=0.25, specPow=32, specScale=0.3, gamma=2.2)');
    }

    // Build Three.js geometry from parsed BSP data
    buildFromParsedData(parsedMap) {
        const { bspData } = parsedMap;

        for (const bsp of bspData) {
            console.log(`[SpartanLoungeRender] Building BSP: ${bsp.name}`);
            console.log(`[SpartanLoungeRender] Bounds: X[${bsp.bounds.minX.toFixed(1)}, ${bsp.bounds.maxX.toFixed(1)}] ` +
                `Y[${bsp.bounds.minY.toFixed(1)}, ${bsp.bounds.maxY.toFixed(1)}] ` +
                `Z[${bsp.bounds.minZ.toFixed(1)}, ${bsp.bounds.maxZ.toFixed(1)}]`);

            // Build cluster meshes (BSP terrain)
            let clusterTriCount = 0;
            for (const mesh of bsp.clusterMeshes) {
                const threeMesh = this.createThreeMesh(mesh);
                if (threeMesh) {
                    this.mapGroup.add(threeMesh);
                    clusterTriCount += mesh.indices.length / 3;
                }
            }
            console.log(`[SpartanLoungeRender] Cluster terrain: ${bsp.clusterMeshes.length} meshes, ${clusterTriCount} triangles`);

            // Build instanced geometry
            let instanceTriCount = 0;
            for (const instance of bsp.instancedGeometryInstances) {
                if (instance.index >= bsp.instanceMeshes.length) continue;

                const def = bsp.instanceMeshes[instance.index];
                if (!def || !def.meshes || def.meshes.length === 0) continue;

                const instanceGroup = new THREE.Group();
                instanceGroup.name = `instance_${instance.index}`;

                for (const mesh of def.meshes) {
                    const threeMesh = this.createThreeMesh(mesh);
                    if (threeMesh) {
                        instanceGroup.add(threeMesh);
                        instanceTriCount += mesh.indices.length / 3;
                    }
                }

                // Apply instance transform
                instanceGroup.position.set(instance.position.x, instance.position.y, instance.position.z);
                instanceGroup.scale.setScalar(instance.scale);

                // Apply 3x3 rotation matrix
                const rm = instance.rotationMatrix;
                const mat4 = new THREE.Matrix4();
                mat4.set(
                    rm[0], rm[1], rm[2], 0,
                    rm[3], rm[4], rm[5], 0,
                    rm[6], rm[7], rm[8], 0,
                    0, 0, 0, 1
                );
                instanceGroup.applyMatrix4(mat4);
                instanceGroup.position.set(instance.position.x, instance.position.y, instance.position.z);

                this.mapGroup.add(instanceGroup);
            }
            console.log(`[SpartanLoungeRender] Instanced geometry: ${bsp.instancedGeometryInstances.length} instances, ${instanceTriCount} triangles`);
        }

        // Final stats
        console.log(`[SpartanLoungeRender] === BUILD COMPLETE ===`);
        console.log(`[SpartanLoungeRender]   Total meshes: ${this.meshCount} (${this.failedMeshes} failed)`);
        console.log(`[SpartanLoungeRender]   Total triangles: ${this.triCount.toLocaleString()}`);
        console.log(`[SpartanLoungeRender]   Unique materials: ${this.materials.size}`);
        console.log(`[SpartanLoungeRender]   Scene children: ${this.mapGroup.children.length}`);

        return this.mapGroup;
    }

    // Create a Three.js mesh from parsed mesh data
    createThreeMesh(meshData) {
        const { indices, vertices, vertexCount } = meshData;

        if (!vertices.positions || indices.length === 0) {
            this.failedMeshes++;
            return null;
        }

        const geometry = new THREE.BufferGeometry();

        // Positions
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices.positions, 3));

        // Normals
        if (vertices.normals) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(vertices.normals, 3));
        }

        // UVs (for future texture support)
        if (vertices.texCoords) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(vertices.texCoords, 2));
        }

        // Lightmap UVs (for future lightmap support)
        if (vertices.lightmapUVs) {
            geometry.setAttribute('uv2', new THREE.BufferAttribute(vertices.lightmapUVs, 2));
        }

        // Set index buffer - find max safely without stack overflow
        let maxIndex = 0;
        for (let i = 0; i < indices.length; i++) {
            if (indices[i] > maxIndex) maxIndex = indices[i];
        }
        if (maxIndex > 65535) {
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        } else {
            geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        }

        // Generate normals if not provided
        if (!vertices.normals) {
            geometry.computeVertexNormals();
        }

        // Get or create material (custom ShaderMaterial matching Vulkan pipeline)
        const material = this.getMaterial(meshData.shaderId, meshData.matId);

        const mesh = new THREE.Mesh(geometry, material);

        this.meshCount++;
        this.triCount += indices.length / 3;
        this.vertCount += vertexCount;

        return mesh;
    }

    // Material system - custom ShaderMaterial matching Generic.vk.frag
    // Generates distinct diffuse colors per shader ID (placeholder until textures)
    getMaterial(shaderId, matId) {
        const key = shaderId || matId;
        if (this.materials.has(key)) {
            return this.materials.get(key);
        }

        // Generate a consistent color from the shader/material ID
        const hue = ((key * 137) % 360) / 360;
        const color = new THREE.Color();
        color.setHSL(hue, 0.3, 0.5);

        // Specular color defaults to white (matches Vulkan SpecularColor default)
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

    // Set sun direction (normalized) - updates all materials
    setSunDirection(x, y, z) {
        this.sunDirection.set(x, y, z).normalize();
        console.log(`[SpartanLoungeRender] Sun direction: (${this.sunDirection.x.toFixed(3)}, ${this.sunDirection.y.toFixed(3)}, ${this.sunDirection.z.toFixed(3)})`);
    }

    // Scene setup - no Three.js lights needed since we use custom shaders
    setupLighting() {
        console.log('[SpartanLoungeRender] Custom shader pipeline active - no Three.js lights needed');
        console.log('[SpartanLoungeRender] Lighting handled in fragment shader (Blinn-Phong)');
    }

    // Get map center and size for camera positioning
    getMapBounds() {
        const box = new THREE.Box3().setFromObject(this.mapGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        console.log(`[SpartanLoungeRender] Map bounds: center=(${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}), size=(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);
        console.log(`[SpartanLoungeRender] Map box: min=(${box.min.x.toFixed(1)}, ${box.min.y.toFixed(1)}, ${box.min.z.toFixed(1)}) max=(${box.max.x.toFixed(1)}, ${box.max.y.toFixed(1)}, ${box.max.z.toFixed(1)})`);
        return { center, size, box };
    }

    // Dispose all resources
    dispose() {
        console.log(`[SpartanLoungeRender] Disposing: ${this.meshCount} meshes, ${this.materials.size} materials`);
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
