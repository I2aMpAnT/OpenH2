using Avalonia.Controls;
using OpenH2.Core.ExternalFormats;
using OpenH2.Core.Extensions;
using OpenH2.Core.Factories;
using OpenH2.Core.Maps.Vista;
using OpenH2.Core.Tags;
using OpenH2.Core.Tags.Scenario;
using OpenH2.Launcher.Preferences;
using PropertyChanged;
using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Threading.Tasks;

namespace OpenH2.Launcher.ViewModels
{
    [AddINotifyPropertyChangedInterface]
    public class MainWindowViewModel
    {
        private readonly Window window;

        public ObservableCollection<MapEntry> AvailableMaps { get; set; } = new();

        public MapEntry SelectedMap { get; set; }

        public string ExportStatus { get; set; }

        public MainWindowViewModel(Window window)
        {
            this.window = window;
            
            if(Directory.Exists(AppPreferences.Current.ChosenMapFolder))
            {
                LoadMaps(AppPreferences.Current.ChosenMapFolder);
            }
        }


        public async Task ChooseMapFolder()
        {
            var dialog = new OpenFolderDialog();
            dialog.Directory = 
                AppPreferences.Current.ChosenMapFolder ??
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft Games", "Halo 2", "maps");
            
            var chosenFolder = await dialog.ShowAsync(this.window);

            AppPreferences.Current.ChosenMapFolder = chosenFolder;
            AppPreferences.StoreCurrent();

            if (string.IsNullOrWhiteSpace(chosenFolder))
            { 
                return;
            }

            LoadMaps(chosenFolder);
        }

