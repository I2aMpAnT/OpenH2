using OpenBlam.Core.Extensions;
using OpenBlam.Core.MapLoading;
using OpenBlam.Core.Maps;
using OpenBlam.Core.Streams;
using OpenBlam.Serialization;
using OpenH2.Core.Enums;
using OpenH2.Core.Extensions;
using OpenH2.Core.Maps;
using OpenH2.Core.Maps.MCC;
using OpenH2.Core.Maps.Vista;
using OpenH2.Core.Maps.Xbox;
using OpenH2.Core.Offsets;
using OpenH2.Core.Tags;
using System;
using System.Collections.Generic;
using System.IO;

namespace OpenH2.Core.Factories
{
    /// <summary>
    /// Configuration for ancillary map file paths.
    /// Set paths to use custom locations, or leave null to use mapRoot.
    /// </summary>
    public class AncillaryMapConfig
    {
        /// <summary>Full path to shared.map (used for multiplayer maps)</summary>
        public string? SharedMapPath { get; set; }

        /// <summary>Full path to mainmenu.map</summary>
        public string? MainMenuMapPath { get; set; }

        /// <summary>Full path to single_player_shared.map (used for campaign maps)</summary>
        public string? SinglePlayerSharedMapPath { get; set; }
    }

    public class MapFactory
    {
        private const string MainMenuName = "mainmenu.map";
        private const string MultiPlayerSharedName = "shared.map";
        private const string SinglePlayerSharedName = "single_player_shared.map";
        private readonly string mapRoot;
        private MapLoader loader = null!;

        public MapFactory(string mapRoot) : this(mapRoot, null)
        {
        }

        public MapFactory(string mapRoot, AncillaryMapConfig? config)
        {
            this.mapRoot = mapRoot;

            var builder = MapLoaderBuilder.FromRoot(mapRoot);

            // Use custom paths if provided, otherwise default to mapRoot
            var mainMenuPath = GetAncillaryPath(config?.MainMenuMapPath, mapRoot, MainMenuName);
            var sharedPath = GetAncillaryPath(config?.SharedMapPath, mapRoot, MultiPlayerSharedName);
            var spSharedPath = GetAncillaryPath(config?.SinglePlayerSharedMapPath, mapRoot, SinglePlayerSharedName);

            builder.UseAncillaryMap((byte)DataFile.MainMenu, mainMenuPath);
            builder.UseAncillaryMap((byte)DataFile.SinglePlayerShared, spSharedPath);
            builder.UseAncillaryMap((byte)DataFile.Shared, sharedPath);

            this.loader = builder.Build();
        }

        private static string GetAncillaryPath(string? customPath, string mapRoot, string defaultName)
        {
            if (!string.IsNullOrWhiteSpace(customPath) && File.Exists(customPath))
            {
                return customPath;
            }
            return Path.Combine(mapRoot, defaultName);
        }

        public IH2Map Load(string mapFileName)
        {
            Span<byte> header = new byte[2048];
            using (var peek = File.OpenRead(Path.Combine(this.mapRoot, mapFileName)))
            {
                peek.Read(header);
            }

            var baseHeader = BlamSerializer.Deserialize<H2HeaderBase>(header);

            return baseHeader.Version switch
            {
                MapVersion.Halo2 => LoadH2Map(mapFileName, header),
                MapVersion.Halo2Mcc => LoadH2mccMap(mapFileName),
                MapVersion.Halo2MccSeason8 => LoadH2mccMapV13(mapFileName),
                _ => throw new NotSupportedException()
            };
        }

        public static IH2MapInfo LoadInformational(string mapPath)
        {
            // Not using ancillary maps here, just info from map header
            var singleLoader = MapLoader.FromRoot(Path.GetDirectoryName(mapPath) ?? string.Empty);

            Span<byte> header = new byte[2048];
            using (var peek = File.OpenRead(mapPath))
            {
                peek.Read(header);
            }

            var baseHeader = BlamSerializer.Deserialize<H2HeaderBase>(header);

            return baseHeader.Version switch
            {
                MapVersion.Halo2 => LoadH2MapInfo(singleLoader, mapPath, header),
                _ => throw new NotSupportedException("This map type is not supported")
            };
        }

        private static IH2MapInfo LoadH2MapInfo(MapLoader loader, string mapPath, Span<byte> headerData)
        {
            // Check sub-version to determine Xbox vs Vista
            var subVersion = headerData.ReadInt32At(SubVersionOffset);

            if (subVersion == 0)
            {
                // Xbox map
                return loader.Load<H2xMapInfo>(
                    new ReadOnlyFileStream(mapPath),
                    (IMap map, Stream stream) => { });
            }

            // Vista map
            return loader.Load<H2vMapInfo>(
                new ReadOnlyFileStream(mapPath),
                (IMap map, Stream stream) => { });
        }

        // Sub-version offset for detecting Xbox vs Vista (offset 0x24 = 36)
        private const int SubVersionOffset = 0x24;

