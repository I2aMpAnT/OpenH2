using OpenBlam.Core.MapLoading;
using OpenBlam.Serialization.Layout;
using OpenH2.Core.GameObjects;
using OpenH2.Core.Maps;
using OpenH2.Core.Scripting;
using OpenH2.Core.Tags.Layout;
using System;
using System.Numerics;
using System.Text.Json.Serialization;

namespace OpenH2.Core.Tags.Scenario
{
    [TagLabel(TagName.scnr)]
    public partial class ScenarioTag : BaseTag
    {
        public override string? Name { get; set; }
        public ScenarioTag(uint id) : base(id)
        {
        }



        [ReferenceArray(296)] public Obj296[] Obj296s { get; set; } = Array.Empty<Obj296>();
        [ReferenceArray(360)] public Obj360_String[] Obj360s_Locations { get; set; } = Array.Empty<Obj360_String>();
        [ReferenceArray(368)] public Obj368[] Obj368s { get; set; } = Array.Empty<Obj368>();
        [ReferenceArray(560)] public Obj560[] Obj560s { get; set; } = Array.Empty<Obj560>();
        [ReferenceArray(656)] public Obj656[] Obj656s { get; set; } = Array.Empty<Obj656>();
        [ReferenceArray(792)] public Obj792[] Obj792s { get; set; } = Array.Empty<Obj792>();
        [ReferenceArray(896)] public Obj896[] Obj896s { get; set; } = Array.Empty<Obj896>();
        
        [ReferenceArray(8)] public SkyboxInstance[] SkyboxInstances { get; set; } = Array.Empty<SkyboxInstance>();
        [ReferenceArray(72)] public EntityReference[] WellKnownItems { get; set; } = Array.Empty<EntityReference>();
        [ReferenceArray(80)] public SceneryInstance[] SceneryInstances { get; set; } = Array.Empty<SceneryInstance>();
        [ReferenceArray(88)] public SceneryDefinition[] SceneryDefinitions { get; set; } = Array.Empty<SceneryDefinition>();
        [ReferenceArray(96)] public BipedInstance[] BipedInstances { get; set; } = Array.Empty<BipedInstance>();
        [ReferenceArray(104)] public BipedDefinition[] BipedDefinitions { get; set; } = Array.Empty<BipedDefinition>();
        [ReferenceArray(112)] public VehicleInstance[] VehicleInstances { get; set; } = Array.Empty<VehicleInstance>();
        [ReferenceArray(120)] public VehicleDefinition[] VehicleDefinitions { get; set; } = Array.Empty<VehicleDefinition>();
        [ReferenceArray(128)] public EquipmentPlacement[] EquipmentPlacements { get; set; } = Array.Empty<EquipmentPlacement>();
        [ReferenceArray(136)] public EquipmentDefinition[] EquipmentDefinitions { get; set; } = Array.Empty<EquipmentDefinition>();
        [ReferenceArray(144)] public WeaponPlacement[] WeaponPlacements { get; set; } = Array.Empty<WeaponPlacement>();
        [ReferenceArray(152)] public WeaponDefinition[] WeaponDefinitions { get; set; } = Array.Empty<WeaponDefinition>();
        [ReferenceArray(160)] public DeviceGroupDefinition[] DeviceGroupDefinitions { get; set; } = Array.Empty<DeviceGroupDefinition>();
        [ReferenceArray(168)] public MachineryInstance[] MachineryInstances { get; set; } = Array.Empty<MachineryInstance>();
        [ReferenceArray(176)] public MachineryDefinition[] MachineryDefinitions { get; set; } = Array.Empty<MachineryDefinition>();
        [ReferenceArray(184)] public ControllerInstance[] ControllerInstances { get; set; } = Array.Empty<ControllerInstance>();
        [ReferenceArray(192)] public ControllerDefinition[] ControllerDefinitions { get; set; } = Array.Empty<ControllerDefinition>();
        [ReferenceArray(216)] public SoundSceneryInstance[] SoundSceneryInstances { get; set; } = Array.Empty<SoundSceneryInstance>();
        [ReferenceArray(224)] public SoundSceneryDefinition[] SoundSceneryDefinitions { get; set; } = Array.Empty<SoundSceneryDefinition>();
        [ReferenceArray(232)] public LightInstance[] LightInstances { get; set; } = Array.Empty<LightInstance>();
        [ReferenceArray(240)] public LightDefinition[] LightDefinitions { get; set; } = Array.Empty<LightDefinition>();
        [ReferenceArray(248)] public StartingProfileDefinition[] StartingProfileDefinitions { get; set; } = Array.Empty<StartingProfileDefinition>();
        [ReferenceArray(256)] public PlayerSpawnMarker[] PlayerSpawnMarkers { get; set; } = Array.Empty<PlayerSpawnMarker>();
        [ReferenceArray(264)] public TriggerVolume[] TriggerVolumes { get; set; } = Array.Empty<TriggerVolume>();
        [ReferenceArray(280)] public GameModeMarker[] GameModeMarkers { get; set; } = Array.Empty<GameModeMarker>();
        [ReferenceArray(288)] public ItemCollectionPlacement[] ItemCollectionPlacements { get; set; } = Array.Empty<ItemCollectionPlacement>();
        [ReferenceArray(304)] public BspTransitionTrigger[] BspTransitions { get; set; } = Array.Empty<BspTransitionTrigger>();
        [ReferenceArray(312)] public DecalInstance[] DecalInstances { get; set; } = Array.Empty<DecalInstance>();
        [ReferenceArray(320)] public DecalDefinition[] DecalDefinitions { get; set; } = Array.Empty<DecalDefinition>();
        [ReferenceArray(336)] public StyleDefinition[] StyleDefinitions { get; set; } = Array.Empty<StyleDefinition>();
        [ReferenceArray(344)] public AiSquadGroupDefinition[] AiSquadGroupDefinitions { get; set; } = Array.Empty<AiSquadGroupDefinition>();
        [ReferenceArray(352)] public AiSquadDefinition[] AiSquadDefinitions { get; set; } = Array.Empty<AiSquadDefinition>();
        [ReferenceArray(376)] public CharacterDefinition[] CharacterDefinitions { get; set; } = Array.Empty<CharacterDefinition>();
        
