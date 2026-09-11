# Fixed native filesystem helper. Input is JSON on stdin, never executable text.
# It inspects security descriptors without reading credentials or state contents.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $path = [System.IO.Path]::GetFullPath([string]$request.path)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    switch ($request.action) {
        'inspect' {
            $acl = Get-Acl -LiteralPath $path
            $descriptor = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
            $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
                @{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [int]$_.FileSystemRights }
            })
            @{
                user = $identity.Value
                owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
                hasDacl = $null -ne $descriptor.DiscretionaryAcl
                reparse = ([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
                rules = $rules
            } | ConvertTo-Json -Depth 5 -Compress
        }
        'create-directory' {
            $security = [System.Security.AccessControl.DirectorySecurity]::new()
            $security.SetAccessRuleProtection($true, $false)
            $security.SetOwner($identity)
            foreach ($sid in @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')) {
                $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                    [System.Security.Principal.SecurityIdentifier]::new($sid),
                    [System.Security.AccessControl.FileSystemRights]::FullControl,
                    [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
                    [System.Security.AccessControl.PropagationFlags]::None,
                    [System.Security.AccessControl.AccessControlType]::Allow)
                $security.AddAccessRule($rule)
            }
            # The DACL is supplied at creation. Existing directories are untouched
            # and are checked by the caller before any protected data is written.
            [System.IO.Directory]::CreateDirectory($path, $security) | Out-Null
            '{"created":true}'
        }
        'replace' {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SaffronStateFile {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool MoveFileEx(string source, string destination, uint flags);
}
'@
            # MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH; no cross-volume copy.
            if (-not [SaffronStateFile]::MoveFileEx($path, [string]$request.destination, 9)) { throw 'State replacement failed.' }
            '{"replaced":true}'
        }
        default { throw 'Unsupported protected-file operation.' }
    }
} catch {
    # Exceptions may contain private paths. Return only failure to the caller.
    exit 1
}
