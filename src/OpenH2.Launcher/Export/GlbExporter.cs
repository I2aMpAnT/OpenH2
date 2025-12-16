using OpenH2.Core.Enums.Texture;
using OpenH2.Core.Factories;
using OpenH2.Core.Maps;
using OpenH2.Core.Tags;
using OpenH2.Foundation;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace OpenH2.Launcher.Export
{
    /// <summary>
    /// Exports Halo 2 map geometry to GLB (binary glTF 2.0) format with textures.
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
        private const int UNSIGNED_BYTE = 5121;
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

            Console.WriteLine($"[GlbExporter] Extracting geometry and textures...");

            var exportData = ExtractGeometryWithMaterials(playableMap);

            if (exportData.Primitives.Count == 0)
            {
                Console.WriteLine($"[GlbExporter] No geometry found in map");
                return;
            }

            Console.WriteLine($"[GlbExporter] Found {exportData.Primitives.Count} primitives, {exportData.Textures.Count} unique textures");
            Console.WriteLine($"[GlbExporter] Building GLB...");

            BuildGlbWithTextures(exportData, outputPath);

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

        private static GlbExportData ExtractGeometryWithMaterials(IH2PlayableMap map)
        {
            var exportData = new GlbExportData();
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
                        var primitive = ConvertMeshWithMaterial(map, modelMesh, exportData);
                        if (primitive != null)
                        {
                            exportData.Primitives.Add(primitive);
                        }
                    }
                }

                // Extract instanced geometry
                foreach (var instanceDef in bsp.InstancedGeometryDefinitions)
                {
                    if (instanceDef.Model?.Meshes == null) continue;

                    foreach (var modelMesh in instanceDef.Model.Meshes)
                    {
                        var primitive = ConvertMeshWithMaterial(map, modelMesh, exportData);
                        if (primitive != null)
                        {
                            exportData.Primitives.Add(primitive);
                        }
                    }
                }
            }

            return exportData;
        }

        private static GlbPrimitive? ConvertMeshWithMaterial(IH2PlayableMap map, OpenH2.Core.Tags.Common.Models.ModelMesh modelMesh, GlbExportData exportData)
        {
            if (modelMesh.Verticies == null || modelMesh.Verticies.Length == 0)
                return null;
            if (modelMesh.Indices == null || modelMesh.Indices.Length == 0)
                return null;

            var primitive = new GlbPrimitive();

            // Try to get texture for this mesh
            primitive.MaterialIndex = GetOrCreateMaterial(map, modelMesh, exportData);

            // Rotation matrix: Halo Z-up to glTF Y-up
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

        private static int GetOrCreateMaterial(IH2PlayableMap map, OpenH2.Core.Tags.Common.Models.ModelMesh modelMesh, GlbExportData exportData)
        {
            // Try to get shader and diffuse texture
            if (modelMesh.Shader.IsInvalid)
                return 0; // Default material

            try
            {
                if (!map.TryGetTag(modelMesh.Shader, out var shader) || shader == null)
                    return 0;

                // Try to get diffuse bitmap from shader
                BitmapTag? diffuseBitmap = null;

                // First try legacy bitmap info
                if (shader.BitmapInfos != null && shader.BitmapInfos.Length > 0)
                {
                    var bitmapInfo = shader.BitmapInfos[0];
                    if (!bitmapInfo.DiffuseBitmap.IsInvalid)
                    {
                        map.TryGetTag(bitmapInfo.DiffuseBitmap, out diffuseBitmap);
                    }
                }

                // If no legacy info, try shader arguments
                if (diffuseBitmap == null && shader.Arguments != null && shader.Arguments.Length > 0)
                {
                    var args = shader.Arguments[0];
                    if (args.BitmapArguments != null && args.BitmapArguments.Length > 0)
                    {
                        // Usually index 0 is diffuse
                        for (int i = 0; i < Math.Min(3, args.BitmapArguments.Length); i++)
                        {
                            var bitmapArg = args.BitmapArguments[i];
                            if (!bitmapArg.Bitmap.IsInvalid && map.TryGetTag(bitmapArg.Bitmap, out var testBitmap))
                            {
                                // Use the first valid texture (usually diffuse)
                                if (testBitmap?.TextureUsage == TextureUsage.Diffuse || diffuseBitmap == null)
                                {
                                    diffuseBitmap = testBitmap;
                                    if (testBitmap?.TextureUsage == TextureUsage.Diffuse)
                                        break;
                                }
                            }
                        }
                    }
                }

                if (diffuseBitmap == null)
                    return 0;

                // Check if we already have this texture
                var textureId = diffuseBitmap.Id;
                if (exportData.TextureToMaterial.TryGetValue(textureId, out var existingMaterial))
                    return existingMaterial;

                // Create new texture and material
                var textureData = ExtractTexture(diffuseBitmap);
                if (textureData == null)
                    return 0;

                var textureIndex = exportData.Textures.Count;
                exportData.Textures.Add(textureData);

                var materialIndex = exportData.Materials.Count;
                exportData.Materials.Add(new GlbMaterial
                {
                    TextureIndex = textureIndex,
                    Name = Path.GetFileNameWithoutExtension(diffuseBitmap.Name ?? $"texture_{textureIndex}")
                });

                exportData.TextureToMaterial[textureId] = materialIndex;
                return materialIndex;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GlbExporter] Failed to extract material: {ex.Message}");
                return 0;
            }
        }

        private static byte[]? ExtractTexture(BitmapTag bitmap)
        {
            try
            {
                if (bitmap.TextureInfos == null || bitmap.TextureInfos.Length == 0)
                    return null;

                var textureInfo = bitmap.TextureInfos[0];
                if (textureInfo.LevelsOfDetail == null || textureInfo.LevelsOfDetail.Length == 0)
                    return null;

                var lod = textureInfo.LevelsOfDetail[0];
                if (lod.Data.IsEmpty)
                    return null;

                var width = textureInfo.Width;
                var height = textureInfo.Height;
                var format = bitmap.TextureFormat;
                var pixelFormat = textureInfo.Format;

                // Decode to RGBA
                var rgba = DecodeDxt(lod.Data.Span, width, height, format, pixelFormat);
                if (rgba == null)
                    return null;

                // Convert to PNG
                return EncodeToPng(rgba, width, height);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GlbExporter] Failed to extract texture: {ex.Message}");
                return null;
            }
        }

        private static byte[]? DecodeDxt(ReadOnlySpan<byte> data, int width, int height, TextureCompressionFormat format, TextureFormat pixelFormat)
        {
            var rgba = new byte[width * height * 4];

            try
            {
                switch (format)
                {
                    case TextureCompressionFormat.DXT1:
                        DecodeDxt1(data, rgba, width, height);
                        break;
                    case TextureCompressionFormat.DXT23:
                        DecodeDxt3(data, rgba, width, height);
                        break;
                    case TextureCompressionFormat.DXT45:
                        DecodeDxt5(data, rgba, width, height);
                        break;
                    case TextureCompressionFormat.ThirtyTwoBit:
                        DecodeA8R8G8B8(data, rgba, width, height);
                        break;
                    case TextureCompressionFormat.SixteenBit:
                        Decode16Bit(data, rgba, width, height, pixelFormat);
                        break;
                    default:
                        // Unsupported format - return gray
                        for (int i = 0; i < rgba.Length; i += 4)
                        {
                            rgba[i] = 128;
                            rgba[i + 1] = 128;
                            rgba[i + 2] = 128;
                            rgba[i + 3] = 255;
                        }
                        break;
                }
            }
            catch
            {
                return null;
            }

            return rgba;
        }

        private static void DecodeDxt1(ReadOnlySpan<byte> data, byte[] output, int width, int height)
        {
            int blockCountX = (width + 3) / 4;
            int blockCountY = (height + 3) / 4;
            int blockIndex = 0;

            for (int by = 0; by < blockCountY; by++)
            {
                for (int bx = 0; bx < blockCountX; bx++)
                {
                    if (blockIndex * 8 + 8 > data.Length) return;

                    var block = data.Slice(blockIndex * 8, 8);
                    ushort c0 = (ushort)(block[0] | (block[1] << 8));
                    ushort c1 = (ushort)(block[2] | (block[3] << 8));

                    var colors = new byte[4][];
                    colors[0] = Rgb565ToRgba(c0);
                    colors[1] = Rgb565ToRgba(c1);

                    if (c0 > c1)
                    {
                        colors[2] = new byte[] {
                            (byte)((2 * colors[0][0] + colors[1][0]) / 3),
                            (byte)((2 * colors[0][1] + colors[1][1]) / 3),
                            (byte)((2 * colors[0][2] + colors[1][2]) / 3),
                            255
                        };
                        colors[3] = new byte[] {
                            (byte)((colors[0][0] + 2 * colors[1][0]) / 3),
                            (byte)((colors[0][1] + 2 * colors[1][1]) / 3),
                            (byte)((colors[0][2] + 2 * colors[1][2]) / 3),
                            255
                        };
                    }
                    else
                    {
                        colors[2] = new byte[] {
                            (byte)((colors[0][0] + colors[1][0]) / 2),
                            (byte)((colors[0][1] + colors[1][1]) / 2),
                            (byte)((colors[0][2] + colors[1][2]) / 2),
                            255
                        };
                        colors[3] = new byte[] { 0, 0, 0, 0 }; // Transparent
                    }

                    uint indices = (uint)(block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24));

                    for (int py = 0; py < 4; py++)
                    {
                        for (int px = 0; px < 4; px++)
                        {
                            int x = bx * 4 + px;
                            int y = by * 4 + py;
                            if (x >= width || y >= height) continue;

                            int colorIndex = (int)((indices >> ((py * 4 + px) * 2)) & 0x3);
                            int outputIndex = (y * width + x) * 4;

                            output[outputIndex] = colors[colorIndex][0];
                            output[outputIndex + 1] = colors[colorIndex][1];
                            output[outputIndex + 2] = colors[colorIndex][2];
                            output[outputIndex + 3] = colors[colorIndex][3];
                        }
                    }

                    blockIndex++;
                }
            }
        }

        private static void DecodeDxt3(ReadOnlySpan<byte> data, byte[] output, int width, int height)
        {
            int blockCountX = (width + 3) / 4;
            int blockCountY = (height + 3) / 4;
            int blockIndex = 0;

            for (int by = 0; by < blockCountY; by++)
            {
                for (int bx = 0; bx < blockCountX; bx++)
                {
                    if (blockIndex * 16 + 16 > data.Length) return;

                    var block = data.Slice(blockIndex * 16, 16);

                    // Alpha block (8 bytes)
                    var alphaBlock = block.Slice(0, 8);

                    // Color block (8 bytes) - same as DXT1
                    var colorBlock = block.Slice(8, 8);
                    ushort c0 = (ushort)(colorBlock[0] | (colorBlock[1] << 8));
                    ushort c1 = (ushort)(colorBlock[2] | (colorBlock[3] << 8));

                    var colors = new byte[4][];
                    colors[0] = Rgb565ToRgba(c0);
                    colors[1] = Rgb565ToRgba(c1);
                    colors[2] = new byte[] {
                        (byte)((2 * colors[0][0] + colors[1][0]) / 3),
                        (byte)((2 * colors[0][1] + colors[1][1]) / 3),
                        (byte)((2 * colors[0][2] + colors[1][2]) / 3),
                        255
                    };
                    colors[3] = new byte[] {
                        (byte)((colors[0][0] + 2 * colors[1][0]) / 3),
                        (byte)((colors[0][1] + 2 * colors[1][1]) / 3),
                        (byte)((colors[0][2] + 2 * colors[1][2]) / 3),
                        255
                    };

                    uint indices = (uint)(colorBlock[4] | (colorBlock[5] << 8) | (colorBlock[6] << 16) | (colorBlock[7] << 24));

                    for (int py = 0; py < 4; py++)
                    {
                        for (int px = 0; px < 4; px++)
                        {
                            int x = bx * 4 + px;
                            int y = by * 4 + py;
                            if (x >= width || y >= height) continue;

                            int colorIndex = (int)((indices >> ((py * 4 + px) * 2)) & 0x3);
                            int outputIndex = (y * width + x) * 4;

                            // Get alpha (4 bits per pixel)
                            int alphaByteIndex = py * 2 + px / 2;
                            int alphaNibble = (px % 2 == 0) ? (alphaBlock[alphaByteIndex] & 0x0F) : ((alphaBlock[alphaByteIndex] >> 4) & 0x0F);
                            byte alpha = (byte)(alphaNibble * 17); // Scale 0-15 to 0-255

                            output[outputIndex] = colors[colorIndex][0];
                            output[outputIndex + 1] = colors[colorIndex][1];
                            output[outputIndex + 2] = colors[colorIndex][2];
                            output[outputIndex + 3] = alpha;
                        }
                    }

                    blockIndex++;
                }
            }
        }

        private static void DecodeDxt5(ReadOnlySpan<byte> data, byte[] output, int width, int height)
        {
            int blockCountX = (width + 3) / 4;
            int blockCountY = (height + 3) / 4;
            int blockIndex = 0;

            for (int by = 0; by < blockCountY; by++)
            {
                for (int bx = 0; bx < blockCountX; bx++)
                {
                    if (blockIndex * 16 + 16 > data.Length) return;

                    var block = data.Slice(blockIndex * 16, 16);

                    // Alpha block (8 bytes)
                    byte a0 = block[0];
                    byte a1 = block[1];
                    var alphas = new byte[8];
                    alphas[0] = a0;
                    alphas[1] = a1;

                    if (a0 > a1)
                    {
                        alphas[2] = (byte)((6 * a0 + 1 * a1) / 7);
                        alphas[3] = (byte)((5 * a0 + 2 * a1) / 7);
                        alphas[4] = (byte)((4 * a0 + 3 * a1) / 7);
                        alphas[5] = (byte)((3 * a0 + 4 * a1) / 7);
                        alphas[6] = (byte)((2 * a0 + 5 * a1) / 7);
                        alphas[7] = (byte)((1 * a0 + 6 * a1) / 7);
                    }
                    else
                    {
                        alphas[2] = (byte)((4 * a0 + 1 * a1) / 5);
                        alphas[3] = (byte)((3 * a0 + 2 * a1) / 5);
                        alphas[4] = (byte)((2 * a0 + 3 * a1) / 5);
                        alphas[5] = (byte)((1 * a0 + 4 * a1) / 5);
                        alphas[6] = 0;
                        alphas[7] = 255;
                    }

                    ulong alphaIndices = (ulong)block[2] | ((ulong)block[3] << 8) | ((ulong)block[4] << 16) |
                                         ((ulong)block[5] << 24) | ((ulong)block[6] << 32) | ((ulong)block[7] << 40);

                    // Color block (8 bytes) - same as DXT1
                    var colorBlock = block.Slice(8, 8);
                    ushort c0 = (ushort)(colorBlock[0] | (colorBlock[1] << 8));
                    ushort c1 = (ushort)(colorBlock[2] | (colorBlock[3] << 8));

                    var colors = new byte[4][];
                    colors[0] = Rgb565ToRgba(c0);
                    colors[1] = Rgb565ToRgba(c1);
                    colors[2] = new byte[] {
                        (byte)((2 * colors[0][0] + colors[1][0]) / 3),
                        (byte)((2 * colors[0][1] + colors[1][1]) / 3),
                        (byte)((2 * colors[0][2] + colors[1][2]) / 3),
                        255
                    };
                    colors[3] = new byte[] {
                        (byte)((colors[0][0] + 2 * colors[1][0]) / 3),
                        (byte)((colors[0][1] + 2 * colors[1][1]) / 3),
                        (byte)((colors[0][2] + 2 * colors[1][2]) / 3),
                        255
                    };

                    uint colorIndices = (uint)(colorBlock[4] | (colorBlock[5] << 8) | (colorBlock[6] << 16) | (colorBlock[7] << 24));

                    for (int py = 0; py < 4; py++)
                    {
                        for (int px = 0; px < 4; px++)
                        {
                            int x = bx * 4 + px;
                            int y = by * 4 + py;
                            if (x >= width || y >= height) continue;

                            int colorIndex = (int)((colorIndices >> ((py * 4 + px) * 2)) & 0x3);
                            int alphaIndex = (int)((alphaIndices >> ((py * 4 + px) * 3)) & 0x7);
                            int outputIndex = (y * width + x) * 4;

                            output[outputIndex] = colors[colorIndex][0];
                            output[outputIndex + 1] = colors[colorIndex][1];
                            output[outputIndex + 2] = colors[colorIndex][2];
                            output[outputIndex + 3] = alphas[alphaIndex];
                        }
                    }

                    blockIndex++;
                }
            }
        }

        private static void DecodeA8R8G8B8(ReadOnlySpan<byte> data, byte[] output, int width, int height)
        {
            int pixelCount = Math.Min(width * height, data.Length / 4);
            for (int i = 0; i < pixelCount; i++)
            {
                // ARGB -> RGBA
                output[i * 4] = data[i * 4 + 2];     // R
                output[i * 4 + 1] = data[i * 4 + 1]; // G
                output[i * 4 + 2] = data[i * 4];     // B
                output[i * 4 + 3] = data[i * 4 + 3]; // A
            }
        }

        private static void Decode16Bit(ReadOnlySpan<byte> data, byte[] output, int width, int height, TextureFormat pixelFormat)
        {
            int pixelCount = Math.Min(width * height, data.Length / 2);
            for (int i = 0; i < pixelCount; i++)
            {
                ushort pixel = (ushort)(data[i * 2] | (data[i * 2 + 1] << 8));
                var rgba = Rgb565ToRgba(pixel);
                output[i * 4] = rgba[0];
                output[i * 4 + 1] = rgba[1];
                output[i * 4 + 2] = rgba[2];
                output[i * 4 + 3] = rgba[3];
            }
        }

        private static byte[] Rgb565ToRgba(ushort color)
        {
            int r = (color >> 11) & 0x1F;
            int g = (color >> 5) & 0x3F;
            int b = color & 0x1F;
            return new byte[]
            {
                (byte)((r << 3) | (r >> 2)),
                (byte)((g << 2) | (g >> 4)),
                (byte)((b << 3) | (b >> 2)),
                255
            };
        }

        private static byte[]? EncodeToPng(byte[] rgba, int width, int height)
        {
            try
            {
                using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
                var bitmapData = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);

                try
                {
                    // Convert RGBA to BGRA for System.Drawing
                    var bgra = new byte[rgba.Length];
                    for (int i = 0; i < rgba.Length; i += 4)
                    {
                        bgra[i] = rgba[i + 2];     // B
                        bgra[i + 1] = rgba[i + 1]; // G
                        bgra[i + 2] = rgba[i];     // R
                        bgra[i + 3] = rgba[i + 3]; // A
                    }

                    Marshal.Copy(bgra, 0, bitmapData.Scan0, bgra.Length);
                }
                finally
                {
                    bitmap.UnlockBits(bitmapData);
                }

                using var ms = new MemoryStream();
                bitmap.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GlbExporter] PNG encoding failed: {ex.Message}");
                return null;
            }
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
                        output.Add((uint)i0);
                        output.Add((uint)i1);
                        output.Add((uint)i2);
                    }
                    else
                    {
                        output.Add((uint)i0);
                        output.Add((uint)i2);
                        output.Add((uint)i1);
                    }
                }

                flip = !flip;
            }
        }

        private static void BuildGlbWithTextures(GlbExportData exportData, string outputPath)
        {
            using var binStream = new MemoryStream();
            using var binWriter = new BinaryWriter(binStream);

            var bufferViews = new List<object>();
            var accessors = new List<object>();
            var meshPrimitives = new List<object>();
            var images = new List<object>();
            var textures = new List<object>();
            var materials = new List<object>();
            var samplers = new List<object>();

            // Add default sampler
            samplers.Add(new
            {
                magFilter = 9729, // LINEAR
                minFilter = 9987, // LINEAR_MIPMAP_LINEAR
                wrapS = 10497,    // REPEAT
                wrapT = 10497     // REPEAT
            });

            // Write texture images first
            foreach (var textureData in exportData.Textures)
            {
                var imageOffset = (int)binStream.Position;
                binWriter.Write(textureData);
                PadTo4Bytes(binWriter, binStream);
                var imageLength = (int)binStream.Position - imageOffset;

                var bufferViewIndex = bufferViews.Count;
                bufferViews.Add(new { buffer = 0, byteOffset = imageOffset, byteLength = imageLength });

                images.Add(new { bufferView = bufferViewIndex, mimeType = "image/png" });
                textures.Add(new { source = images.Count - 1, sampler = 0 });
            }

            // Create materials
            // Always add default material first
            materials.Add(new
            {
                pbrMetallicRoughness = new
                {
                    baseColorFactor = new[] { 0.8f, 0.8f, 0.8f, 1.0f },
                    metallicFactor = 0.0f,
                    roughnessFactor = 1.0f
                },
                doubleSided = true
            });

            // Add materials with textures
            foreach (var mat in exportData.Materials)
            {
                materials.Add(new
                {
                    pbrMetallicRoughness = new
                    {
                        baseColorTexture = new { index = mat.TextureIndex },
                        metallicFactor = 0.0f,
                        roughnessFactor = 1.0f
                    },
                    doubleSided = true
                });
            }

            int accessorIndex = 0;

            // Write geometry
            foreach (var primitive in exportData.Primitives)
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

                // Material index: 0 is default, materials with textures start at 1
                var materialIndex = primitive.MaterialIndex == 0 ? 0 : primitive.MaterialIndex + 1;

                meshPrimitives.Add(new
                {
                    attributes = new Dictionary<string, int>
                    {
                        ["POSITION"] = positionAccessor,
                        ["TEXCOORD_0"] = uvAccessor,
                        ["NORMAL"] = normalAccessor
                    },
                    indices = indexAccessor,
                    material = materialIndex
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
                ["materials"] = materials,
                ["bufferViews"] = bufferViews,
                ["accessors"] = accessors,
                ["buffers"] = new[] { new { byteLength = binaryData.Length } }
            };

            if (samplers.Count > 0)
                gltf["samplers"] = samplers;
            if (images.Count > 0)
                gltf["images"] = images;
            if (textures.Count > 0)
                gltf["textures"] = textures;

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

    internal class GlbExportData
    {
        public List<GlbPrimitive> Primitives { get; } = new();
        public List<byte[]> Textures { get; } = new();
        public List<GlbMaterial> Materials { get; } = new();
        public Dictionary<uint, int> TextureToMaterial { get; } = new();
    }

    internal class GlbMaterial
    {
        public int TextureIndex { get; set; }
        public string Name { get; set; } = "";
    }

    internal class GlbPrimitive
    {
        public List<float> Positions { get; } = new();
        public List<float> UVs { get; } = new();
        public List<float> Normals { get; } = new();
        public List<uint> Indices { get; } = new();
        public int MaterialIndex { get; set; }

        public float MinX { get; set; } = float.MaxValue;
        public float MaxX { get; set; } = float.MinValue;
        public float MinY { get; set; } = float.MaxValue;
        public float MaxY { get; set; } = float.MinValue;
        public float MinZ { get; set; } = float.MaxValue;
        public float MaxZ { get; set; } = float.MinValue;
    }
}
