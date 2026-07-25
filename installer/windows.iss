; Inno Setup script — OpenLeagueDisplay Windows installer
; =============================================================
; Installs the PyInstaller output (the dist\OpenLeagueDisplay ONEDIR folder: the exe plus its
; _internal payload) per-user, with a Start Menu entry / optional desktop shortcut / uninstaller
; (registered in "Apps & features"). The binaries (exe / ico) are not committed to the repo;
; CI (release.yml) builds and bundles them at build time.
;
; Compile (Inno Setup 6):
;   ISCC.exe /DAppVersion=1.2.3 installer\windows.iss
;   -> installer\out\OpenLeagueDisplay-windows-setup.exe
; When AppVersion is unspecified it becomes "dev" (for manual dry runs).

#ifndef AppVersion
  #define AppVersion "dev"
#endif

#define AppName "OpenLeagueDisplay"
#define AppExeName "OpenLeagueDisplay.exe"
#define AppPublisher "OpenLeagueDisplay"
#define AppURL "https://github.com/badfalcon/OpenLeagueDisplay"
; The GUID body for AppId. Reused by both [Setup]'s AppId and [Code]'s existing-install
; detection (uninstall registry key …\Uninstall\{GUID}_is1) to avoid duplicate maintenance.
; Never change it — the uninstall registry lookup depends on it.
#define MyGuid "8F4C2A91-3B6D-4E27-9A1F-2C5D8E0B7A43"

; Display name shown in the wizard title / welcome screen (AppVerName). If unset, Inno
; uses "AppName version AppVersion", which on dry runs (dev) gives an ugly
; "OpenLeagueDisplay version dev Setup". Hide the version on dev, and only show
; "OpenLeagueDisplay X.Y.Z" on real releases (vX.Y.Z).
#if AppVersion == "dev"
  #define AppDisplayName AppName
#else
  #define AppDisplayName AppName + " " + AppVersion
#endif

