using System;

namespace OpenH2.Foundation
{
    public class Mesh<TTexture>
    {
        public int[] Indicies { get; set; } = Array.Empty<int>();
        public VertexFormat[] Verticies { get; set; } = Array.Empty<VertexFormat>();
        public MeshElementType ElementType { get; set; }
        public IMaterial<TTexture> Material { get; set; } = null!;
        public bool Compressed { get; set; }

        public byte[] RawData { get; set; } = Array.Empty<byte>();

        public string Note { get; set; } = string.Empty;

        /// <summary>
        /// Set to true after modification of internal data to ensure caches are updated
        /// </summary>
        public bool Dirty { get; set; }
    }
}
