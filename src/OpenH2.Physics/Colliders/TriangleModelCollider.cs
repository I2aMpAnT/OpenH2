using OpenH2.Foundation.Physics;
using System;

namespace OpenH2.Physics.Colliders
{
    public class TriangleModelCollider : ICollider
    {
        public int PhysicsMaterial => -1;

        public TriangleMeshCollider[] MeshColliders { get; set; } = Array.Empty<TriangleMeshCollider>();
    }
}
