using System;
using System.Diagnostics;
using System.IO;
using System.Numerics;
using OpenH2.Core.Architecture;
using OpenH2.Core.Audio.Abstractions;
using OpenH2.Core.Configuration;
using OpenH2.Core.Extensions;
using OpenH2.Core.Factories;
using OpenH2.Core.Maps;
using OpenH2.Core.Maps.Vista;
using OpenH2.Core.Maps.Xbox;
using OpenH2.Core.Metrics;
using OpenH2.Engine.Components;
using OpenH2.Engine.Entities;
using OpenH2.Engine.EntityFactories;
using OpenH2.Foundation;
using OpenH2.Foundation.Engine;
using OpenH2.OpenAL.Audio;
using OpenH2.Rendering.Abstractions;
using OpenH2.Rendering.Vulkan;
using Silk.NET.Input;

namespace OpenH2.Engine
{
    public class Engine : IDisposable
    {
        IDisposable? graphicsHostDisposable = null;
        IGraphicsHost graphicsHost = null!;
        IAudioHost audioHost = null!;
        IGameLoopSource gameLoop = null!;
        Func<IInputContext> gameInputGetter = null!;

        private World world = null!;
        private FlatFileMetricSink sink = null!;

        public Engine()
        {
            var host = new VulkanHost();
            host.EnableConsoleDebug();
            gameInputGetter = host.GetInputContext;

            graphicsHostDisposable = host;
            graphicsHost = host;
            gameLoop = host;

            audioHost = OpenALHost.Open(EngineGlobals.Forward, EngineGlobals.Up);
        }

        // Environment variable names for ancillary map paths
        private const string EnvSharedMapPath = "openh2_shared_map";
        private const string EnvMainMenuMapPath = "openh2_mainmenu_map";
        private const string EnvSPSharedMapPath = "openh2_sp_shared_map";

        public void Start(EngineStartParameters parameters)
        {
            var mapPath = parameters.LoadPathOverride ?? @"D:\H2vMaps\lockout.map";
            var configPath = Environment.GetEnvironmentVariable(ConfigurationConstants.ConfigPathOverrideEnvironmentVariable);

            if (configPath != null)
            {
                configPath = Path.GetFullPath(configPath);
            }
            else
            {
                configPath = Environment.CurrentDirectory + "/Configs";
            }

            var matFactory = new MaterialFactory(configPath);

            // Build ancillary map config from environment variables
            var ancillaryConfig = new AncillaryMapConfig
            {
                SharedMapPath = Environment.GetEnvironmentVariable(EnvSharedMapPath),
                MainMenuMapPath = Environment.GetEnvironmentVariable(EnvMainMenuMapPath),
                SinglePlayerSharedMapPath = Environment.GetEnvironmentVariable(EnvSPSharedMapPath)
            };

            var factory = new MapFactory(Path.GetDirectoryName(mapPath), ancillaryConfig);

            var mapFilename = Path.GetFileName(mapPath);

            matFactory.AddListener(() =>
            {
                LoadMap(factory, mapFilename, matFactory);
            });

            graphicsHost.CreateWindow(new Vector2(1600, 900));

            world = new RealtimeWorld(gameInputGetter(), 
                audioHost.GetAudioAdapter(), 
                graphicsHost);

            LoadMap(factory, mapFilename, matFactory);

            gameLoop.RegisterCallbacks(world.Update, world.Render);
            gameLoop.Start(60, 60);
        }

        private void LoadMap(MapFactory factory, string mapFilename, IMaterialFactory materialFactory)
        {
            var watch = new Stopwatch();
            watch.Start();

            var imap = factory.Load(mapFilename);

            // Support both Vista and Xbox maps
            IH2PlayableMap playableMap;

            switch (imap)
            {
                case H2vMap vistaMap:
                    vistaMap.UseMaterialFactory(materialFactory);
                    playableMap = vistaMap;
                    break;

                case H2xMap xboxMap:
                    xboxMap.UseMaterialFactory(materialFactory);
                    playableMap = xboxMap;
                    Console.WriteLine("Loading Xbox original map");
                    break;

                default:
                    throw new Exception($"Unsupported map type: {imap.GetType().Name}");
            }

            var scenario = playableMap.Scenario;
            var scene = new Scene(playableMap, new EntityCreator(playableMap));
            scene.Load();

            watch.Stop();
            Console.WriteLine($"Loading map took {watch.ElapsedMilliseconds / 1000f} seconds");

            var player = new Player(true);
            player.FriendlyName = "player_0";
            player.Transform.Position = scenario.PlayerSpawnMarkers[0].Position + new Vector3(0, 0, 0.3f);
            player.Transform.Orientation = Quaternion.CreateFromAxisAngle(EngineGlobals.Up, scenario.PlayerSpawnMarkers[0].Heading);
            player.Transform.UpdateDerivedData();

            scene.AddEntity(player);


            foreach (var squad in scenario.AiSquadDefinitions)
            {
                foreach (var start in squad.StartingLocations)
                {
                    var entity = ActorFactory.SpawnPointFromStartingLocation(playableMap, start);

                    if(entity != null)
                        scene.AddEntity(entity);
                }
            }

            // Process all queued entities before loading the scene
            // This ensures player and other entities are in Scene.Entities
            // before systems initialize and before the first render
            // (VulkanHost skips the first Update to avoid physics issues with large delta time)
            scene.ProcessUpdates();

            world.LoadScene(scene);

            var timestamp = DateTime.Now.ToString("yy-MM-ddTHH-mm");
            var sinkPath = Path.Combine(Environment.CurrentDirectory, "diagnostics", $"{timestamp}-metrics.csv");
            Directory.CreateDirectory(Path.GetDirectoryName(sinkPath));
            this.sink = new FlatFileMetricSink(sinkPath);
            scene.UseMetricSink(this.sink);
            this.sink.Start();
        }

        private void PlaceLights(Scene destination)
        {
            for(var i = 0; i < 9; i++)
            {
                var position = VectorExtensions.Random(3, 12);
                var color = VectorExtensions.RandomColor(200);

                var item = new Light();
                var model = new RenderModelComponent(item, ModelFactory.HalfTriangularThing(color));

                var xform = new TransformComponent(item, position);

                var light = new PointLightEmitterComponent(item)
                {
                    Light = new PointLight()
                    {
                        Color = new Vector3(color.X, color.Y, color.Z),
                        Position = Vector3.Zero,
                        Radius = 20f
                    }
                };

                item.SetComponents(new Component[]{
                    model,
                    xform,
                    light
                });

                destination.Entities.Add(Guid.NewGuid(), item);
            }
        }

        public void Dispose()
        {
            this.sink?.Stop();
            this.graphicsHostDisposable?.Dispose();
        }

    }
}
