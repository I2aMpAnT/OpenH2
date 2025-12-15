using OpenH2.Core.Offsets;
using OpenH2.Core.Tags;
using OpenBlam.Serialization.Layout;

namespace OpenH2.Core.Maps.Xbox
{
    /// <summary>
    /// Halo 2 Xbox original map header structure.
    /// Based on Entity (github.com/I2aMpAnT/Entity) LoadHalo2MapHeaderInfo offsets.
    /// Xbox headers have different field positions than Vista/PC.
    /// </summary>
    [FixedLength(2048)]
    public class H2xMapHeader : IH2MapHeader
    {
        [StringValue(0, 4)]
        public string FileHead { get; set; }

        [PrimitiveValue(4)]
        public int Version { get; set; }

        [PrimitiveValue(8)]
        public int TotalBytes { get; set; }

        // 0x10 - indexOffset
        [PrimitiveValue(16)]
        public NormalOffset IndexOffset { get; set; }

        // 0x14 - metaStart (called RawSecondaryOffset in OpenH2)
        [PrimitiveValue(20)]
        public int RawSecondaryOffset { get; set; }

        public PrimaryOffset SecondaryOffset { get; set; }

        // 0x18 - metaSize
        [PrimitiveValue(24)]
        public int MetaSize { get; set; }

        // 0x1C - combinedSize
        [PrimitiveValue(28)]
        public int CombinedSize { get; set; }

        [StringValue(32, 32)]
        public string MapOrigin { get; set; }

        [StringValue(288, 32)]
        public string Build { get; set; }

        // 0x154 - sizeOfCrazy
        [PrimitiveValue(340)]
        public int SizeOfCrazy { get; set; }

        // 0x158 - offsetToCrazy
        [PrimitiveValue(344)]
        public int OffsetToCrazy { get; set; }

        // 0x160 - offsetToStringNames1 (InternedStringsOffset)
        [PrimitiveValue(352)]
        public int InternedStringsOffset { get; set; }

        // 0x164 - scriptReferenceCount (InternedStringCount)
        [PrimitiveValue(356)]
        public int InternedStringCount { get; set; }

        // 0x168 - sizeOfScriptReference
        [PrimitiveValue(360)]
        public int SizeOfScriptReference { get; set; }

        // 0x16C - offsetToStringIndex (InternedStringIndexOffset)
        [PrimitiveValue(364)]
        public int InternedStringIndexOffset { get; set; }

        // 0x170 - offsetToStringNames2 (duplicate/alternate string offset)
        [PrimitiveValue(368)]
        public int InternedStringsOffset2 { get; set; }

        // 0x198 - mapName (36 chars)
        [StringValue(408, 36)]
        public string Name { get; set; }

        // 0x1BC - scenarioPath (64 chars for Xbox)
        [StringValue(444, 64)]
        public string ScenarioPath { get; set; }

        // 0x2C0 - fileCount
        [PrimitiveValue(704)]
        public int FileCount { get; set; }

        // 0x2C4 - offsetTofileNames
        [PrimitiveValue(708)]
        public int FileTableOffset { get; set; }

        // 0x2C8 - fileNamesSize
        [PrimitiveValue(712)]
        public int FileTableSize { get; set; }

        // 0x2CC - offsetTofileIndex
        [PrimitiveValue(716)]
        public int FilesIndex { get; set; }

        // 0x2D0 - signature (always 0 for Xbox maps)
        [PrimitiveValue(720)]
        public int StoredSignature { get; set; }

        // Xbox maps don't have a LocalSounds reference in the header like Vista
        // We provide a default invalid reference
        public TagRef<SoundMappingTag> LocalSounds { get; set; } = new TagRef<SoundMappingTag>(uint.MaxValue);

        [StringValue(2044, 4)]
        public string Footer { get; set; }
    }
}
