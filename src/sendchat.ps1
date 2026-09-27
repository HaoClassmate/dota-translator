# The keys behind "send it translated": the player types English into the
# game's OWN chat field and presses the app's key instead of Enter.
#
#   copy       Ctrl+A, Ctrl+C          what is in the chat field goes to the clipboard
#   send       Ctrl+A, Ctrl+V, Enter   the translation replaces it and is said
# and, for the default way (the chat closes at once, the line is said when
# the translation is ready - the user, 2026-09-27):
#   clear      Ctrl+A, Backspace, Escape   the field emptied and the chat closed
#   open team  Enter          the team chat opened
#   open all   Shift+Enter    the all chat opened
#   paste      Ctrl+A, Ctrl+V
#   enter      Enter
#
# The app does the clipboard and the translating in between; no text comes
# through here at all.
#
# This is INPUT, the kind a keyboard sends, through Windows. The game's
# process is never opened by this script, for reading or for writing, and
# nothing here could write to it. It acts only on a word from the app,
# and the app sends one only because the player pressed the key.
#
# It is started with the app and then WAITS, blocked on its stdin, costing
# nothing: compiling the C# below takes most of a second, and a key that
# answers a second late is a key that feels broken. When the app goes, the
# pipe closes, the read returns nothing, and this exits.
#
# GUARD: if Dota is not the window in front, NOTHING is typed - asked
# before every group of keys. Keys sent to whatever else has the keyboard
# would select, overwrite and SEND in it, and that could be a chat with a
# real person.

param([string]$ProcessName = 'dota2')

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class SayKeys {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  const uint KEYUP = 2;
  public const byte BACK = 0x08, ESC = 0x1B, ENTER = 0x0D, SHIFT = 0x10, CTRL = 0x11, ALT = 0x12, A = 0x41, C = 0x43, V = 0x56;

  // The scan code goes with the virtual key: a game reading raw input
  // sees the scan code and would ignore a key that has none.
  static void Down(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), 0, UIntPtr.Zero); }
  static void Up(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), KEYUP, UIntPtr.Zero); }
  public static void Tap(byte vk) { Down(vk); Thread.Sleep(30); Up(vk); }
  public static void Chord(byte mod, byte vk) { Down(mod); Thread.Sleep(30); Tap(vk); Thread.Sleep(30); Up(mod); }

  /// Does the window in front belong to this process?
  public static bool InFront(int pid) {
    int owner; GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    return owner == pid;
  }

  /// Every key this script ever presses, let go - whatever happened in the
  /// middle. A Ctrl left down turns every key the player presses into
  /// Ctrl+key, which the game ignores: the user, 2026-09-27, "couldnt press
  /// a single button and had to quit dota". An extra key-up for a key that
  /// is already up does nothing.
  public static void ReleaseAll() { Up(V); Up(C); Up(A); Up(ENTER); Up(BACK); Up(ESC); Up(SHIFT); Up(CTRL); }

  static bool Held(byte vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

  /// The player's own Ctrl and Enter are still going up from the key that
  /// started this. Ours on top of theirs would be other keys.
  /// No key of the keyboard held at all (mouse buttons aside): before the
  /// app opens the chat by itself, so a Q held for a spell is not typed
  /// into it.
  public static bool WaitAllReleased(int ms) {
    for (int t = 0; t < ms; t += 25) {
      bool any = false;
      for (int vk = 0x08; vk <= 0xFE && !any; vk++) if (Held((byte)vk)) any = true;
      if (!any) return true;
      Thread.Sleep(25);
    }
    return false;
  }

  public static bool WaitReleased(int ms) {
    for (int t = 0; t < ms; t += 25) {
      if (!Held(CTRL) && !Held(SHIFT) && !Held(ALT) && !Held(ENTER)) return true;
      Thread.Sleep(25);
    }
    return false;
  }
}
"@

function GamePid {
  $p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { return $p.Id }
  return 0
}

Write-Output 'ready'
while ($true) {
  $word = [Console]::In.ReadLine()
  if ($null -eq $word) { break }
  if (@('copy', 'send', 'clear', 'open team', 'open all', 'paste', 'enter') -notcontains $word) { Write-Output 'NOT DONE: not a command'; continue }
  try {
    $id = GamePid
    if ($id -eq 0 -or -not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game is not in front'; continue }
    if (-not [SayKeys]::WaitReleased(1500)) { Write-Output 'NOT DONE: keys are still held'; continue }
    if (-not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game is not in front'; continue }
    if ($word -eq 'open team' -or $word -eq 'open all' -or $word -eq 'paste' -or $word -eq 'enter') {
      if (-not [SayKeys]::WaitAllReleased(3000)) { Write-Output 'NOT DONE: keys are still held'; continue }
      if (-not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game is not in front'; continue }
      if ($word -eq 'open team') { [SayKeys]::Tap([SayKeys]::ENTER) }
      elseif ($word -eq 'open all') { [SayKeys]::Chord([SayKeys]::SHIFT, [SayKeys]::ENTER) }
      elseif ($word -eq 'paste') { [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::A); Start-Sleep -Milliseconds 40; [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::V) }
      else { [SayKeys]::Tap([SayKeys]::ENTER) }
      Start-Sleep -Milliseconds 90
      Write-Output 'done'
      continue
    }
    [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::A)
    if ($word -eq 'clear') {
      Start-Sleep -Milliseconds 40
      [SayKeys]::Tap([SayKeys]::BACK)
      Start-Sleep -Milliseconds 40
      [SayKeys]::Tap([SayKeys]::ESC)
      Start-Sleep -Milliseconds 60
      Write-Output 'done'
      continue
    }
    Start-Sleep -Milliseconds 60
    if ($word -eq 'copy') {
      [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::C)
      Start-Sleep -Milliseconds 80
      Write-Output 'copied'
      continue
    }
    [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::V)
    Start-Sleep -Milliseconds 120
    # Asked again: Enter in the wrong window SENDS something.
    if (-not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game lost focus'; continue }
    [SayKeys]::Tap([SayKeys]::ENTER)
    Write-Output 'sent'
  } catch {
    Write-Output 'NOT DONE: the helper failed'
  } finally {
    try { [SayKeys]::ReleaseAll() } catch { }
  }
}
