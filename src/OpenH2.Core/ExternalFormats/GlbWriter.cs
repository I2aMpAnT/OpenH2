using OpenH2.Core.Extensions;
using OpenH2.Core.Tags;
using OpenH2.Core.Tags.Common.Models;
using OpenH2.Foundation;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace OpenH2.Core.ExternalFormats
{
    public class GlbWriter
    {
        private readonly List<GlbMesh> meshes = new();
        private readonly Dictionary<string, int> materialIndices = new();
        private readonly List<GlbMaterial> materials = new();

        public void AddBspCluster(MeshCollection meshCollection, ModelShaderReference[] shaders, string name)
        {
            foreach (var mesh in meshCollection.Meshes)
            {
                if (mesh.Verticies == null || mesh.Verticies.Length == 0 || mesh.Indices == null || mesh.Indices.Length == 0)
                    continue;

                var triangleIndices = ConvertToTriangleList(mesh);
                if (triangleIndices.Count == 0)
                    continue;

                var matName = $"mat_{mesh.Note ?? name}";
                var matIdx = GetOrCreateMaterial(matName);

                meshes.Add(new GlbMesh
                {
                    Name = name,
                    Vertices = mesh.Verticies,
                    Indices = triangleIndices.ToArray(),
                    Transform = Matrix4x4.Identity,
                    MaterialIndex = matIdx
                });
            }
        }

        public void AddInstancedGeometry(MeshCollection meshCollection, Matrix4x4 transform, string name)
        {
            foreach (var mesh in meshCollection.Meshes)
            {
                if (mesh.Verticies == null || mesh.Verticies.Length == 0 || mesh.Indices == null || mesh.Indices.Length == 0)
                    continue;

                var triangleIndices = ConvertToTriangleList(mesh);
                if (triangleIndices.Count == 0)
                    continue;

                var matName = $"mat_{mesh.Note ?? name}";
                var matIdx = GetOrCreateMaterial(matName);

                meshes.Add(new GlbMesh
                {
                    Name = name,
                    Vertices = mesh.Verticies,
                    Indices = triangleIndices.ToArray(),
                    Transform = transform,
                    MaterialIndex = matIdx
                });
            }
        }

        private int GetOrCreateMaterial(string name)
        {
            if (materialIndices.TryGetValue(name, out var idx))
                return idx;

            idx = materials.Count;
            // Deterministic color from name hash
            var hash = (uint)name.GetHashCode();
            var hue = (hash % 360) / 360.0f;
            HslToRgb(hue, 0.35f, 0.55f, out var r, out var g, out var b);

            materials.Add(new GlbMaterial { Name = name, R = r, G = g, B = b });
            materialIndices[name] = idx;
            return idx;
        }

        public byte[] ToGlb()
        {
            if (meshes.Count == 0)
                return Array.Empty<byte>();

            // Build binary buffer: all vertex positions, normals, texcoords, indices
            using var binStream = new MemoryStream();
            using var binWriter = new BinaryWriter(binStream);

            var accessors = new List<object>();
            var bufferViews = new List<object>();
            var gltfMeshes = new List<object>();
            var nodes = new List<object>();

            for (int mi = 0; mi < meshes.Count; mi++)
            {
                var mesh = meshes[mi];
                var verts = mesh.Vertices;
                var indices = mesh.Indices;
                var xform = mesh.Transform;

                // Write positions
                var posViewStart = (int)binStream.Position;
                float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
                float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;

                foreach (var v in verts)
                {
                    var pos = Vector3.Transform(v.Position, xform);
                    binWriter.Write(pos.X);
                    binWriter.Write(pos.Y);
                    binWriter.Write(pos.Z);
                    minX = Math.Min(minX, pos.X); maxX = Math.Max(maxX, pos.X);
                    minY = Math.Min(minY, pos.Y); maxY = Math.Max(maxY, pos.Y);
                    minZ = Math.Min(minZ, pos.Z); maxZ = Math.Max(maxZ, pos.Z);
                }
                var posViewLen = (int)binStream.Position - posViewStart;

                // Write normals
                var normViewStart = (int)binStream.Position;
                foreach (var v in verts)
                {
                    var n = Vector3.TransformNormal(v.Normal, xform);
                    var len = n.Length();
                    if (len > 0) n /= len;
                    binWriter.Write(n.X);
                    binWriter.Write(n.Y);
                    binWriter.Write(n.Z);
                }
                var normViewLen = (int)binStream.Position - normViewStart;

                // Write texcoords
                var uvViewStart = (int)binStream.Position;
                foreach (var v in verts)
                {
                    binWriter.Write(v.TexCoords.X);
                    binWriter.Write(v.TexCoords.Y);
                }
                var uvViewLen = (int)binStream.Position - uvViewStart;

                // Write indices (uint32)
                var idxViewStart = (int)binStream.Position;
                uint maxIdx = 0;
                foreach (var idx in indices)
                {
                    var ui = (uint)idx;
                    binWriter.Write(ui);
                    if (ui > maxIdx) maxIdx = ui;
                }
                var idxViewLen = (int)binStream.Position - idxViewStart;

                // Buffer views
                int bvPos = bufferViews.Count;
                bufferViews.Add(new { buffer = 0, byteOffset = posViewStart, byteLength = posViewLen, target = 34962 });
                bufferViews.Add(new { buffer = 0, byteOffset = normViewStart, byteLength = normViewLen, target = 34962 });
                bufferViews.Add(new { buffer = 0, byteOffset = uvViewStart, byteLength = uvViewLen, target = 34962 });
                bufferViews.Add(new { buffer = 0, byteOffset = idxViewStart, byteLength = idxViewLen, target = 34963 });

                // Accessors
                int accPos = accessors.Count;
                accessors.Add(new { bufferView = bvPos, componentType = 5126, count = verts.Length, type = "VEC3", min = new[] { minX, minY, minZ }, max = new[] { maxX, maxY, maxZ } });
                accessors.Add(new { bufferView = bvPos + 1, componentType = 5126, count = verts.Length, type = "VEC3" });
                accessors.Add(new { bufferView = bvPos + 2, componentType = 5126, count = verts.Length, type = "VEC2" });
                accessors.Add(new { bufferView = bvPos + 3, componentType = 5125, count = indices.Length, type = "SCALAR" });

                // Mesh primitive
                gltfMeshes.Add(new
                {
                    name = mesh.Name,
                    primitives = new[]
                    {
                        new
                        {
                            attributes = new Dictionary<string, int>
                            {
                                { "POSITION", accPos },
                                { "NORMAL", accPos + 1 },
                                { "TEXCOORD_0", accPos + 2 }
                            },
                            indices = accPos + 3,
                            material = mesh.MaterialIndex
                        }
                    }
                });

                nodes.Add(new { mesh = mi, name = mesh.Name });
            }

            // Pad binary buffer to 4-byte alignment
            while (binStream.Position % 4 != 0)
                binWriter.Write((byte)0);

            var binData = binStream.ToArray();

            // Build glTF JSON
            var gltfMaterials = materials.Select(m => new
            {
                name = m.Name,
                pbrMetallicRoughness = new
                {
                    baseColorFactor = new[] { m.R, m.G, m.B, 1.0f },
                    metallicFactor = 0.0f,
                    roughnessFactor = 0.7f
                },
                doubleSided = true
            }).ToArray();

            var sceneNodes = Enumerable.Range(0, nodes.Count).ToArray();

            var gltf = new
            {
                asset = new { version = "2.0", generator = "OpenH2.Launcher" },
                scene = 0,
                scenes = new[] { new { name = "Halo2Map", nodes = sceneNodes } },
                nodes = nodes.ToArray(),
                meshes = gltfMeshes.ToArray(),
                accessors = accessors.ToArray(),
                bufferViews = bufferViews.ToArray(),
                buffers = new[] { new { byteLength = binData.Length } },
                materials = gltfMaterials
            };

            var jsonString = JsonSerializer.Serialize(gltf, new JsonSerializerOptions { WriteIndented = false });
            var jsonBytes = Encoding.UTF8.GetBytes(jsonString);

            // Pad JSON to 4-byte alignment with spaces
            var jsonPadding = (4 - (jsonBytes.Length % 4)) % 4;
            var jsonPadded = new byte[jsonBytes.Length + jsonPadding];
            Array.Copy(jsonBytes, jsonPadded, jsonBytes.Length);
            for (int i = jsonBytes.Length; i < jsonPadded.Length; i++)
                jsonPadded[i] = 0x20; // space

            // Write GLB
            var totalLength = 12 + 8 + jsonPadded.Length + 8 + binData.Length;
            using var glbStream = new MemoryStream(totalLength);
            using var glbWriter = new BinaryWriter(glbStream);

            // GLB header
            glbWriter.Write(0x46546C67); // "glTF"
            glbWriter.Write(2);           // version
            glbWriter.Write(totalLength);

            // JSON chunk
            glbWriter.Write(jsonPadded.Length);
            glbWriter.Write(0x4E4F534A); // "JSON"
            glbWriter.Write(jsonPadded);

            // BIN chunk
            glbWriter.Write(binData.Length);
            glbWriter.Write(0x004E4942); // "BIN\0"
            glbWriter.Write(binData);

            return glbStream.ToArray();
        }

        private static List<int> ConvertToTriangleList(ModelMesh mesh)
        {
            var result = new List<int>();

            switch (mesh.ElementType)
            {
                case MeshElementType.TriangleList:
                case MeshElementType.TriangleListEnvironment:
                    for (int i = 0; i < mesh.Indices.Length - 2; i += 3)
                    {
                        var a = mesh.Indices[i];
                        var b = mesh.Indices[i + 1];
                        var c = mesh.Indices[i + 2];
                        if (a != b && b != c && a != c)
                        {
                            result.Add(a);
                            result.Add(b);
                            result.Add(c);
                        }
                    }
                    break;

                case MeshElementType.TriangleStrip:
                case MeshElementType.TriangleStripDecal:
                    var stripVerts = new List<int>();
                    for (int i = 0; i < mesh.Indices.Length; i++)
                    {
                        if (mesh.Indices[i] == -1 || mesh.Indices[i] == 0xFFFF)
                        {
                            stripVerts.Clear();
                            continue;
                        }
                        stripVerts.Add(mesh.Indices[i]);
                        if (stripVerts.Count >= 3)
                        {
                            var triIdx = stripVerts.Count - 3;
                            var a = stripVerts[triIdx];
                            var b = stripVerts[triIdx + 1];
                            var c = stripVerts[triIdx + 2];
                            if (a != b && b != c && a != c)
                            {
                                if (triIdx % 2 == 0)
                                {
                                    result.Add(a);
                                    result.Add(b);
                                    result.Add(c);
                                }
                                else
                                {
                                    result.Add(a);
                                    result.Add(c);
                                    result.Add(b);
                                }
                            }
                        }
                    }
                    break;
            }

            return result;
        }

        private static void HslToRgb(float h, float s, float l, out float r, out float g, out float b)
        {
            float c = (1 - Math.Abs(2 * l - 1)) * s;
            float x = c * (1 - Math.Abs((h * 6) % 2 - 1));
            float m = l - c / 2;

            float r1, g1, b1;
            int sector = (int)(h * 6) % 6;
            switch (sector)
            {
                case 0: r1 = c; g1 = x; b1 = 0; break;
                case 1: r1 = x; g1 = c; b1 = 0; break;
                case 2: r1 = 0; g1 = c; b1 = x; break;
                case 3: r1 = 0; g1 = x; b1 = c; break;
                case 4: r1 = x; g1 = 0; b1 = c; break;
                default: r1 = c; g1 = 0; b1 = x; break;
            }
            r = r1 + m;
            g = g1 + m;
            b = b1 + m;
        }

        private class GlbMesh
        {
            public string Name;
            public VertexFormat[] Vertices;
            public int[] Indices;
            public Matrix4x4 Transform;
            public int MaterialIndex;
        }

        private class GlbMaterial
        {
            public string Name;
            public float R, G, B;
        }
    }
}
