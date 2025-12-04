using System.Collections.Generic;

namespace OpenH2.Core.Configuration
{
    public class MaterialMappingConfig
    {
        public Dictionary<string, MaterialAlias> Aliases { get; set; } = new Dictionary<string, MaterialAlias>();
        public Dictionary<string, MaterialMapping> Mappings { get; set; } = new Dictionary<string, MaterialMapping>();
    }
}
