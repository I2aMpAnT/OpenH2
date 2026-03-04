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

                    var writer = new GlbWriter();
                    var bsps = scene.GetLocalTagsOfType<BspTag>().ToArray();

                    // BSP clusters
                    int clusterCount = 0;
                    foreach (var bsp in bsps)
                    {
                        if (bsp.Clusters == null) continue;
                        for (int ci = 0; ci < bsp.Clusters.Length; ci++)
                        {
                            var cluster = bsp.Clusters[ci];
                            if (cluster.Model == null) continue;
                            writer.AddBspCluster(cluster.Model, bsp.ModelShaderReferences, $"cluster_{ci}");
                            clusterCount++;
                        }
                    }

                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Loaded {clusterCount} clusters, processing instanced geometry...");

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

                            writer.AddInstancedGeometry(def.Model, xform, $"ig_{igCount}");
                            igCount++;
                        }
                    }

                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Clusters: {clusterCount}, IG: {igCount}. Processing scenery...");

                    // Scenery, Crates (Bloc), Machinery from scenario
                    var scenario = scene.GetLocalTagsOfType<ScenarioTag>().FirstOrDefault();
                    int objectCount = 0;

                    if (scenario != null)
                    {
                        // Scenery
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

                        // Crates (Bloc)
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

                        // Machinery
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
                    }

                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Writing GLB... (clusters: {clusterCount}, IG: {igCount}, objects: {objectCount})");

                    var glbData = writer.ToGlb();
                    File.WriteAllBytes(savePath, glbData);

                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Exported to {Path.GetFileName(savePath)} ({glbData.Length / 1024 / 1024}MB) — clusters: {clusterCount}, IG: {igCount}, objects: {objectCount}");
                }
                catch (Exception ex)
                {
                    Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                        ExportStatus = $"Export failed: {ex.Message}");
                }
            });
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

                writer.AddInstancedGeometry(section.Model, transform, name);
            }
        }

        public void Exit()
        {
            this.Exit();
        }
    }
}
