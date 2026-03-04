using OpenBlam.Core.Extensions;
using OpenH2.Core.Extensions;
using OpenH2.Core.Maps;
using OpenH2.Foundation;
using System;
using System.Buffers.Binary;
using System.Collections.Generic;

namespace OpenH2.Core.Tags.Common.Models
{
    public static class ModelResourceContainerProcessor
    {
        private static bool diagnosticsDumped = false;

        private struct PartDescription
        {
            public PartDescription(int indexStart, int indexCount, TagRef<ShaderTag> shader, MeshElementType elementType)
            {
                IndexStart = indexStart;
                IndexCount = indexCount;
                Shader = shader;
                ElementType = elementType;
            }

            public int IndexStart;
            public int IndexCount;
            public TagRef<ShaderTag> Shader;
            public MeshElementType ElementType;
        }

        public static ModelMesh[] ProcessContainer(IModelResourceContainer container, ModelShaderReference[] shaders, string note = null)
        {
            var parts = new List<PartDescription>((int)container.Header.PartInfoCount);

            var verts = new VertexFormat[container.VertexCount];
            Span<int> indices = new int[container.Header.IndexCount];

            var currentResource = 0;

            // process part info 0 resource
            if (container.Header.PartInfoCount > 0)
            {
                var partData = container.Resources[currentResource].Data.Span;

                // Dump raw hex for first container to verify field offsets
                if (!diagnosticsDumped)
                {
                    diagnosticsDumped = true;
                    Console.WriteLine($"[MeshDiag] First container: verts={container.VertexCount}, totalIdx={container.Header.IndexCount}, " +
                        $"parts={container.Header.PartInfoCount}, compression={container.CompressionFlags}, partDataLen={partData.Length}");

                    for (var d = 0; d < Math.Min(3, (int)container.Header.PartInfoCount); d++)
                    {
                        var dStart = d * 72;
                        var hexBytes = new List<string>();
                        for (int b = 0; b < Math.Min(20, partData.Length - dStart); b++)
                            hexBytes.Add(partData[dStart + b].ToString("X2"));
                        Console.WriteLine($"  Part[{d}] raw hex (first 20 bytes): {string.Join(" ", hexBytes)}");

                        // Show both uint16 and uint32 interpretations
                        var u16_0 = BinaryPrimitives.ReadUInt16LittleEndian(partData.Slice(dStart + 0, 2));
                        var u16_2 = BinaryPrimitives.ReadUInt16LittleEndian(partData.Slice(dStart + 2, 2));
                        var u16_4 = BinaryPrimitives.ReadUInt16LittleEndian(partData.Slice(dStart + 4, 2));
                        var u16_6 = BinaryPrimitives.ReadUInt16LittleEndian(partData.Slice(dStart + 6, 2));
                        var u16_8 = BinaryPrimitives.ReadUInt16LittleEndian(partData.Slice(dStart + 8, 2));
                        var u32_8 = BinaryPrimitives.ReadUInt32LittleEndian(partData.Slice(dStart + 8, 4));
                        var u32_12 = BinaryPrimitives.ReadUInt32LittleEndian(partData.Slice(dStart + 12, 4));
                        Console.WriteLine($"  Part[{d}] u16@0={u16_0} u16@2={u16_2} u16@4={u16_4} u16@6={u16_6} u16@8={u16_8} | u32@8={u32_8} u32@12={u32_12}");
                    }
                }

                for (var i = 0; i < container.Header.PartInfoCount; i++)
                {
                    var start = i * 72;

                    var elementType = (MeshElementType)partData.ReadUInt16At(start + 2);
                    var matId = partData.ReadUInt16At(start + 4);
                    var indexStart = partData.ReadUInt16At(start + 6);
                    var indexCount = partData.ReadUInt16At(start + 8);

                    // Validate matId
                    if (matId >= shaders.Length)
                    {
                        Console.WriteLine($"[MeshDiag] WARNING: {note} Part[{i}]: matId={matId} >= shaders.Length={shaders.Length}, skipping");
                        continue;
                    }

                    // Validate index range
                    if (indexStart + indexCount > container.Header.IndexCount)
                    {
                        Console.WriteLine($"[MeshDiag] WARNING: {note} Part[{i}]: indexStart={indexStart}+indexCount={indexCount}={indexStart + indexCount} > totalIdx={container.Header.IndexCount}");
                    }

                    var partDescription = new PartDescription(indexStart, indexCount, shaders[matId].ShaderId, elementType);

                    parts.Add(partDescription);
                }

                currentResource++;
            }

            // process part info 2 resource
            if (container.Header.PartInfo2Count > 0)
            {
                // Not positive on what this is for, last ushort of the 8 bytes looks to be part index
                currentResource++;
            }

            // process part info 3 resource
            if (container.Header.PartInfo3Count > 0)
            {
                currentResource++;
            }

            // process indicies resource
            if (container.Header.IndexCount > 0)
            {
                var data = container.Resources[currentResource].Data.Span;

                for (var i = 0; i < container.Header.IndexCount; i++)
                {
                    var idx = data.ReadUInt16At(i * 2);
                    // Convert uint16 primitive restart marker (0xFFFF) to uint32 restart marker (0xFFFFFFFF)
                    indices[i] = idx == 0xFFFF ? -1 : idx;
                }

                currentResource++;
            }

            // process unknown resource
            if (container.Header.UknownDataLength > 0)
            {
                currentResource++;
            }

            // process unknown resource
            if (container.Header.UknownIndiciesCount > 0)
            {
                currentResource++;
            }

            // process Vertex Attribute Hint resource
            if (container.Header.VertexComponentCount > 0)
            {
                currentResource++;
            }

            // process vertex attribute resources
            if (container.Header.VertexComponentCount > 0)
            {
                if (container.Header.VertexComponentCount >= 1)
                {
                    var posData = container.Resources[currentResource].Data.Span;

                    // TODO: Find out why stride can be different/ how to know other than this method
                    var itemStride = posData.Length / container.VertexCount;

                    for (var i = 0; i < container.VertexCount; i++)
                    {
                        var vert = new VertexFormat();

                        vert.Position = posData.ReadVec3At(i * itemStride);

                        verts[i] = vert;
                    }

                    currentResource++;
                }

                if (container.Header.VertexComponentCount >= 2)
                {
                    var texData = container.Resources[currentResource].Data.Span;

                    for (var i = 0; i < container.VertexCount; i++)
                    {
                        var vert = verts[i];

                        vert.TexCoords = texData.ReadVec2At(i * 8);

                        verts[i] = vert;
                    }

                    currentResource++;
                }

                if (container.Header.VertexComponentCount >= 3)
                {
                    var tbnData = container.Resources[currentResource].Data.Span;

                    for (var i = 0; i < container.VertexCount; i++)
                    {
                        var vert = verts[i];

                        var start = i * 36;
                        vert.Normal = tbnData.ReadVec3At(start);
                        vert.Bitangent = tbnData.ReadVec3At(start + 12);
                        vert.Tangent = tbnData.ReadVec3At(start + 24);

                        verts[i] = vert;
                    }

                    currentResource++;
                }

                // Process secondary UV (lightmap coordinates) if present
                if (container.Header.VertexComponentCount >= 4)
                {
                    var lmData = container.Resources[currentResource].Data.Span;
                    var itemStride = lmData.Length / container.VertexCount;

                    for (var i = 0; i < container.VertexCount; i++)
                    {
                        var vert = verts[i];

                        vert.LightmapTexCoords = lmData.ReadVec2At(i * itemStride);

                        verts[i] = vert;
                    }

                    currentResource++;
                }
            }

            // Log vertex position range for compression detection
            if (container.VertexCount > 0 && container.CompressionFlags != 0)
            {
                var minPos = verts[0].Position;
                var maxPos = verts[0].Position;
                for (var i = 1; i < Math.Min(container.VertexCount, 100); i++)
                {
                    var p = verts[i].Position;
                    minPos = System.Numerics.Vector3.Min(minPos, p);
                    maxPos = System.Numerics.Vector3.Max(maxPos, p);
                }
                Console.WriteLine($"[MeshDiag] {note ?? "container"}: CompressionFlags={container.CompressionFlags}, " +
                    $"vertexRange=[{minPos}]->[{maxPos}]");
            }

            var meshes = new List<ModelMesh>(parts.Count);

            foreach (var part in parts)
            {
                meshes.Add(new ModelMesh
                {
                    Verticies = verts,
                    Indices = indices.Slice(part.IndexStart, part.IndexCount).ToArray(),
                    Shader = part.Shader,
                    ElementType = part.ElementType,
                    Note = note
                });
            }

            return meshes.ToArray();
        }
    }
}
