using System.Collections.Generic;

namespace OpenH2.Core.Configuration
{
    public class MaterialMappingConfig
    {
        public Dictionary<string, MaterialAlias> Aliases { get; set; } = null!;
        public Dictionary<string, MaterialMapping> Mappings { get; set; } = null!;
    }
}