        [ReferenceArray(432), JsonIgnore] public byte[] ScriptStrings { get; set; } = Array.Empty<byte>();
        [ReferenceArray(440)] public ScriptMethodDefinition[] ScriptMethods { get; set; } = Array.Empty<ScriptMethodDefinition>();
        [ReferenceArray(448)] public ScriptVariableDefinition[] ScriptVariables { get; set; } = Array.Empty<ScriptVariableDefinition>();
        [ReferenceArray(456)] public SoundDefinition[] SoundDefinitions { get; set; } = Array.Empty<SoundDefinition>();

        [ReferenceArray(472)] public SpatialPointStuff[] SpatialPointStuffs { get; set; } = Array.Empty<SpatialPointStuff>();
        [ReferenceArray(480)] public LocationFlagDefinition[] LocationFlagDefinitions { get; set; } = Array.Empty<LocationFlagDefinition>();
        [ReferenceArray(488)] public CameraPathTarget[] CameraPathTargets { get; set; } = Array.Empty<CameraPathTarget>();
        [ReferenceArray(496)] public CinematicTitleDefinition[] CinematicTitleDefinitions { get; set; } = Array.Empty<CinematicTitleDefinition>();
        [ReferenceArray(528)] public Terrain[] Terrains { get; set; } = Array.Empty<Terrain>();
        [ReferenceArray(536)] public OriginatingData[] OriginatingDatas { get; set; } = Array.Empty<OriginatingData>();
        [ReferenceArray(552)] public VehicleReference[] VehicleReferences { get; set; } = Array.Empty<VehicleReference>();
        [ReferenceArray(568), JsonIgnore] public ScriptSyntaxNode[] ScriptSyntaxNodes { get; set; } = Array.Empty<ScriptSyntaxNode>();
        [ReferenceArray(576)] public AiOrderDefinition[] AiOrderDefinitions { get; set; } = Array.Empty<AiOrderDefinition>();
        [ReferenceArray(584)] public AiNamedTrigger[] AiNamedTriggers { get; set; } = Array.Empty<AiNamedTrigger>();
        [ReferenceArray(592)] public BackgroundSoundDefinition[] BackgroundSoundDefinitions { get; set; } = Array.Empty<BackgroundSoundDefinition>();
        [ReferenceArray(600)] public SoundEnvironmentDefinition[] SoundEnvironmentDefinitions { get; set; } = Array.Empty<SoundEnvironmentDefinition>();
        [ReferenceArray(808)] public BlocInstance[] BlocInstances { get; set; } = Array.Empty<BlocInstance>();
        [ReferenceArray(816)] public BlocDefinition[] BlocDefinitions { get; set; } = Array.Empty<BlocDefinition>();
        [ReferenceArray(832)] public AtmosphericFogDefinition[] AtmosphericFogDefinitions { get; set; } = Array.Empty<AtmosphericFogDefinition>();
        [ReferenceArray(840)] public FogDefinition[] FogDefinitions { get; set; } = Array.Empty<FogDefinition>();
        [ReferenceArray(848)] public CreatureDefinition[] CreatureDefinitions { get; set; } = Array.Empty<CreatureDefinition>();
        [ReferenceArray(888)] public DecrDefinition[] DecrDefinitions { get; set; } = Array.Empty<DecrDefinition>();
        [ReferenceArray(904)] public BspLightingInfo[] BspLightingInfos { get; set; } = Array.Empty<BspLightingInfo>();
        [ReferenceArray(920)] public LevelInfo[] LevelInfos { get; set; } = Array.Empty<LevelInfo>();
        [ReferenceArray(944)] public MissionDialogMap[] MissionDialogMapping { get; set; } = Array.Empty<MissionDialogMap>();
        //[ReferenceArray(984)] public uint[] FreeSpace { get; set; }

