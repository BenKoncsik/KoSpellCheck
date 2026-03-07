param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
node (Join-Path $root "Coral-tpu/tools/koscoral-model-cli.mjs") @Args