[Setup]
; AppId is fixed to keep the uninstall registry key stable (never change it).
; The leading {{ is an escaped literal { in Inno -> the actual AppId is {GUID}.
AppId={{{#MyGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
; The display name branches on version (see the #define above). AppVersion is kept in the uninstall registration.
AppVerName={#AppDisplayName}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
; Per-user install: no UAC elevation. The app's data (wallpaper cache in
; %LOCALAPPDATA% / HKCU wallpaper settings) is already per-user, so this matches the permission model.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
OutputDir=out
OutputBaseFilename={#AppName}-windows-setup
SetupIconFile=..\icon.ico
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
; Backstop for a running instance that the graceful /api/quit (see [Code] QuitRunningApp) didn't
; reach (custom port etc.): "force" terminates it instead of letting Restart Manager's polite close
; hang the wizard. Nothing is lost — the app holds no unsaved state (wallpaper settings live in the
; OS). This mattered most back when the app was a onefile bootloader+child process pair, which RM
; could wait on forever; the onedir build is a single process, but the backstop stays either way.
CloseApplications=force

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
; The desktop shortcut is on by default but the user can opt out.
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; The whole onedir output: {#AppExeName} at the top and its _internal payload beneath it.
; recursesubdirs+createallsubdirs keeps that layout intact — PyInstaller resolves sys._MEIPASS
; relative to the exe, so the folder must land in {app} exactly as it was built.
Source: "..\dist\{#AppName}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; icon.ico ships inside _internal too (local_app.spec bundles it as a data file for the native
; window), but the shortcuts and the URL-scheme DefaultIcon below point at {app}\icon.ico, so keep
; this copy at the top level rather than making those paths reach into _internal.
Source: "..\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; Register the openleaguedisplay:// URL scheme so the web version (GitHub Pages) can hand a gallery
; to this app with a link — it launches the app whether or not it's already running (the old
; http://127.0.0.1:8000 deep link only reached an already-running instance).
; THIS IS THE ONLY PLACE THE SCHEME IS REGISTERED. local_app.py deliberately never writes it: an
; app that re-registered on every start would let a portable exe / from-source run silently steal the
; handler from an installed copy. Consequence, by design: the portable exe does not get link launching.
; HKA = HKCU for the normal per-user install, HKLM if the user elevated to per-machine
; (PrivilegesRequiredOverridesAllowed=dialog). uninsdeletekey on the root drops the whole tree on uninstall.
; The HKCU delete below runs first and only in admin mode: HKCU\Software\Classes SHADOWS HKLM in the
; HKCR merge, so a leftover per-user registration from an earlier non-elevated install would keep
; pointing the scheme at the old (now removed) {localappdata} exe.
Root: HKCU; Subkey: "Software\Classes\openleaguedisplay"; ValueType: none; Flags: deletekey; Check: IsAdminInstallMode
Root: HKA; Subkey: "Software\Classes\openleaguedisplay"; ValueType: string; ValueName: ""; ValueData: "URL:OpenLeagueDisplay Protocol"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\openleaguedisplay"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
; Quoted + icon index: an elevated install defaults to a Program Files path, and an unquoted path
; with a space there fails to resolve (generic icon in the browser's "Open OpenLeagueDisplay?" prompt).
Root: HKA; Subkey: "Software\Classes\openleaguedisplay\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\icon.ico"",0"
Root: HKA; Subkey: "Software\Classes\openleaguedisplay\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
; Show a "Launch OpenLeagueDisplay" checkbox on the install-complete screen.
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Inno removes what it installed and prunes the directories that empty out, so _internal normally
; goes on its own. This is a belt-and-braces sweep so a stray file (a Python __pycache__ written at
; runtime, a half-written update) can't leave the folder behind — the classic onedir uninstall
; complaint. Scoped to the app's own payload directory; {app} itself is left to Inno.
Type: filesandordirs; Name: "{app}\_internal"

; Note: uninstall removes only the app itself installed via [Files]. The wallpaper
; cache (%LOCALAPPDATA%\OpenLeagueDisplay\wallpapers) is intentionally kept so as not
; to break the currently-set wallpaper file. Users who want the data gone too delete it manually (see README).

[CustomMessages]
; 3-choice dialog text when the same version is already installed (%n = newline). Held per language.
english.AlreadyInstalled=OpenLeagueDisplay is already installed.%n%nYes = Reinstall (repair)%nNo = Uninstall%nCancel = Do nothing
japanese.AlreadyInstalled=OpenLeagueDisplay は既にインストールされています。%n%n[はい] = 再インストール（修復）%n[いいえ] = アンインストール%n[キャンセル] = 何もしない

[Code]
{ Ask a running OpenLeagueDisplay (default port 8000) to exit before we touch the install dir.
  (NB: this is a Pascal comment, so no literal braces in here.) Asking the app to close itself is
  the reliable way to release the files — Restart Manager's polite close could wait forever on the
  old onefile bootloader+child process pair. GET /api/ping first and
  check the answer really is our app (something else on :8000 shouldn't get a surprise POST);
  the POST carries the X-OLD-Local header the API requires (its CSRF gate). Then poll ping until
  the server is gone, and give the process a moment to fully exit. Every step is best-effort:
  no server / an old build without the endpoint -> fall through to CloseApplications=force. }
procedure QuitRunningApp();
var
  WinHttp: Variant;
  Resp: String;
  I: Integer;
  Alive: Boolean;
begin
  try
    WinHttp := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    WinHttp.SetTimeouts(500, 500, 500, 1000);
    WinHttp.Open('GET', 'http://127.0.0.1:8000/api/ping', False);
    WinHttp.Send('');
    { Pos() wants Strings — the Variant from COM needs an explicit hop through one }
    Resp := WinHttp.ResponseText;
    if Pos('OpenLeagueDisplay', Resp) = 0 then
      Exit;
    WinHttp.Open('POST', 'http://127.0.0.1:8000/api/quit', False);
    WinHttp.SetRequestHeader('X-OLD-Local', '1');
    WinHttp.SetRequestHeader('Content-Type', 'application/json');
    WinHttp.Send('{}');
    { Wait (up to ~5s) for the server to actually go away, then a beat for process teardown. }
    for I := 1 to 10 do
    begin
      Sleep(500);
      Alive := True;
      try
        WinHttp.Open('GET', 'http://127.0.0.1:8000/api/ping', False);
        WinHttp.Send('');
      except
        Alive := False;
      end;
      if not Alive then
        Break;
    end;
    Sleep(500);
  except
    { nothing listening — no running instance to quit }
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  QuitRunningApp();
  Result := '';   { empty = proceed with the install }
end;

function InitializeUninstall(): Boolean;
begin
  QuitRunningApp();
  Result := True;
end;

{ Read the existing install's DisplayVersion / UninstallString. Per-user installs
  register under HKCU, so prefer HKCU and fall back to HKLM in case it was elevated
  to per-machine via PrivilegesRequiredOverridesAllowed=dialog (this is a 32-bit
  installer, so the HKLM read matches the WOW6432Node view Inno wrote to). }
function GetInstalled(var Version, UninstallStr: String): Boolean;
var
  SubKey: String;
begin
  // Inno's uninstall key is the GUID wrapped in curly braces + "_is1". MyGuid has no
  // braces, so concatenate literal braces on both sides to match the real key name.
  SubKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{' + '{#MyGuid}' + '}_is1';
  Result := False;
  if RegQueryStringValue(HKCU, SubKey, 'DisplayVersion', Version) then begin
    RegQueryStringValue(HKCU, SubKey, 'UninstallString', UninstallStr);
    Result := True;
  end else if RegQueryStringValue(HKLM, SubKey, 'DisplayVersion', Version) then begin
    RegQueryStringValue(HKLM, SubKey, 'UninstallString', UninstallStr);
    Result := True;
  end;
end;

{ Branch on existing-install detection:
  - Not installed -> normal install
  - Different version (up or down) -> silently overwrite-update with no prompt (Inno default)
  - Same version -> 3-choice: Repair (reinstall) / Uninstall / Cancel }
function InitializeSetup(): Boolean;
var
  InstVer, UninstStr: String;
  ErrCode: Integer;
begin
  Result := True;
  if not GetInstalled(InstVer, UninstStr) then
    Exit;
  { String match = same version. Anything else is treated as a "different version"
    and silently proceeds (by user consent; no semantic version comparison). }
  if CompareText(InstVer, '{#AppVersion}') <> 0 then
    Exit;
  case MsgBox(ExpandConstant('{cm:AlreadyInstalled}'), mbConfirmation, MB_YESNOCANCEL) of
    IDYES:
      Result := True;        { Repair = overwrite-reinstall as-is }
    IDNO:
      begin                  { Launch the uninstaller, wait for it, then exit setup itself }
        { UninstallString is in "…\unins000.exe" form (quoted, no extra args). }
        if UninstStr <> '' then
          Exec(RemoveQuotes(UninstStr), '', '', SW_SHOW, ewWaitUntilTerminated, ErrCode);
        Result := False;
      end;
  else
    Result := False;         { Cancel }
  end;
end;
