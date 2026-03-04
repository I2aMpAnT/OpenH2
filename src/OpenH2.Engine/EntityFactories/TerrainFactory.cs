using OpenH2.Core.Architecture;
using OpenH2.Core.Maps.Vista;
using OpenH2.Core.Tags;
using OpenH2.Core.Tags.Common.Models;
using OpenH2.Engine.Components;
using OpenH2.Engine.Entities;
using OpenH2.Engine.Factories;
using OpenH2.Foundation;
using System;
using System.Collections.Generic;
using System.Numerics;

namespace OpenH2.Engine.EntityFactories
{
    public static class TerrainFactory
    {
        public static Terrain FromBspData(H2vMap map, BspTag tag, BitmapTag lightmapBitmap = null)
        {
            var terrain = new Terrain();
            terrain.FriendlyName = tag.Name;

            var meshes = new List<ModelMesh>();

            // Log per-cluster info
            for (var ci = 0; ci < tag.Clusters.Length; ci++)
            {
                var chunk = tag.Clusters[ci];
                var mc = chunk.Model?.Meshes?.Length ?? 0;
                if (mc == 0 || chunk.CompressionFlags != 0)
                {
                    Console.WriteLine($"[TerrainDiag] Cluster[{ci}]: verts={chunk.VertexCount}, meshes={mc}, " +
                        $"compression={chunk.CompressionFlags}, offset=0x{chunk.DataBlockRawOffset:X}");
                }
                meshes.AddRange(chunk.Model.Meshes);
            }

            var renderModelMeshes = new List<Mesh<BitmapTag>>(meshes.Count);
            var alphaCount = 0;

            foreach (var mesh in meshes)
            {
                var mat = map.CreateMaterial(mesh);

                // BSP terrain is always opaque world geometry. Force alpha=1 on
                // DiffuseColor and remove alpha maps so the fragment shader's
                // alpha discard (< 0.1) never kills terrain fragments.
                mat = mat with
                {
                    DiffuseColor = new Vector4(mat.DiffuseColor.X, mat.DiffuseColor.Y, mat.DiffuseColor.Z, 1f),
                    AlphaMap = null
                };

                // Set lightmap bitmap on terrain materials
                if (lightmapBitmap != null)
                {
                    mat = mat with { LightmapBitmap = lightmapBitmap };
                }

                var renderMesh = new Mesh<BitmapTag>()
                {
                    Compressed = mesh.Compressed,
                    ElementType = mesh.ElementType,
                    Indicies = mesh.Indices,
                    Note = mesh.Note,
                    RawData = mesh.RawData,
                    Verticies = mesh.Verticies,

                    Material = mat
                };

                // Always render BSP terrain in the opaque pass.
                // Alpha blending is always enabled in the pipeline, so alpha-test
                // surfaces still blend correctly (alpha=0 pixels become transparent).
                // Routing BSP surfaces to the transparent pass caused rendering issues.
                renderModelMeshes.Add(renderMesh);
                if (mat.AlphaMap != null) alphaCount++;
            }

            Console.WriteLine($"[TerrainDiag] {tag.Name}: {meshes.Count} total meshes -> " +
                $"{renderModelMeshes.Count} opaque ({alphaCount} with alpha maps, kept in opaque pass)");

            var components = new List<Component>();

            components.Add(new RenderModelComponent(terrain, new Model<BitmapTag>
            {
                Meshes = renderModelMeshes.ToArray(),
                Flags = ModelFlags.Diffuse | ModelFlags.ReceivesShadows | ModelFlags.IsStatic
            }));

            var collisionTerrain = PhysicsComponentFactory.CreateTerrain(terrain, tag.CollisionInfos, tag.PhysicsMaterials);
            components.Add(collisionTerrain);

            components.Add(new RenderModelComponent(terrain, new Model<BitmapTag>
            {
                Meshes = MeshFactory.GetRenderModel(collisionTerrain.Collider),
                Flags = ModelFlags.Wireframe | ModelFlags.IsStatic,
                RenderLayer = RenderLayers.Collision
            }));

            components.Add(new TransformComponent(terrain, Vector3.Zero));

            terrain.SetComponents(components);

            return terrain;
        }
    }
}
