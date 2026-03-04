// SpartanLoungeViewer - Halo 2 Vista .map file parser
// Native WebGL rendering engine for Spartan Lounge Theater
// Binary format: Little-endian throughout

export class H2MapParser {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.view = new DataView(arrayBuffer);
        this.u8 = new Uint8Array(arrayBuffer);
        // Ancillary map buffers keyed by DataFile location value
        // Location mapping (NormalOffset upper 2 bits >>> 30):
        //   0 = Local, 1 = MainMenu, 2 = Shared (shared.map), 3 = SinglePlayerShared
        this.ancillaryBuffers = new Map(); // location → ArrayBuffer
    }

    // Set ancillary map buffers for external texture data
    setAncillaryMaps(maps) {
        // maps: { shared?: ArrayBuffer, mainmenu?: ArrayBuffer, singlePlayerShared?: ArrayBuffer }
        if (maps.shared) this.ancillaryBuffers.set(2, maps.shared);
        if (maps.mainmenu) this.ancillaryBuffers.set(1, maps.mainmenu);
        if (maps.singlePlayerShared) this.ancillaryBuffers.set(3, maps.singlePlayerShared);
        console.log(`[SpartanLoungeMap] Ancillary maps loaded: ${[...this.ancillaryBuffers.keys()].map(k => ['local','mainmenu','shared','sp_shared'][k]).join(', ')}`);
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
    // Read a 4-byte FourCC tag (big-endian string stored as LE uint32)
    // Same format as tag types in the tag index (e.g. "head", "foot", "tags", "sbsp")
    readFourCC(offset) {
        const val = this.readUint32(offset);
        return String.fromCharCode(
            (val >>> 24) & 0xFF,
            (val >>> 16) & 0xFF,
            (val >>> 8) & 0xFF,
            val & 0xFF
        );
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
        console.log(`[SpartanLoungeMap] File size: ${(this.buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

        const header = {
            fileHead: this.readFourCC(0),              // "head"
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
            footer: this.readFourCC(2044)              // "foot"
        };

        header.indexOffset = this.decodeNormalOffset(header.indexOffsetRaw);

        if (header.fileHead !== 'head') {
            console.error(`[SpartanLoungeMap] Invalid magic: got "${header.fileHead}" (0x${this.readUint32(0).toString(16)})`);
            throw new Error(`Invalid map file: expected "head", got "${header.fileHead}"`);
        }
        if (header.footer !== 'foot') {
            console.warn(`[SpartanLoungeMap] Footer mismatch: expected "foot", got "${header.footer}"`);
        }

        console.log(`[SpartanLoungeMap] Header OK: magic=${header.fileHead}/${header.footer}, version=${header.version}`);
        console.log(`[SpartanLoungeMap]   name="${header.name}", origin="${header.mapOrigin}", build="${header.build}"`);
        console.log(`[SpartanLoungeMap]   scenario="${header.scenarioPath}"`);
        console.log(`[SpartanLoungeMap]   indexOffset=0x${header.indexOffset.value.toString(16)} (raw=0x${(header.indexOffsetRaw >>> 0).toString(16)}, location=${header.indexOffset.location})`);
        console.log(`[SpartanLoungeMap]   secondaryOffset=0x${(header.rawSecondaryOffset >>> 0).toString(16)}, fileCount=${header.fileCount}`);
        console.log(`[SpartanLoungeMap]   fileTable: offset=0x${header.fileTableOffset.toString(16)}, size=${header.fileTableSize}, index=0x${header.filesIndex.toString(16)}`);

        return header;
    }

    // ===== Index Header (32 bytes at header.indexOffset) =====
    parseIndexHeader(header) {
        const off = header.indexOffset.value;
        console.log(`[SpartanLoungeMap] Reading IndexHeader at 0x${off.toString(16)}...`);

        const indexHeader = {
            primaryMagicConstant: this.readInt32(off),
            tagListCount: this.readInt32(off + 4),
            rawTagIndexOffset: this.readInt32(off + 8),
            scenarioTagId: this.readUint32(off + 12),
            globalsTagId: this.readUint32(off + 20),
            tagIndexCount: this.readInt32(off + 24),
            tagsLabel: this.readFourCC(off + 28)      // "tags"
        };

        // Calculate primary magic
        indexHeader.primaryMagic = off - indexHeader.primaryMagicConstant + 32;

        // Calculate tag index physical offset
        indexHeader.tagIndexOffset = indexHeader.primaryMagic + indexHeader.rawTagIndexOffset;

        console.log(`[SpartanLoungeMap] IndexHeader: label="${indexHeader.tagsLabel}", tagCount=${indexHeader.tagIndexCount}`);
        console.log(`[SpartanLoungeMap]   primaryMagicConst=0x${(indexHeader.primaryMagicConstant >>> 0).toString(16)}, primaryMagic=0x${(indexHeader.primaryMagic >>> 0).toString(16)}`);
        console.log(`[SpartanLoungeMap]   rawTagIndexOff=0x${(indexHeader.rawTagIndexOffset >>> 0).toString(16)}, tagIndexPhysical=0x${(indexHeader.tagIndexOffset >>> 0).toString(16)}`);
        console.log(`[SpartanLoungeMap]   scenarioTag=0x${indexHeader.scenarioTagId.toString(16)}, globalsTag=0x${indexHeader.globalsTagId.toString(16)}`);

        if (indexHeader.tagsLabel !== 'tags') {
            console.warn(`[SpartanLoungeMap] WARNING: Expected "tags" label, got "${indexHeader.tagsLabel}"`);
        }

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

    // Calculate secondary magic from first valid tag entry
    // C# reference: SecondaryMagic = firstObjOffset - (PrimaryMagic + RawSecondaryOffset)
    // JS convention is inverted: physical = virtual + magic, so magic = secondaryPhysical - firstVirtual
    calculateSecondaryMagic(header, indexHeader, tagIndex) {
        // Find first valid (non-NULL, non-zero-size) tag entry — matches C# MapFactory behavior
        let firstOffsetRaw = null;
        for (const entry of tagIndex) {
            if (entry.tag !== 'ÿÿÿÿ' && entry.dataSize > 0) {
                firstOffsetRaw = entry.offsetRaw;
                break;
            }
        }

        if (firstOffsetRaw === null) {
            console.error('[SpartanLoungeMap] No valid tags found - cannot calculate secondary magic');
            return 0;
        }

        // The physical start of the tag data section comes from the header's secondary offset
        // converted via primary magic (matching C# PrimaryOffset behavior)
        const secondaryPhysical = indexHeader.primaryMagic + header.rawSecondaryOffset;
        const magic = secondaryPhysical - firstOffsetRaw;

        console.log(`[SpartanLoungeMap] Secondary magic: 0x${(magic >>> 0).toString(16)} (secondaryPhys=0x${secondaryPhysical.toString(16)}, firstTagRaw=0x${(firstOffsetRaw >>> 0).toString(16)})`);


        // Log tag type distribution
        const tagTypes = {};
        for (const entry of tagIndex) {
            tagTypes[entry.tag] = (tagTypes[entry.tag] || 0) + 1;
        }
        const sorted = Object.entries(tagTypes).sort((a, b) => b[1] - a[1]).slice(0, 15);
        console.log(`[SpartanLoungeMap] Tag types (top 15): ${sorted.map(([t, c]) => `${t}=${c}`).join(', ')}`);

        return magic;
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
        if (count <= 0 || rawOffset === 0) {
            if (count !== 0) {
                console.warn(`[SpartanLoungeMap] readRefArray(+${fieldOffset}): early return — count=${count}, rawOffset=0x${(rawOffset >>> 0).toString(16)}`);
            }
            return { count: 0, offset: 0 };
        }
        const physOffset = secondaryMagic + rawOffset;
        if (physOffset < 0 || physOffset >= this.buffer.byteLength) {
            console.error(`[SpartanLoungeMap] readRefArray(+${fieldOffset}): out of bounds! count=${count}, rawPtr=0x${(rawOffset >>> 0).toString(16)}, phys=${physOffset} (0x${(physOffset >>> 0).toString(16)}), fileSize=${this.buffer.byteLength}`);
            return { count: 0, offset: 0 };
        }
        return {
            count,
            offset: physOffset
        };
    }

    // Hex dump helper for debugging BSP reflexive issues
    hexDump(offset, length = 32) {
        const bytes = [];
        for (let i = 0; i < length; i++) {
            if (offset + i < this.buffer.byteLength) {
                bytes.push(this.u8[offset + i].toString(16).padStart(2, '0'));
            }
        }
        return bytes.join(' ');
    }

    // ===== BSP Tag Parsing =====
    parseBspTag(tagDataOffset, secondaryMagic) {
        console.log(`[SpartanLoungeMap] BSP tag at 0x${tagDataOffset.toString(16)}, secondaryMagic=${secondaryMagic} (0x${(secondaryMagic >>> 0).toString(16)})`);

        // Hex dump around key BSP offsets for debugging
        console.log(`[SpartanLoungeMap]   hex[+0..+15]: ${this.hexDump(tagDataOffset, 16)}`);
        console.log(`[SpartanLoungeMap]   hex[+8..+11] (checksum): ${this.hexDump(tagDataOffset + 8, 4)}`);
        console.log(`[SpartanLoungeMap]   hex[+52..+75] (bounds): ${this.hexDump(tagDataOffset + 52, 24)}`);
        console.log(`[SpartanLoungeMap]   hex[+156..+171] (clusters reflexive): ${this.hexDump(tagDataOffset + 156, 16)}`);
        console.log(`[SpartanLoungeMap]   hex[+164..+179] (shaders reflexive): ${this.hexDump(tagDataOffset + 164, 16)}`);

        // Log raw reflexive values at key offsets
        const clustersCount = this.readInt32(tagDataOffset + 156);
        const clustersPtr = this.readInt32(tagDataOffset + 160);
        const shadersCount = this.readInt32(tagDataOffset + 164);
        const shadersPtr = this.readInt32(tagDataOffset + 168);
        console.log(`[SpartanLoungeMap]   clusters reflexive: count=${clustersCount}, ptr=0x${(clustersPtr >>> 0).toString(16)} → phys=0x${((secondaryMagic + clustersPtr) >>> 0).toString(16)}`);
        console.log(`[SpartanLoungeMap]   shaders reflexive: count=${shadersCount}, ptr=0x${(shadersPtr >>> 0).toString(16)} → phys=0x${((secondaryMagic + shadersPtr) >>> 0).toString(16)}`);

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

        console.log(`[SpartanLoungeMap]   checksum=0x${(bsp.checksum >>> 0).toString(16)}`);
        console.log(`[SpartanLoungeMap]   bounds: X[${bsp.bounds.minX.toFixed(2)}, ${bsp.bounds.maxX.toFixed(2)}] Y[${bsp.bounds.minY.toFixed(2)}, ${bsp.bounds.maxY.toFixed(2)}] Z[${bsp.bounds.minZ.toFixed(2)}, ${bsp.bounds.maxZ.toFixed(2)}]`);

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
        console.log(`[SpartanLoungeMap]   shaders: ${bsp.shaders.length} (IDs: ${bsp.shaders.slice(0, 5).map(s => '0x' + s.shaderId.toString(16)).join(', ')}${bsp.shaders.length > 5 ? '...' : ''})`);

        // Parse clusters array (offset 156 in BspTag)
        const clusterRef = this.readRefArray(tagDataOffset, 156, secondaryMagic);
        bsp.clusters = [];
        for (let i = 0; i < clusterRef.count; i++) {
            const cOff = clusterRef.offset + i * 176;
            bsp.clusters.push(this.parseCluster(cOff, secondaryMagic));
        }
        console.log(`[SpartanLoungeMap]   clusters: ${bsp.clusters.length}`);

        // Log per-cluster stats
        let totalVerts = 0, totalTris = 0, totalResources = 0;
        for (let i = 0; i < bsp.clusters.length; i++) {
            const c = bsp.clusters[i];
            totalVerts += c.vertexCount;
            totalTris += c.triangleCount;
            totalResources += c.resources.length;
            if (i < 3 || c.vertexCount === 0) {
                console.log(`[SpartanLoungeMap]     cluster[${i}]: verts=${c.vertexCount}, tris=${c.triangleCount}, resources=${c.resources.length}, compression=0x${c.compressionFlags.toString(16)}, dataOffset=0x${(c.dataBlockRawOffset >>> 0).toString(16)}`);
            }
        }
        console.log(`[SpartanLoungeMap]   cluster totals: ${totalVerts} verts, ${totalTris} tris, ${totalResources} resources`);

        // Hex dump for instanced geometry reflexives
        console.log(`[SpartanLoungeMap]   hex[+312..+327] (igDefs reflexive): ${this.hexDump(tagDataOffset + 312, 16)}`);
        console.log(`[SpartanLoungeMap]   hex[+320..+335] (igInsts reflexive): ${this.hexDump(tagDataOffset + 320, 16)}`);

        // Parse instanced geometry definitions (offset 312)
        const igDefRef = this.readRefArray(tagDataOffset, 312, secondaryMagic);
        bsp.instancedGeometryDefs = [];
        for (let i = 0; i < igDefRef.count; i++) {
            const dOff = igDefRef.offset + i * 200;
            bsp.instancedGeometryDefs.push(this.parseInstancedGeometryDef(dOff, secondaryMagic));
        }
        console.log(`[SpartanLoungeMap]   instanced geometry defs: ${bsp.instancedGeometryDefs.length}`);

        // Parse instanced geometry instances (offset 320)
        const igInstRef = this.readRefArray(tagDataOffset, 320, secondaryMagic);
        bsp.instancedGeometryInstances = [];
        for (let i = 0; i < igInstRef.count; i++) {
            const iOff = igInstRef.offset + i * 88;
            bsp.instancedGeometryInstances.push(this.parseInstancedGeometryInstance(iOff));
        }
        console.log(`[SpartanLoungeMap]   instanced geometry instances: ${bsp.instancedGeometryInstances.length}`);

        // Log first few instances
        for (let i = 0; i < Math.min(3, bsp.instancedGeometryInstances.length); i++) {
            const inst = bsp.instancedGeometryInstances[i];
            console.log(`[SpartanLoungeMap]     instance[${i}]: defIdx=${inst.index}, pos=(${inst.position.x.toFixed(2)}, ${inst.position.y.toFixed(2)}, ${inst.position.z.toFixed(2)}), scale=${inst.scale.toFixed(3)}`);
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
    processGeometry(container, shaders, label = 'geometry') {
        const headerRaw = container.dataBlockRawOffset;
        if (headerRaw === 0xFFFFFFFF || headerRaw === 0) {
            console.warn(`[SpartanLoungeMap] ${label}: skipped (dataBlockRawOffset=0x${(headerRaw >>> 0).toString(16)})`);
            return [];
        }

        const headerOffset = this.decodeNormalOffset(headerRaw);
        const header = this.parseModelResourceBlockHeader(headerOffset.value);

        console.debug(`[SpartanLoungeMap] ${label}: headerAt=0x${headerOffset.value.toString(16)}, parts=${header.partInfoCount}, indices=${header.indexCount}, vertComponents=${header.vertexComponentCount}, verts=${container.vertexCount}, resources=${container.resources.length}`);

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
                } else {
                    console.warn(`[SpartanLoungeMap] ${label} part[${i}]: matId=${matId} >= shaders.length=${shaders.length}, skipped`);
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

        // Count restart markers in indices
        let restartCount = 0;
        for (let i = 0; i < indices.length; i++) {
            if (indices[i] === -1) restartCount++;
        }
        if (restartCount > 0) {
            console.debug(`[SpartanLoungeMap] ${label}: ${restartCount} restart markers in ${indices.length} indices`);
        }

        // Log element type distribution
        const elTypes = {};
        for (const p of parts) {
            const name = { 2: 'StripDecal', 3: 'Strip', 10: 'ListEnv', 11: 'List', 20: 'Point' }[p.elementType] || `Unknown(${p.elementType})`;
            elTypes[name] = (elTypes[name] || 0) + 1;
        }
        console.debug(`[SpartanLoungeMap] ${label}: ${parts.length} parts, elementTypes: ${Object.entries(elTypes).map(([k, v]) => `${k}=${v}`).join(', ')}`);

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

        // Log vertex data summary
        if (verts.positions) {
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let i = 0; i < Math.min(container.vertexCount, 1000); i++) {
                const x = verts.positions[i * 3], y = verts.positions[i * 3 + 1], z = verts.positions[i * 3 + 2];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
            console.debug(`[SpartanLoungeMap] ${label}: vertexRange X[${minX.toFixed(2)}, ${maxX.toFixed(2)}] Y[${minY.toFixed(2)}, ${maxY.toFixed(2)}] Z[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`);
            console.debug(`[SpartanLoungeMap] ${label}: hasUVs=${!!verts.texCoords}, hasNormals=${!!verts.normals}, hasTangents=${!!verts.tangents}, hasLightmapUVs=${!!verts.lightmapUVs}`);
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

    // ===== Shader Tag (shad) Parsing =====
    // Returns the diffuse bitmap tag ID for a shader
    parseShaderTag(tagOffset, secondaryMagic) {
        // ShaderTag structure:
        //   Offset 0: StemTag (4 chars)
        //   Offset 4: ShaderTemplate TagRef
        //   Offset 12: BitmapInfos reflexive (legacy path)
        //   Offset 32: Arguments reflexive (template path)

        // Try Arguments path first (ShaderTemplateArguments[0].BitmapArguments[0].Bitmap)
        const argsRef = this.readRefArray(tagOffset, 32, secondaryMagic);
        if (argsRef.count > 0) {
            // ShaderTemplateArguments is 124 bytes
            // Offset 4: BitmapArguments reflexive
            const bitmapArgsRef = this.readRefArray(argsRef.offset, 4, secondaryMagic);
            if (bitmapArgsRef.count > 0) {
                // ShaderMap is 12 bytes, Bitmap TagRef at offset 0
                const bitmapId = this.readUint32(bitmapArgsRef.offset);
                if (bitmapId !== 0 && bitmapId !== 0xFFFFFFFF) {
                    return bitmapId;
                }
            }
        }

        // Fallback: LegacyBitmapInfo[0].DiffuseBitmap (offset 4 within 80-byte struct)
        const legacyRef = this.readRefArray(tagOffset, 12, secondaryMagic);
        if (legacyRef.count > 0) {
            const diffuseBitmapId = this.readUint32(legacyRef.offset + 4);
            if (diffuseBitmapId !== 0 && diffuseBitmapId !== 0xFFFFFFFF) {
                return diffuseBitmapId;
            }
        }

        return null;
    }

    // ===== Bitmap Tag (bitm) Parsing =====
    parseBitmapTag(tagOffset, secondaryMagic) {
        // BitmapTag structure:
        //   Offset 0: TextureType (ushort)
        //   Offset 2: TextureCompressionFormat (ushort) — 0=DXT1, 1=DXT23, 2=DXT45, 3=16bit, 4=32bit, 5=mono
        //   Offset 4: TextureUsage (ushort)
        //   Offset 68: TextureInfos reflexive

        const compressionFormat = this.readUint16(tagOffset + 2);

        const texInfoRef = this.readRefArray(tagOffset, 68, secondaryMagic);
        if (texInfoRef.count === 0) return null;

        // TextureInfo is 116 bytes
        const tiOff = texInfoRef.offset;
        const width = this.view.getInt16(tiOff + 4, true);
        const height = this.view.getInt16(tiOff + 6, true);
        const depth = this.view.getInt16(tiOff + 8, true);
        const format = this.readUint16(tiOff + 12);
        const properties = this.view.getInt16(tiOff + 14, true);

        // LOD offsets and sizes (6 each, uint32)
        const lodOffsets = [];
        const lodSizes = [];
        for (let i = 0; i < 6; i++) {
            lodOffsets.push(this.readUint32(tiOff + 28 + i * 4));
            lodSizes.push(this.readUint32(tiOff + 52 + i * 4));
        }

        return {
            compressionFormat,
            width, height, depth,
            format, properties,
            lodOffsets, lodSizes
        };
    }

    // ===== Decompress bitmap LOD data (deflate) =====
    // Reads from local buffer or ancillary map buffer based on NormalOffset location
    async decompressLodData(lodOffsetRaw, lodSize) {
        const noff = this.decodeNormalOffset(lodOffsetRaw);
        if (noff.value === 0 || lodSize === 0) return null;

        // Select the right buffer based on location
        let sourceBuffer;
        if (noff.location === 0) {
            sourceBuffer = this.buffer;
        } else {
            sourceBuffer = this.ancillaryBuffers.get(noff.location);
            if (!sourceBuffer) return null; // ancillary map not loaded
        }

        if (noff.value >= sourceBuffer.byteLength) return null;

        // Bitmap data is zlib compressed: 2-byte header + deflate stream
        const compressedData = new Uint8Array(sourceBuffer, noff.value, lodSize);

        try {
            const blob = new Blob([compressedData]);
            const ds = new DecompressionStream('deflate');
            const stream = blob.stream().pipeThrough(ds);
            const result = await new Response(stream).arrayBuffer();
            return new Uint8Array(result);
        } catch (e) {
            console.warn(`[SpartanLoungeMap] Deflate decompress failed at 0x${noff.value.toString(16)} (loc=${noff.location}): ${e.message}`);
            return null;
        }
    }

    // ===== DXT1 Software Decoder =====
    static decodeDXT1(data, width, height) {
        const rgba = new Uint8Array(width * height * 4);
        const blocksX = (width + 3) >> 2;
        const blocksY = (height + 3) >> 2;

        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const blockIdx = (by * blocksX + bx) * 8;
                const c0raw = data[blockIdx] | (data[blockIdx + 1] << 8);
                const c1raw = data[blockIdx + 2] | (data[blockIdx + 3] << 8);

                const colors = new Uint8Array(16); // 4 colors x RGBA
                // Decode RGB565
                colors[0] = ((c0raw >> 11) & 0x1F) * 255 / 31;
                colors[1] = ((c0raw >> 5) & 0x3F) * 255 / 63;
                colors[2] = (c0raw & 0x1F) * 255 / 31;
                colors[3] = 255;
                colors[4] = ((c1raw >> 11) & 0x1F) * 255 / 31;
                colors[5] = ((c1raw >> 5) & 0x3F) * 255 / 63;
                colors[6] = (c1raw & 0x1F) * 255 / 31;
                colors[7] = 255;

                if (c0raw > c1raw) {
                    colors[8]  = (2 * colors[0] + colors[4]) / 3;
                    colors[9]  = (2 * colors[1] + colors[5]) / 3;
                    colors[10] = (2 * colors[2] + colors[6]) / 3;
                    colors[11] = 255;
                    colors[12] = (colors[0] + 2 * colors[4]) / 3;
                    colors[13] = (colors[1] + 2 * colors[5]) / 3;
                    colors[14] = (colors[2] + 2 * colors[6]) / 3;
                    colors[15] = 255;
                } else {
                    colors[8]  = (colors[0] + colors[4]) / 2;
                    colors[9]  = (colors[1] + colors[5]) / 2;
                    colors[10] = (colors[2] + colors[6]) / 2;
                    colors[11] = 255;
                    colors[12] = 0; colors[13] = 0; colors[14] = 0; colors[15] = 0;
                }

                // 4 bytes of 2-bit indices
                for (let py = 0; py < 4; py++) {
                    const row = data[blockIdx + 4 + py];
                    for (let px = 0; px < 4; px++) {
                        const ci = (row >> (px * 2)) & 0x3;
                        const dx = bx * 4 + px;
                        const dy = by * 4 + py;
                        if (dx < width && dy < height) {
                            const dst = (dy * width + dx) * 4;
                            rgba[dst] = colors[ci * 4];
                            rgba[dst + 1] = colors[ci * 4 + 1];
                            rgba[dst + 2] = colors[ci * 4 + 2];
                            rgba[dst + 3] = colors[ci * 4 + 3];
                        }
                    }
                }
            }
        }
        return rgba;
    }

    // ===== DXT3 Software Decoder =====
    static decodeDXT3(data, width, height) {
        const rgba = new Uint8Array(width * height * 4);
        const blocksX = (width + 3) >> 2;
        const blocksY = (height + 3) >> 2;

        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const blockIdx = (by * blocksX + bx) * 16;

                // First 8 bytes: explicit alpha (4 bits per pixel)
                const alphaBlock = data.subarray(blockIdx, blockIdx + 8);

                // Next 8 bytes: DXT1 color block
                const c0raw = data[blockIdx + 8] | (data[blockIdx + 9] << 8);
                const c1raw = data[blockIdx + 10] | (data[blockIdx + 11] << 8);

                const colors = new Uint8Array(12); // 4 colors x RGB
                colors[0] = ((c0raw >> 11) & 0x1F) * 255 / 31;
                colors[1] = ((c0raw >> 5) & 0x3F) * 255 / 63;
                colors[2] = (c0raw & 0x1F) * 255 / 31;
                colors[3] = ((c1raw >> 11) & 0x1F) * 255 / 31;
                colors[4] = ((c1raw >> 5) & 0x3F) * 255 / 63;
                colors[5] = (c1raw & 0x1F) * 255 / 31;
                colors[6] = (2 * colors[0] + colors[3]) / 3;
                colors[7] = (2 * colors[1] + colors[4]) / 3;
                colors[8] = (2 * colors[2] + colors[5]) / 3;
                colors[9]  = (colors[0] + 2 * colors[3]) / 3;
                colors[10] = (colors[1] + 2 * colors[4]) / 3;
                colors[11] = (colors[2] + 2 * colors[5]) / 3;

                for (let py = 0; py < 4; py++) {
                    const row = data[blockIdx + 12 + py];
                    for (let px = 0; px < 4; px++) {
                        const ci = (row >> (px * 2)) & 0x3;
                        const dx = bx * 4 + px;
                        const dy = by * 4 + py;
                        if (dx < width && dy < height) {
                            const dst = (dy * width + dx) * 4;
                            rgba[dst] = colors[ci * 3];
                            rgba[dst + 1] = colors[ci * 3 + 1];
                            rgba[dst + 2] = colors[ci * 3 + 2];
                            // Alpha from explicit block
                            const alphaByteIdx = py * 2 + (px >> 1);
                            const alphaNibble = (px & 1) === 0
                                ? alphaBlock[alphaByteIdx] & 0x0F
                                : (alphaBlock[alphaByteIdx] >> 4) & 0x0F;
                            rgba[dst + 3] = alphaNibble * 17; // 0-15 → 0-255
                        }
                    }
                }
            }
        }
        return rgba;
    }

    // ===== DXT5 Software Decoder =====
    static decodeDXT5(data, width, height) {
        const rgba = new Uint8Array(width * height * 4);
        const blocksX = (width + 3) >> 2;
        const blocksY = (height + 3) >> 2;

        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const blockIdx = (by * blocksX + bx) * 16;

                // Alpha block: 2 reference alphas + 6 bytes of 3-bit indices
                const a0 = data[blockIdx];
                const a1 = data[blockIdx + 1];
                const alphas = new Uint8Array(8);
                alphas[0] = a0;
                alphas[1] = a1;
                if (a0 > a1) {
                    for (let i = 1; i <= 6; i++) alphas[i + 1] = ((7 - i) * a0 + i * a1) / 7;
                } else {
                    for (let i = 1; i <= 4; i++) alphas[i + 1] = ((5 - i) * a0 + i * a1) / 5;
                    alphas[6] = 0;
                    alphas[7] = 255;
                }

                // Read 48 bits (6 bytes) of 3-bit alpha indices
                const alphaBits = [];
                for (let i = 0; i < 6; i++) alphaBits.push(data[blockIdx + 2 + i]);
                const alphaIndices = new Uint8Array(16);
                let bitPos = 0;
                for (let i = 0; i < 16; i++) {
                    const byteIdx = bitPos >> 3;
                    const bitOff = bitPos & 7;
                    let val = (alphaBits[byteIdx] >> bitOff);
                    if (bitOff > 5 && byteIdx + 1 < 6) val |= (alphaBits[byteIdx + 1] << (8 - bitOff));
                    alphaIndices[i] = val & 0x7;
                    bitPos += 3;
                }

                // Color block (same as DXT1, always 4-color mode)
                const c0raw = data[blockIdx + 8] | (data[blockIdx + 9] << 8);
                const c1raw = data[blockIdx + 10] | (data[blockIdx + 11] << 8);

                const colors = new Uint8Array(12);
                colors[0] = ((c0raw >> 11) & 0x1F) * 255 / 31;
                colors[1] = ((c0raw >> 5) & 0x3F) * 255 / 63;
                colors[2] = (c0raw & 0x1F) * 255 / 31;
                colors[3] = ((c1raw >> 11) & 0x1F) * 255 / 31;
                colors[4] = ((c1raw >> 5) & 0x3F) * 255 / 63;
                colors[5] = (c1raw & 0x1F) * 255 / 31;
                colors[6] = (2 * colors[0] + colors[3]) / 3;
                colors[7] = (2 * colors[1] + colors[4]) / 3;
                colors[8] = (2 * colors[2] + colors[5]) / 3;
                colors[9]  = (colors[0] + 2 * colors[3]) / 3;
                colors[10] = (colors[1] + 2 * colors[4]) / 3;
                colors[11] = (colors[2] + 2 * colors[5]) / 3;

                for (let py = 0; py < 4; py++) {
                    const row = data[blockIdx + 12 + py];
                    for (let px = 0; px < 4; px++) {
                        const ci = (row >> (px * 2)) & 0x3;
                        const dx = bx * 4 + px;
                        const dy = by * 4 + py;
                        if (dx < width && dy < height) {
                            const dst = (dy * width + dx) * 4;
                            rgba[dst] = colors[ci * 3];
                            rgba[dst + 1] = colors[ci * 3 + 1];
                            rgba[dst + 2] = colors[ci * 3 + 2];
                            rgba[dst + 3] = alphas[alphaIndices[py * 4 + px]];
                        }
                    }
                }
            }
        }
        return rgba;
    }

    // ===== Decode A8R8G8B8 to RGBA =====
    static decodeA8R8G8B8(data, width, height) {
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            // A8R8G8B8 → RGBA
            rgba[i * 4]     = data[i * 4 + 2]; // R (from B8G8R8A8 little-endian = A, R, G, B)
            rgba[i * 4 + 1] = data[i * 4 + 1]; // G
            rgba[i * 4 + 2] = data[i * 4];     // B
            rgba[i * 4 + 3] = data[i * 4 + 3]; // A
        }
        return rgba;
    }

    // ===== Load textures for BSP shaders =====
    // Uses local map data + ancillary maps (shared.map etc.) for external bitmap tags
    async loadTextures(bsp, tagIdMap, header, secondaryMagic) {
        const textures = new Map(); // shaderId → { rgba, width, height }
        let loaded = 0, skipped = 0, failed = 0, fromShared = 0;

        for (const shaderRef of bsp.shaders) {
            const shaderId = shaderRef.shaderId;
            if (textures.has(shaderId)) continue;

            const shaderEntry = tagIdMap.get(shaderId);
            if (!shaderEntry || shaderEntry.tag !== 'shad') {
                skipped++;
                continue;
            }

            try {
                // Skip shader tags with no local data (struct is external)
                if (shaderEntry.dataSize === 0) {
                    // Try shared.map parser if available
                    if (this.sharedParser) {
                        const result = await this.loadTextureFromShared(shaderId);
                        if (result) {
                            textures.set(shaderId, result);
                            loaded++; fromShared++;
                            continue;
                        }
                    }
                    skipped++;
                    continue;
                }

                const shaderOffset = secondaryMagic + shaderEntry.offsetRaw;
                const bitmapId = this.parseShaderTag(shaderOffset, secondaryMagic);
                if (!bitmapId) { skipped++; continue; }

                const bitmapEntry = tagIdMap.get(bitmapId);
                if (!bitmapEntry || bitmapEntry.tag !== 'bitm') { skipped++; continue; }

                // If bitmap tag data is external (dataSize == 0), try shared.map
                if (bitmapEntry.dataSize === 0) {
                    if (this.sharedParser) {
                        const result = await this.loadBitmapFromShared(bitmapId);
                        if (result) {
                            textures.set(shaderId, result);
                            loaded++; fromShared++;
                            continue;
                        }
                    }
                    skipped++;
                    continue;
                }

                const bitmapOffset = secondaryMagic + bitmapEntry.offsetRaw;
                const texInfo = this.parseBitmapTag(bitmapOffset, secondaryMagic);
                if (!texInfo || texInfo.width <= 0 || texInfo.height <= 0) { skipped++; continue; }

                // Find best LOD (first non-empty) — now supports external LODs via ancillary buffers
                let pixelData = null;
                for (let lod = 0; lod < 6; lod++) {
                    if (texInfo.lodOffsets[lod] === 0 || texInfo.lodSizes[lod] === 0) continue;
                    pixelData = await this.decompressLodData(texInfo.lodOffsets[lod], texInfo.lodSizes[lod]);
                    if (pixelData) break;
                }

                if (!pixelData) { skipped++; continue; }

                const rgba = this.decodePixelData(pixelData, texInfo.compressionFormat, texInfo.width, texInfo.height);
                if (!rgba) { skipped++; continue; }

                textures.set(shaderId, { rgba, width: texInfo.width, height: texInfo.height });
                loaded++;
            } catch (e) {
                failed++;
                console.warn(`[SpartanLoungeMap] Texture load failed for shader 0x${shaderId.toString(16)}: ${e.message}`);
            }
        }

        console.log(`[SpartanLoungeMap] Textures: ${loaded} loaded (${fromShared} from shared), ${skipped} skipped, ${failed} failed`);
        return textures;
    }

    // Decode compressed pixel data to RGBA based on format
    decodePixelData(pixelData, compressionFormat, width, height) {
        switch (compressionFormat) {
            case 0: return H2MapParser.decodeDXT1(pixelData, width, height);
            case 1: return H2MapParser.decodeDXT3(pixelData, width, height);
            case 2: return H2MapParser.decodeDXT5(pixelData, width, height);
            case 4: return H2MapParser.decodeA8R8G8B8(pixelData, width, height);
            default: return null;
        }
    }

    // Load a bitmap texture by ID from shared.map
    async loadBitmapFromShared(bitmapId) {
        if (!this.sharedParser) return null;
        const entry = this.sharedParser._tagIdMap.get(bitmapId);
        if (!entry || entry.tag !== 'bitm' || entry.dataSize === 0) return null;

        const offset = this.sharedParser._secondaryMagic + entry.offsetRaw;
        const texInfo = this.sharedParser.parseBitmapTag(offset, this.sharedParser._secondaryMagic);
        if (!texInfo || texInfo.width <= 0 || texInfo.height <= 0) return null;

        let pixelData = null;
        for (let lod = 0; lod < 6; lod++) {
            if (texInfo.lodOffsets[lod] === 0 || texInfo.lodSizes[lod] === 0) continue;
            pixelData = await this.sharedParser.decompressLodData(texInfo.lodOffsets[lod], texInfo.lodSizes[lod]);
            if (pixelData) break;
        }
        if (!pixelData) return null;

        const rgba = this.decodePixelData(pixelData, texInfo.compressionFormat, texInfo.width, texInfo.height);
        if (!rgba) return null;
        return { rgba, width: texInfo.width, height: texInfo.height };
    }

    // Load a texture by shader ID from shared.map (full shader→bitmap chain)
    async loadTextureFromShared(shaderId) {
        if (!this.sharedParser) return null;
        const shaderEntry = this.sharedParser._tagIdMap.get(shaderId);
        if (!shaderEntry || shaderEntry.tag !== 'shad' || shaderEntry.dataSize === 0) return null;

        const shaderOffset = this.sharedParser._secondaryMagic + shaderEntry.offsetRaw;
        const bitmapId = this.sharedParser.parseShaderTag(shaderOffset, this.sharedParser._secondaryMagic);
        if (!bitmapId) return null;

        return this.loadBitmapFromShared(bitmapId);
    }

    // Initialize shared.map parser for external texture lookups
    initSharedParser(sharedBuffer) {
        if (!sharedBuffer) return;
        console.log(`[SpartanLoungeMap] Initializing shared.map parser (${(sharedBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)...`);

        const shared = new H2MapParser(sharedBuffer);
        const sharedHeader = shared.parseHeader();
        const sharedIndexHeader = shared.parseIndexHeader(sharedHeader);
        const sharedTagIndex = shared.parseTagIndex(sharedIndexHeader);
        const sharedSecondaryMagic = shared.calculateSecondaryMagic(sharedHeader, sharedIndexHeader, sharedTagIndex);

        // Build tag ID map for shared.map (skip NULL/empty entries)
        shared._tagIdMap = new Map();
        for (const entry of sharedTagIndex) {
            if (entry.dataSize > 0) {
                shared._tagIdMap.set(entry.id, entry);
            }
        }
        shared._secondaryMagic = sharedSecondaryMagic;
        shared._header = sharedHeader;

        const bitmCount = sharedTagIndex.filter(e => e.tag === 'bitm' && e.dataSize > 0).length;
        const shadCount = sharedTagIndex.filter(e => e.tag === 'shad' && e.dataSize > 0).length;
        console.log(`[SpartanLoungeMap] shared.map: ${shared._tagIdMap.size} valid tags (${bitmCount} bitmaps, ${shadCount} shaders)`);

        this.sharedParser = shared;
    }

    // ===== Full parse pipeline =====
    async parse() {
        console.log('[SpartanLoungeMap] Parsing map file...');
        const header = this.parseHeader();
        console.log(`[SpartanLoungeMap] Map: "${header.name}", scenario: ${header.scenarioPath}`);

        const indexHeader = this.parseIndexHeader(header);
        console.log(`[SpartanLoungeMap] Tag index: ${indexHeader.tagIndexCount} tags`);

        const tagIndex = this.parseTagIndex(indexHeader);
        const secondaryMagic = this.calculateSecondaryMagic(header, indexHeader, tagIndex);

        // Build tag ID lookup map
        const tagIdMap = new Map();
        for (const entry of tagIndex) {
            tagIdMap.set(entry.id, entry);
        }

        // Find BSP tags
        const bspEntries = tagIndex.filter(e => e.tag === 'sbsp');
        console.log(`[SpartanLoungeMap] Found ${bspEntries.length} BSP tag(s)`);

        const bspData = [];
        for (const entry of bspEntries) {
            const tagOffset = secondaryMagic + entry.offsetRaw;
            const name = this.getTagName(header, entry.id);
            console.log(`[SpartanLoungeMap] Parsing BSP: ${name}`);

            const bsp = this.parseBspTag(tagOffset, secondaryMagic);
            bsp.name = name;
            bsp.id = entry.id;

            // Process cluster geometry
            console.log(`[SpartanLoungeMap] Processing ${bsp.clusters.length} clusters...`);
            console.time('[SpartanLoungeMap] Cluster processing');
            bsp.clusterMeshes = [];
            let clusterErrors = 0;
            for (let i = 0; i < bsp.clusters.length; i++) {
                try {
                    const meshes = this.processGeometry(bsp.clusters[i], bsp.shaders, `cluster[${i}]`);
                    bsp.clusterMeshes.push(...meshes);
                } catch (e) {
                    clusterErrors++;
                    console.error(`[SpartanLoungeMap] cluster[${i}] FAILED:`, e.message);
                }
            }
            console.timeEnd('[SpartanLoungeMap] Cluster processing');
            console.log(`[SpartanLoungeMap] Cluster results: ${bsp.clusterMeshes.length} meshes (${clusterErrors} errors)`);

            // Process instanced geometry
            console.time('[SpartanLoungeMap] Instanced geometry processing');
            bsp.instanceMeshes = [];
            let igErrors = 0;
            for (let i = 0; i < bsp.instancedGeometryDefs.length; i++) {
                try {
                    const meshes = this.processGeometry(bsp.instancedGeometryDefs[i], bsp.shaders, `igDef[${i}]`);
                    bsp.instanceMeshes.push({ defIndex: i, meshes });
                } catch (e) {
                    igErrors++;
                    console.error(`[SpartanLoungeMap] igDef[${i}] FAILED:`, e.message);
                    bsp.instanceMeshes.push({ defIndex: i, meshes: [] });
                }
            }
            console.timeEnd('[SpartanLoungeMap] Instanced geometry processing');
            console.log(`[SpartanLoungeMap] IG results: ${bsp.instanceMeshes.length} defs (${igErrors} errors)`);

            // Load textures for BSP shaders
            console.time('[SpartanLoungeMap] Texture loading');
            bsp.textures = await this.loadTextures(bsp, tagIdMap, header, secondaryMagic);
            console.timeEnd('[SpartanLoungeMap] Texture loading');

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