        private void LoadMaps(string folder)
        {
            this.AvailableMaps.Clear();

            var maps = Directory.GetFiles(folder, "*.map");

            foreach (var map in maps)
            {
                var fileName = Path.GetFileName(map);

                // Skip campaign maps (filenames starting with digits, e.g. "00a_introduction.map")
                // and skip shared/single_player_shared/mainmenu utility maps
                if (fileName.Length > 0 && char.IsDigit(fileName[0]))
                    continue;
                if (fileName.StartsWith("shared", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (fileName.StartsWith("single_player_shared", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (fileName.StartsWith("mainmenu", StringComparison.OrdinalIgnoreCase))
                    continue;

                this.AvailableMaps.Add(new MapEntry(map));
            }
        }

        public void Launch()
        {
            if (this.SelectedMap == null) return;

            EngineConnector.Start(this.SelectedMap.FullPath);
        }

        public async Task ExportGlb()
        {
            if (this.SelectedMap == null)
            {
                ExportStatus = "No map selected.";
                return;
            }

            var dialog = new SaveFileDialog();
            dialog.DefaultExtension = "glb";
            dialog.InitialFileName = Path.GetFileNameWithoutExtension(this.SelectedMap.FileName) + ".glb";
            dialog.Filters.Add(new FileDialogFilter { Name = "GLB Files", Extensions = { "glb" } });

            var savePath = await dialog.ShowAsync(this.window);
            if (string.IsNullOrWhiteSpace(savePath))
                return;

            ExportStatus = "Loading map...";

            await Task.Run(() =>
            {
                try
                {
                    var mapFolder = Path.GetDirectoryName(this.SelectedMap.FullPath);
                    var factory = new MapFactory(mapFolder);
                    var h2map = factory.Load(Path.GetFileName(this.SelectedMap.FullPath));

                    if (h2map is not H2vMap scene)
                    {
                        Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                            ExportStatus = "Only Halo 2 Vista maps are supported.");
                        return;
                    }

                    var writer = new GlbWriter(scene);
                    ExportMapToWriter(writer, scene);

                    var glbData = writer.ToGlb();
                    File.WriteAllBytes(savePath, glbData);

                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Exported to {Path.GetFileName(savePath)} ({glbData.Length / 1024 / 1024}MB)");
                }
                catch (Exception ex)
                {
                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Export failed: {ex.Message}");
                }
            });
        }

        public async Task ExportAllGlb()
        {
            if (AvailableMaps.Count == 0)
            {
                ExportStatus = "No maps loaded.";
                return;
            }

            var dialog = new OpenFolderDialog();
            dialog.Directory = AppPreferences.Current.ChosenMapFolder;

            var outputFolder = await dialog.ShowAsync(this.window);
            if (string.IsNullOrWhiteSpace(outputFolder))
                return;

            var maps = AvailableMaps.ToArray();
            int total = maps.Length;

            await Task.Run(() =>
            {
                int exported = 0;
                for (int i = 0; i < maps.Length; i++)
                {
                    var mapEntry = maps[i];
                    var mapName = Path.GetFileNameWithoutExtension(mapEntry.FileName);

                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Exporting {i + 1}/{total}: {mapName}...");

                    try
                    {
                        var mapFolder = Path.GetDirectoryName(mapEntry.FullPath);
                        var factory = new MapFactory(mapFolder);
                        var h2map = factory.Load(Path.GetFileName(mapEntry.FullPath));

                        if (h2map is not H2vMap scene)
                            continue;

                        var writer = new GlbWriter(scene);
                        ExportMapToWriter(writer, scene);

                        var glbData = writer.ToGlb();
                        var savePath = Path.Combine(outputFolder, mapName + ".glb");
                        File.WriteAllBytes(savePath, glbData);
                        exported++;
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Failed to export {mapName}: {ex.Message}");
                    }
                }

                Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                    ExportStatus = $"Exported {exported}/{total} maps to {outputFolder}");
            });
        }

        private static void ExportMapToWriter(GlbWriter writer, H2vMap scene)
        {
            var bsps = scene.GetLocalTagsOfType<BspTag>().ToArray();

            // BSP clusters
            foreach (var bsp in bsps)
            {
                if (bsp.Clusters == null) continue;
                for (int ci = 0; ci < bsp.Clusters.Length; ci++)
                {
                    var cluster = bsp.Clusters[ci];
                    if (cluster.Model == null) continue;
                    writer.AddMeshCollection(cluster.Model, Matrix4x4.Identity, $"cluster_{ci}");
                }
            }

            // Instanced geometry
            int igCount = 0;
            foreach (var bsp in bsps)
            {
                if (bsp.InstancedGeometryInstances == null || bsp.InstancedGeometryDefinitions == null)
                    continue;

                foreach (var instance in bsp.InstancedGeometryInstances)
                {
                    if (instance.Index >= bsp.InstancedGeometryDefinitions.Length)
                        continue;

                    var def = bsp.InstancedGeometryDefinitions[instance.Index];
                    if (def.Model == null) continue;

                    var xform = Matrix4x4.CreateScale(new Vector3(instance.Scale))
                        * Matrix4x4.CreateFromQuaternion(QuaternionExtensions.From3x3Mat(instance.RotationMatrix))
                        * Matrix4x4.CreateTranslation(instance.Position);

                    writer.AddMeshCollection(def.Model, xform, $"ig_{igCount}");
                    igCount++;
                }
            }

            // Scenery, Crates (Bloc), Machinery from scenario
            var scenario = scene.GetLocalTagsOfType<ScenarioTag>().FirstOrDefault();
            int objectCount = 0;

            if (scenario != null)
            {
                if (scenario.SceneryInstances != null && scenario.SceneryDefinitions != null)
                {
                    foreach (var inst in scenario.SceneryInstances)
                    {
                        if (inst.SceneryDefinitionIndex >= scenario.SceneryDefinitions.Length)
                            continue;
                        var def = scenario.SceneryDefinitions[inst.SceneryDefinitionIndex];
                        if (!scene.TryGetTag(def.Scenery, out SceneryTag scen)) continue;
                        if (!scene.TryGetTag(scen.Model, out HaloModelTag hlmt)) continue;
                        if (!scene.TryGetTag(hlmt.RenderModel, out RenderModelTag mode)) continue;

                        var xform = Matrix4x4.CreateFromQuaternion(
                                QuaternionExtensions.FromH2vOrientation(inst.Orientation))
                            * Matrix4x4.CreateTranslation(inst.Position);

                        AddRenderModelMeshes(writer, mode, xform, $"scenery_{objectCount}");
                        objectCount++;
                    }
                }

                if (scenario.BlocInstances != null && scenario.BlocDefinitions != null)
                {
                    foreach (var inst in scenario.BlocInstances)
                    {
                        if (inst.BlocDefinitionIndex >= scenario.BlocDefinitions.Length)
                            continue;
                        var def = scenario.BlocDefinitions[inst.BlocDefinitionIndex];
                        if (!scene.TryGetTag(def.Bloc, out BlocTag bloc)) continue;
                        if (!scene.TryGetTag(bloc.PhysicalModel, out HaloModelTag hlmt)) continue;
                        if (!scene.TryGetTag(hlmt.RenderModel, out RenderModelTag mode)) continue;

                        var xform = Matrix4x4.CreateFromQuaternion(
                                QuaternionExtensions.FromH2vOrientation(inst.Orientation))
                            * Matrix4x4.CreateTranslation(inst.Position);

                        AddRenderModelMeshes(writer, mode, xform, $"crate_{objectCount}");
                        objectCount++;
                    }
                }

                if (scenario.MachineryInstances != null && scenario.MachineryDefinitions != null)
                {
                    foreach (var inst in scenario.MachineryInstances)
                    {
                        if (inst.MachineryDefinitionIndex >= scenario.MachineryDefinitions.Length)
                            continue;
                        var def = scenario.MachineryDefinitions[inst.MachineryDefinitionIndex];
                        if (!scene.TryGetTag(def.Machinery, out MachineryTag mach)) continue;
                        if (!scene.TryGetTag(mach.Model, out HaloModelTag hlmt)) continue;
                        if (!scene.TryGetTag(hlmt.RenderModel, out RenderModelTag mode)) continue;

                        var xform = Matrix4x4.CreateFromQuaternion(
                                QuaternionExtensions.FromH2vOrientation(inst.Orientation))
                            * Matrix4x4.CreateTranslation(inst.Position);

                        AddRenderModelMeshes(writer, mode, xform, $"machine_{objectCount}");
                        objectCount++;
                    }
                }

                // Skyboxes — scale to encompass map geometry
                if (scenario.SkyboxInstances != null)
                {
                    // Compute map bounds from BSPs to determine skybox scale
                    float mapExtent = 100f;
                    var mapCenter = Vector3.Zero;
                    foreach (var bsp in bsps)
                    {
                        float dx = bsp.MaxX - bsp.MinX;
                        float dy = bsp.MaxY - bsp.MinY;
                        float dz = bsp.MaxZ - bsp.MinZ;
                        float extent = Math.Max(dx, Math.Max(dy, dz));
                        if (extent > mapExtent) mapExtent = extent;
                        mapCenter = new Vector3(
                            (bsp.MinX + bsp.MaxX) * 0.5f,
                            (bsp.MinY + bsp.MaxY) * 0.5f,
                            (bsp.MinZ + bsp.MaxZ) * 0.5f);
                    }

                    // Scale skybox to 10x the map extent so it surrounds everything
                    float skyScale = mapExtent * 10f;

                    foreach (var sky in scenario.SkyboxInstances)
                    {
                        if (!scene.TryGetTag(sky.Skybox, out SkyboxTag skyTag)) continue;
                        if (!scene.TryGetTag(skyTag.Model, out RenderModelTag mode)) continue;

                        var skyXform = Matrix4x4.CreateScale(skyScale)
                            * Matrix4x4.CreateTranslation(mapCenter);

                        // Export only Region[5] — the Halo ring (identified as CYAN)
                        if (mode.Regions != null && mode.Regions.Length > 5 && mode.Sections != null)
                        {
                            var region = mode.Regions[5];
                            if (region.Permutations?.Length > 0)
                            {
                                var sectionIndex = region.Permutations[0].HighestPieceIndex;
                                if (sectionIndex >= 0 && sectionIndex < mode.Sections.Length
                                    && mode.Sections[sectionIndex].Model != null)
                                {
                                    writer.AddMeshCollection(mode.Sections[sectionIndex].Model,
                                        skyXform, "skybox_halo_ring");
                                }
                            }
                        }
                        objectCount++;
                    }
                }
            }
        }

        private static void AddRenderModelMeshes(GlbWriter writer, RenderModelTag mode, Matrix4x4 transform, string name)
        {
            if (mode.Regions == null || mode.Sections == null)
                return;

            foreach (var region in mode.Regions)
            {
                if (region.Permutations == null || region.Permutations.Length == 0)
                    continue;

                // Use highest LOD permutation
                var perm = region.Permutations[0];
                var sectionIndex = perm.HighestPieceIndex;
                if (sectionIndex < 0 || sectionIndex >= mode.Sections.Length)
                    continue;

                var section = mode.Sections[sectionIndex];
                if (section.Model == null)
                    continue;

                writer.AddMeshCollection(section.Model, transform, name);
            }
        }

        public void Exit()
        {
            this.Exit();
        }
    }
}
