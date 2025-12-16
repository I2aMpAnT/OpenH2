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
            Console.WriteLine($"[EngineConnector] Looking for engine...");
            Console.WriteLine($"[EngineConnector] Current directory: {Directory.GetCurrentDirectory()}");

            var enginePath = Environment.GetEnvironmentVariable("openh2_engine");
            Console.WriteLine($"[EngineConnector] Env var 'openh2_engine': {enginePath ?? "(not set)"}");

            if (enginePath != null && File.Exists(enginePath))
            {
                Console.WriteLine($"[EngineConnector] Found engine at env var path");
                return enginePath;
            }

            // Check engine/ subfolder first (where post-build copies complete files)
            enginePath = Path.Combine(Directory.GetCurrentDirectory(), "engine", "OpenH2.Engine.exe");
            var dllPath = Path.Combine(Directory.GetCurrentDirectory(), "engine", "OpenH2.Engine.dll");
            Console.WriteLine($"[EngineConnector] Checking: {enginePath}");
            Console.WriteLine($"[EngineConnector]   EXE exists: {File.Exists(enginePath)}, DLL exists: {File.Exists(dllPath)}");

            if (File.Exists(enginePath) && File.Exists(dllPath))
            {
                return enginePath;
            }

            // Fallback to current directory
            enginePath = Path.Combine(Directory.GetCurrentDirectory(), "OpenH2.Engine.exe");
            dllPath = Path.Combine(Directory.GetCurrentDirectory(), "OpenH2.Engine.dll");
            Console.WriteLine($"[EngineConnector] Checking: {enginePath}");
            Console.WriteLine($"[EngineConnector]   EXE exists: {File.Exists(enginePath)}, DLL exists: {File.Exists(dllPath)}");

            if (File.Exists(enginePath) && File.Exists(dllPath))
            {
                return enginePath;
            }

            Console.WriteLine("[EngineConnector] ERROR: Could not find OpenH2.Engine.exe with its DLL");
            throw new Exception("Cannot find OpenH2.Engine executable (need both .exe and .dll)");
        }

        public static void Start(string mapPath)
        {
            if(runningProcess != null && !runningProcess.HasExited)
            {
                runningProcess.Kill();
            }

            var enginePath = LocateEngine();
            var startInfo = new ProcessStartInfo(enginePath, @$"""{mapPath}""");
            startInfo.WorkingDirectory = Path.GetDirectoryName(enginePath) ?? Directory.GetCurrentDirectory();
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
