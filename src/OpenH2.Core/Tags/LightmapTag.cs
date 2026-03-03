using OpenBlam.Core.MapLoading;
using OpenBlam.Serialization.Layout;
using OpenH2.Core.Maps;
using OpenH2.Core.Tags.Layout;

namespace OpenH2.Core.Tags
{
    [TagLabel(TagName.ltmp)]
    public partial class LightmapTag : BaseTag
    {
        public override string Name { get; set; }

        public LightmapTag(uint id) : base(id) { }

        [ReferenceArray(0)]
        public LightmapGroup[] Groups { get; set; }

        public override void PopulateExternalData(MapStream reader) { }

        [FixedLength(104)]
        public class LightmapGroup
        {
            // Cluster render info
            [ReferenceArray(0)]
            public GroupEntry[] ClusterRenderInfo { get; set; }

            // Bitmap tag reference for lightmap pages
            [PrimitiveValue(96)]
            public TagRef<BitmapTag> LightmapBitmap { get; set; }
        }

        [FixedLength(48)]
        public class GroupEntry
        {
            [PrimitiveValue(0)]
            public ushort BitmapIndex { get; set; }

            [PrimitiveValue(2)]
            public ushort PaletteIndex { get; set; }
        }
    }
}
