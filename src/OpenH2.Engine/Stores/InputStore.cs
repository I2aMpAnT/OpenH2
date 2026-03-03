using Silk.NET.Input;
using Silk.NET.Input.Extensions;
using System.Numerics;

namespace OpenH2.Engine.Stores
{
    public class InputStore
    {
        public bool MouseDown { get; set; }
        public Vector2 MousePos { get; set; }
        public Vector2 MouseDiff { get; set; }

        private KeyboardState PreviousKeyState { get; set; }
        private KeyboardState KeyState { get; set; }

        // Gamepad state
        public bool GamepadConnected { get; private set; }
        public Vector2 LeftStick { get; private set; }
        public Vector2 RightStick { get; private set; }
        public float LeftTrigger { get; private set; }
        public float RightTrigger { get; private set; }

        private GamepadState GamepadState { get; set; }
        private GamepadState PreviousGamepadState { get; set; }

        private const float DeadZone = 0.15f;

        public void SetMouse(MouseState mouse)
        {
            MouseDown = mouse.IsButtonPressed(MouseButton.Left);
            MouseDiff = MousePos - mouse.Position;
            MousePos = mouse.Position;
        }

        public void SetKeys(KeyboardState currentDown)
        {
            this.PreviousKeyState = this.KeyState;
            this.KeyState = currentDown;
        }

        public void SetGamepad(GamepadState gamepad)
        {
            this.PreviousGamepadState = this.GamepadState;
            this.GamepadState = gamepad;
            this.GamepadConnected = gamepad != null;

            if (gamepad == null)
            {
                LeftStick = Vector2.Zero;
                RightStick = Vector2.Zero;
                LeftTrigger = 0f;
                RightTrigger = 0f;
                return;
            }

            LeftStick = ApplyDeadZone(gamepad.Thumbsticks.Count > 0
                ? new Vector2(gamepad.Thumbsticks[0].X, gamepad.Thumbsticks[0].Y)
                : Vector2.Zero);

            RightStick = ApplyDeadZone(gamepad.Thumbsticks.Count > 1
                ? new Vector2(gamepad.Thumbsticks[1].X, gamepad.Thumbsticks[1].Y)
                : Vector2.Zero);

            LeftTrigger = gamepad.Triggers.Count > 0 ? gamepad.Triggers[0].Position : 0f;
            RightTrigger = gamepad.Triggers.Count > 1 ? gamepad.Triggers[1].Position : 0f;
        }

        private static Vector2 ApplyDeadZone(Vector2 stick)
        {
            if (stick.Length() < DeadZone)
                return Vector2.Zero;

            return stick;
        }

        public bool GamepadButtonDown(ButtonName button)
        {
            return GamepadState?.IsButtonPressed(button) ?? false;
        }

        public bool GamepadButtonPressed(ButtonName button)
        {
            return (GamepadState?.IsButtonPressed(button) ?? false)
                && !(PreviousGamepadState?.IsButtonPressed(button) ?? false);
        }

        /// <summary>
        /// Returns true if the key is down now, but wasn't last frame
        /// </summary>
        public bool WasPressed(Key key)
        {
            return (this.KeyState?.IsKeyPressed(key) ?? false) && (!(this.PreviousKeyState?.IsKeyPressed(key)) ?? true);
        }

        /// <summary>
        /// Returns if the key is currently down
        /// </summary>
        public bool IsDown(Key key)
        {
            return this.KeyState?.IsKeyPressed(key) ?? false;
        }

        /// <summary>
        /// Returns true if the key is down now, and was last frame as well
        /// </summary>
        public bool Held(Key key)
        {
            return (this.KeyState?.IsKeyPressed(key) ?? false) && this.PreviousKeyState.IsKeyPressed(key);
        }
    }
}