        public override void PopulateExternalData(MapStream reader)
        {
            foreach (var reference in this.WellKnownItems)
            {
                reference.Initialize(this);
            }

            for (int i = 0; i < this.AiSquadDefinitions.Length; i++)
            {
                var squad = this.AiSquadDefinitions[i];
                foreach(var loc in squad.StartingLocations)
                {
                    loc.SquadIndex = i;
                }
            }
        }

        [FixedLength(132)]
        public class CreatureDefinition
        {
            [ReferenceArray(12)]
            public Obj12[] Obj12s { get; set; } = Array.Empty<Obj12>();

            [PrimitiveValue(44)]
            public TagRef Creature { get; set; }

            [FixedLength(28)]
            public class Obj12
            {
                [PrimitiveArray(0, 7)]
                public float[] Floats { get; set; } = Array.Empty<float>();
            }
        }

        [FixedLength(36)]
        public class EntityReference : IGameObjectDefinition<IGameObject>
        {
            [StringValue(0, 32)]
            public string Identifier { get; set; } = string.Empty;

            [PrimitiveValue(32)]
            public WellKnownVarType ItemType { get; set; }

            [PrimitiveValue(34)]
            public ushort Index { get; set; }

            [JsonIgnore]
            public IGameObject? GameObject => this.ItemType switch
            {
                WellKnownVarType.Biped => scenario.BipedInstances[Index].GameObject,
                WellKnownVarType.Vehicle => scenario.VehicleInstances[Index].GameObject,
                WellKnownVarType.Weapon => scenario.WeaponPlacements[Index].GameObject,
                WellKnownVarType.Equipment => scenario.EquipmentPlacements[Index].GameObject,
                WellKnownVarType.Scenery => scenario.SceneryInstances[Index].GameObject,
                WellKnownVarType.Machinery => scenario.MachineryInstances[Index].GameObject,
                WellKnownVarType.Controller => scenario.ControllerInstances[Index].GameObject,
                WellKnownVarType.Sound => scenario.SoundSceneryInstances[Index].GameObject,
                WellKnownVarType.Bloc => scenario.BlocInstances[Index].GameObject,
                WellKnownVarType.Undef => null,
                _ => throw new System.NotImplementedException(),
            };

            private ScenarioTag scenario = null!;
            public void Initialize(ScenarioTag scenario)
            {
                this.scenario = scenario;
            }
        }

        public enum WellKnownVarType : ushort
        {
            Biped = 0,
            Vehicle = 1,
            Weapon = 2,
            Equipment = 3, // Unsure

            Scenery = 6,
            Machinery = 7,
            Controller = 8,

            Sound = 10, // Unsure
            Bloc = 11,

            Undef = ushort.MaxValue
        }

        [FixedLength(84)]
        public class VehicleInstance : IGameObjectDefinition<IVehicle>
        {
            [PrimitiveValue(0)]
            public ushort Index { get; set; }

            [PrimitiveValue(8)]
            public Vector3 Position { get; set; }

            [PrimitiveValue(20)]
            public Vector3 Orientation { get; set; }

            public IVehicle? GameObject { get; set; }
        }

        [FixedLength(56)]
        public class EquipmentPlacement : IGameObjectDefinition<IEquipment>
        {
            [PrimitiveValue(0)]
            public ushort Index { get; set; }

