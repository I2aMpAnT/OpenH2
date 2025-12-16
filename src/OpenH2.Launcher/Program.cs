using Avalonia;
using System;
using System.Runtime.InteropServices;

namespace OpenH2.Launcher
{
    class Program
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool AllocConsole();

        // Initialization code. Don't use any Avalonia, third-party APIs or any
        // SynchronizationContext-reliant code before AppMain is called: things aren't initialized
        // yet and stuff might break.
        public static void Main(string[] args)
        {
            // Open a debug console window
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                AllocConsole();
            }

            Console.WriteLine("=== OpenH2 Launcher Debug Console ===");
            Console.WriteLine($"Started at: {DateTime.Now}");
            Console.WriteLine();

            BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        }

        // Avalonia configuration, don't remove; also used by visual designer.
        public static AppBuilder BuildAvaloniaApp()
            => AppBuilder.Configure<App>()
                .UsePlatformDetect()
                .LogToTrace();
    }
}
