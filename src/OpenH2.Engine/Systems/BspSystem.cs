using System;
using System.Collections;
using System.Collections.Generic;
using OpenH2.Core.Architecture;
using OpenH2.Core.Tags;
using OpenH2.Engine.Stores;
using OpenH2.Foundation.Logging;
using Silk.NET.Input;

namespace OpenH2.Engine.Systems
{
    public class BspSystem : WorldSystem
    {
        private InputStore inputStore;

        private Dictionary<int, List<Entity>> bspEntities = new();

        private BitArray loadedBsps = new BitArray(0);
        private BitArray bspsToLoad = new BitArray(0);
        private BitArray bspsToUnload = new BitArray(0);


        public BspSystem(World world) : base(world)
        {
        }

        public void SwitchBsp(int desiredIndex, bool toggle)
        {
            if(desiredIndex >= loadedBsps.Length)
            {
                Logger.Log($"BSP[{desiredIndex}] does not exist", Logger.Color.Red);
                return;
            }

            if(toggle)
            {
                if (this.loadedBsps[desiredIndex])
                {
                    this.bspsToUnload[desiredIndex] = true;
                }
                else
                {
                    this.bspsToLoad[desiredIndex] = true;
                }
            }
            else
            {
                for (int i = 0; i < loadedBsps.Length; i++)
                {
                    if (i == desiredIndex) 
                        continue;

                    if(loadedBsps[i]) 
                        bspsToUnload[i] = true;
                }

                if (this.loadedBsps[desiredIndex] == false)
                {
                    bspsToLoad[desiredIndex] = true;
                }
            }
        }

        public override void Initialize(Scene scene)
        {
            bspEntities.Clear();
            this.inputStore = this.world.GetGlobalResource<InputStore>();

            var terrains = scene.Scenario.Terrains;

            this.loadedBsps = new BitArray(terrains.Length);
            this.bspsToLoad = new BitArray(terrains.Length);
            this.bspsToUnload = new BitArray(terrains.Length);

            for (int i = 0; i < terrains.Length; i++)
            {
                var terrain = terrains[i];
                var entities = new List<Entity>();

                var bsp = scene.Map.GetTag(terrain.Bsp);

                // Try to load lightmap bitmap from the ltmp tag
                BitmapTag lightmapBitmap = null;
                if (terrain.LightmapId.IsInvalid == false)
                {
                    try
                    {
                        if (scene.Map.TryGetTag<LightmapTag>(terrain.LightmapId.Id, out var ltmpTag))
                        {
                            var groupCount = ltmpTag.Groups?.Length ?? 0;
                            Logger.Log($"BSP[{i}] ltmp tag found, {groupCount} groups, tag offset={ltmpTag.Offset}, tag length={ltmpTag.Length}", Logger.Color.White);

                            // Dump first 32 bytes of ltmp tag data to debug structure
                            try
                            {
                                var tagEntry = ltmpTag.TagIndexEntry;
                                var readLen = Math.Min(32, tagEntry.DataSize);
                                var rawData = scene.Map.ReadData(ltmpTag.DataFile, tagEntry.Offset, readLen);
                                var hexDump = BitConverter.ToString(rawData.ToArray()).Replace("-", " ");
                                Logger.Log($"BSP[{i}] ltmp raw[0..{readLen}] @offset={tagEntry.Offset.Value}: {hexDump}", Logger.Color.Cyan);

                                // Parse first 8 bytes as two uint32s (count + offset for the reflexive)
                                var span = rawData.Span;
                                if (span.Length >= 8)
                                {
                                    var count = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(span);
                                    var ptr = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(4));
                                    Logger.Log($"BSP[{i}] ltmp reflexive at 0: count={count}, ptr=0x{ptr:X8}", Logger.Color.Cyan);
                                }
                            }
                            catch (Exception dumpEx)
                            {
                                Logger.Log($"BSP[{i}] ltmp raw dump failed: {dumpEx.Message}", Logger.Color.Red);
                            }

                            if (ltmpTag.Groups != null && ltmpTag.Groups.Length > 0)
                            {
                                var group = ltmpTag.Groups[0];
                                var clusterInfoCount = group.ClusterRenderInfo?.Length ?? 0;
                                Logger.Log($"BSP[{i}] group[0]: {clusterInfoCount} cluster entries, bitmap ref={group.LightmapBitmap.Id}, invalid={group.LightmapBitmap.IsInvalid}", Logger.Color.White);

                                if (group.LightmapBitmap.IsInvalid == false)
                                {
                                    if (scene.Map.TryGetTag(group.LightmapBitmap, out lightmapBitmap))
                                    {
                                        Logger.Log($"Loaded lightmap bitmap for BSP[{i}]: {lightmapBitmap.Name}", Logger.Color.Cyan);
                                    }
                                    else
                                    {
                                        Logger.Log($"BSP[{i}] lightmap bitmap ref valid but tag not found: {group.LightmapBitmap.Id}", Logger.Color.Red);
                                    }
                                }
                            }
                        }
                        else
                        {
                            Logger.Log($"BSP[{i}] ltmp tag not found for id={terrain.LightmapId.Id}", Logger.Color.Magenta);
                        }

                        if (lightmapBitmap == null)
                        {
                            Logger.Log($"BSP[{i}] no lightmap - using fallback lighting", Logger.Color.Magenta);
                        }
                    }
                    catch (Exception ex)
                    {
                        Logger.Log($"Failed to load lightmap for BSP[{i}]: {ex.Message}", Logger.Color.Red);
                    }
                }

                // Log cluster geometry stats
                var emptyClusterCount = 0;
                var validClusterCount = 0;
                foreach (var cluster in bsp.Clusters)
                {
                    if (cluster.Model == null || cluster.Model.Meshes.Length == 0)
                        emptyClusterCount++;
                    else
                        validClusterCount++;
                }
                Logger.Log($"BSP[{i}]: {bsp.Name}, {bsp.Clusters.Length} clusters ({validClusterCount} with geometry, {emptyClusterCount} empty), {bsp.InstancedGeometryInstances.Length} instances, lightmap={lightmapBitmap != null}", Logger.Color.White);

                entities.Add(scene.EntityCreator.FromBsp(bsp, lightmapBitmap));

                foreach (var instance in bsp.InstancedGeometryInstances)
                {
                    entities.Add(scene.EntityCreator.FromInstancedGeometry(bsp, instance));
                }

                // Find appropriate skybox
                if(terrain.SkyIndex >= 0 && terrain.SkyIndex < scene.Map.Scenario.SkyboxInstances.Length)
                {
                    var sky = scene.Map.Scenario.SkyboxInstances[terrain.SkyIndex];

                    if(sky.Skybox.IsInvalid == false)
                    {
                        entities.Add(scene.EntityCreator.FromSkyboxInstance(sky));
                    }
                }

                scene.GatherPlacedEntities(i, entities);

                this.bspEntities[i] = entities;
            }

