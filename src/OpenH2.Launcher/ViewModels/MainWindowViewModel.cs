using Avalonia.Controls;
using OpenH2.Core.Factories;
using OpenH2.Launcher.Export;
using OpenH2.Launcher.Preferences;
using PropertyChanged;
using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Threading.Tasks;

namespace OpenH2.Launcher.ViewModels
{
    [AddINotifyPropertyChangedInterface]
    public class MainWindowViewModel
    {
        private readonly Window window;

        public ObservableCollection<MapEntry> AvailableMaps { get; set; } = new();

        public MapEntry? SelectedMap { get; set; }

        // Settings properties bound to UI
        public string SharedMapPath
        {
            get => AppPreferences.Current.SharedMapPath ?? "";
            set
            {
                AppPreferences.Current.SharedMapPath = string.IsNullOrWhiteSpace(value) ? null : value;
                AppPreferences.StoreCurrent();
            }
        }

        public string MainMenuMapPath
        {
            get => AppPreferences.Current.MainMenuMapPath ?? "";
            set
            {
                AppPreferences.Current.MainMenuMapPath = string.IsNullOrWhiteSpace(value) ? null : value;
                AppPreferences.StoreCurrent();
            }
        }

        public string SinglePlayerSharedMapPath
        {
            get => AppPreferences.Current.SinglePlayerSharedMapPath ?? "";
            set
            {
                AppPreferences.Current.SinglePlayerSharedMapPath = string.IsNullOrWhiteSpace(value) ? null : value;
                AppPreferences.StoreCurrent();
            }
        }

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
            Log($"Loading maps from: {folder}");
            this.AvailableMaps.Clear();

            var maps = Directory.GetFiles(folder, "*.map");
            Log($"Found {maps.Length} map files");

            foreach (var map in maps)
            {
                this.AvailableMaps.Add(new MapEntry(map));
            }
        }

        public void Launch()
        {
            if (this.SelectedMap == null)
            {
                Log("ERROR: No map selected");
                return;
            }

            try
            {
                Log($"Launching map: {this.SelectedMap.FullPath}");
                EngineConnector.Start(this.SelectedMap.FullPath);
                Log("Engine started successfully");
            }
            catch (Exception ex)
            {
                Log($"ERROR: Failed to launch engine: {ex.Message}");
                Log($"Stack trace: {ex.StackTrace}");
            }
        }

        public async Task QuickLoadMap()
        {
            var dialog = new OpenFileDialog();
            dialog.Title = "Select a Halo 2 Map";
            dialog.AllowMultiple = false;
            dialog.Filters.Add(new FileDialogFilter
            {
                Name = "Halo 2 Map Files",
                Extensions = { "map" }
            });

            // Start in the last used folder or default Halo 2 location
            dialog.Directory =
                AppPreferences.Current.ChosenMapFolder ??
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft Games", "Halo 2", "maps");

            var result = await dialog.ShowAsync(this.window);

            if (result != null && result.Length > 0)
            {
                var mapPath = result[0];

                // Remember the folder for next time
                var mapDirectory = Path.GetDirectoryName(mapPath);
                AppPreferences.Current.ChosenMapFolder = mapDirectory;
                AppPreferences.StoreCurrent();

                // Reload the maps list from this folder
                if (mapDirectory != null)
                {
                    LoadMaps(mapDirectory);
                }

                // Launch the map directly
                try
                {
                    Log($"Quick loading map: {mapPath}");
                    EngineConnector.Start(mapPath);
                    Log("Engine started successfully");
                }
                catch (Exception ex)
                {
                    Log($"ERROR: Failed to launch engine: {ex.Message}");
                    Log($"Stack trace: {ex.StackTrace}");
                }
            }
        }

        public async Task BrowseSharedMap()
        {
            var path = await BrowseForMapFile("Select shared.map");
            if (path != null) SharedMapPath = path;
        }

        public async Task BrowseMainMenuMap()
        {
            var path = await BrowseForMapFile("Select mainmenu.map");
            if (path != null) MainMenuMapPath = path;
        }

        public async Task BrowseSinglePlayerSharedMap()
        {
            var path = await BrowseForMapFile("Select single_player_shared.map");
            if (path != null) SinglePlayerSharedMapPath = path;
        }

        private async Task<string?> BrowseForMapFile(string title)
        {
            var dialog = new OpenFileDialog();
            dialog.Title = title;
            dialog.AllowMultiple = false;
            dialog.Filters.Add(new FileDialogFilter
            {
                Name = "Halo 2 Map Files",
                Extensions = { "map" }
            });

            dialog.Directory = AppPreferences.Current.ChosenMapFolder ?? "";

            var result = await dialog.ShowAsync(this.window);

            if (result != null && result.Length > 0)
            {
                return result[0];
            }

            return null;
        }

        public void ClearSharedMap() => SharedMapPath = "";
        public void ClearMainMenuMap() => MainMenuMapPath = "";
        public void ClearSinglePlayerSharedMap() => SinglePlayerSharedMapPath = "";

        public async Task ExportAllMapsToGlb()
        {
            var mapFolder = AppPreferences.Current.ChosenMapFolder;
            if (string.IsNullOrWhiteSpace(mapFolder) || !Directory.Exists(mapFolder))
            {
                Log("ERROR: No map folder selected. Please choose a map folder first.");
                return;
            }

            // Ask user for output folder
            var dialog = new OpenFolderDialog();
            dialog.Title = "Select Output Folder for GLB Files";
            dialog.Directory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

            var outputFolder = await dialog.ShowAsync(this.window);

            if (string.IsNullOrWhiteSpace(outputFolder))
            {
                return;
            }

            Log($"Exporting all maps from {mapFolder} to {outputFolder}...");

            // Build ancillary config from preferences
            var ancillaryConfig = new AncillaryMapConfig
            {
                SharedMapPath = string.IsNullOrWhiteSpace(AppPreferences.Current.SharedMapPath) ? null : AppPreferences.Current.SharedMapPath,
                MainMenuMapPath = string.IsNullOrWhiteSpace(AppPreferences.Current.MainMenuMapPath) ? null : AppPreferences.Current.MainMenuMapPath,
                SinglePlayerSharedMapPath = string.IsNullOrWhiteSpace(AppPreferences.Current.SinglePlayerSharedMapPath) ? null : AppPreferences.Current.SinglePlayerSharedMapPath
            };

            try
            {
                await Task.Run(() =>
                {
                    GlbExporter.ExportAllMaps(mapFolder, outputFolder, ancillaryConfig, (progress) =>
                    {
                        Log(progress);
                    });
                });

                Log("GLB export complete!");
            }
            catch (Exception ex)
            {
                Log($"ERROR: Export failed: {ex.Message}");
                Log($"Stack trace: {ex.StackTrace}");
            }
        }

        public void Exit()
        {
            this.window.Close();
        }

        private static void Log(string message)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {message}");
        }
    }
}
