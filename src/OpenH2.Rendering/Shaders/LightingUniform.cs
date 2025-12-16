using OpenH2.Foundation;
using System;
using System.Numerics;
using System.Runtime.InteropServices;

namespace OpenH2.Rendering.Shaders
{
    [StructLayout(LayoutKind.Explicit)]
    public struct LightingUniform
    {
        public LightingUniform() { }

        [FieldOffset(0)]
        public PointLightUniform[] PointLights = Array.Empty<PointLightUniform>();

        public static readonly int Size = Marshal.SizeOf<LightingUniform>();
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PointLightUniform
    {
        public PointLightUniform(PointLight light)
        {
            Position = new Vector4(light.Position, 0f);
            ColorAndRange = new Vector4(light.Color, light.Radius);
        }

        [FieldOffset(0)]
        public Vector4 Position;

        [FieldOffset(16)]
        public Vector4 ColorAndRange;
    }
}