            // Load BSP 0
            this.bspsToLoad[0] = true;
        }

        public override void Update(double timestep)
        {
            PopulateSwitchCommandFromKeys();

            for (int i = 0; i < this.bspsToUnload.Length; i++)
            {
                if(this.bspsToUnload[i])
                {
                    this.bspsToUnload[i] = false;

                    foreach (var e in bspEntities[i])
                        world.Scene.RemoveEntity(e);

                    this.loadedBsps[i] = false;
                }
            }

            for (int i = 0; i < this.bspsToLoad.Length; i++)
            {
                if (this.bspsToLoad[i])
                {
                    this.bspsToLoad[i] = false;

                    foreach (var e in bspEntities[i])
                        world.Scene.AddEntity(e);

                    this.loadedBsps[i] = true;
                }
            }
        }

        private void PopulateSwitchCommandFromKeys()
        {
            var bspIndex = -1;

            if (this.inputStore.WasPressed(Key.Keypad0))
            {
                bspIndex = 0;
            }
            else if (this.inputStore.WasPressed(Key.Keypad1))
            {
                bspIndex = 1;
            }
            else if (this.inputStore.WasPressed(Key.Keypad2))
            {
                bspIndex = 2;
            }
            else if (this.inputStore.WasPressed(Key.Keypad3))
            {
                bspIndex = 3;
            }
            else if (this.inputStore.WasPressed(Key.Keypad4))
            {
                bspIndex = 4;
            }
            else if (this.inputStore.WasPressed(Key.Keypad5))
            {
                bspIndex = 5;
            }
            else if (this.inputStore.WasPressed(Key.Keypad6))
            {
                bspIndex = 6;
            }
            else if (this.inputStore.WasPressed(Key.Keypad7))
            {
                bspIndex = 7;
            }
            else if (this.inputStore.WasPressed(Key.Keypad8))
            {
                bspIndex = 8;
            }
            else if (this.inputStore.WasPressed(Key.Keypad9))
            {
                bspIndex = 9;
            }

            if(bspIndex >= 0)
            {
                var toggle = this.inputStore.IsDown(Key.ControlLeft)
                || this.inputStore.IsDown(Key.ControlRight);

                SwitchBsp(bspIndex, toggle);
            }
        }
    }
}
