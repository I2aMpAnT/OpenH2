using OpenH2.Core.Configuration;
using OpenH2.Core.Enums.Texture;
using OpenH2.Core.Extensions;
using OpenH2.Core.Maps.Vista;
using OpenH2.Core.Tags;
using OpenH2.Core.Tags.Common.Models;
using OpenH2.Foundation;
using OpenBlam.Core.Texturing;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace OpenH2.Core.ExternalFormats
{
    public class GlbWriter
    {
        private readonly H2vMap scene;
        private readonly MaterialMappingConfig materialConfig;
        private readonly List<GlbMesh> meshes = new();
        private readonly Dictionary<uint, int> materialByShader = new();
        private readonly List<GlbMaterial> materials = new();
        private readonly Dictionary<uint, int> textureByBitmap = new();
        private readonly List<GlbTexture> textures = new();
        private int fallbackMatIdx = -1;

        public GlbWriter(H2vMap scene)
        {
            this.scene = scene;
            this.materialConfig = LoadMaterialConfig();
        }

        private static MaterialMappingConfig LoadMaterialConfig()
        {
            // Try to find material-config.json from the config root
            var configRoot = Environment.GetEnvironmentVariable(ConfigurationConstants.ConfigPathOverrideEnvironmentVariable);

            string[] searchPaths;
            if (!string.IsNullOrEmpty(configRoot))
            {
                searchPaths = new[] { Path.Combine(configRoot, ConfigurationConstants.MaterialConfigName) };
            }
            else
            {
                // Search common locations
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                searchPaths = new[]
                {
                    Path.Combine(baseDir, ConfigurationConstants.MaterialConfigName),
                    Path.Combine(baseDir, "Configs", ConfigurationConstants.MaterialConfigName),
                    Path.Combine(Directory.GetCurrentDirectory(), ConfigurationConstants.MaterialConfigName),
                };
            }

            foreach (var path in searchPaths)
            {
                if (File.Exists(path))
                {
                    var json = File.ReadAllText(path);
                    var opts = new JsonSerializerOptions
                    {
                        AllowTrailingCommas = true,
                        ReadCommentHandling = JsonCommentHandling.Skip,
                        PropertyNameCaseInsensitive = true
                    };
                    var config = JsonSerializer.Deserialize<MaterialMappingConfig>(json, opts);
                    Console.WriteLine($"  [glb] Loaded material config from {path}");
                    return config;
                }
            }

            Console.WriteLine("  [glb] WARNING: material-config.json not found, using heuristic fallback");
            return new MaterialMappingConfig
            {
                Aliases = new Dictionary<string, MaterialAlias>(),
                Mappings = new Dictionary<string, MaterialMapping>()
            };
        }

        public void AddMeshCollection(MeshCollection meshCollection, Matrix4x4 transform, string name)
        {
            if (meshCollection?.Meshes == null) return;

            foreach (var mesh in meshCollection.Meshes)
            {
                if (mesh.Verticies == null || mesh.Verticies.Length == 0 || mesh.Indices == null || mesh.Indices.Length == 0)
                    continue;

                var triangleIndices = ConvertToTriangleList(mesh);
                if (triangleIndices.Count == 0)
                    continue;

                var matIdx = ResolveMaterial(mesh);

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

        private int ResolveMaterial(ModelMesh mesh)
        {
            var shaderId = mesh.Shader.Id;
            if (shaderId == uint.MaxValue || shaderId == 0)
                return GetFallbackMaterial();

            if (materialByShader.TryGetValue(shaderId, out var idx))
                return idx;

            if (!scene.TryGetTag(mesh.Shader, out ShaderTag shader))
            {
                Console.WriteLine($"  [tex] Shader {shaderId:X8} not found in scene");
                materialByShader[shaderId] = GetFallbackMaterial();
                return materialByShader[shaderId];
            }

            BitmapTag diffuseBitmap = null;

            if (shader.Arguments != null && shader.Arguments.Length > 0)
            {
                var args = shader.Arguments[0];

                // Try config-based lookup (same as MaterialFactory.PopulateFromMapping)
                if (args.ShaderTemplate.Id != uint.MaxValue && scene.TryGetTag(args.ShaderTemplate, out var templateTag))
                {
                    var templateKey = templateTag.Name;

                    // Resolve aliases
                    if (materialConfig.Aliases != null && materialConfig.Aliases.TryGetValue(templateKey, out var alias))
                        templateKey = alias.Alias;

                    if (materialConfig.Mappings != null && materialConfig.Mappings.TryGetValue(templateKey, out var mapping))
                    {
                        // Use the exact DiffuseMapIndex from config
                        if (mapping.DiffuseMapIndex.HasValue)
                        {
                            diffuseBitmap = args.GetBitmap(scene, mapping.DiffuseMapIndex);
                        }
                    }
                }

                // Heuristic fallback (same as MaterialFactory.PopulateFromHeuristic)
                if (diffuseBitmap == null && args.BitmapArguments != null)
                {
                    // First check BitmapInfos for legacy diffuse
                    if (shader.BitmapInfos != null)
                    {
                        foreach (var info in shader.BitmapInfos)
                        {
                            if (!info.DiffuseBitmap.IsInvalid)
                            {
                                scene.TryGetTag(info.DiffuseBitmap, out diffuseBitmap);
                                if (diffuseBitmap != null) break;
                            }
                        }
                    }

                    // Then scan BitmapArguments for TextureUsage.Diffuse
                    if (diffuseBitmap == null)
                    {
                        for (int i = 0; i < args.BitmapArguments.Length; i++)
                        {
                            if (!scene.TryGetTag(args.BitmapArguments[i].Bitmap, out var bitm))
                                continue;
                            if (bitm.TextureUsage == TextureUsage.Diffuse)
                            {
                                diffuseBitmap = bitm;
                                break;
                            }
                        }
                    }

                    // Last resort: first bitmap argument
                    if (diffuseBitmap == null && args.BitmapArguments.Length > 0)
                    {
                        scene.TryGetTag(args.BitmapArguments[0].Bitmap, out diffuseBitmap);
                    }
                }
            }
            else if (shader.BitmapInfos != null)
            {
                // No Arguments at all, try legacy path
                foreach (var info in shader.BitmapInfos)
                {
                    if (!info.DiffuseBitmap.IsInvalid)
                    {
                        scene.TryGetTag(info.DiffuseBitmap, out diffuseBitmap);
                        if (diffuseBitmap != null) break;
                    }
                }
            }

            int texIdx = -1;
            if (diffuseBitmap != null)
            {
                texIdx = GetOrCreateTexture(diffuseBitmap);
            }
            else
            {
                Console.WriteLine($"  [tex] No diffuse bitmap for shader '{shader.Name}' ({shaderId:X8})");
            }

            idx = materials.Count;
            materials.Add(new GlbMaterial
            {
                Name = shader.Name ?? $"shader_{shaderId:X8}",
                TextureIndex = texIdx
            });
            materialByShader[shaderId] = idx;
            return idx;
        }

        private int GetFallbackMaterial()
        {
            if (fallbackMatIdx >= 0) return fallbackMatIdx;
            fallbackMatIdx = materials.Count;
            materials.Add(new GlbMaterial { Name = "fallback", TextureIndex = -1 });
            return fallbackMatIdx;
        }

        private int GetOrCreateTexture(BitmapTag bitmap)
        {
            if (textureByBitmap.TryGetValue(bitmap.Id, out var idx))
                return idx;

            if (bitmap.TextureInfos == null || bitmap.TextureInfos.Length == 0)
            {
                Console.WriteLine($"  [tex] Bitmap '{bitmap.Name}' ({bitmap.Id:X8}): no TextureInfos");
                textureByBitmap[bitmap.Id] = -1;
                return -1;
            }

            var info = bitmap.TextureInfos[0];
            if (info.LevelsOfDetail == null || info.LevelsOfDetail.Length == 0 || info.LevelsOfDetail[0].Data.Length == 0)
            {
                Console.WriteLine($"  [tex] Bitmap '{bitmap.Name}' ({bitmap.Id:X8}): no LOD data");
                textureByBitmap[bitmap.Id] = -1;
                return -1;
            }

            var width = info.Width;
            var height = info.Height;
            if (width <= 0 || height <= 0)
            {
                Console.WriteLine($"  [tex] Bitmap '{bitmap.Name}' ({bitmap.Id:X8}): invalid size {width}x{height}");
                textureByBitmap[bitmap.Id] = -1;
                return -1;
            }

            var rawData = info.LevelsOfDetail[0].Data.Span;
            byte[] rgba;

            try
            {
                rgba = DecodeToRgba(rawData, width, height, info.Format);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  [tex] Bitmap '{bitmap.Name}' ({bitmap.Id:X8}): decode threw {ex.Message}");
                textureByBitmap[bitmap.Id] = -1;
                return -1;
            }

            if (rgba == null)
            {
                Console.WriteLine($"  [tex] Bitmap '{bitmap.Name}' ({bitmap.Id:X8}): unsupported format {info.Format}");
                textureByBitmap[bitmap.Id] = -1;
                return -1;
            }

            var pngData = EncodePng(rgba, width, height);

            idx = textures.Count;
            textures.Add(new GlbTexture
            {
                Name = bitmap.Name ?? $"bitm_{bitmap.Id:X8}",
                PngData = pngData,
                Width = width,
                Height = height
            });
            textureByBitmap[bitmap.Id] = idx;
            return idx;
        }

        public byte[] ToGlb()
        {
            if (meshes.Count == 0)
                return Array.Empty<byte>();

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

                // Write texcoords (Vulkan and glTF both use top-left origin, no flip needed)
                var uvViewStart = (int)binStream.Position;
                foreach (var v in verts)
                {
                    binWriter.Write(v.TexCoords.X);
                    binWriter.Write(v.TexCoords.Y);
                }
                var uvViewLen = (int)binStream.Position - uvViewStart;

                // Write indices (uint32)
                var idxViewStart = (int)binStream.Position;
                foreach (var idx in indices)
                    binWriter.Write((uint)idx);
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

            // Write texture image data into the binary buffer
            var imageBufferViews = new List<int>();
            foreach (var tex in textures)
            {
                // Align to 4 bytes
                while (binStream.Position % 4 != 0) binWriter.Write((byte)0);

                var imgStart = (int)binStream.Position;
                binWriter.Write(tex.PngData);
                var imgLen = (int)binStream.Position - imgStart;

                imageBufferViews.Add(bufferViews.Count);
                bufferViews.Add(new { buffer = 0, byteOffset = imgStart, byteLength = imgLen });
            }

            // Pad binary buffer to 4-byte alignment
            while (binStream.Position % 4 != 0) binWriter.Write((byte)0);

            var binData = binStream.ToArray();

            Console.WriteLine($"  [glb] {textures.Count} textures baked, {materials.Count} materials, {meshes.Count} meshes");
            Console.WriteLine($"  [glb] Binary buffer: {binData.Length / 1024}KB (textures: {textures.Sum(t => t.PngData.Length) / 1024}KB)");

            // Build glTF JSON
            var gltfImages = textures.Select((tex, i) => new
            {
                mimeType = "image/png",
                bufferView = imageBufferViews[i],
                name = tex.Name
            }).ToArray();

            var gltfTextures = textures.Select((tex, i) => new
            {
                source = i,
                name = tex.Name
            }).ToArray();

            var gltfMaterials = materials.Select(m =>
            {
                var pbr = new Dictionary<string, object>
                {
                    { "metallicFactor", 0.0f },
                    { "roughnessFactor", 0.7f }
                };

                if (m.TextureIndex >= 0)
                {
                    pbr["baseColorTexture"] = new { index = m.TextureIndex };
                }
                else
                {
                    pbr["baseColorFactor"] = new[] { 0.5f, 0.5f, 0.5f, 1.0f };
                }

                return new Dictionary<string, object>
                {
                    { "name", m.Name },
                    { "pbrMetallicRoughness", pbr },
                    { "doubleSided", true }
                };
            }).ToArray();

            var sceneNodes = Enumerable.Range(0, nodes.Count).ToArray();

            var gltfRoot = new Dictionary<string, object>
            {
                { "asset", new { version = "2.0", generator = "OpenH2.Launcher" } },
                { "scene", 0 },
                { "scenes", new[] { new { name = "Halo2Map", nodes = sceneNodes } } },
                { "nodes", nodes.ToArray() },
                { "meshes", gltfMeshes.ToArray() },
                { "accessors", accessors.ToArray() },
                { "bufferViews", bufferViews.ToArray() },
                { "buffers", new[] { new { byteLength = binData.Length } } },
                { "materials", gltfMaterials }
            };

            if (gltfImages.Length > 0)
            {
                gltfRoot["images"] = gltfImages;
                gltfRoot["textures"] = gltfTextures;
            }

            var jsonString = JsonSerializer.Serialize(gltfRoot, new JsonSerializerOptions { WriteIndented = false });
            var jsonBytes = Encoding.UTF8.GetBytes(jsonString);

            // Pad JSON to 4-byte alignment with spaces
            var jsonPadding = (4 - (jsonBytes.Length % 4)) % 4;
            var jsonPadded = new byte[jsonBytes.Length + jsonPadding];
            Array.Copy(jsonBytes, jsonPadded, jsonBytes.Length);
            for (int i = jsonBytes.Length; i < jsonPadded.Length; i++)
                jsonPadded[i] = 0x20;

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

        // ===== DXT Decoding =====

        private static byte[] DecodeToRgba(ReadOnlySpan<byte> data, int width, int height, TextureFormat format)
        {
            switch (format)
            {
                case TextureFormat.DXT1:
                    return DecodeDxt1(data, width, height);
                case TextureFormat.DXT23:
                    return DecodeDxt3(data, width, height);
                case TextureFormat.DXT45:
                    return DecodeDxt5(data, width, height);
                case TextureFormat.A8R8G8B8:
                    return DecodeBgra(data, width, height);
                case TextureFormat.R8G8B8:
                    return DecodeBgr(data, width, height);
                case TextureFormat.A8:
                case TextureFormat.L8:
                    return DecodeL8(data, width, height);
                case TextureFormat.A8L8:
                    return DecodeA8L8(data, width, height);
                case TextureFormat.R5G6B5:
                    return DecodeR5G6B5(data, width, height);
                case TextureFormat.A4R4G4B4:
                    return DecodeA4R4G4B4(data, width, height);
                default:
                    return null;
            }
        }

        private static byte[] DecodeDxt1(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int blocksX = (width + 3) / 4;
            int blocksY = (height + 3) / 4;
            int offset = 0;

            for (int by = 0; by < blocksY; by++)
            {
                for (int bx = 0; bx < blocksX; bx++)
                {
                    if (offset + 8 > data.Length) return rgba;

                    ushort c0 = (ushort)(data[offset] | (data[offset + 1] << 8));
                    ushort c1 = (ushort)(data[offset + 2] | (data[offset + 3] << 8));
                    uint lookup = (uint)(data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24));
                    offset += 8;

                    Rgb565ToRgb(c0, out byte r0, out byte g0, out byte b0);
                    Rgb565ToRgb(c1, out byte r1, out byte g1, out byte b1);

                    var colors = new byte[16]; // 4 colors × RGBA
                    colors[0] = r0; colors[1] = g0; colors[2] = b0; colors[3] = 255;
                    colors[4] = r1; colors[5] = g1; colors[6] = b1; colors[7] = 255;

                    if (c0 > c1)
                    {
                        colors[8] = (byte)((2 * r0 + r1) / 3); colors[9] = (byte)((2 * g0 + g1) / 3); colors[10] = (byte)((2 * b0 + b1) / 3); colors[11] = 255;
                        colors[12] = (byte)((r0 + 2 * r1) / 3); colors[13] = (byte)((g0 + 2 * g1) / 3); colors[14] = (byte)((b0 + 2 * b1) / 3); colors[15] = 255;
                    }
                    else
                    {
                        colors[8] = (byte)((r0 + r1) / 2); colors[9] = (byte)((g0 + g1) / 2); colors[10] = (byte)((b0 + b1) / 2); colors[11] = 255;
                        colors[12] = 0; colors[13] = 0; colors[14] = 0; colors[15] = 0;
                    }

                    for (int py = 0; py < 4; py++)
                    {
                        for (int px = 0; px < 4; px++)
                        {
                            int x = bx * 4 + px;
                            int y = by * 4 + py;
                            if (x >= width || y >= height) continue;

                            int ci = (int)((lookup >> (2 * (py * 4 + px))) & 3);
                            int di = (y * width + x) * 4;
                            rgba[di] = colors[ci * 4];
                            rgba[di + 1] = colors[ci * 4 + 1];
                            rgba[di + 2] = colors[ci * 4 + 2];
                            rgba[di + 3] = colors[ci * 4 + 3];
                        }
                    }
                }
            }
            return rgba;
        }

        private static byte[] DecodeDxt3(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int blocksX = (width + 3) / 4;
            int blocksY = (height + 3) / 4;
            int offset = 0;

            for (int by = 0; by < blocksY; by++)
            {
                for (int bx = 0; bx < blocksX; bx++)
                {
                    if (offset + 16 > data.Length) return rgba;

                    // 8 bytes of alpha (4 bits per pixel)
                    var alphaBlock = data.Slice(offset, 8);
                    offset += 8;

                    ushort c0 = (ushort)(data[offset] | (data[offset + 1] << 8));
                    ushort c1 = (ushort)(data[offset + 2] | (data[offset + 3] << 8));
                    uint lookup = (uint)(data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24));
                    offset += 8;

                    Rgb565ToRgb(c0, out byte r0, out byte g0, out byte b0);
                    Rgb565ToRgb(c1, out byte r1, out byte g1, out byte b1);

                    var colors = new byte[12];
                    colors[0] = r0; colors[1] = g0; colors[2] = b0;
                    colors[3] = r1; colors[4] = g1; colors[5] = b1;
                    colors[6] = (byte)((2 * r0 + r1) / 3); colors[7] = (byte)((2 * g0 + g1) / 3); colors[8] = (byte)((2 * b0 + b1) / 3);
                    colors[9] = (byte)((r0 + 2 * r1) / 3); colors[10] = (byte)((g0 + 2 * g1) / 3); colors[11] = (byte)((b0 + 2 * b1) / 3);

                    for (int py = 0; py < 4; py++)
                    {
                        for (int px = 0; px < 4; px++)
                        {
                            int x = bx * 4 + px;
                            int y = by * 4 + py;
                            if (x >= width || y >= height) continue;

                            int ci = (int)((lookup >> (2 * (py * 4 + px))) & 3);
                            int alphaIdx = py * 4 + px;
                            int alphaByte = alphaBlock[alphaIdx / 2];
                            int alpha4 = (alphaIdx % 2 == 0) ? (alphaByte & 0xF) : ((alphaByte >> 4) & 0xF);
                            byte alpha = (byte)(alpha4 | (alpha4 << 4));

                            int di = (y * width + x) * 4;
                            rgba[di] = colors[ci * 3];
                            rgba[di + 1] = colors[ci * 3 + 1];
                            rgba[di + 2] = colors[ci * 3 + 2];
                            rgba[di + 3] = alpha;
                        }
                    }
                }
            }
            return rgba;
        }

        private static byte[] DecodeDxt5(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int blocksX = (width + 3) / 4;
            int blocksY = (height + 3) / 4;
            int offset = 0;

            for (int by = 0; by < blocksY; by++)
            {
                for (int bx = 0; bx < blocksX; bx++)
                {
                    if (offset + 16 > data.Length) return rgba;

                    // Alpha block
                    byte a0 = data[offset];
                    byte a1 = data[offset + 1];
                    ulong alphaBits = 0;
                    for (int i = 2; i < 8; i++)
                        alphaBits |= (ulong)data[offset + i] << (8 * (i - 2));
                    offset += 8;

                    var alphaTable = new byte[8];
                    alphaTable[0] = a0;
                    alphaTable[1] = a1;
                    if (a0 > a1)
                    {
                        alphaTable[2] = (byte)((6 * a0 + 1 * a1) / 7);
                        alphaTable[3] = (byte)((5 * a0 + 2 * a1) / 7);
                        alphaTable[4] = (byte)((4 * a0 + 3 * a1) / 7);
                        alphaTable[5] = (byte)((3 * a0 + 4 * a1) / 7);
                        alphaTable[6] = (byte)((2 * a0 + 5 * a1) / 7);
                        alphaTable[7] = (byte)((1 * a0 + 6 * a1) / 7);
                    }
                    else
                    {
                        alphaTable[2] = (byte)((4 * a0 + 1 * a1) / 5);
                        alphaTable[3] = (byte)((3 * a0 + 2 * a1) / 5);
                        alphaTable[4] = (byte)((2 * a0 + 3 * a1) / 5);
                        alphaTable[5] = (byte)((1 * a0 + 4 * a1) / 5);
                        alphaTable[6] = 0;
                        alphaTable[7] = 255;
                    }

                    ushort c0 = (ushort)(data[offset] | (data[offset + 1] << 8));
                    ushort c1 = (ushort)(data[offset + 2] | (data[offset + 3] << 8));
                    uint lookup = (uint)(data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24));
                    offset += 8;

                    Rgb565ToRgb(c0, out byte r0, out byte g0, out byte b0);
                    Rgb565ToRgb(c1, out byte r1, out byte g1, out byte b1);

                    var colors = new byte[12];
                    colors[0] = r0; colors[1] = g0; colors[2] = b0;
                    colors[3] = r1; colors[4] = g1; colors[5] = b1;
                    colors[6] = (byte)((2 * r0 + r1) / 3); colors[7] = (byte)((2 * g0 + g1) / 3); colors[8] = (byte)((2 * b0 + b1) / 3);
                    colors[9] = (byte)((r0 + 2 * r1) / 3); colors[10] = (byte)((g0 + 2 * g1) / 3); colors[11] = (byte)((b0 + 2 * b1) / 3);

                    for (int py = 0; py < 4; py++)
                    {
                        for (int px = 0; px < 4; px++)
                        {
                            int x = bx * 4 + px;
                            int y = by * 4 + py;
                            if (x >= width || y >= height) continue;

                            int ci = (int)((lookup >> (2 * (py * 4 + px))) & 3);
                            int alphaIdx = py * 4 + px;
                            byte alpha = alphaTable[(alphaBits >> (3 * alphaIdx)) & 7];

                            int di = (y * width + x) * 4;
                            rgba[di] = colors[ci * 3];
                            rgba[di + 1] = colors[ci * 3 + 1];
                            rgba[di + 2] = colors[ci * 3 + 2];
                            rgba[di + 3] = alpha;
                        }
                    }
                }
            }
            return rgba;
        }

        private static void Rgb565ToRgb(ushort c, out byte r, out byte g, out byte b)
        {
            r = (byte)(((c >> 11) & 0x1F) * 255 / 31);
            g = (byte)(((c >> 5) & 0x3F) * 255 / 63);
            b = (byte)((c & 0x1F) * 255 / 31);
        }

        private static byte[] DecodeBgra(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int count = Math.Min(width * height, data.Length / 4);
            for (int i = 0; i < count; i++)
            {
                rgba[i * 4] = data[i * 4 + 2];     // R <- B position in BGRA
                rgba[i * 4 + 1] = data[i * 4 + 1]; // G
                rgba[i * 4 + 2] = data[i * 4];      // B <- R position in BGRA
                rgba[i * 4 + 3] = data[i * 4 + 3]; // A
            }
            return rgba;
        }

        private static byte[] DecodeBgr(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            // R8G8B8 is stored as BGRA (4 bytes) per the OpenGL binder
            int count = Math.Min(width * height, data.Length / 4);
            for (int i = 0; i < count; i++)
            {
                rgba[i * 4] = data[i * 4 + 2];
                rgba[i * 4 + 1] = data[i * 4 + 1];
                rgba[i * 4 + 2] = data[i * 4];
                rgba[i * 4 + 3] = 255;
            }
            return rgba;
        }

        private static byte[] DecodeL8(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int count = Math.Min(width * height, data.Length);
            for (int i = 0; i < count; i++)
            {
                rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i];
                rgba[i * 4 + 3] = 255;
            }
            return rgba;
        }

        private static byte[] DecodeA8L8(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int count = Math.Min(width * height, data.Length / 2);
            for (int i = 0; i < count; i++)
            {
                byte l = data[i * 2];
                byte a = data[i * 2 + 1];
                rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = l;
                rgba[i * 4 + 3] = a;
            }
            return rgba;
        }

        private static byte[] DecodeR5G6B5(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int count = Math.Min(width * height, data.Length / 2);
            for (int i = 0; i < count; i++)
            {
                ushort c = (ushort)(data[i * 2] | (data[i * 2 + 1] << 8));
                Rgb565ToRgb(c, out byte r, out byte g, out byte b);
                rgba[i * 4] = r;
                rgba[i * 4 + 1] = g;
                rgba[i * 4 + 2] = b;
                rgba[i * 4 + 3] = 255;
            }
            return rgba;
        }

        private static byte[] DecodeA4R4G4B4(ReadOnlySpan<byte> data, int width, int height)
        {
            var rgba = new byte[width * height * 4];
            int count = Math.Min(width * height, data.Length / 2);
            for (int i = 0; i < count; i++)
            {
                ushort c = (ushort)(data[i * 2] | (data[i * 2 + 1] << 8));
                byte a = (byte)(((c >> 12) & 0xF) * 17);
                byte r = (byte)(((c >> 8) & 0xF) * 17);
                byte g = (byte)(((c >> 4) & 0xF) * 17);
                byte b = (byte)((c & 0xF) * 17);
                rgba[i * 4] = r;
                rgba[i * 4 + 1] = g;
                rgba[i * 4 + 2] = b;
                rgba[i * 4 + 3] = a;
            }
            return rgba;
        }

        // ===== Minimal PNG Encoder =====

        private static byte[] EncodePng(byte[] rgba, int width, int height)
        {
            using var ms = new MemoryStream();
            // PNG signature
            ms.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, 0, 8);

            // IHDR
            WriteChunk(ms, "IHDR", writer =>
            {
                WriteBigEndian(writer, width);
                WriteBigEndian(writer, height);
                writer.Write((byte)8);  // bit depth
                writer.Write((byte)6);  // RGBA
                writer.Write((byte)0);  // compression
                writer.Write((byte)0);  // filter
                writer.Write((byte)0);  // interlace
            });

            // IDAT - filtered rows then deflate
            using var rawStream = new MemoryStream();
            for (int y = 0; y < height; y++)
            {
                rawStream.WriteByte(0); // filter: None
                rawStream.Write(rgba, y * width * 4, width * 4);
            }
            var rawBytes = rawStream.ToArray();

            using var compressedStream = new MemoryStream();
            // zlib header
            compressedStream.WriteByte(0x78);
            compressedStream.WriteByte(0x01);
            using (var deflate = new DeflateStream(compressedStream, CompressionLevel.Optimal, true))
            {
                deflate.Write(rawBytes, 0, rawBytes.Length);
            }
            // Adler32 checksum
            uint adler = Adler32(rawBytes);
            compressedStream.WriteByte((byte)(adler >> 24));
            compressedStream.WriteByte((byte)(adler >> 16));
            compressedStream.WriteByte((byte)(adler >> 8));
            compressedStream.WriteByte((byte)adler);

            WriteChunk(ms, "IDAT", writer => writer.Write(compressedStream.ToArray()));

            // IEND
            WriteChunk(ms, "IEND", writer => { });

            return ms.ToArray();
        }

        private static void WriteChunk(Stream stream, string type, Action<BinaryWriter> writeData)
        {
            using var dataStream = new MemoryStream();
            using var dataWriter = new BinaryWriter(dataStream);
            writeData(dataWriter);
            dataWriter.Flush();
            var data = dataStream.ToArray();

            var typeBytes = Encoding.ASCII.GetBytes(type);

            using var writer = new BinaryWriter(stream, Encoding.UTF8, true);
            WriteBigEndian(writer, data.Length);
            writer.Write(typeBytes);
            writer.Write(data);

            // CRC32 of type + data
            var crcBuf = new byte[typeBytes.Length + data.Length];
            Array.Copy(typeBytes, 0, crcBuf, 0, typeBytes.Length);
            Array.Copy(data, 0, crcBuf, typeBytes.Length, data.Length);
            WriteBigEndian(writer, (int)Crc32(crcBuf));
        }

        private static void WriteBigEndian(BinaryWriter writer, int value)
        {
            writer.Write((byte)(value >> 24));
            writer.Write((byte)(value >> 16));
            writer.Write((byte)(value >> 8));
            writer.Write((byte)value);
        }

        private static uint Adler32(byte[] data)
        {
            uint a = 1, b = 0;
            for (int i = 0; i < data.Length; i++)
            {
                a = (a + data[i]) % 65521;
                b = (b + a) % 65521;
            }
            return (b << 16) | a;
        }

        private static readonly uint[] Crc32Table = BuildCrc32Table();
        private static uint[] BuildCrc32Table()
        {
            var table = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint crc = i;
                for (int j = 0; j < 8; j++)
                    crc = (crc & 1) != 0 ? (0xEDB88320 ^ (crc >> 1)) : (crc >> 1);
                table[i] = crc;
            }
            return table;
        }

        private static uint Crc32(byte[] data)
        {
            uint crc = 0xFFFFFFFF;
            foreach (var b in data)
                crc = Crc32Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
            return crc ^ 0xFFFFFFFF;
        }

        // ===== Triangle Strip Conversion =====

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

        // ===== Internal Types =====

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
            public int TextureIndex = -1;
        }

        private class GlbTexture
        {
            public string Name;
            public byte[] PngData;
            public int Width, Height;
        }
    }
}