        public IH2Map LoadH2Map(string mapFileName, Span<byte> headerData)
        {
            // Vista and Xbox both use version 8, but differ in sub-version at offset 0x24:
            // - Xbox: sub-version = 0
            // - Vista: sub-version = -1 (0xFFFFFFFF)
            // Reference: Entity (github.com/I2aMpAnT/Entity) Map.cs LoadFromFile
            var subVersion = headerData.ReadInt32At(SubVersionOffset);

            Console.WriteLine($"[MapFactory] Loading map: {mapFileName}");
            Console.WriteLine($"[MapFactory] Sub-version at 0x24: {subVersion} (0x{subVersion:X8})");

            if (subVersion == 0)
            {
                Console.WriteLine("[MapFactory] Detected as Xbox format (H2xMap)");
                return this.loader.Load<H2xMap>(mapFileName, LoadMetadata);
            }

            Console.WriteLine("[MapFactory] Detected as Vista format (H2vMap)");
            return this.loader.Load<H2vMap>(mapFileName, LoadMetadata);
        }

        public H2mccMap LoadH2mccMap(string mapFileName)
        {
            return this.loader.Load<H2mccMap>(mapFileName, H2mccCompression.DecompressInline, LoadMetadata);
        }

        public H2mccV13Map LoadH2mccMapV13(string mapFileName)
        {
            return this.loader.Load<H2mccV13Map>(mapFileName, H2mccCompressionV13.DecompressInline, LoadMetadata);
        }

        public H2mccMap LoadSingleH2mccMap(Stream decompressedMap)
        {
            // Not using ancillary maps here since the map stream is already 
            // decompressed, while the ancillary maps are still compressed
            var singleLoader = MapLoader.FromRoot(this.mapRoot);

            return singleLoader.Load<H2mccMap>(decompressedMap, LoadMetadata);
        }

        private static void LoadMetadata(IMap map, Stream reader)
        {
            if(map is not IH2Map h2map)
            {
                return;
            }

            Console.WriteLine($"[MapFactory] Loading metadata for map type: {map.GetType().Name}");
            Console.WriteLine($"[MapFactory] Header.RawSecondaryOffset: {h2map.Header.RawSecondaryOffset} (0x{h2map.Header.RawSecondaryOffset:X8})");
            Console.WriteLine($"[MapFactory] Header.IndexOffset: {h2map.Header.IndexOffset.Value} (0x{h2map.Header.IndexOffset.Value:X8})");

            h2map.Header.SecondaryOffset = h2map.PrimaryOffset(h2map.Header.RawSecondaryOffset);
            Console.WriteLine($"[MapFactory] Header.SecondaryOffset.Value: {h2map.Header.SecondaryOffset.Value} (0x{h2map.Header.SecondaryOffset.Value:X8})");

            h2map.IndexHeader = DeserializeIndexHeader(h2map, reader);
            Console.WriteLine($"[MapFactory] IndexHeader.Scenario: {h2map.IndexHeader.Scenario} (0x{h2map.IndexHeader.Scenario:X8})");
            Console.WriteLine($"[MapFactory] IndexHeader.TagIndexCount: {h2map.IndexHeader.TagIndexCount}");

            h2map.PrimaryMagic = CalculatePrimaryMagic(h2map.IndexHeader);
            Console.WriteLine($"[MapFactory] PrimaryMagic: {h2map.PrimaryMagic} (0x{h2map.PrimaryMagic:X8})");

            h2map.TagIndex = BuildTagIndex(h2map, reader, out var firstOffset);
            Console.WriteLine($"[MapFactory] FirstTagOffset: {firstOffset} (0x{firstOffset:X8})");
            Console.WriteLine($"[MapFactory] TagIndex count: {h2map.TagIndex.Count}");

            h2map.SecondaryMagic = CalculateSecondaryMagic(h2map.Header, firstOffset);
            Console.WriteLine($"[MapFactory] SecondaryMagic: {h2map.SecondaryMagic} (0x{h2map.SecondaryMagic:X8})");

            h2map.LoadWellKnownTags();
        }

        public static IndexHeader DeserializeIndexHeader(IH2Map scene, Stream reader)
        {
            var header = scene.Header;

            var index = BlamSerializer.Deserialize<IndexHeader>(reader, header.IndexOffset.Value);
            index.FileRawOffset = header.IndexOffset;
            index.TagIndexOffset = scene.PrimaryOffset(index.RawTagIndexOffset);

            return index;
        }

        public static Dictionary<uint, TagIndexEntry> BuildTagIndex(IH2Map scene, Stream reader, out int firstEntryOffset)
        {
            firstEntryOffset = -1;
            var index = scene.IndexHeader;

            var entries = new Dictionary<uint, TagIndexEntry>(index.TagIndexCount);

            for (var i = 0; i < index.TagIndexCount; i++)
            {
                var entryBase = index.TagIndexOffset.Value + i * 16;

                var tag = (TagName)reader.ReadUInt32At(entryBase);

                if (tag == TagName.NULL)
                    continue;

                var entry = new TagIndexEntry
                {
                    Tag = tag,
                    ID = reader.ReadUInt32At(entryBase + 4),
                    Offset = new SecondaryOffset(scene, reader.ReadInt32At(entryBase + 8)),
                    DataSize = reader.ReadInt32At(entryBase + 12)
                };

                if (entry.DataSize == 0)
                    continue;

                if (firstEntryOffset == -1)
                    firstEntryOffset = entry.Offset.OriginalValue;

                entries[entry.ID] = entry;
            }

            return entries;
        }

        public static int CalculatePrimaryMagic(IndexHeader index)
        {
            return index.FileRawOffset.Value - index.PrimaryMagicConstant + IndexHeader.Length;
        }

        public static int CalculateSecondaryMagic(IH2MapHeader header, int firstObjOffset)
        {
            return firstObjOffset - header.SecondaryOffset.Value;
        }
    }
}
