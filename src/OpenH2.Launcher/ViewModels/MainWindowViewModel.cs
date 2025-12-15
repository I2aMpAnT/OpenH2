using Avalonia.Controls;
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

        public MapEntry SelectedMap { get; set; }

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
            this.AvailableMaps.Clear();

            var maps = Directory.GetFiles(folder, "*.map");

            foreach (var map in maps)
            {
                this.AvailableMaps.Add(new MapEntry(map));
            }
        }

        public void Launch()
        {
            if (this.SelectedMap == null) return;

            EngineConnector.Start(this.SelectedMap.FullPath);
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
                AppPreferences.Current.ChosenMapFolder = Path.GetDirectoryName(mapPath);
                AppPreferences.StoreCurrent();

                // Reload the maps list from this folder
                LoadMaps(Path.GetDirectoryName(mapPath));

                // Launch the map directly
                EngineConnector.Start(mapPath);
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

            dialog.Directory = AppPreferences.Current.ChosenMapFolder;

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

        public void Exit()
        {
            this.Exit();
        }
    }
}
