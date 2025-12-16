using OpenBlam.Core.MapLoading;
using OpenH2.Core.Factories;
using OpenH2.Core.Tags;
using OpenH2.Core.Tags.Common.Models;
using OpenH2.Core.Tags.Scenario;
using OpenH2.Foundation;

namespace OpenH2.Core.Maps.Vista
{
    /// This class is the in-memory representation of a .map file
    public class H2vMap : H2BaseMap<H2vMapHeader>, IH2PlayableMap
    {
        private IMaterialFactory materialFactory = NullMaterialFactory.Instance;

        public ScenarioTag Scenario { get; private set; } = null!;
        public SoundMappingTag LocalSounds { get; set; } = null!;
        public GlobalsTag Globals { get; private set; } = null!;

        public override void Load(byte selfIdentifier, MapStream mapStream)
        {
            base.Load(selfIdentifier, mapStream);
        }

        public override void LoadWellKnownTags()
        {
            if (this.TryGetTag(this.IndexHeader.Scenario, out var scnr))
            {
                this.Scenario = scnr!;
            }

            if (this.TryGetTag(this.Header.LocalSounds, out var ugh))
            {
                this.LocalSounds = ugh!;
            }

            if (this.TryGetTag(this.IndexHeader.Globals, out var globals))
            {
                this.Globals = globals!;
            }
        }

        // TODO: consider if material construction belongs here
        public void UseMaterialFactory(IMaterialFactory materialFactory)
        {
            this.materialFactory = materialFactory;
        }

        public Material<BitmapTag> CreateMaterial(ModelMesh mesh)
        {
            return this.materialFactory.CreateMaterial(this, mesh);
        }
    }
}