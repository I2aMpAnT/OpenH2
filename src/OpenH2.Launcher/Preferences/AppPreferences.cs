namespace OpenH2.Launcher.Preferences
{
    public class AppPreferences
    {
        static AppPreferences()
        {
            Current = PreferencesManager.LoadAppPreferences();
        }

        public static void StoreCurrent()
        {
            PreferencesManager.StoreAppPreferences(AppPreferences.Current);
        }

        public static AppPreferences Current { get; private set; } = null!;

        // Primary map folder for loading maps
        public string? ChosenMapFolder { get; set; }

        // Ancillary map paths - if null, uses ChosenMapFolder
        // These can be set separately for Xbox maps or custom setups
        public string? SharedMapPath { get; set; }
        public string? MainMenuMapPath { get; set; }
        public string? SinglePlayerSharedMapPath { get; set; }
    }
}
