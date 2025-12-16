using OpenH2.Core.Tags.Common.Collision;
using OpenH2.Core.Tags.Layout;
using OpenBlam.Serialization.Layout;
using System;

namespace OpenH2.Core.Tags
{
    [TagLabel(TagName.coll)]
    public class ColliderTag : BaseTag
    {
        public ColliderTag(uint id) : base(id)
        {
        }

        [ReferenceArray(20)]
        public MaterialReference[] Ids { get; set; } = Array.Empty<MaterialReference>();

        [ReferenceArray(28)]
        public ColliderDefinition[] ColliderComponents { get; set; } = Array.Empty<ColliderDefinition>();

        [ReferenceArray(36)]
        public Obj36[] Obj36s { get; set; } = Array.Empty<Obj36>();

        [ReferenceArray(44)]
        public Obj44[] Obj44s { get; set; } = Array.Empty<Obj44>();

        [FixedLength(4)]
        public class MaterialReference
        {
            [InternedString(0)]
            public string Value { get; set; } = string.Empty;
        }

        [FixedLength(12)]
        public class ColliderDefinition
        {
            [InternedString(0)]
            public string DefName { get; set; } = string.Empty;

            [ReferenceArray(4)]
            public CollisionContainer[] DamageLevels { get; set; } = Array.Empty<CollisionContainer>();

            [FixedLength(20)]
            public class CollisionContainer
            {
                [InternedString(0)]
                public string CollName { get; set; } = string.Empty;

                [ReferenceArray(4)]
                public CollisionInfo[] Parts { get; set; } = Array.Empty<CollisionInfo>();

                [PrimitiveArray(12, 2)]
                public uint[] Obj12s { get; set; } = Array.Empty<uint>();

                [FixedLength(68)]
                public class CollisionInfo : ICollisionInfo
                {
                    [ReferenceArray(4)]
                    public Node3D[] Node3Ds { get; set; } = Array.Empty<Node3D>();

                    [ReferenceArray(12)]
                    public Common.Collision.Plane[] Planes { get; set; } = Array.Empty<Common.Collision.Plane>();

                    [ReferenceArray(20)]
                    public RawObject3[] RawObject3s { get; set; } = Array.Empty<RawObject3>();

                    //[ReferenceArray(28)]
                    public RawObject4[] RawObject4s { get; set; } = Array.Empty<RawObject4>();

                    [ReferenceArray(36)]
                    public Node2D[] Node2Ds { get; set; } = Array.Empty<Node2D>();

                    [ReferenceArray(44)]
                    public Face[] Faces { get; set; } = Array.Empty<Face>();

                    [ReferenceArray(52)]
                    public HalfEdgeContainer[] HalfEdges { get; set; } = Array.Empty<HalfEdgeContainer>();

                    [ReferenceArray(60)]
                    public Vertex[] Vertices { get; set; } = Array.Empty<Vertex>();
                }
            }
        }

        [FixedLength(4)] public class Obj36 { }
        [FixedLength(4)] public class Obj44 { }
    }
}
