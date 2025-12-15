using OpenH2.Core.Offsets;
using OpenH2.Core.Tags;
using OpenBlam.Serialization.Layout;

namespace OpenH2.Core.Maps.Xbox
{
    /// <summary>
    /// Halo 2 Xbox original map header structure.
    /// Based on Entity (github.com/troymac1ure/Entity) LoadHalo2MapHeaderInfo offsets.
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

        [PrimitiveValue(16)]
        public NormalOffset IndexOffset { get; set; }

        [PrimitiveValue(20)]
        public int RawSecondaryOffset { get; set; }

        public PrimaryOffset SecondaryOffset { get; set; }

        // Xbox has combinedSize at 24
        [PrimitiveValue(24)]
        public int CombinedSize { get; set; }

        [StringValue(32, 32)]
        public string MapOrigin { get; set; }

        [StringValue(288, 32)]
        public string Build { get; set; }

        // Xbox crazy section info
        [PrimitiveValue(340)]
        public int SizeOfCrazy { get; set; }

        [PrimitiveValue(344)]
        public int OffsetToCrazy { get; set; }

        // Xbox string offsets are shifted earlier than Vista
        [PrimitiveValue(352)]
        public int InternedStringsOffset { get; set; }

        [PrimitiveValue(356)]
        public int InternedStringCount { get; set; }

        [PrimitiveValue(360)]
        public int SizeOfScriptReference { get; set; }

        [PrimitiveValue(364)]
        public int InternedStringIndexOffset { get; set; }

        // Xbox map name is at 408 (36 chars), Vista is at 420 (32 chars)
        [StringValue(408, 36)]
        public string Name { get; set; }

        // Xbox scenario path is at 444 with 64 chars (Vista uses 256 chars at offset 456)
        [StringValue(444, 64)]
        public string ScenarioPath { get; set; }

        // Xbox file table info - shifted earlier than Vista
        [PrimitiveValue(704)]
        public int FileCount { get; set; }

        [PrimitiveValue(708)]
        public int FileTableOffset { get; set; }

        [PrimitiveValue(712)]
        public int FileTableSize { get; set; }

        [PrimitiveValue(716)]
        public int FilesIndex { get; set; }

        // Xbox signature is at 720, but always 0 for Xbox maps
        [PrimitiveValue(720)]
        public int StoredSignature { get; set; }

        // Xbox maps don't have a LocalSounds reference in the header like Vista
        // We provide a default invalid reference
        public TagRef<SoundMappingTag> LocalSounds { get; set; } = new TagRef<SoundMappingTag>(uint.MaxValue);

        [StringValue(2044, 4)]
        public string Footer { get; set; }
    }
}
