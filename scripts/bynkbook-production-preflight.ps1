$ErrorActionPreference = "Stop"

$ExpectedBranch = "main"
$ExpectedAwsProfile = "ledrigo-dev"
$ExpectedAwsAccount = "116846786465"
$ProductionAppUrl = "https://app.bynkbook.com"
$ProductionApiUrl = "https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com"
$HasFailure = $false

function Write-Pass {
    param([string]$Message)
    Write-Host "PASS: $Message"
}

function Write-Stop {
    param([string]$Message)
    Write-Host "STOP: $Message"
    $script:HasFailure = $true
}

function Invoke-ReadOnlyCommand {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    $output = & $Command @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($output | Out-String)
    }

    return $output
}

Write-Host "INFO: Bynkbook production preflight helper"
Write-Host "INFO: this helper is read-only"
Write-Host "INFO: this helper does not deploy"
Write-Host "INFO: this helper does not run production API checks"
Write-Host "INFO: this helper does not mutate production data"
Write-Host "INFO: approved production app URL: $ProductionAppUrl"
Write-Host "INFO: approved production API URL: $ProductionApiUrl"

try {
    $currentBranch = (Invoke-ReadOnlyCommand -Command "git" -Arguments @("branch", "--show-current") | Out-String).Trim()
    if ($currentBranch -eq $ExpectedBranch) {
        Write-Pass "current branch is main"
    } else {
        Write-Stop "current branch is not main"
    }
} catch {
    Write-Stop "git branch check failed"
}

try {
    $status = (Invoke-ReadOnlyCommand -Command "git" -Arguments @("status", "--short") | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($status)) {
        Write-Pass "working tree is clean"
    } else {
        Write-Stop "working tree is not clean"
    }
} catch {
    Write-Stop "git status check failed"
}

try {
    Invoke-ReadOnlyCommand -Command "git" -Arguments @("fetch", "origin", "main") | Out-Null
    $localMain = (Invoke-ReadOnlyCommand -Command "git" -Arguments @("rev-parse", "main") | Out-String).Trim()
    $originMain = (Invoke-ReadOnlyCommand -Command "git" -Arguments @("rev-parse", "origin/main") | Out-String).Trim()

    if ($localMain -eq $originMain) {
        Write-Pass "local main matches origin/main"
    } else {
        Write-Stop "local main does not match origin/main"
    }
} catch {
    Write-Stop "local main alignment check failed"
}

if ($env:AWS_PROFILE -eq $ExpectedAwsProfile) {
    Write-Pass "AWS_PROFILE is ledrigo-dev"
} else {
    Write-Stop "AWS_PROFILE is not ledrigo-dev"
}

if ($HasFailure) {
    Write-Host "STOP: fix failed preflight checks before any production validation or deployment approval"
    exit 1
}

try {
    $identityRaw = Invoke-ReadOnlyCommand -Command "aws" -Arguments @("sts", "get-caller-identity")
    $identityText = ($identityRaw | Out-String).Trim()
    $identity = $identityText | ConvertFrom-Json

    if ($identity.Account -eq $ExpectedAwsAccount) {
        Write-Pass "AWS account is 116846786465"
    } else {
        Write-Stop "AWS account mismatch"
    }
} catch {
    Write-Stop "AWS CLI unavailable or identity check failed"
}

if ($HasFailure) {
    Write-Host "STOP: fix failed preflight checks before any production validation or deployment approval"
    exit 1
}

Write-Pass "production preflight checks passed"
Write-Host "PASS: operator may proceed to manual validation or request deployment approval"
Write-Host "STOP: deployment still requires explicit approval"
exit 0
