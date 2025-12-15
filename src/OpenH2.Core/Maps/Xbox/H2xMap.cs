using OpenBlam.Core.MapLoading;
using OpenH2.Core.Factories;
using OpenH2.Core.Tags;
using OpenH2.Core.Tags.Common.Models;
using OpenH2.Core.Tags.Scenario;
using OpenH2.Foundation;

namespace OpenH2.Core.Maps.Xbox
{
    /// <summary>
    /// In-memory representation of an original Xbox Halo 2 .map file.
    /// </summary>
    public class H2xMap : H2BaseMap<H2xMapHeader>, IH2PlayableMap
    {
        private IMaterialFactory materialFactory = NullMaterialFactory.Instance;

        public ScenarioTag Scenario { get; private set; }
        public SoundMappingTag LocalSounds { get; set; }
        public GlobalsTag Globals { get; private set; }

        public override void Load(byte selfIdentifier, MapStream mapStream)
        {
            base.Load(selfIdentifier, mapStream);
        }

        public override void LoadWellKnownTags()
        {
            if (this.TryGetTag(this.IndexHeader.Scenario, out var scnr))
            {
                this.Scenario = scnr;
            }

            // Xbox maps don't have LocalSounds in header, but we can try to find it
            // from the Globals tag if needed
            if (this.Header.LocalSounds.IsInvalid == false &&
                this.TryGetTag(this.Header.LocalSounds, out var ugh))
            {
                this.LocalSounds = ugh;
            }

            if (this.TryGetTag(this.IndexHeader.Globals, out var globals))
            {
                this.Globals = globals;
            }
        }

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
