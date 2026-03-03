using System;
using Silk.NET.Input;
using Silk.NET.Input.Extensions;
using System.Collections.Generic;
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

        private HashSet<ButtonName> currentButtons = new();
        private HashSet<ButtonName> previousButtons = new();

        private const float DeadZone = 0.20f;

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

        public void SetGamepad(IGamepad gamepad)
        {
            // Swap button sets
            (previousButtons, currentButtons) = (currentButtons, previousButtons);
            currentButtons.Clear();

            if (gamepad == null)
            {
                GamepadConnected = false;
                LeftStick = Vector2.Zero;
                RightStick = Vector2.Zero;
                LeftTrigger = 0f;
                RightTrigger = 0f;
                return;
            }

            GamepadConnected = true;

            LeftStick = ApplyDeadZone(gamepad.Thumbsticks.Count > 0
                ? new Vector2(gamepad.Thumbsticks[0].X, gamepad.Thumbsticks[0].Y)
                : Vector2.Zero);

            RightStick = ApplyDeadZone(gamepad.Thumbsticks.Count > 1
                ? new Vector2(gamepad.Thumbsticks[1].X, gamepad.Thumbsticks[1].Y)
                : Vector2.Zero);

            LeftTrigger = gamepad.Triggers.Count > 0 ? gamepad.Triggers[0].Position : 0f;
            RightTrigger = gamepad.Triggers.Count > 1 ? gamepad.Triggers[1].Position : 0f;

            foreach (var button in gamepad.Buttons)
            {
                if (button.Pressed)
                    currentButtons.Add(button.Name);
            }
        }

        private static Vector2 ApplyDeadZone(Vector2 stick)
        {
            var magnitude = stick.Length();
            if (magnitude < DeadZone)
                return Vector2.Zero;

            // Rescale from [deadzone, 1.0] to [0.0, 1.0] so there's no jump at threshold
            var normalized = stick / magnitude;
            var rescaled = (magnitude - DeadZone) / (1.0f - DeadZone);
            rescaled = MathF.Min(rescaled, 1.0f);

            // Square the magnitude for finer control near center, snappier at edges
            rescaled *= rescaled;

            return normalized * rescaled;
        }


        public bool GamepadButtonDown(ButtonName button)
        {
            return currentButtons.Contains(button);
        }

        public bool GamepadButtonPressed(ButtonName button)
        {
            return currentButtons.Contains(button) && !previousButtons.Contains(button);
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