            [PrimitiveValue(8)]
            public Vector3 Position { get; set; }

            [PrimitiveValue(20)]
            public Vector3 Orientation { get; set; }

            public IEquipment? GameObject { get; set; }
        }

        [FixedLength(84)]
        public class BipedInstance : IGameObjectDefinition<IUnit>
        {
            [PrimitiveValue(0)]
            public ushort Index { get; set; }

            [PrimitiveValue(2)]
            public ushort IndexB { get; set; }

            [PrimitiveValue(4)]
            public ushort Value { get; set; }

            [PrimitiveValue(8)]
            public Vector3 Position { get; set; }

            [PrimitiveValue(20)]
            public Vector3 Orientation { get; set; }

            [InternedString(52)]
            public string Description { get; set; } = string.Empty;

            public IUnit? GameObject { get; set; }
        }

        [FixedLength(68)]
        public class TriggerVolume : IGameObjectDefinition<ITriggerVolume>
        {
            [InternedString(0)]
            public string Description { get; set; } = string.Empty;

            [PrimitiveValue(4)]
            public ushort ParentId { get; set; }

            [PrimitiveValue(6)]
            public ushort Unknown2 { get; set; }

            // Seems to only have a value when parented
            [InternedString(8)]
            public string ParentDescription { get; set; } = string.Empty;

            [PrimitiveValue(12)]
            public Vector3 ForwardRotation { get; set; }

            [PrimitiveValue(24)]
            public Vector3 UpRotation { get; set; }

            [PrimitiveValue(36)]
            public Vector3 Position { get; set; }

            [PrimitiveValue(48)]
            public Vector3 Size { get; set; }

            [PrimitiveValue(60)]
            public float Param { get; set; }

            // Non-max when it's a kill volume
            [PrimitiveValue(64)]
            public uint Unknown3 { get; set; }

            public ITriggerVolume? GameObject { get; set; }
        }

        [FixedLength(32)]
        public class GameModeMarker
        {
            [PrimitiveValue(0)]
            public Vector3 Position { get; set; }
        }

        // only in MP?
        [FixedLength(156)] public class Obj296 { }

        [FixedLength(14)]
        public class BspTransitionTrigger
        {
            [PrimitiveValue(0)]
            public ushort TriggerVolumeIndex { get; set; }

            [PrimitiveValue(2)]
            public ushort FromBsp { get; set; }

            [PrimitiveValue(4)]
            public ushort ToBsp { get; set; }

            [PrimitiveValue(6)]
            public ushort ValA { get; set; }

            [PrimitiveValue(8)]
            public ushort LocationFlagOffset_Maybe { get; set; }

            [PrimitiveValue(10)]
            public ushort ValC { get; set; }

            [PrimitiveValue(12)]
            public ushort ValD { get; set; }
        }

        [FixedLength(8)]
        public class StyleDefinition
        {
            [PrimitiveValue(4)]
            public TagRef StyleReference { get; set; }
        }

        [FixedLength(84)]
        public class Obj368
        {
            [PrimitiveValue(0)]
            public uint Val1 { get; set; }

            //[ReferenceArray(16)]
            public Obj16[] Obj16s { get; set; } = null!;

            [PrimitiveValue(24)]
            public uint Val3 { get; set; }

            //[ReferenceArray(32)]
            public Obj32[] Obj32s { get; set; } = null!;

            //[ReferenceArray(40)]
            public Obj40[] Obj40s { get; set; } = null!;

            // More here

            [FixedLength(24)]
            public class Obj16
            {
                
            }

            [FixedLength(20)]
            public class Obj32
            {
                
            }

            [FixedLength(20)]
            public class Obj40
            {
                
            }
        }


        [FixedLength(8)]
        public class CharacterDefinition
        {
            [PrimitiveValue(4)]
            public TagRef<CharacterTag> CharacterReference { get; set; }
        }

        [FixedLength(8)]
        public class SoundDefinition
        {
            [PrimitiveValue(36)]
            public TagRef<SoundTag> Sound { get; set; }
        }

        [FixedLength(128)]
        public class SpatialPointStuff
        {
            [ReferenceArray(0)]
            public SpatialPointCollection[] SpatialPointCollections { get; set; } = Array.Empty<SpatialPointCollection>();

            [FixedLength(48)]
            public class SpatialPointCollection
            {
                [StringValue(0, 32)]
                public string Description { get; set; } = string.Empty;

