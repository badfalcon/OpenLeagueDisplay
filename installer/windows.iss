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
; AppId の GUID 本体。[Setup] の AppId と [Code] の既インストール検知 (アンインストール
; レジストリキー …\Uninstall\{GUID}_is1) の両方で使い回し、二重管理を避ける。絶対に変えない。
#define MyGuid "8F4C2A91-3B6D-4E27-9A1F-2C5D8E0B7A43"

; ウィザードのタイトル/ようこそ画面に出る表示名 (AppVerName)。未指定だと Inno は
; "AppName version AppVersion" を使い、ドライラン (dev) では「OpenLeagueDisplay バージョン
; dev セットアップ」と不格好になる。dev ではバージョンを出さず、実リリース (vX.Y.Z) の
; ときだけ "OpenLeagueDisplay X.Y.Z" と出す。
#if AppVersion == "dev"
  #define AppDisplayName AppName
#else
  #define AppDisplayName AppName + " " + AppVersion
#endif

[Setup]
; AppId はアンインストール登録キーを安定させるため固定する (絶対に変えない)。
; 先頭の {{ はリテラルの { のエスケープ → 実 AppId は {GUID}。
AppId={{{#MyGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
; 表示名はバージョン分岐 (上の #define 参照)。AppVersion はアンインストール登録に残す。
AppVerName={#AppDisplayName}
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

[CustomMessages]
; 既に同一バージョンが入っているときの 3択ダイアログ文 (%n = 改行)。言語別に持つ。
english.AlreadyInstalled=OpenLeagueDisplay is already installed.%n%nYes = Reinstall (repair)%nNo = Uninstall%nCancel = Do nothing
japanese.AlreadyInstalled=OpenLeagueDisplay は既にインストールされています。%n%n[はい] = 再インストール（修復）%n[いいえ] = アンインストール%n[キャンセル] = 何もしない

[Code]
{ 既インストールの DisplayVersion / UninstallString を取得する。per-user は HKCU に
  登録されるので HKCU を優先し、PrivilegesRequiredOverridesAllowed=dialog で昇格
  per-machine になった場合に備えて HKLM もフォールバックで見る (32bit インストーラ
  なので HKLM 参照は Inno が書いた WOW6432Node ビューと一致する)。 }
function GetInstalled(var Version, UninstallStr: String): Boolean;
var
  SubKey: String;
begin
  // Inno のアンインストールキーは GUID を波括弧で囲んだ名前 + "_is1"。MyGuid は波括弧
  // 無しなので、両脇にリテラルの波括弧を連結して実キー名に一致させる。
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

{ 既インストール検知で分岐:
  - 未インストール → 通常インストール
  - 別バージョン (上げ/下げ問わず) → 何も出さず黙って上書き更新 (Inno 既定)
  - 同一バージョン → 修復(再インストール) / アンインストール / キャンセル の 3択 }
function InitializeSetup(): Boolean;
var
  InstVer, UninstStr: String;
  ErrCode: Integer;
begin
  Result := True;
  if not GetInstalled(InstVer, UninstStr) then
    Exit;
  { 文字列一致＝同一版。それ以外は「別バージョン」として黙って続行 (ユーザー合意。
    セマンティックな版の大小比較はしない)。 }
  if CompareText(InstVer, '{#AppVersion}') <> 0 then
    Exit;
  case MsgBox(ExpandConstant('{cm:AlreadyInstalled}'), mbConfirmation, MB_YESNOCANCEL) of
    IDYES:
      Result := True;        { 修復 = そのまま上書き再インストール }
    IDNO:
      begin                  { アンインストーラを起動し、完了を待って setup 自体は終了 }
        { UninstallString は "…\unins000.exe" 形式 (引用符付き・追加引数なし)。 }
        if UninstStr <> '' then
          Exec(RemoveQuotes(UninstStr), '', '', SW_SHOW, ewWaitUntilTerminated, ErrCode);
        Result := False;
      end;
  else
    Result := False;         { キャンセル }
  end;
end;
