// SpartanLoungeViewer - Halo 2 Vista .map file parser
// Native WebGL rendering engine for Spartan Lounge Theater
// Binary format: Little-endian throughout

export class H2MapParser {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.view = new DataView(arrayBuffer);
        this.u8 = new Uint8Array(arrayBuffer);
    }

    // ===== Low-level binary readers =====
    readInt32(offset) { return this.view.getInt32(offset, true); }
    readUint32(offset) { return this.view.getUint32(offset, true); }
    readUint16(offset) { return this.view.getUint16(offset, true); }
    readFloat32(offset) { return this.view.getFloat32(offset, true); }
    readString(offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            const ch = this.u8[offset + i];
            if (ch === 0) break;
            str += String.fromCharCode(ch);
        }
        return str;
    }
    readVec3(offset) {
        return {
            x: this.readFloat32(offset),
            y: this.readFloat32(offset + 4),
            z: this.readFloat32(offset + 8)
        };
    }
    readVec2(offset) {
        return {
            x: this.readFloat32(offset),
            y: this.readFloat32(offset + 4)
        };
    }

    // NormalOffset: lower 30 bits = offset, upper 2 bits = data file location
    decodeNormalOffset(raw) {
        return {
            value: raw & 0x3FFFFFFF,
            location: (raw >>> 30) & 0x3
        };
    }

    // ===== Map Header (2048 bytes) =====
    parseHeader() {
        const header = {
            fileHead: this.readString(0, 4),         // "head"
            version: this.readInt32(4),
            totalBytes: this.readInt32(8),
            indexOffsetRaw: this.readInt32(16),
            rawSecondaryOffset: this.readInt32(20),
            mapOrigin: this.readString(32, 32),
            build: this.readString(300, 32),
            internedStringCount: this.readInt32(368),
            internedStringIndexOffset: this.readInt32(376),
            internedStringsOffset: this.readInt32(380),
            name: this.readString(420, 32),
            scenarioPath: this.readString(456, 256),
            fileCount: this.readInt32(716),
            fileTableOffset: this.readInt32(720),
            fileTableSize: this.readInt32(724),
            filesIndex: this.readInt32(728),
            storedSignature: this.readInt32(752),
            footer: this.readString(2044, 4)          // "foot"
        };

        header.indexOffset = this.decodeNormalOffset(header.indexOffsetRaw);

        if (header.fileHead !== 'head') {
            throw new Error(`Invalid map file: expected "head", got "${header.fileHead}"`);
        }

        return header;
    }

    // ===== Index Header (32 bytes at header.indexOffset) =====
    parseIndexHeader(header) {
        const off = header.indexOffset.value;
        const indexHeader = {
            primaryMagicConstant: this.readInt32(off),
            tagListCount: this.readInt32(off + 4),
            rawTagIndexOffset: this.readInt32(off + 8),
            scenarioTagId: this.readUint32(off + 12),
            globalsTagId: this.readUint32(off + 20),
            tagIndexCount: this.readInt32(off + 24),
            tagsLabel: this.readString(off + 28, 4)  // "tags"
        };

        // Calculate primary magic
        indexHeader.primaryMagic = off - indexHeader.primaryMagicConstant + 32;

        // Calculate tag index physical offset
        indexHeader.tagIndexOffset = indexHeader.primaryMagic + indexHeader.rawTagIndexOffset;

        return indexHeader;
    }

    // ===== Tag Index Entries (16 bytes each) =====
    parseTagIndex(indexHeader) {
        const entries = [];
        const baseOff = indexHeader.tagIndexOffset;

        for (let i = 0; i < indexHeader.tagIndexCount; i++) {
            const off = baseOff + i * 16;
            const tagRaw = this.readUint32(off);
            // Convert tag FourCC to string (big-endian order)
            const tag = String.fromCharCode(
                (tagRaw >>> 24) & 0xFF,
                (tagRaw >>> 16) & 0xFF,
                (tagRaw >>> 8) & 0xFF,
                tagRaw & 0xFF
            );

            entries.push({
                tag,
                id: this.readUint32(off + 4),
                offsetRaw: this.readInt32(off + 8),
                dataSize: this.readInt32(off + 12)
            });
        }

        return entries;
    }

    // Calculate secondary magic from first tag entry
    calculateSecondaryMagic(header, indexHeader, tagIndex) {
        if (tagIndex.length === 0) return 0;
        // Secondary magic: first tag's physical offset in file minus its raw offset
        // The first tag data starts right after the tag index
        const firstTagPhysical = indexHeader.tagIndexOffset + indexHeader.tagIndexCount * 16;
        return firstTagPhysical - tagIndex[0].offsetRaw;
    }

    // Get tag name from file table
    getTagName(header, tagId) {
        const nameIndex = (tagId & 0x0000FFFF);
        const nameStart = this.readInt32(header.filesIndex + nameIndex * 4);
        return this.readString(header.fileTableOffset + nameStart, 256);
    }

    // ===== Reference Array (8 bytes: count + raw offset) =====
    readRefArray(tagDataOffset, fieldOffset, secondaryMagic) {
        const abs = tagDataOffset + fieldOffset;
        const count = this.readInt32(abs);
        const rawOffset = this.readInt32(abs + 4);
        if (count <= 0 || rawOffset === 0) return { count: 0, offset: 0 };
        return {
            count,
            offset: secondaryMagic + rawOffset
        };
    }

    // ===== BSP Tag Parsing =====
    parseBspTag(tagDataOffset, secondaryMagic) {
        const bsp = {
            checksum: this.readInt32(tagDataOffset + 8),
            bounds: {
                minX: this.readFloat32(tagDataOffset + 52),
                maxX: this.readFloat32(tagDataOffset + 56),
                minY: this.readFloat32(tagDataOffset + 60),
                maxY: this.readFloat32(tagDataOffset + 64),
                minZ: this.readFloat32(tagDataOffset + 68),
                maxZ: this.readFloat32(tagDataOffset + 72)
            }
        };

        // Parse shader references array (offset 164 in BspTag)
        const shaderRef = this.readRefArray(tagDataOffset, 164, secondaryMagic);
        bsp.shaders = [];
        for (let i = 0; i < shaderRef.count; i++) {
            const sOff = shaderRef.offset + i * 32;
            bsp.shaders.push({
                shaderId: this.readUint32(sOff + 12),
                offset: this.readUint32(sOff + 20)
            });
        }

        // Parse clusters array (offset 156 in BspTag)
        const clusterRef = this.readRefArray(tagDataOffset, 156, secondaryMagic);
        bsp.clusters = [];
        for (let i = 0; i < clusterRef.count; i++) {
            const cOff = clusterRef.offset + i * 176;
            bsp.clusters.push(this.parseCluster(cOff, secondaryMagic));
        }

        // Parse instanced geometry definitions (offset 312)
        const igDefRef = this.readRefArray(tagDataOffset, 312, secondaryMagic);
        bsp.instancedGeometryDefs = [];
        for (let i = 0; i < igDefRef.count; i++) {
            const dOff = igDefRef.offset + i * 200;
            bsp.instancedGeometryDefs.push(this.parseInstancedGeometryDef(dOff, secondaryMagic));
        }

        // Parse instanced geometry instances (offset 320)
        const igInstRef = this.readRefArray(tagDataOffset, 320, secondaryMagic);
        bsp.instancedGeometryInstances = [];
        for (let i = 0; i < igInstRef.count; i++) {
            const iOff = igInstRef.offset + i * 88;
            bsp.instancedGeometryInstances.push(this.parseInstancedGeometryInstance(iOff));
        }

        return bsp;
    }

    // ===== Cluster (176 bytes) =====
    parseCluster(offset, secondaryMagic) {
        const cluster = {
            vertexCount: this.readUint16(offset),
            triangleCount: this.readUint16(offset + 2),
            shadowCastingTriangleCount: this.readUint16(offset + 6),
            compressionFlags: this.readUint16(offset + 22),
            dataBlockRawOffset: this.readUint32(offset + 40),
            dataBlockSize: this.readUint32(offset + 44),
            dataPreambleSize: this.readUint32(offset + 48),
            resourceSubsectionSize: this.readUint32(offset + 52)
        };

        // Parse resources array (offset 56 within cluster)
        const resRef = this.readRefArray(offset, 56, secondaryMagic);
        cluster.resources = [];
        for (let i = 0; i < resRef.count; i++) {
            const rOff = resRef.offset + i * 16;
            cluster.resources.push({
                type: this.u8[rOff],
                size: this.readInt32(rOff + 8),
                offset: this.readInt32(rOff + 12)
            });
        }

        return cluster;
    }

    // ===== Instanced Geometry Definition (200 bytes) =====
    parseInstancedGeometryDef(offset, secondaryMagic) {
        const def = {
            vertexCount: this.readUint16(offset),
            triangleCount: this.readUint16(offset + 2),
            compressionFlags: this.readUint16(offset + 22),
            dataBlockRawOffset: this.readUint32(offset + 40),
            dataBlockSize: this.readUint32(offset + 44),
            dataPreambleSize: this.readUint32(offset + 48)
        };

        // Parse compression info (offset 24)
        const compRef = this.readRefArray(offset, 24, secondaryMagic);
        def.compressionInfos = [];
        for (let i = 0; i < compRef.count; i++) {
            const cOff = compRef.offset + i * 56;
            const floats = [];
            for (let f = 0; f < 10; f++) {
                floats.push(this.readFloat32(cOff + f * 4));
            }
            def.compressionInfos.push({ floats });
        }

        // Parse resources (offset 56)
        const resRef = this.readRefArray(offset, 56, secondaryMagic);
        def.resources = [];
        for (let i = 0; i < resRef.count; i++) {
            const rOff = resRef.offset + i * 16;
            def.resources.push({
                type: this.u8[rOff],
                size: this.readInt32(rOff + 8),
                offset: this.readInt32(rOff + 12)
            });
        }

        return def;
    }

    // ===== Instanced Geometry Instance (88 bytes) =====
    parseInstancedGeometryInstance(offset) {
        const inst = {
            scale: this.readFloat32(offset),
            rotationMatrix: [],
            position: this.readVec3(offset + 40),
            index: this.readUint32(offset + 52),
            flags: this.readUint16(offset + 82)
        };
        // 3x3 rotation matrix (9 floats starting at offset 4)
        for (let i = 0; i < 9; i++) {
            inst.rotationMatrix.push(this.readFloat32(offset + 4 + i * 4));
        }
        return inst;
    }

    // ===== Model Resource Block Header (120 bytes) =====
    parseModelResourceBlockHeader(offset) {
        return {
            partInfoCount: this.readUint32(offset + 8),
            partInfo2Count: this.readUint32(offset + 16),
            partInfo3Count: this.readUint32(offset + 24),
            indexCount: this.readUint32(offset + 40),
            unknownDataLength: this.readUint32(offset + 48),
            unknownIndicesCount: this.readUint32(offset + 56),
            vertexComponentCount: this.readUint32(offset + 64)
        };
    }

    // ===== Process cluster/definition geometry into meshes =====
    processGeometry(container, shaders) {
        const headerRaw = container.dataBlockRawOffset;
        if (headerRaw === 0xFFFFFFFF || headerRaw === 0) return [];

        const headerOffset = this.decodeNormalOffset(headerRaw);
        const header = this.parseModelResourceBlockHeader(headerOffset.value);

        // Read resource data
        const resources = [];
        for (const res of container.resources) {
            const dataOffset = headerRaw + 8 + container.dataPreambleSize + res.offset;
            const physOffset = this.decodeNormalOffset(dataOffset).value;
            resources.push({
                type: res.type,
                size: res.size,
                data: new Uint8Array(this.buffer, physOffset, res.size),
                dataView: new DataView(this.buffer, physOffset, res.size)
            });
        }

        let currentResource = 0;
        const parts = [];

        // Process part info (resource 0, 72 bytes per part)
        if (header.partInfoCount > 0 && currentResource < resources.length) {
            const partData = resources[currentResource];
            for (let i = 0; i < header.partInfoCount; i++) {
                const start = i * 72;
                const elementType = partData.dataView.getUint16(start + 2, true);
                const matId = partData.dataView.getUint16(start + 4, true);
                const indexStart = partData.dataView.getUint16(start + 6, true);
                const indexCount = partData.dataView.getUint16(start + 8, true);

                if (matId < shaders.length) {
                    parts.push({ elementType, matId, indexStart, indexCount, shaderId: shaders[matId].shaderId });
                }
            }
            currentResource++;
        }

        // Skip part info 2
        if (header.partInfo2Count > 0) currentResource++;
        // Skip part info 3
        if (header.partInfo3Count > 0) currentResource++;

        // Process indices (uint16 array)
        const indices = new Int32Array(header.indexCount);
        if (header.indexCount > 0 && currentResource < resources.length) {
            const idxData = resources[currentResource];
            for (let i = 0; i < header.indexCount; i++) {
                const val = idxData.dataView.getUint16(i * 2, true);
                indices[i] = val === 0xFFFF ? -1 : val;
            }
            currentResource++;
        }

        // Skip unknown data
        if (header.unknownDataLength > 0) currentResource++;
        // Skip unknown indices
        if (header.unknownIndicesCount > 0) currentResource++;
        // Skip vertex component hint
        if (header.vertexComponentCount > 0) currentResource++;

        // Process vertex attributes
        const verts = {
            positions: null,
            texCoords: null,
            normals: null,
            tangents: null,
            bitangents: null,
            lightmapUVs: null
        };

        if (header.vertexComponentCount >= 1 && currentResource < resources.length) {
            const posData = resources[currentResource];
            const itemStride = posData.size / container.vertexCount;
            const positions = new Float32Array(container.vertexCount * 3);
            for (let i = 0; i < container.vertexCount; i++) {
                positions[i * 3] = posData.dataView.getFloat32(i * itemStride, true);
                positions[i * 3 + 1] = posData.dataView.getFloat32(i * itemStride + 4, true);
                positions[i * 3 + 2] = posData.dataView.getFloat32(i * itemStride + 8, true);
            }
            verts.positions = positions;
            currentResource++;
        }

        if (header.vertexComponentCount >= 2 && currentResource < resources.length) {
            const texData = resources[currentResource];
            const texCoords = new Float32Array(container.vertexCount * 2);
            for (let i = 0; i < container.vertexCount; i++) {
                texCoords[i * 2] = texData.dataView.getFloat32(i * 8, true);
                texCoords[i * 2 + 1] = texData.dataView.getFloat32(i * 8 + 4, true);
            }
            verts.texCoords = texCoords;
            currentResource++;
        }

        if (header.vertexComponentCount >= 3 && currentResource < resources.length) {
            const tbnData = resources[currentResource];
            const normals = new Float32Array(container.vertexCount * 3);
            const tangents = new Float32Array(container.vertexCount * 3);
            const bitangents = new Float32Array(container.vertexCount * 3);
            for (let i = 0; i < container.vertexCount; i++) {
                const start = i * 36;
                normals[i * 3] = tbnData.dataView.getFloat32(start, true);
                normals[i * 3 + 1] = tbnData.dataView.getFloat32(start + 4, true);
                normals[i * 3 + 2] = tbnData.dataView.getFloat32(start + 8, true);
                bitangents[i * 3] = tbnData.dataView.getFloat32(start + 12, true);
                bitangents[i * 3 + 1] = tbnData.dataView.getFloat32(start + 16, true);
                bitangents[i * 3 + 2] = tbnData.dataView.getFloat32(start + 20, true);
                tangents[i * 3] = tbnData.dataView.getFloat32(start + 24, true);
                tangents[i * 3 + 1] = tbnData.dataView.getFloat32(start + 28, true);
                tangents[i * 3 + 2] = tbnData.dataView.getFloat32(start + 32, true);
            }
            verts.normals = normals;
            verts.tangents = tangents;
            verts.bitangents = bitangents;
            currentResource++;
        }

        if (header.vertexComponentCount >= 4 && currentResource < resources.length) {
            const lmData = resources[currentResource];
            const itemStride = lmData.size / container.vertexCount;
            const lmUVs = new Float32Array(container.vertexCount * 2);
            for (let i = 0; i < container.vertexCount; i++) {
                lmUVs[i * 2] = lmData.dataView.getFloat32(i * itemStride, true);
                lmUVs[i * 2 + 1] = lmData.dataView.getFloat32(i * itemStride + 4, true);
            }
            verts.lightmapUVs = lmUVs;
            currentResource++;
        }

        // Build meshes from parts
        const meshes = [];
        for (const part of parts) {
            // Extract index slice for this part
            const partIndices = indices.slice(part.indexStart, part.indexStart + part.indexCount);

            // Convert triangle strips to triangle lists if needed
            let triIndices;
            if (part.elementType === 3 || part.elementType === 2) {
                // TriangleStrip / TriangleStripDecal
                triIndices = this.convertStripToList(partIndices);
            } else {
                // TriangleList (10, 11) - filter out restart markers
                triIndices = this.filterRestartMarkers(partIndices);
            }

            if (triIndices.length === 0) continue;

            meshes.push({
                indices: triIndices,
                vertices: verts,
                vertexCount: container.vertexCount,
                elementType: part.elementType,
                matId: part.matId,
                shaderId: part.shaderId
            });
        }

        return meshes;
    }

    // Convert triangle strip indices to triangle list
    convertStripToList(stripIndices) {
        const triangles = [];
        let stripVerts = [];

        for (let i = 0; i < stripIndices.length; i++) {
            if (stripIndices[i] === -1) {
                // Primitive restart - start new strip
                stripVerts = [];
                continue;
            }

            stripVerts.push(stripIndices[i]);

            if (stripVerts.length >= 3) {
                const triIdx = stripVerts.length - 3;
                const a = stripVerts[triIdx];
                const b = stripVerts[triIdx + 1];
                const c = stripVerts[triIdx + 2];

                // Skip degenerate triangles
                if (a !== b && b !== c && a !== c) {
                    // Alternate winding for proper normals
                    if (triIdx % 2 === 0) {
                        triangles.push(a, b, c);
                    } else {
                        triangles.push(a, c, b);
                    }
                }
            }
        }

        return new Int32Array(triangles);
    }

    // Filter restart markers from triangle list
    filterRestartMarkers(indices) {
        const filtered = [];
        for (let i = 0; i < indices.length; i++) {
            if (indices[i] !== -1) {
                filtered.push(indices[i]);
            }
        }
        return new Int32Array(filtered);
    }

    // ===== Full parse pipeline =====
    parse() {
        console.log('[H2Map] Parsing map file...');
        const header = this.parseHeader();
        console.log(`[H2Map] Map: "${header.name}", scenario: ${header.scenarioPath}`);

        const indexHeader = this.parseIndexHeader(header);
        console.log(`[H2Map] Tag index: ${indexHeader.tagIndexCount} tags`);

        const tagIndex = this.parseTagIndex(indexHeader);
        const secondaryMagic = this.calculateSecondaryMagic(header, indexHeader, tagIndex);

        // Find BSP tags
        const bspEntries = tagIndex.filter(e => e.tag === 'sbsp');
        console.log(`[H2Map] Found ${bspEntries.length} BSP tag(s)`);

        const bspData = [];
        for (const entry of bspEntries) {
            const tagOffset = secondaryMagic + entry.offsetRaw;
            const name = this.getTagName(header, entry.id);
            console.log(`[H2Map] Parsing BSP: ${name}`);

            const bsp = this.parseBspTag(tagOffset, secondaryMagic);
            bsp.name = name;
            bsp.id = entry.id;

            // Process cluster geometry
            console.log(`[H2Map] Processing ${bsp.clusters.length} clusters...`);
            bsp.clusterMeshes = [];
            for (let i = 0; i < bsp.clusters.length; i++) {
                const meshes = this.processGeometry(bsp.clusters[i], bsp.shaders);
                bsp.clusterMeshes.push(...meshes);
            }
            console.log(`[H2Map] Got ${bsp.clusterMeshes.length} cluster meshes`);

            // Process instanced geometry
            bsp.instanceMeshes = [];
            for (let i = 0; i < bsp.instancedGeometryDefs.length; i++) {
                const meshes = this.processGeometry(bsp.instancedGeometryDefs[i], bsp.shaders);
                bsp.instanceMeshes.push({ defIndex: i, meshes });
            }
            console.log(`[H2Map] Got ${bsp.instanceMeshes.length} instanced geometry defs`);

            bspData.push(bsp);
        }

        return {
            header,
            indexHeader,
            tagIndex,
            secondaryMagic,
            bspData
        };
    }
}