                [ReferenceArray(32)]
                public SpatialPointDefinition[] SpatialPoints { get; set; } = Array.Empty<SpatialPointDefinition>();


                [FixedLength(60)]
                public class SpatialPointDefinition : ISpatialPoint
                {
                    [StringValue(0, 32)]
                    public string Description { get; set; } = string.Empty;

                    [PrimitiveValue(32)]
                    public Vector3 Position { get; set; }

                    [PrimitiveValue(48)]
                    public short Value { get; set; }

                    [PrimitiveValue(52)]
                    public Vector2 Unknown { get; set; }
                }
            }
        }

        [FixedLength(56)]
        public class LocationFlagDefinition : ILocationFlag
        {
            [PrimitiveValue(0)]
            public uint Value { get; set; }

            [StringValue(4, 32)]
            public string Description { get; set; } = string.Empty;

            [PrimitiveValue(36)]
            public Vector3 Position { get; set; }

            [PrimitiveValue(48)]
            public float Param { get; set; }
        }

        [FixedLength(64)]
        public class CameraPathTarget : ICameraPathTarget
        {
            [PrimitiveValue(0)]
            public uint Value { get; set; }

            [StringValue(4, 32)]
            public string Description { get; set; } = string.Empty;

            [PrimitiveValue(36)]
            public Vector3 Position { get; set; }

            [PrimitiveValue(48)]
            public Vector3 Orientation { get; set; }

            [PrimitiveValue(60)]
            public float FieldOfView { get; set; }
        }


        [FixedLength(36)]
        public class CinematicTitleDefinition : IGameObjectDefinition<ICinematicTitle>
        {
            [InternedString(0)]
            public string Title { get; set; } = string.Empty;

            [PrimitiveValue(4)]
            public ushort OneHundred { get; set; }

            [PrimitiveValue(6)]
            public ushort Ten24 { get; set; }

            [PrimitiveValue(8)]
            public ushort ValueA { get; set; }

            [PrimitiveValue(10)]
            public ushort ValueB { get; set; }

            [PrimitiveValue(12)]
            public ushort ValueC { get; set; }

            [PrimitiveValue(14)]
            public ushort ValueD { get; set; }

            [PrimitiveValue(24)]
            public Vector3 Floats { get; set; }

            public ICinematicTitle? GameObject { get; set; }
        }


        [FixedLength(8)]
        public class VehicleReference
        {
            [PrimitiveValue(0)]
            public TagRef Tag { get; set; }

            [PrimitiveValue(4)]
            public uint Value { get; set; }
        }

        [FixedLength(2)]
        public class Obj560
        {
            [PrimitiveValue(0)]
            public ushort Index { get; set; }
        }

        

        [FixedLength(124)]
        public class AiOrderDefinition : IGameObjectDefinition<IAiOrders>
        {
            [StringValue(0, 32)]
            public string Description { get; set; } = string.Empty;

            [PrimitiveValue(32)]
            public uint ValueA { get; set; }

            [PrimitiveValue(40)]
            public uint ValueB { get; set; }

            [ReferenceArray(84)]
            public Obj84[] Obj84s { get; set; } = Array.Empty<Obj84>();

            [ReferenceArray(116)]
            public Obj116[] Obj116s { get; set; } = Array.Empty<Obj116>();


            [FixedLength(60)]
            public class Obj84
            {

            }

            [FixedLength(36)]
            public class Obj116
            {

            }

            public IAiOrders? GameObject { get; set; }
        }

        [FixedLength(48)]
        public class AiNamedTrigger
        {
            [StringValue(0, 32)]
            public string Description { get; set; } = string.Empty;

            [ReferenceArray(40)]
            public Obj40[] Obj40s { get; set; } = Array.Empty<Obj40>();


            [FixedLength(56)]
            public class Obj40
            {
                [PrimitiveValue(0)]
                public ushort Index1 { get; set; }

                [PrimitiveValue(6)]
                public ushort Index2 { get; set; }
            }
        }


        [FixedLength(100)]
        public class BackgroundSoundDefinition
        {
            [StringValue(0, 32)]
            public string Description { get; set; } = string.Empty;

            [PrimitiveValue(36)]
            public TagRef<LoopingSoundTag> LoopingSound1 { get; set; }

            [PrimitiveValue(44)]
            public TagRef<LoopingSoundTag> LoopingSound2 { get; set; }

            [PrimitiveValue(68)]
            public float Param1 { get; set; }

