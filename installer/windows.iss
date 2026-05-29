; Inno Setup スクリプト — OpenLeagueDisplay Windows インストーラ
; =============================================================
; PyInstaller 産物 (dist\OpenLeagueDisplay.exe) を per-user でインストールし、
; スタートメニュー / 任意のデスクトップショートカット / アンインストーラ
; (「アプリと機能」への登録) を用意する。バイナリ (exe / ico) はリポジトリに
; コミットせず、CI (release.yml) がビルド時に生成して同梱する。
;
; コンパイル (Inno Setup 6):
;   ISCC.exe /DAppVersion=1.2.3 installer\windows.iss
;   → installer\out\OpenLeagueDisplay-windows-setup.exe
; AppVersion 未指定時は "dev" になる (手動ドライラン用)。

#ifndef AppVersion
  #define AppVersion "dev"
#endif

#define AppName "OpenLeagueDisplay"
#define AppExeName "OpenLeagueDisplay.exe"
#define AppPublisher "OpenLeagueDisplay"
#define AppURL "https://github.com/badfalcon/OpenLeagueDisplay"

[Setup]
; AppId はアンインストール登録キーを安定させるため固定する (絶対に変えない)。
AppId={{8F4C2A91-3B6D-4E27-9A1F-2C5D8E0B7A43}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
; per-user インストール: UAC 昇格不要。アプリのデータ (壁紙キャッシュ %LOCALAPPDATA% /
; HKCU の壁紙設定) が元々 per-user なので権限モデルと一致する。
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
; デスクトップショートカットは既定 ON だがユーザーが解除できる。
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
; インストール完了画面に「OpenLeagueDisplay を起動する」チェックを出す。
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

; 注: アンインストールでは [Files] で入れたアプリ本体のみ削除する。壁紙キャッシュ
; (%LOCALAPPDATA%\OpenLeagueDisplay\wallpapers) は現在設定中の壁紙ファイルを壊さない
; ため意図的に残す。データも消したいユーザーは手動で削除する (README 参照)。
