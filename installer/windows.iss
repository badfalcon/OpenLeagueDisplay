; Inno Setup script — OpenLeagueDisplay Windows installer
; =============================================================
; Installs the PyInstaller output (dist\OpenLeagueDisplay.exe) per-user, with a
; Start Menu entry / optional desktop shortcut / uninstaller (registered in
; "Apps & features"). The binaries (exe / ico) are not committed to the repo;
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

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
; The desktop shortcut is on by default but the user can opt out.
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
; Show a "Launch OpenLeagueDisplay" checkbox on the install-complete screen.
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

; Note: uninstall removes only the app itself installed via [Files]. The wallpaper
; cache (%LOCALAPPDATA%\OpenLeagueDisplay\wallpapers) is intentionally kept so as not
; to break the currently-set wallpaper file. Users who want the data gone too delete it manually (see README).

[CustomMessages]
; 3-choice dialog text when the same version is already installed (%n = newline). Held per language.
english.AlreadyInstalled=OpenLeagueDisplay is already installed.%n%nYes = Reinstall (repair)%nNo = Uninstall%nCancel = Do nothing
japanese.AlreadyInstalled=OpenLeagueDisplay は既にインストールされています。%n%n[はい] = 再インストール（修復）%n[いいえ] = アンインストール%n[キャンセル] = 何もしない

[Code]
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
