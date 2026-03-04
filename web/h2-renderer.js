// SpartanLoungeViewer - Three.js/WebGL renderer for Halo 2 maps
// Renders parsed BSP geometry with proper materials and lighting

import * as THREE from 'three';

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
        this.defaultMaterial = new THREE.MeshStandardMaterial({
            color: 0x808080,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide
        });
    }

    // Build Three.js geometry from parsed BSP data
    buildFromParsedData(parsedMap) {
        const { bspData } = parsedMap;

        for (const bsp of bspData) {
            console.log(`[H2Render] Building BSP: ${bsp.name}`);
            console.log(`[H2Render] Bounds: X[${bsp.bounds.minX.toFixed(1)}, ${bsp.bounds.maxX.toFixed(1)}] ` +
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
            console.log(`[H2Render] Cluster terrain: ${bsp.clusterMeshes.length} meshes, ${clusterTriCount} triangles`);

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
            console.log(`[H2Render] Instanced geometry: ${bsp.instancedGeometryInstances.length} instances, ${instanceTriCount} triangles`);
        }

        return this.mapGroup;
    }

    // Create a Three.js mesh from parsed mesh data
    createThreeMesh(meshData) {
        const { indices, vertices, vertexCount } = meshData;

        if (!vertices.positions || indices.length === 0) return null;

        const geometry = new THREE.BufferGeometry();

        // Positions
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices.positions, 3));

        // Normals
        if (vertices.normals) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(vertices.normals, 3));
        }

        // UVs
        if (vertices.texCoords) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(vertices.texCoords, 2));
        }

        // Lightmap UVs as uv2
        if (vertices.lightmapUVs) {
            geometry.setAttribute('uv2', new THREE.BufferAttribute(vertices.lightmapUVs, 2));
        }

        // Set index buffer
        const maxIndex = Math.max(...indices);
        if (maxIndex > 65535) {
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        } else {
            geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        }

        // Generate normals if not provided
        if (!vertices.normals) {
            geometry.computeVertexNormals();
        }

        // Get or create material
        const material = this.getMaterial(meshData.shaderId, meshData.matId);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    // Material system - generates distinct colors per shader for now
    // Will be extended with proper texture loading later
    getMaterial(shaderId, matId) {
        const key = shaderId || matId;
        if (this.materials.has(key)) {
            return this.materials.get(key);
        }

        // Generate a consistent color from the shader/material ID
        const hue = ((key * 137) % 360) / 360;
        const color = new THREE.Color();
        color.setHSL(hue, 0.3, 0.5);

        const mat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        this.materials.set(key, mat);
        return mat;
    }

    // Set up scene lighting appropriate for Halo 2 maps
    setupLighting() {
        // Ambient light for base visibility
        const ambient = new THREE.AmbientLight(0x404050, 0.6);
        this.scene.add(ambient);

        // Main directional light (sun)
        const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
        sun.position.set(50, 100, 50);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 500;
        sun.shadow.camera.left = -100;
        sun.shadow.camera.right = 100;
        sun.shadow.camera.top = 100;
        sun.shadow.camera.bottom = -100;
        this.scene.add(sun);

        // Fill light from opposite direction
        const fill = new THREE.DirectionalLight(0x8899bb, 0.4);
        fill.position.set(-30, 60, -30);
        this.scene.add(fill);

        // Hemisphere light for sky/ground ambient
        const hemi = new THREE.HemisphereLight(0x88aacc, 0x443322, 0.3);
        this.scene.add(hemi);
    }

    // Get map center and size for camera positioning
    getMapBounds() {
        const box = new THREE.Box3().setFromObject(this.mapGroup);
        return {
            center: box.getCenter(new THREE.Vector3()),
            size: box.getSize(new THREE.Vector3()),
            box
        };
    }

    // Dispose all resources
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
