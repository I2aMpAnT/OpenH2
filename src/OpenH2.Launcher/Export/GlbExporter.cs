using OpenH2.Core.Factories;
using OpenH2.Core.Maps;
using OpenH2.Core.Tags;
using OpenH2.Foundation;
using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace OpenH2.Launcher.Export
{
    /// <summary>
    /// Exports Halo 2 map geometry to GLB (binary glTF 2.0) format.
    /// Handles coordinate system conversion from Halo (Z-up) to glTF (Y-up).
    /// </summary>
    public class GlbExporter
    {
        // GLB magic numbers
        private const uint GLB_MAGIC = 0x46546C67; // "glTF"
        private const uint GLB_VERSION = 2;
        private const uint JSON_CHUNK_TYPE = 0x4E4F534A; // "JSON"
        private const uint BIN_CHUNK_TYPE = 0x004E4942; // "BIN\0"

        // glTF constants
        private const int FLOAT = 5126;
        private const int UNSIGNED_INT = 5125;
        private const int ARRAY_BUFFER = 34962;
        private const int ELEMENT_ARRAY_BUFFER = 34963;

        /// <summary>
        /// Export a single map to GLB format.
        /// </summary>
        public static void ExportMap(string mapPath, string outputPath, AncillaryMapConfig? ancillaryConfig = null)
        {
            Console.WriteLine($"[GlbExporter] Loading map: {mapPath}");

            var mapDir = Path.GetDirectoryName(mapPath) ?? ".";
            var factory = new MapFactory(mapDir, ancillaryConfig);
            var mapName = Path.GetFileName(mapPath);

            IH2Map map;
            try
            {
                map = factory.Load(mapName);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GlbExporter] Failed to load map: {ex.Message}");
                return;
            }

            if (map is not IH2PlayableMap playableMap)
            {
                Console.WriteLine($"[GlbExporter] Map is not a playable map type");
                return;
            }

            Console.WriteLine($"[GlbExporter] Extracting geometry...");

            var primitives = ExtractGeometry(playableMap);

            if (primitives.Count == 0)
            {
                Console.WriteLine($"[GlbExporter] No geometry found in map");
                return;
            }

            Console.WriteLine($"[GlbExporter] Found {primitives.Count} primitives");
            Console.WriteLine($"[GlbExporter] Building GLB...");

            BuildGlb(primitives, outputPath);

            Console.WriteLine($"[GlbExporter] Exported to: {outputPath}");
        }

        /// <summary>
        /// Export all maps in a folder to GLB format.
        /// </summary>
        public static void ExportAllMaps(string mapFolder, string outputFolder, AncillaryMapConfig? ancillaryConfig = null, Action<string>? progressCallback = null)
        {
            if (!Directory.Exists(mapFolder))
            {
                Console.WriteLine($"[GlbExporter] Map folder does not exist: {mapFolder}");
                return;
            }

            Directory.CreateDirectory(outputFolder);

            var mapFiles = Directory.GetFiles(mapFolder, "*.map");
            var exported = 0;
            var skipped = 0;

            foreach (var mapPath in mapFiles)
            {
                var mapName = Path.GetFileNameWithoutExtension(mapPath);

                // Skip ancillary maps
                if (mapName == "shared" || mapName == "mainmenu" || mapName == "single_player_shared")
                {
                    Console.WriteLine($"[GlbExporter] Skipping ancillary map: {mapName}");
                    skipped++;
                    continue;
                }

                progressCallback?.Invoke($"Exporting {mapName}...");

                var outputPath = Path.Combine(outputFolder, $"{mapName}.glb");

                try
                {
                    ExportMap(mapPath, outputPath, ancillaryConfig);
                    exported++;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[GlbExporter] Failed to export {mapName}: {ex.Message}");
                    skipped++;
                }
            }

            progressCallback?.Invoke($"Complete! Exported {exported} maps, skipped {skipped}");
            Console.WriteLine($"[GlbExporter] Export complete. {exported} exported, {skipped} skipped.");
        }

        private static List<GlbPrimitive> ExtractGeometry(IH2PlayableMap map)
        {
            var primitives = new List<GlbPrimitive>();
            var scenario = map.Scenario;

            // Extract BSP geometry from each terrain
            foreach (var terrain in scenario.Terrains)
            {
                if (terrain.Bsp.IsInvalid) continue;

                BspTag bsp;
                try
                {
                    bsp = map.GetTag(terrain.Bsp);
                }
                catch
                {
                    continue;
                }

                // Extract clusters (main level geometry)
                foreach (var cluster in bsp.Clusters)
                {
                    if (cluster.Model?.Meshes == null) continue;

                    foreach (var modelMesh in cluster.Model.Meshes)
                    {
                        var primitive = ConvertMesh(map, modelMesh);
                        if (primitive != null)
                        {
                            primitives.Add(primitive);
                        }
                    }
                }

                // Extract instanced geometry
                foreach (var instanceDef in bsp.InstancedGeometryDefinitions)
                {
                    if (instanceDef.Model?.Meshes == null) continue;

                    foreach (var modelMesh in instanceDef.Model.Meshes)
                    {
                        var primitive = ConvertMesh(map, modelMesh);
                        if (primitive != null)
                        {
                            primitives.Add(primitive);
                        }
                    }
                }
            }

            return primitives;
        }

        private static GlbPrimitive? ConvertMesh(IH2PlayableMap map, OpenH2.Core.Tags.Common.Models.ModelMesh modelMesh)
        {
            if (modelMesh.Verticies == null || modelMesh.Verticies.Length == 0)
                return null;
            if (modelMesh.Indices == null || modelMesh.Indices.Length == 0)
                return null;

            var primitive = new GlbPrimitive();

            // Rotation matrix: Halo Z-up to glTF Y-up
            // X=-90° rotation to convert Z-up to Y-up
            // Y=-180° rotation to flip orientation
            float rotX = -90f * MathF.PI / 180f;
            float rotY = -180f * MathF.PI / 180f;
            var rotationX = Matrix4x4.CreateRotationX(rotX);
            var rotationY = Matrix4x4.CreateRotationY(rotY);
            var exportRotation = rotationX * rotationY;

            // Convert vertices
            foreach (var vertex in modelMesh.Verticies)
            {
                // Apply coordinate transform
                var rotated = Vector3.Transform(vertex.Position, exportRotation);
                primitive.Positions.Add(rotated.X);
                primitive.Positions.Add(rotated.Y);
                primitive.Positions.Add(rotated.Z);

                // Update bounds
                primitive.MinX = MathF.Min(primitive.MinX, rotated.X);
                primitive.MaxX = MathF.Max(primitive.MaxX, rotated.X);
                primitive.MinY = MathF.Min(primitive.MinY, rotated.Y);
                primitive.MaxY = MathF.Max(primitive.MaxY, rotated.Y);
                primitive.MinZ = MathF.Min(primitive.MinZ, rotated.Z);
                primitive.MaxZ = MathF.Max(primitive.MaxZ, rotated.Z);

                // Fix UV coordinates (flip V)
                primitive.UVs.Add(vertex.TexCoords.X);
                primitive.UVs.Add(1.0f - vertex.TexCoords.Y);

                // Transform normals
                var rotatedNormal = Vector3.TransformNormal(vertex.Normal, exportRotation);
                primitive.Normals.Add(rotatedNormal.X);
                primitive.Normals.Add(rotatedNormal.Y);
                primitive.Normals.Add(rotatedNormal.Z);
            }

            // Convert indices based on element type
            var indices = modelMesh.Indices;
            var elementType = modelMesh.ElementType;

            if (elementType == MeshElementType.TriangleStrip || elementType == MeshElementType.TriangleStripDecal)
            {
                // Convert triangle strip to triangle list
                ConvertTriangleStrip(indices, primitive.Indices);
            }
            else
            {
                // Triangle list - reverse winding order (swap indices 1 and 2)
                for (int i = 0; i < indices.Length - 2; i += 3)
                {
                    primitive.Indices.Add((uint)indices[i]);
                    primitive.Indices.Add((uint)indices[i + 2]); // Swapped
                    primitive.Indices.Add((uint)indices[i + 1]); // Swapped
                }
            }

            if (primitive.Indices.Count < 3)
                return null;

            return primitive;
        }

        private static void ConvertTriangleStrip(int[] indices, List<uint> output)
        {
            bool flip = false;
            for (int i = 0; i < indices.Length - 2; i++)
            {
                int i0 = indices[i];
                int i1 = indices[i + 1];
                int i2 = indices[i + 2];

                // Skip degenerate triangles
                if (i0 != i1 && i0 != i2 && i1 != i2)
                {
                    if (flip)
                    {
                        // Reverse winding for strip + flip
                        output.Add((uint)i0);
                        output.Add((uint)i1); // Already flipped by strip
                        output.Add((uint)i2);
                    }
                    else
                    {
                        // Reverse winding
                        output.Add((uint)i0);
                        output.Add((uint)i2); // Swapped
                        output.Add((uint)i1); // Swapped
                    }
                }

                flip = !flip;
            }
        }

        private static void BuildGlb(List<GlbPrimitive> primitives, string outputPath)
        {
            using var binStream = new MemoryStream();
            using var binWriter = new BinaryWriter(binStream);

            var bufferViews = new List<object>();
            var accessors = new List<object>();
            var meshPrimitives = new List<object>();

            int accessorIndex = 0;

            foreach (var primitive in primitives)
            {
                int positionAccessor = -1, uvAccessor = -1, normalAccessor = -1, indexAccessor = -1;

                // Write positions
                var posOffset = (int)binStream.Position;
                foreach (var p in primitive.Positions)
                    binWriter.Write(p);
                PadTo4Bytes(binWriter, binStream);
                var posLength = (int)binStream.Position - posOffset;

                bufferViews.Add(new { buffer = 0, byteOffset = posOffset, byteLength = posLength, target = ARRAY_BUFFER });
                accessors.Add(new
                {
                    bufferView = bufferViews.Count - 1,
                    componentType = FLOAT,
                    count = primitive.Positions.Count / 3,
                    type = "VEC3",
                    min = new[] { primitive.MinX, primitive.MinY, primitive.MinZ },
                    max = new[] { primitive.MaxX, primitive.MaxY, primitive.MaxZ }
                });
                positionAccessor = accessorIndex++;

                // Write UVs
                var uvOffset = (int)binStream.Position;
                foreach (var uv in primitive.UVs)
                    binWriter.Write(uv);
                PadTo4Bytes(binWriter, binStream);
                var uvLength = (int)binStream.Position - uvOffset;

                bufferViews.Add(new { buffer = 0, byteOffset = uvOffset, byteLength = uvLength, target = ARRAY_BUFFER });
                accessors.Add(new
                {
                    bufferView = bufferViews.Count - 1,
                    componentType = FLOAT,
                    count = primitive.UVs.Count / 2,
                    type = "VEC2"
                });
                uvAccessor = accessorIndex++;

                // Write normals
                var normalOffset = (int)binStream.Position;
                foreach (var n in primitive.Normals)
                    binWriter.Write(n);
                PadTo4Bytes(binWriter, binStream);
                var normalLength = (int)binStream.Position - normalOffset;

                bufferViews.Add(new { buffer = 0, byteOffset = normalOffset, byteLength = normalLength, target = ARRAY_BUFFER });
                accessors.Add(new
                {
                    bufferView = bufferViews.Count - 1,
                    componentType = FLOAT,
                    count = primitive.Normals.Count / 3,
                    type = "VEC3"
                });
                normalAccessor = accessorIndex++;

                // Write indices
                var indexOffset = (int)binStream.Position;
                foreach (var idx in primitive.Indices)
                    binWriter.Write(idx);
                PadTo4Bytes(binWriter, binStream);
                var indexLength = (int)binStream.Position - indexOffset;

                bufferViews.Add(new { buffer = 0, byteOffset = indexOffset, byteLength = indexLength, target = ELEMENT_ARRAY_BUFFER });
                accessors.Add(new
                {
                    bufferView = bufferViews.Count - 1,
                    componentType = UNSIGNED_INT,
                    count = primitive.Indices.Count,
                    type = "SCALAR"
                });
                indexAccessor = accessorIndex++;

                meshPrimitives.Add(new
                {
                    attributes = new Dictionary<string, int>
                    {
                        ["POSITION"] = positionAccessor,
                        ["TEXCOORD_0"] = uvAccessor,
                        ["NORMAL"] = normalAccessor
                    },
                    indices = indexAccessor,
                    material = 0
                });
            }

            var binaryData = binStream.ToArray();

            // Build JSON
            var gltf = new Dictionary<string, object>
            {
                ["asset"] = new { version = "2.0", generator = "OpenH2 GlbExporter" },
                ["scene"] = 0,
                ["scenes"] = new[] { new { nodes = new[] { 0 } } },
                ["nodes"] = new[] { new { mesh = 0 } },
                ["meshes"] = new[] { new { primitives = meshPrimitives } },
                ["materials"] = new[]
                {
                    new
                    {
                        pbrMetallicRoughness = new
                        {
                            baseColorFactor = new[] { 0.8f, 0.8f, 0.8f, 1.0f },
                            metallicFactor = 0.0f,
                            roughnessFactor = 1.0f
                        },
                        doubleSided = true
                    }
                },
                ["bufferViews"] = bufferViews,
                ["accessors"] = accessors,
                ["buffers"] = new[] { new { byteLength = binaryData.Length } }
            };

            var jsonString = JsonSerializer.Serialize(gltf, new JsonSerializerOptions { WriteIndented = false });
            var jsonBytes = Encoding.UTF8.GetBytes(jsonString);

            // Pad JSON to 4-byte alignment
            var jsonPadding = (4 - (jsonBytes.Length % 4)) % 4;
            var paddedJsonBytes = new byte[jsonBytes.Length + jsonPadding];
            Array.Copy(jsonBytes, paddedJsonBytes, jsonBytes.Length);
            for (int i = jsonBytes.Length; i < paddedJsonBytes.Length; i++)
                paddedJsonBytes[i] = 0x20; // Space character

            // Write GLB file
            using var fs = File.Create(outputPath);
            using var writer = new BinaryWriter(fs);

            // Header
            var totalLength = 12 + 8 + paddedJsonBytes.Length + 8 + binaryData.Length;
            writer.Write(GLB_MAGIC);
            writer.Write(GLB_VERSION);
            writer.Write((uint)totalLength);

            // JSON chunk
            writer.Write((uint)paddedJsonBytes.Length);
            writer.Write(JSON_CHUNK_TYPE);
            writer.Write(paddedJsonBytes);

            // Binary chunk
            writer.Write((uint)binaryData.Length);
            writer.Write(BIN_CHUNK_TYPE);
            writer.Write(binaryData);
        }

        private static void PadTo4Bytes(BinaryWriter writer, MemoryStream stream)
        {
            while (stream.Position % 4 != 0)
                writer.Write((byte)0);
        }
    }

    internal class GlbPrimitive
    {
        public List<float> Positions { get; } = new();
        public List<float> UVs { get; } = new();
        public List<float> Normals { get; } = new();
        public List<uint> Indices { get; } = new();

        public float MinX { get; set; } = float.MaxValue;
        public float MaxX { get; set; } = float.MinValue;
        public float MinY { get; set; } = float.MaxValue;
        public float MaxY { get; set; } = float.MinValue;
        public float MinZ { get; set; } = float.MaxValue;
        public float MaxZ { get; set; } = float.MinValue;
    }
}