            [PrimitiveValue(88)]
            public float Param2 { get; set; }
        }

        [FixedLength(72)]
        public class SoundEnvironmentDefinition
        {
            [StringValue(0, 32)]
            public string Description { get; set; } = string.Empty;

            [PrimitiveValue(36)]
            public TagRef SndeReference { get; set; }

            [PrimitiveValue(40)]
            public float Param1 { get; set; }

            [PrimitiveValue(44)]
            public float Param2 { get; set; }
        }

        [FixedLength(52)]
        public class Obj656
        {
            [PrimitiveValue(4)]
            public TagRef<BspTag> Bsp { get; set; }

            [ReferenceArray(8)]
            public uint[] ValueAs { get; set; } = Array.Empty<uint>();

            [ReferenceArray(16)]
            public uint[] ValueBs { get; set; } = Array.Empty<uint>();

            [PrimitiveValue(24)]
            public ushort Param1 { get; set; }

            [PrimitiveValue(26)]
            public ushort Param2 { get; set; }

            [ReferenceArray(28)]
            public uint[] ValueCs { get; set; } = Array.Empty<uint>();

            [ReferenceArray(36)]
            public uint[] ValueDs { get; set; } = Array.Empty<uint>();

            [ReferenceArray(44)]
            public uint[] ValueEs { get; set; } = Array.Empty<uint>();
        }

        // MP only?
        [FixedLength(96)]
        public class Obj792
        {
            [PrimitiveValue(0)]
            public uint Zero { get; set; }
        }

        [FixedLength(244)]
        public class AtmosphericFogDefinition
        {
            [InternedString(0)]
            public string Name { get; set; } = string.Empty;

            [PrimitiveArray(4, 9)]
            public float[] FloatsA { get; set; } = Array.Empty<float>();

            [PrimitiveArray(136, 10)]
            public float[] FloatsB { get; set; } = Array.Empty<float>();

            [PrimitiveValue(212)]
            public TagRef FpchRef { get; set; }
        }

        

        [FixedLength(8)]
        public class DecrDefinition
        {
            [PrimitiveValue(4)]
            public TagRef DecrRef { get; set; }
        }

        [FixedLength(8)]
        public class Obj896
        {
            [PrimitiveValue(0)]
            public ushort ValueA { get; set; }

            [PrimitiveValue(2)]
            public ushort ValueB { get; set; }

            [PrimitiveValue(4)]
            public uint ValueC { get; set; }
        }

        [FixedLength(16)]
        public class BspLightingInfo
        {
            [PrimitiveValue(4)]
            public TagRef<BspTag> BspRef { get; set; }

            // TODO: using Vector4[] for ReferenceArray isn't supported
            //[ReferenceArray(8)]
            public Vector4[] LightPoints { get; set; } = Array.Empty<Vector4>();
        }

        [FixedLength(24)]
        public class LevelInfo
        {
            [PrimitiveValue(4)]
            public TagRef DescriptionUnicode { get; set; }

            [ReferenceArray(8)]
            public CampaignInfo[] CampaignInfos { get; set; } = Array.Empty<CampaignInfo>();

            [ReferenceArray(16)]
            public MultiplayerInfo[] MultiplayerInfos { get; set; } = Array.Empty<MultiplayerInfo>();

            [FixedLength(16)]
            public class CampaignInfo
            {
                [PrimitiveValue(0)]
                public uint CampaignId { get; set; }

                [PrimitiveValue(4)]
                public uint MapId { get; set; }

                [PrimitiveValue(12)]
                public TagRef<BitmapTag> BitmapRef { get; set; }

                [Utf16StringValue(16, 32)]
                public string EnglishName { get; set; } = string.Empty;

                [Utf16StringValue(592, 128)]
                public string EnglishDescription { get; set; } = string.Empty;
            }

            [FixedLength(16)]
            public class MultiplayerInfo
            {
                [PrimitiveValue(0)]
                public uint MapId { get; set; }

                [PrimitiveValue(8)]
                public TagRef<BitmapTag> BitmapRef { get; set; }

                [Utf16StringValue(12, 32)]
                public string EnglishName { get; set; } = string.Empty;

                [Utf16StringValue(588, 128)]
                public string EnglishDescription { get; set; } = string.Empty;
            }
        }

        [FixedLength(8)]
        public class MissionDialogMap
        {
            [PrimitiveValue(4)]
            public TagRef<DialogMapTag> MdlgRef { get; set; }
        }
    }
}
