using OpenH2.Core.Architecture;
using OpenH2.Core.GameObjects;

namespace OpenH2.Engine.Entities
{
    public class Item : GameObjectEntity, IEquipment
    {
        public Item()
        {
            this.Components = new Component[0];
        }
    }
}
