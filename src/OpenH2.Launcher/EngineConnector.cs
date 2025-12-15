using OpenH2.Launcher.Preferences;
using System;
using System.Diagnostics;
using System.IO;

namespace OpenH2.Launcher
{
    public static class EngineConnector
    {
        private static Process? runningProcess;

        private static string LocateEngine()
        {
            var enginePath = Environment.GetEnvironmentVariable("openh2_engine");

            if (enginePath != null && File.Exists(enginePath))
            {
                return enginePath;
            }

            enginePath = Path.Combine(Directory.GetCurrentDirectory(), "OpenH2.Engine.exe");

            if(File.Exists(enginePath))
            {
                return enginePath;
            }

            enginePath = Path.Combine(Directory.GetCurrentDirectory(), "engine", "OpenH2.Engine.exe");

            if (File.Exists(enginePath))
            {
                return enginePath;
            }

            throw new Exception("Cannot find OpenH2.Engine executable");
        }

        public static void Start(string mapPath)
        {
            if(runningProcess != null && !runningProcess.HasExited)
            {
                runningProcess.Kill();
            }

            var enginePath = LocateEngine();
            var startInfo = new ProcessStartInfo(enginePath, @$"""{mapPath}""");
            startInfo.WorkingDirectory = Path.GetDirectoryName(enginePath);
            startInfo.EnvironmentVariables["openh2_configroot"] = "Configs";

            // Pass ancillary map paths from preferences
            var prefs = AppPreferences.Current;
            if (!string.IsNullOrWhiteSpace(prefs.SharedMapPath))
                startInfo.EnvironmentVariables["openh2_shared_map"] = prefs.SharedMapPath;

            if (!string.IsNullOrWhiteSpace(prefs.MainMenuMapPath))
                startInfo.EnvironmentVariables["openh2_mainmenu_map"] = prefs.MainMenuMapPath;

            if (!string.IsNullOrWhiteSpace(prefs.SinglePlayerSharedMapPath))
                startInfo.EnvironmentVariables["openh2_sp_shared_map"] = prefs.SinglePlayerSharedMapPath;

            runningProcess = Process.Start(startInfo);
        }
    }
}
